"""真实验证拼装：在现有真实股票K线(prefetched.json)基础上，
注入本次真实取到的 000300 指数K线(setcode=62) 与真实 westock 估值快照，
生成 prefetched_verify.json 供 run_hub 跑牛熊过滤验证。"""
from __future__ import annotations
import json
import os

BASE = os.path.dirname(os.path.abspath(__file__))
PREFETCHED = os.path.join(BASE, "prefetched.json")
INDEX_FILE = (
    r"C:\Users\xilasuo\.workbuddy\projects\d-code-AICode-AIStock"
    r"\253b6445-e005-4edc-b925-24f99709e0ca\tool-results"
    r"\mcp-connector-proxy-tdx-connector_tdx_kline-1785589574309-5073d0.txt"
)
OUT = os.path.join(BASE, "prefetched_verify.json")

# 本次 westock 真实估值快照 (2026-07-31 收盘)
WESTOCK = {
    "600519": {"name": "贵州茅台", "price": 1350.6, "pe_ttm": 20.41, "pb": 7.25, "turnover_pct": 0.44, "change_pct": -0.82},
    "000858": {"name": "五粮液", "price": 78.0, "pe_ttm": 24.03, "pb": 2.57, "turnover_pct": 1.28, "change_pct": -0.71},
    "601318": {"name": "中国平安", "price": 54.9, "pe_ttm": 7.49, "pb": 1.01, "turnover_pct": 0.99, "change_pct": -1.61},
    "600036": {"name": "招商银行", "price": 39.62, "pe_ttm": 6.63, "pb": 0.9, "turnover_pct": 0.72, "change_pct": -2.29},
    "000333": {"name": "美的集团", "price": 87.6, "pe_ttm": 15.12, "pb": 3.28, "turnover_pct": 0.69, "change_pct": -1.52},
    "300750": {"name": "宁德时代", "price": 395.3, "pe_ttm": 21.52, "pb": 4.82, "turnover_pct": 0.93, "change_pct": -1.64},
    "600276": {"name": "恒瑞医药", "price": 54.08, "pe_ttm": 44.21, "pb": 5.76, "turnover_pct": 0.91, "change_pct": -1.04},
    "002594": {"name": "比亚迪", "price": 95.77, "pe_ttm": 31.7, "pb": 3.82, "turnover_pct": 1.25, "change_pct": -0.07},
    "600900": {"name": "长江电力", "price": 29.09, "pe_ttm": 19.73, "pb": 3.41, "turnover_pct": 0.7, "change_pct": -1.36},
    "000725": {"name": "京东方Ａ", "price": 5.51, "pe_ttm": 34.3, "pb": 1.52, "turnover_pct": 5.84, "change_pct": 2.8},
    "002415": {"name": "海康威视", "price": 37.65, "pe_ttm": 21.0, "pb": 4.09, "turnover_pct": 1.9, "change_pct": 5.7},
    "601888": {"name": "中国中免", "price": 58.01, "pe_ttm": 29.45, "pb": 2.1, "turnover_pct": 2.06, "change_pct": -0.12},
}


def main():
    with open(PREFETCHED, encoding="utf-8") as f:
        pf = json.load(f)

    # 解析指数落盘文件
    with open(INDEX_FILE, encoding="utf-8") as f:
        txt = f.read()
    start = txt.find("{")
    obj = json.loads(txt[start:])
    head = obj["ListHead"]["ItemHead"]
    idx = {name: i for i, name in enumerate(head)}

    def get(r, k):
        return r.get(k) if isinstance(r, dict) else r[idx[k]]

    bars = []
    for r in obj["Rows"]:
        bars.append({
            "date": str(get(r, "Data")),
            "open": float(get(r, "Open") or 0),
            "high": float(get(r, "High") or 0),
            "low": float(get(r, "Low") or 0),
            "close": float(get(r, "Close") or 0),
            "volume": float(get(r, "Volume") or 0),
            "amount": float(get(r, "Amount") or 0),
        })
    print(f"指数 000300: {len(bars)} 根 | 最新收盘={bars[-1]['close']} | 最早={bars[0]['close']}")
    pf["klines"]["000300"] = bars

    # 用真实 westock 估值覆盖 quotes
    for code, w in WESTOCK.items():
        if code in pf["quotes"]:
            pf["quotes"][code].update(w)
        else:
            pf["quotes"][code] = w

    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(pf, f, ensure_ascii=False, indent=2)
    print(f"写出 {OUT}: universe={len(pf['universe'])} klines={len(pf['klines'])} quotes={len(pf['quotes'])}")


if __name__ == "__main__":
    main()
