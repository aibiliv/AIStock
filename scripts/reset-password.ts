/**
 * 一次性维护脚本：重置指定用户的登录密码（与 lib/crypto.ts 的 pbkdf2Hash 保持一致的算法）。
 *
 * 适用场景：
 *  - APP_PASSWORD 明文曾泄露，需要为 admin 重设一个更安全的密码；
 *  - 忘记密码后强制重置。
 *
 * 用法（在服务器宿主机执行，直接操作 miniflare 的 D1 sqlite 文件）：
 *   npx tsx scripts/reset-password.ts <username> <newPassword> [--db <path-to.sqlite>]
 *
 * 算法：PBKDF2(SHA-256, salt=16字节随机, iterations=100_000)，salt/hash 以 base64url 存入。
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { webcrypto } from "node:crypto";

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
  // 优先选「含 users 表」的文件（而非体积最大），避免选错库
  for (const c of candidates) {
    try {
      const out = execFileSync("sqlite3", [c, "SELECT name FROM sqlite_master WHERE type='table' AND name='users';"], {
        encoding: "utf8",
      }).trim();
      if (out === "users") return c;
    } catch {
      /* ignore */
    }
  }
  return null;
}

function sqlite(db: string, sql: string): string {
  return execFileSync("sqlite3", [db, sql], { encoding: "utf8" }).trim();
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return Buffer.from(bin, "binary").toString("base64url");
}

async function pbkdf2Hash(password: string, salt: string): Promise<string> {
  const encoder = new TextEncoder();
  const keyMaterial = await webcrypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits"],
  );
  const bits = await webcrypto.subtle.deriveBits(
    { name: "PBKDF2", salt: encoder.encode(salt), iterations: 100_000, hash: "SHA-256" },
    keyMaterial,
    256,
  );
  return bytesToBase64Url(new Uint8Array(bits));
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const positional = args.filter((a) => !a.startsWith("--"));
  const flagDb = args.find((a) => a.startsWith("--db="))?.split("=")[1];

  const username = positional[0];
  const newPassword = positional[1];
  if (!username || !newPassword) {
    fail("缺少参数。用法：npx tsx scripts/reset-password.ts <username> <newPassword> [--db <path>]");
  }
  if (newPassword.length < 12) {
    fail("新密码至少 12 位（与 APP_PASSWORD 校验规则一致）。");
  }

  let db = flagDb;
  if (!db) db = findDbPath() ?? undefined;
  if (!db || !existsSync(db)) {
    fail("找不到含 users 表的 D1 sqlite 文件。请显式指定：--db <path>");
  }
  console.log(`[信息] 使用数据库：${db}`);

  try {
    execFileSync("sqlite3", ["--version"], { encoding: "utf8" });
  } catch {
    fail("未检测到 sqlite3 CLI。请先安装：sudo apt-get install -y sqlite3");
  }

  // WAL 落盘
  try {
    sqlite(db, "PRAGMA wal_checkpoint(FULL);");
  } catch (e) {
    console.warn(`[警告] wal_checkpoint 失败（可忽略）：${(e as Error).message}`);
  }

  // 确认用户存在
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

  // 生成 salt + hash
  const saltBytes = webcrypto.getRandomValues(new Uint8Array(16));
  const salt = bytesToBase64Url(saltBytes);
  const hash = await pbkdf2Hash(newPassword, salt);

  try {
    sqlite(
      db,
      `UPDATE users SET passwordSalt = '${salt}', passwordHash = '${hash}', disabled = 0 WHERE id = ${targetId};`,
    );
  } catch (e) {
    fail(`更新密码失败：${(e as Error).message}`);
  }

  console.log(`\n[成功] 已为账号 "${username}" (id=${targetId}) 重置密码并启用。`);
  console.log("下一步：用新密码重新登录。旧 session 仍可登录，但建议重新登录以获取最新角色信息。");
}

main();
