"""用「连接器同底层接口」为候选池取数，生成引擎消费的 prefetched.json。

背景:
    trading_agent 引擎通过 StaticProvider 读取「中枢预取的数据」，自身不直连
    任何 MCP。在自动化运行时，WorkBuddy 中枢会用 MCP 连接器取数
    (tdx_kline 取 K 线 + westock data_quote 取估值/换手/市值) 并写 prefetched.json。
    本脚本用与这些连接器**相同的底层 HTTP 接口**(东财/新浪 K线 + 腾讯 qt.gtimg 行情)
    取数，字段映射与「中枢用 MCP 取数后写盘」完全一致，用于:
      1) 验证 prefetched 字段映射正确; 2) 验证 StaticProvider -> 引擎链路通。

字段映射(对应自动化 prompt 里中枢取数步骤):
    tdx_kline Rows  -> bar: {date, open, high, low, close, volume, amount}
    westock data_quote -> quote: {name, price, pe_ttm, pb, turnover_pct, change_pct,
                                  market_name, float_mcap_yi}

用法:
    python fetch_market_data.py <universe.json> [--index 000300] [--out prefetched.json]
    universe.json 格式: {"universe": ["603407","000566",...], "index": "000300"}
"""
from __future__ import annotations

import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from data import provider  # 复用「连接器同底层」的取数实现
import config


def _bar_from_raw(b: dict) -> dict:
    """统一 K 线字段 -> {date, open, high, low, close, volume, amount}。"""
    # provider._em_kline / _sina_kline 返回 vol; tdx_kline MCP 返回 Volume
    vol = b.get("vol")
    if vol is None:
        vol = b.get("volume", 0)
    return {
        "date": b.get("date"),
        "open": float(b.get("open", 0)),
        "high": float(b.get("high", 0)),
        "low": float(b.get("low", 0)),
        "close": float(b.get("close", 0)),
        "volume": float(vol or 0),
        "amount": float(b.get("amount", 0)),
    }


def _quote_from_raw(q: dict) -> dict:
    """统一估值字段 -> quote 子结构。market_name 用于板块/市值判断。"""
    return {
        "name": q.get("name", ""),
        "price": float(q.get("price", 0)),
        "pe_ttm": float(q.get("pe_ttm", 0)),
        "pb": float(q.get("pb", 0)),
        "turnover_pct": float(q.get("turnover_pct", 0)),
        "change_pct": float(q.get("change_pct", 0)),
        "market_name": q.get("market_name", ""),
        "float_mcap_yi": float(q.get("float_mcap_yi", 0)),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("universe", help="候选池 json: {universe:[codes], index?}")
    ap.add_argument("--index", default="000300", help="指数代码(牛熊判定用)")
    ap.add_argument("--out", default="prefetched.json")
    ap.add_argument("--beg", default="20250101")
    ap.add_argument("--end", default="20500101")
    args = ap.parse_args()

    with open(args.universe, encoding="utf-8") as f:
        u = json.load(f)
    codes = u.get("universe") or []
    index = u.get("index") or args.index
    print(f"候选池 {len(codes)} 只; 指数 {index}")

    klines: dict[str, list[dict]] = {}
    quotes: dict[str, dict] = {}

    for c in codes:
        kl = provider.fetch_kline(c, args.beg, args.end)
        klines[c] = [_bar_from_raw(b) for b in kl]
        q = provider.fetch_quote(c)
        quotes[c] = _quote_from_raw(q)
        print(f"  {c} {q.get('name',''):8s} K线={len(kl)} 换手={q.get('turnover_pct')} "
              f"PE={q.get('pe_ttm')} PB={q.get('pb')} 市场={q.get('market_name','')}")

    # 指数 K 线(牛熊判定)
    idx_kl = provider.fetch_kline(index, args.beg, args.end)
    klines[index] = [_bar_from_raw(b) for b in idx_kl]
    print(f"指数 {index} K线={len(idx_kl)}")

    out = {
        "universe": list(codes),
        "klines": klines,
        "quotes": quotes,
        "hot": [],
    }
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False)
    print(f"已写出 {args.out} (universe={len(codes)}, 含指数 {index})")


if __name__ == "__main__":
    main()
