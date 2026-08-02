/**
 * 一次性维护脚本：将指定用户升级为超级管理员（role = 'super_admin'）。
 *
 * 适用场景：
 *  - 老库（已部署服务器）从单用户迁移到多用户隔离架构后，登录账号 role 仍是 'user'，
 *    导致设置页看不到「用户管理」模块。
 *  - 也适用于修复 init 逻辑在「库非空但无 super_admin」时的静默回退问题。
 *
 * 用法（在服务器宿主机执行，直接操作 miniflare 的 D1 sqlite 文件）：
 *   npx tsx scripts/make-admin.ts <username> [--db <path-to.sqlite>]
 *
 * 参数：
 *   username  要升级为超级管理员的登录用户名（如 admin）
 *   --db      指定 D1 sqlite 文件路径；不传则自动在 data/ 下扫描第一个 *.sqlite
 *
 * 注意：
 *  - miniflare 的 D1 文件可能处于 WAL 模式，脚本会先执行 wal_checkpoint(FULL) 再改，
 *    确保读到的数据是最新的、且改动能落盘。
 *  - 修改前会自动打印当前 users 表，便于确认。
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

function fail(message: string): never {
  console.error(`\n[错误] ${message}`);
  process.exit(1);
}

function findDbPath(): string | null {
  const candidates: string[] = [];
  const roots = ["data", "data/v3", "."];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    const walk = (dir: string): void => {
      let entries: string[];
      try {
        entries = readdirSync(dir);
      } catch {
        return;
      }
      for (const name of entries) {
        if (name === "metadata.sqlite" || name.endsWith("-shm") || name.endsWith("-wal")) continue;
        const full = join(dir, name);
        try {
          const st = statSync(full);
          if (st.isDirectory()) {
            walk(full);
          } else if (name.endsWith(".sqlite") && !name.startsWith("metadata")) {
            candidates.push(full);
          }
        } catch {
          /* ignore */
        }
      }
    };
    walk(root);
  }
  // 优先选体积最大的（真实业务库，而非空壳）
  candidates.sort((a, b) => {
    try {
      return statSync(b).size - statSync(a).size;
    } catch {
      return 0;
    }
  });
  return candidates[0] ?? null;
}

function sqlite(db: string, sql: string): string {
  return execFileSync("sqlite3", [db, sql], { encoding: "utf8" }).trim();
}

function main(): void {
  const args = process.argv.slice(2);
  const positional = args.filter((a) => !a.startsWith("--"));
  const flagDb = args.find((a) => a.startsWith("--db="))?.split("=")[1];
  const dbFlagIdx = args.findIndex((a) => a.startsWith("--db"));
  if (dbFlagIdx >= 0 && !flagDb && args[dbFlagIdx + 1]) {
    // 兼容 --db <path> 写法
  }

  const username = positional[0];
  if (!username) {
    fail("缺少用户名参数。用法：npx tsx scripts/make-admin.ts <username> [--db <path>]");
  }

  let db = flagDb;
  if (!db && dbFlagIdx >= 0 && args[dbFlagIdx + 1]) {
    db = args[dbFlagIdx + 1];
  }
  if (!db) {
    db = findDbPath() ?? undefined;
  }
  if (!db || !existsSync(db)) {
    fail(
      `找不到 D1 sqlite 文件。请显式指定：--db <path>\n` +
        `  例如：npx tsx scripts/make-admin.ts ${username} --db data/v3/d1/miniflare-D1DatabaseObject/xxxx.sqlite`,
    );
  }
  console.log(`[信息] 使用数据库：${db}`);

  // 检查 sqlite3 CLI 是否可用
  try {
    execFileSync("sqlite3", ["--version"], { encoding: "utf8" });
  } catch {
    fail("未检测到 sqlite3 CLI。请先安装：sudo apt-get install -y sqlite3");
  }

  // 1) WAL 落盘
  try {
    sqlite(db, "PRAGMA wal_checkpoint(FULL);");
    console.log("[信息] 已执行 wal_checkpoint(FULL)，WAL 数据已合并。");
  } catch (e) {
    console.warn(`[警告] wal_checkpoint 失败（可忽略）：${(e as Error).message}`);
  }

  // 2) 打印当前用户表
  console.log("\n[当前 users 表]");
  try {
    const rows = sqlite(db, "SELECT id, username, role, disabled FROM users ORDER BY id ASC;");
    console.log(rows || "(空)");
  } catch (e) {
    fail(`读取 users 表失败：${(e as Error).message}`);
  }

  // 3) 校验目标用户存在
  let targetId: number | null = null;
  try {
    const row = sqlite(db, `SELECT id FROM users WHERE username = '${username.replace(/'/g, "''")}';`);
    if (row) targetId = Number(row);
  } catch {
    /* ignore */
  }
  if (targetId == null) {
    fail(`用户 "${username}" 不存在于 users 表。`);
  }

  // 4) 升级为 super_admin
  try {
    sqlite(db, `UPDATE users SET role = 'super_admin' WHERE id = ${targetId};`);
  } catch (e) {
    fail(`升级失败：${(e as Error).message}`);
  }

  // 5) 校验结果
  const after = sqlite(db, `SELECT id, username, role FROM users WHERE id = ${targetId};`);
  console.log(`\n[成功] 已将用户升级为超级管理员：\n${after}`);
  console.log("\n下一步：");
  console.log("  1. 重新构建部署（REBUILD=1 ./deploy.sh），让 ensureSchema 的新逻辑 + 加列生效。");
  console.log("  2. 退出当前会话，用该账号重新登录（session token 重新签发才会携带 role=super_admin）。");
  console.log("  3. 设置页将出现「用户管理」模块。");
}

main();
