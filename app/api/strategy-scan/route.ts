import { readFile, writeFile, mkdir } from "fs/promises";
import { dirname } from "path";
import { requireApiUser } from "../../../lib/auth";

/**
 * 策略扫描接口（跨机器联动 · 本地 PC 推送 / 云端读取）
 *
 * 部署形态：trading_agent 运行在本地 PC，AIStock（本服务）部署在远程云服务器。
 * - GET  ：前端读取最新扫描结果（来自 /data 卷文件）。
 * - POST ：本地 trading_agent 推送扫描 JSON，校验 token 后写入 /data 卷文件。
 *
 * 存储位置（Docker 部署）：/data/strategy-scan/latest.json
 *   - docker-compose 已将 ./data 挂载为持久化卷，容器重建不丢。
 *   - 可用环境变量 STRATEGY_SCAN_FILE 覆盖路径。
 *
 * 鉴权：POST 需要 header `x-push-token`，值等于云端环境变量
 *   STRATEGY_PUSH_TOKEN（未设置时回退到 CRON_SECRET）。
 */
const SCAN_FILE =
  process.env.STRATEGY_SCAN_FILE || "/data/strategy-scan/latest.json";

function pushSecret(): string | undefined {
  return process.env.STRATEGY_PUSH_TOKEN || process.env.CRON_SECRET || undefined;
}

export async function GET() {
  const unauthorized = await requireApiUser();
  if (unauthorized) return unauthorized;
  try {
    const raw = await readFile(SCAN_FILE, "utf-8");
    const scan = JSON.parse(raw);
    return Response.json({ ok: true, scan });
  } catch {
    return Response.json(
      {
        ok: false,
        error:
          "尚未生成策略扫描结果。请先在本地 PC 运行 trading_agent 并推送到本服务（POST /api/strategy-scan）。",
      },
      { status: 404 },
    );
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
    await mkdir(dirname(SCAN_FILE), { recursive: true });
    await writeFile(SCAN_FILE, JSON.stringify(body), "utf-8");
    return Response.json({ ok: true, savedAt: new Date().toISOString() });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json(
      { ok: false, error: `write failed: ${msg}` },
      { status: 500 },
    );
  }
}
