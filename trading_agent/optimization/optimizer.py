"""优化策略模块

对信号参数（快/慢均线）做网格搜索，以夏普（或指定指标）为目标，
在已选标的的历史数据上挑选更优参数组合，形成「回测→优化」迭代。
"""
from __future__ import annotations

import copy

import config
from strategy import signals
from backtest import engine


def optimize(code_klines: dict, codes: list[str], cfg: config.AppConfig) -> dict:
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
