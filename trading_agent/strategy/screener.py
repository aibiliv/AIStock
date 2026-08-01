"""选票（选股）模块

基于多因子打分从候选池中选出 top_n 只标的：
  - 动量因子：近 momentum_window 日收益率
  - 估值因子：盈利收益率 1/PE（越高越便宜）
  - 流动性因子：最新换手率（越高越活跃）
因子做横截面 min-max 归一化后加权，剔除流动性差/估值过高的标的。
"""
from __future__ import annotations

import config
from data import provider


def _minmax(vals: list[float]):
    lo, hi = min(vals), max(vals)
    if hi - lo < 1e-12:
        return lambda x: 0.5
    return lambda x: (x - lo) / (hi - lo)


def screen(cfg: config.AppConfig, codes: list[str], dp=None) -> list[dict]:
    """返回按综合得分降序排列的候选标的列表（含因子明细）。

    dp: DataProvider（可注入）。None 时回退默认数据源（腾讯/东财直连）。
    """
    sc = cfg.screener
    dp = dp or provider.default_provider()
    rows = []
    for code in codes:
        try:
            kline = dp.fetch_kline(code, cfg.beg, cfg.end)
            quote = dp.fetch_quote(code)
        except Exception:
            continue
        if not kline or len(kline) < sc.momentum_window + 2:
            continue
        pe = quote.get("pe_ttm") or 0
        pb = quote.get("pb") or 0
        turnover = quote.get("turnover_pct") or 0
        # 过滤：流动性差 / 估值过高
        if turnover < sc.min_turnover_pct:
            continue
        if pe <= 0 or pe > sc.max_pe_ttm:
            continue
        if pb <= 0 or pb > sc.max_pb:
            continue
        closes = [b["close"] for b in kline]
        mom = closes[-1] / closes[-(sc.momentum_window + 1)] - 1.0
        ey = 1.0 / pe if pe > 0 else 0.0
        rows.append({
            "code": code,
            "name": quote.get("name", code),
            "momentum": mom,
            "earnings_yield": ey,
            "turnover": turnover,
            "pe_ttm": pe,
            "pb": pb,
        })
    if not rows:
        return []

    mom_norm = _minmax([r["momentum"] for r in rows])
    ey_norm = _minmax([r["earnings_yield"] for r in rows])
    liq_norm = _minmax([r["turnover"] for r in rows])

    for r in rows:
        r["score"] = (
            sc.w_momentum * mom_norm(r["momentum"])
            + sc.w_value * ey_norm(r["earnings_yield"])
            + sc.w_liquidity * liq_norm(r["turnover"])
        )

    rows.sort(key=lambda r: r["score"], reverse=True)
    return rows[: sc.top_n]
