"""优化策略模块

对信号参数（快/慢均线）做网格搜索，以夏普（或指定指标）为目标，
在已选标的的历史数据上挑选更优参数组合，形成「回测→优化」迭代。
"""
from __future__ import annotations

import copy

import config
from strategy import signals
from backtest import engine


def apply_feedback_adjustment(cfg: config.AppConfig) -> config.AppConfig:
    """读取用户反馈，自适应调整因子权重与止损。

    正面反馈占比高 -> 强化动量因子、放宽止损（当前策略被认可）；
    占比低 -> 偏价值/流动性、收紧止损（当前策略需更谨慎）。
    """
    from feedback_store import feedback_summary

    try:
        s = feedback_summary()
    except Exception:  # noqa: BLE001
        return cfg
    if s["count"] == 0:
        return cfg

    ratio = s["positive_ratio"]
    w_mom = 0.3 + 0.4 * ratio
    w_val = 0.45 - 0.2 * ratio
    w_liq = max(0.1, round(1 - w_mom - w_val, 2))
    w_mom = round(w_mom, 2)
    w_val = round(w_val, 2)
    cfg.screener.w_momentum = w_mom
    cfg.screener.w_value = w_val
    cfg.screener.w_liquidity = w_liq
    cfg.signal.stop_loss_pct = round(-(0.06 + 0.04 * (1 - ratio)), 2)
    return cfg


def optimize(code_klines: dict, codes: list[str], cfg: config.AppConfig) -> dict:
    # 反馈闭环：用历史用户评价自适应调整参数后再搜索
    cfg = copy.deepcopy(cfg)
    cfg = apply_feedback_adjustment(cfg)

    ocfg = cfg.optim
    grid = []
    for f in ocfg.fast_ma_grid:
        for s in ocfg.slow_ma_grid:
            if f < s:
                grid.append((f, s))

    results = []
    best = None
    base_signal = cfg.signal
    for f, s in grid:
        c = copy.copy(cfg)
        c.signal = copy.copy(base_signal)
        c.signal.fast_ma = f
        c.signal.slow_ma = s
        code_signals = {code: signals.generate_signals(code_klines[code], c.signal) for code in codes}
        bt = engine.backtest(code_klines, code_signals, c)
        metric_val = bt["metrics"].get(ocfg.metric, 0.0)
        results.append({
            "fast_ma": f, "slow_ma": s,
            "metric": round(metric_val, 4),
            "sharpe": round(bt["metrics"]["sharpe"], 3),
            "total_return": round(bt["metrics"]["total_return"], 4),
            "max_drawdown": round(bt["metrics"]["max_drawdown"], 4),
        })
        if best is None or metric_val > best[1]:
            best = ((f, s), metric_val, bt)

    best_params, best_metric, best_bt = best
    best_signal = copy.copy(base_signal)
    best_signal.fast_ma, best_signal.slow_ma = best_params

    results.sort(key=lambda r: r["metric"], reverse=True)
    return {
        "best_signal": best_signal,
        "best_metric": best_metric,
        "best_backtest": best_bt,
        "grid": results,
    }
