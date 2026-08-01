import { readFile, writeFile, mkdir } from "fs/promises";
import { dirname } from "path";
import { requireApiUser } from "../../../lib/auth";

/**
 * 回写结果接口（跨机器联动 · 本地 PC 推送 / 云端读取）
 *
 * 部署形态：trading_agent 运行在本地 PC，AIStock（本服务）部署在远程云服务器。
 * - GET  ：前端「回写结果」页读取最新候选回写信号（来自 /data 卷文件）。
 * - POST ：本地 trading_agent 推送候选回写 JSON，校验 token 后写入 /data 卷文件。
 *
 * 存储位置（Docker 部署）：/data/strategy-writeback/latest.json
 *   - docker-compose 已将 ./data 挂载为持久化卷，容器重建不丢。
 *   - 可用环境变量 WRITEBACK_FILE 覆盖路径。
 *
 * 鉴权：POST 需要 header `x-push-token`，值等于云端环境变量
 *   STRATEGY_PUSH_TOKEN（未设置时回退到 CRON_SECRET）。
 *
 * 说明：当前本环境的 tdx-connector 仅暴露查询工具（无 place_order），
 *   因此枢纽推送过来的信号恒为「候选回写 / dry-run」，真实下单需接入带下单能力的连接器。
 */
const WRITEBACK_FILE =
  process.env.WRITEBACK_FILE || "/data/strategy-writeback/latest.json";

function pushSecret(): string | undefined {
  return process.env.STRATEGY_PUSH_TOKEN || process.env.CRON_SECRET || undefined;
}

export async function GET() {
  const unauthorized = await requireApiUser();
  if (unauthorized) return unauthorized;
  try {
    const raw = await readFile(WRITEBACK_FILE, "utf-8");
    const writeback = JSON.parse(raw);
    return Response.json({ ok: true, writeback });
  } catch {
    return Response.json(
      {
        ok: false,
        error:
          "尚未生成回写结果。请先在本地 PC 运行 trading_agent，并推送到本服务（POST /api/writeback-signals）。",
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
    !("signals" in (body as Record<string, unknown>))
  ) {
    return Response.json(
      { ok: false, error: "invalid payload: missing 'signals'" },
      { status: 400 },
    );
  }

  try {
    await mkdir(dirname(WRITEBACK_FILE), { recursive: true });
    await writeFile(WRITEBACK_FILE, JSON.stringify(body), "utf-8");
    return Response.json({ ok: true, savedAt: new Date().toISOString() });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json(
      { ok: false, error: `write failed: ${msg}` },
      { status: 500 },
    );
  }
}
