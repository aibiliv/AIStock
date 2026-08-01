import { desc } from "drizzle-orm";
import { requireApiUser } from "../../../lib/auth";
import { getDb, ensureSchema } from "../../../db";
import { strategyScan } from "../../../db/schema";

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
function pushSecret(): string | undefined {
  return process.env.STRATEGY_PUSH_TOKEN || process.env.CRON_SECRET || undefined;
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
      return Response.json(
        {
          ok: false,
          error:
            "尚未生成策略扫描结果。请先在本地 PC 运行 trading_agent 并推送到本服务（POST /api/strategy-scan）。",
        },
        { status: 404 },
      );
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
  const secret = pushSecret();
  const provided =
    req.headers.get("x-push-token") ||
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
    undefined;
  if (!secret || provided !== secret) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
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
    await ensureSchema();
    const db = getDb();
    await db.insert(strategyScan).values({ payload: JSON.stringify(body) });
    return Response.json({ ok: true, savedAt: new Date().toISOString() });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json(
      { ok: false, error: `write failed: ${msg}` },
      { status: 500 },
    );
  }
}
