import { requireApiUser } from "../../../../lib/auth";
import { execFileSync } from "child_process";
import {
  SUPPORTS_EXEC,
  resolvePython,
  forwardToDaemon,
  isExecNotImplemented,
} from "../../../../lib/pythonExec";
import path from "path";

/**
 * 计算项目根目录（延迟求值，避免在 Workers/Miniflare 模块顶层
 * 使用 import.meta.url/fileURLToPath 导致 "path must be string" 崩溃）。
 */
function projectRoot(): string {
  return path.resolve(process.cwd(), "../../..");
}

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
function dumpScript(): string {
  return path.join(projectRoot(), "trading_agent", "dump_config.py");
}

export async function GET() {
  const unauthorized = await requireApiUser();
  if (unauthorized) return unauthorized;

  if (SUPPORTS_EXEC) {
    try {
      const DUMP = dumpScript();
      const python = resolvePython();
      const stdout = execFileSync(python, [DUMP], {
        cwd: path.join(projectRoot(), "trading_agent"),
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
