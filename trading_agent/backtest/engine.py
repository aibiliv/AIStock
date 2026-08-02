"""回测引擎

对每个标的独立做「买入持有至卖出/止损」的模拟（归一化净值从 1.0 起），
再等权聚合为组合净值曲线。含单边手续费 + 滑点 + 止损。
"""
from __future__ import annotations

import config
from . import metrics


def _simulate_one(kline: list[dict], buy: set, sell: set, cfg: config.AppConfig):
    """返回该标的的逐日净值序列（起始 1.0）与交易次数。"""
    bcfg = cfg.backtest
    cost = bcfg.fee_rate + bcfg.slippage
    cash = 1.0
    shares = 0.0
    entry = 0.0
    in_market = False
    trades = 0
    equity = []
    stop = cfg.signal.stop_loss_pct
    for bar in kline:
        price = bar["close"]
        d = bar["date"]
        if in_market:
            hit_stop = price <= entry * (1 + stop)
            if hit_stop or d in sell:
                cash = shares * price * (1 - cost)
                shares = 0.0
                in_market = False
                trades += 1
        if (not in_market) and d in buy:
            shares = cash * (1 - cost) / price
            cash = 0.0
            entry = price
            in_market = True
        equity.append(cash + shares * price)
    return equity, [b["date"] for b in kline], trades


def backtest(code_klines: dict, code_signals: dict, cfg: config.AppConfig) -> dict:
    """输入：code->kline，code->(buy,sell)。输出组合回测结果字典。"""
    per_code = {}
    all_dates = set()
    for code, kline in code_klines.items():
        buy, sell = code_signals.get(code, (set(), set()))
        eq, dates, trades = _simulate_one(kline, buy, sell, cfg)
        d2e = dict(zip(dates, eq))
        per_code[code] = {"equity": eq, "dates": dates, "trades": trades, "d2e": d2e}
        all_dates.update(dates)

    common = sorted(all_dates)
    n_codes = len(per_code) or 1
    portfolio = []
    for d in common:
        vals = []
        for c in per_code.values():
            v = c["d2e"].get(d)
            if v is None:
                earlier = [x for x in c["dates"] if x <= d]
                if earlier:
                    v = c["d2e"].get(max(earlier))
                else:
                    # d 早于该标的首个交易日（次新股等）：沿用起始净值（carry-forward）
                    v = c["equity"][0] if c["equity"] else 0.0
            vals.append(v)
        portfolio.append(sum(vals) / n_codes)

    total_trades = sum(c["trades"] for c in per_code.values())
    m = metrics.compute_metrics(portfolio, cfg)
    m["trades"] = total_trades
    m["n_stocks"] = len(per_code)
    return {
        "dates": common,
        "equity": portfolio,
        "per_code": per_code,
        "metrics": m,
    }
