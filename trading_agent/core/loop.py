"""闭环编排（对应架构图内循环：选票→操作→回测→优化策略）

编排四步流水线，产出供报告/通知使用的结果字典。
"""
from __future__ import annotations

import copy
from datetime import datetime

import config
from data import universe as universe_mod, provider
from strategy import screener, signals
from backtest import engine


def run(cfg: config.AppConfig, dp=None) -> dict:
    """运行完整闭环，产出结果字典。

    dp: DataProvider（可注入）。None 时回退默认数据源（腾讯/东财直连）。
    当 WorkBuddy 中枢取数后，应传入 StaticProvider 让引擎用中枢数据计算。
    """
    dp = dp or provider.default_provider()

    # 1) 选票
    codes = universe_mod.get_universe(cfg, dp)
    selected = screener.screen(cfg, codes, dp)
    selected_codes = [r["code"] for r in selected]

    # 拉取已选标的的历史 K 线（回测/信号所需）
    code_klines = {c: dp.fetch_kline(c, cfg.beg, cfg.end) for c in selected_codes}

    # 2) 操作（当前参数下的信号）
    code_signals = {c: signals.generate_signals(code_klines[c], cfg.signal) for c in selected_codes}
    base_bt = engine.backtest(code_klines, code_signals, cfg)

    # 补充每只标的的信号条数（买入 + 卖出事件）
    for r in selected:
        bs = code_signals.get(r["code"], (set(), set()))
        r["n_signals"] = len(bs[0]) + len(bs[1])

    result = {
        "meta": {
            "generated_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "beg": cfg.beg,
            "end": cfg.end,
            "universe_size": len(codes),
            "top_n": cfg.screener.top_n,
            "selected_n": len(selected),
            "notifier": cfg.notifier,
        },
        "selected": selected,
        "base": {
            "signal": {"fast_ma": cfg.signal.fast_ma, "slow_ma": cfg.signal.slow_ma},
            "metrics": base_bt["metrics"],
        },
    }

    # 3)+4) 回测 + 优化策略（迭代）
    if cfg.optim.enabled and selected_codes:
        from optimization import optimizer
        opt = optimizer.optimize(code_klines, selected_codes, cfg)
        best_bt = opt["best_backtest"]
        result["optimized"] = {
            "best_signal": {
                "fast_ma": opt["best_signal"].fast_ma,
                "slow_ma": opt["best_signal"].slow_ma,
            },
            "best_metrics": best_bt["metrics"],
            "grid": opt["grid"],
        }
        final_bt = best_bt
        final_signal = opt["best_signal"]
    else:
        final_bt = base_bt
        final_signal = cfg.signal

    # 统计最终信号总条数（买入 + 卖出事件）
    final_signals = {c: signals.generate_signals(code_klines[c], final_signal) for c in selected_codes}
    n_signals_total = sum(len(s[0]) + len(s[1]) for s in final_signals.values())

    result["final"] = {
        "signal": {"fast_ma": final_signal.fast_ma, "slow_ma": final_signal.slow_ma},
        "metrics": final_bt["metrics"],
        "dates": final_bt["dates"],
        "equity": final_bt["equity"],
        "n_signals_total": n_signals_total,
    }
    return result
