import { requireApiUser } from "../../../../lib/auth";
import { execFileSync } from "child_process";
import {
  SUPPORTS_EXEC,
  resolvePython,
  forwardToDaemon,
  isExecNotImplemented,
} from "../../../../lib/pythonExec";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * 读取当前选股默认配置（strategy_config.yaml 摊平结果）
 *
 * GET /api/strategy-scan/config
 *
 * 返回 trading_agent 的持久默认配置，供前端「策略扫描」面板初始化表单，
 * 使网页与 CLI 共用同一份 strategy_config.yaml。
 *
 * 真实 Node 直接执行；Workers / Miniflare 沙箱则转发给本机守护进程。
 */
const PROJECT_ROOT = path.resolve(__dirname, "../../../../");
const DUMP = path.join(PROJECT_ROOT, "trading_agent", "dump_config.py");

export async function GET() {
  const unauthorized = await requireApiUser();
  if (unauthorized) return unauthorized;

  if (SUPPORTS_EXEC) {
    try {
      const python = resolvePython();
      const stdout = execFileSync(python, [DUMP], {
        cwd: path.join(PROJECT_ROOT, "trading_agent"),
        timeout: 15000,
        encoding: "utf-8",
        env: { ...process.env },
      });
      const cfg = JSON.parse(stdout.trim().split("\n").pop() || "{}");
      return Response.json({ ok: true, config: cfg });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      // 伪 Node 环境 -> 转发守护进程
      if (isExecNotImplemented(msg)) return forwardToDaemon("/config");
      console.error("[strategy-scan/config] error:", msg);
      return Response.json(
        { ok: false, error: `读取配置失败: ${msg}` },
        { status: 500 },
      );
    }
  }

  // Workers / Miniflare 沙箱 -> 转发本机守护进程
  return forwardToDaemon("/config");
}
