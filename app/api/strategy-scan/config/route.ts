import { requireApiUser } from "../../../../lib/auth";
import { execFileSync } from "child_process";
import {
  SUPPORTS_EXEC,
  resolvePython,
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
 * - 真实 Node 部署：直接 exec python dump_config.py 读取最新 YAML（含人工改动）。
 * - Cloudflare Workers / vinext 沙箱（云端部署，禁 child_process）：exec 不可用，
 *   回退到内置默认配置（与 strategy_config.yaml 的默认值保持一致），保证前端
 *   仍可正常配置/展示扫描条件；真正的引擎执行由本地程序拉取该配置后运行。
 */
function dumpScript(): string {
  return path.join(projectRoot(), "trading_agent", "dump_config.py");
}

// 云端/沙箱回退用的默认配置（与 trading_agent/strategy_config.yaml 默认值同步）。
// 仅用于「配置展示与编辑」，不参与实际选股计算。
const FALLBACK_CONFIG = {
  screener: {
    top_n: 8,
    max_per_sector: 2,
    momentum_window: 20,
    w_momentum: 0.3,
    w_value: 0.18,
    w_liquidity: 0.08,
    w_rsi: 0.12,
    w_macd: 0.12,
    w_trend: 0.16,
    w_size: 0.04,
    w_quality: 0.06,
    rsi_window: 14,
    macd_fast: 12,
    macd_slow: 26,
    macd_signal: 9,
    vol_window: 20,
    min_turnover_pct: 0.15,
    max_pe_ttm: 200.0,
    max_pb: 20.0,
    boards: ["main", "cyb", "kc", "bj"],
    st_filter: "exclude_st",
    mcap_min: 0.0,
    mcap_max: 10000.0,
  },
  market: {
    enable: true,
    index_code: "000300",
    ma_window: 120,
    mom_window: 60,
    bull_ma_gap: 0.0,
    bear_ma_gap: -0.03,
    bull_mom: 0.08,
    bear_mom: -0.05,
  },
  signal: {
    fast_ma: 5,
    slow_ma: 20,
    use_breakout_filter: true,
    breakout_window: 20,
    stop_loss_pct: -0.08,
    max_positions: 8,
  },
  optim: {
    enabled: true,
  },
};

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
      // 沙箱禁 child_process / exec 不可用 -> 回退内置默认配置，保证前端可配置
      if (isExecNotImplemented(msg)) {
        return Response.json({
          ok: true,
          config: FALLBACK_CONFIG,
          note: "云端环境（沙箱）无法读取实时 YAML，已返回内置默认配置。实际选股由本地程序拉取本配置后执行。",
        });
      }
      console.error("[strategy-scan/config] error:", msg);
      return Response.json(
        { ok: false, error: `读取配置失败: ${msg}` },
        { status: 500 },
      );
    }
  }

  // Workers / Miniflare 沙箱 -> 返回内置默认配置
  return Response.json({
    ok: true,
    config: FALLBACK_CONFIG,
    note: "云端环境（沙箱）无法读取实时 YAML，已返回内置默认配置。实际选股由本地程序拉取本配置后执行。",
  });
}
