"""技术指标工具（选股因子计算的底层函数）

全部基于日线收盘价序列（升序），纯标准库实现，供 strategy/screener.py、
strategy/signals.py 复用。不依赖任何第三方包。
"""
from __future__ import annotations

import math


def sma(values: list[float], n: int) -> list[float]:
    """简单移动平均；前 n-1 个位置用可用样本均值填充。"""
    if n <= 0:
        return [0.0] * len(values)
    out: list[float] = []
    for i in range(len(values)):
        if i + 1 < n:
            out.append(sum(values[: i + 1]) / (i + 1))
        else:
            out.append(sum(values[i - n + 1 : i + 1]) / n)
    return out


def ema(values: list[float], n: int) -> list[float]:
    """指数移动平均（递推）。"""
    if not values or n <= 0:
        return [0.0] * len(values)
    k = 2.0 / (n + 1)
    out: list[float] = []
    prev = values[0]
    for i, v in enumerate(values):
        prev = v if i == 0 else v * k + prev * (1 - k)
        out.append(prev)
    return out


def log_returns(closes: list[float]) -> list[float]:
    """相邻日对数收益率。"""
    out: list[float] = []
    for i in range(1, len(closes)):
        a, b = closes[i - 1], closes[i]
        out.append(math.log(b / a) if a > 0 and b > 0 else 0.0)
    return out


def rolling_vol(closes: list[float], n: int) -> float:
    """最近 n 日日对数收益率的年化波动率（样本标准差 × √252）。"""
    r = log_returns(closes)
    if len(r) < 2:
        return 0.0
    window = r[-n:] if n > 0 else r
    mean = sum(window) / len(window)
    var = sum((x - mean) ** 2 for x in window) / (len(window) - 1)
    return math.sqrt(var) * math.sqrt(252.0)


def rsi(closes: list[float], n: int = 14) -> float:
    """Wilder RSI，返回最新值（0~100）。数据不足返回 50（中性）。"""
    if len(closes) < n + 1:
        return 50.0
    gains: list[float] = []
    losses: list[float] = []
    for i in range(1, len(closes)):
        d = closes[i] - closes[i - 1]
        gains.append(max(d, 0.0))
        losses.append(max(-d, 0.0))
    g = gains[-n:]
    l = losses[-n:]
    avg_g = sum(g) / n
    avg_l = sum(l) / n
    if avg_l == 0:
        return 100.0 if avg_g > 0 else 50.0
    rs = avg_g / avg_l
    return 100.0 - 100.0 / (1.0 + rs)


def macd(closes: list[float], fast: int = 12, slow: int = 26, signal: int = 9):
    """返回 (macd_line, signal_line, histogram) 的最新值；数据不足返回 0。"""
    if len(closes) < slow + signal:
        return 0.0, 0.0, 0.0
    ef = ema(closes, fast)
    es = ema(closes, slow)
    macd_line = [ef[i] - es[i] for i in range(len(closes))]
    sig = ema(macd_line, signal)
    hist = macd_line[-1] - sig[-1]
    return macd_line[-1], sig[-1], hist
