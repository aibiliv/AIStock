import { desc } from "drizzle-orm";
import { requireApiUser, pushSharedSecret } from "../../../lib/auth";
import { getDb, ensureSchema } from "../../../db";
import { strategyScan } from "../../../db/schema";
import { shanghaiIso } from "../../../lib/time";

const MAX_PUSH_BYTES = 1_000_000;

/**
 * 策略扫描接口（跨机器联动 · 本地 PC 推送 / 云端读取）
 *
 * 部署形态：trading_agent 运行在本地 PC，AIStock（本服务）部署在远程云服务器。
 * - GET  ：前端「策略扫描」页读取最新扫描结果（来自 D1 表 strategy_scan）。
 * - POST ：本地 trading_agent 推送扫描 JSON，校验 token 后写入 D1。
 *
 * 存储：使用 D1（Cloudflare Workers 原生、受沙箱允许），而非裸文件系统写入。
 *   docker-compose 把 ./data 挂为 --persist-to /data，D1 持久化与此卷绑定，容器重建不丢。
 *
 * 鉴权：POST 需要 header `x-push-token`，值等于云端环境变量
 *   STRATEGY_PUSH_TOKEN（未设置时回退到 CRON_SECRET）。
 */
async function readLocalScanPayload(): Promise<unknown | null> {
  try {
    const [{ existsSync, readFileSync }, path] = await Promise.all([
      import("node:fs"),
      import("node:path"),
    ]);
    const localPath = path.join(process.cwd(), "trading_agent", "scan_payload.json");
    if (!existsSync(localPath)) return null;
    return JSON.parse(readFileSync(localPath, "utf-8"));
  } catch {
    return null;
  }
}

export async function GET() {
  const unauthorized = await requireApiUser();
  if (unauthorized) return unauthorized;
  try {
    await ensureSchema();
    const db = getDb();
    const rows = await db
      .select()
      .from(strategyScan)
      .orderBy(desc(strategyScan.createdAt))
      .limit(1);
    if (!rows.length) {
      // 本地兜底：云端 D1 无数据时，回退读取本机引擎产物 scan_payload.json，
      // 让本地 `npm run dev` 也能直接看到最近一次扫描结果（无需先推送到云端）。
      const localScan = await readLocalScanPayload();
      if (localScan) return Response.json({ ok: true, scan: localScan, source: "local-file" });
      // 无数据属正常业务状态，用 200 返回（避免被浏览器/监控当作路由 404 异常）。
      return Response.json({
        ok: false,
        scan: null,
        error:
          "尚未生成策略扫描结果。请点击页面上的「应用并扫描」在本地运行引擎，或先在本地 PC 运行 trading_agent。",
      });
    }
    const scan = JSON.parse(rows[0].payload);
    return Response.json({ ok: true, scan });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ ok: false, error: msg }, { status: 500 });
  }
}

export async function POST(req: Request) {
  // 推送鉴权：本地 PC 持有的 token 需与云端一致
  const secret = pushSharedSecret();
  const provided =
    req.headers.get("x-push-token") ||
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
    undefined;
  if (!secret || provided !== secret) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const contentLength = Number(req.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_PUSH_BYTES) {
    return Response.json({ ok: false, error: "payload too large" }, { status: 413 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "invalid json" }, { status: 400 });
  }

  if (
    !body ||
    typeof body !== "object" ||
    !("selected" in (body as Record<string, unknown>))
  ) {
    return Response.json(
      { ok: false, error: "invalid payload: missing 'selected'" },
      { status: 400 },
    );
  }

  try {
    const payload = JSON.stringify(body);
    if (payload.length > MAX_PUSH_BYTES) {
      return Response.json({ ok: false, error: "payload too large" }, { status: 413 });
    }
    await ensureSchema();
    const db = getDb();
    await db.insert(strategyScan).values({ payload });
    return Response.json({ ok: true, savedAt: shanghaiIso() });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json(
      { ok: false, error: `write failed: ${msg}` },
      { status: 500 },
    );
  }
}
