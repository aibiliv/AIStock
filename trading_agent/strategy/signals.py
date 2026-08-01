"""操作（信号）模块

基于快慢均线交叉生成买卖信号；可选「突破 N 日新高」过滤；
回测层负责止损。返回 (buy_dates, sell_dates)，均为 set[str]，供回测按日判定。
"""
from __future__ import annotations


def generate_signals(kline: list[dict], signal_cfg):
    """signal_cfg: config.SignalConfig"""
    cfg = signal_cfg
    closes = [b["close"] for b in kline]
    n = len(closes)
    fast = cfg.fast_ma
    slow = cfg.slow_ma
    if n < slow + 1:
        return set(), set()

    fast_ma, slow_ma = [], []
    for i in range(n):
        fa = sum(closes[max(0, i - fast + 1): i + 1]) / fast
        sa = sum(closes[max(0, i - slow + 1): i + 1]) / slow
        fast_ma.append(fa)
        slow_ma.append(sa)

    buy: set[str] = set()
    sell: set[str] = set()
    bw = cfg.breakout_window

    for i in range(1, n):
        d = kline[i]["date"]
        price = closes[i]
        cross_up = fast_ma[i] > slow_ma[i] and fast_ma[i - 1] <= slow_ma[i - 1]
        cross_dn = fast_ma[i] < slow_ma[i] and fast_ma[i - 1] >= slow_ma[i - 1]

        if cross_up:
            if cfg.use_breakout_filter:
                prev_high = max(closes[max(0, i - bw): i]) if i >= bw else max(closes[:i])
                if price <= prev_high:  # 未创新高，过滤
                    continue
            buy.add(d)
        elif cross_dn:
            sell.add(d)

    return buy, sell
