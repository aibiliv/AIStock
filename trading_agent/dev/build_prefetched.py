"""一次性脚本：把 tdx-connector 落盘的 12 个 K线 .txt 文件 + westock 行情快照
组装成 run_hub.py 所需的 prefetched.json。

- K线来自 tool-results 目录里 *tdx_kline*.txt（超 token 上限被自动落盘）
- 行情(PE/PB/现价/涨跌幅)来自 westock 批量快照（2026-07-31 收盘，休市期）
- 换手率 turnover_pct 取自 tdx AttachInfo.fHSL（每只都有）
"""
from __future__ import annotations
import json
import os
import glob

# 本地 MCP 落盘的 tool-results 目录（本机专用，请从环境变量 WORKBUDDY_TOOL_RESULTS 传入）
TOOL_RESULTS = os.environ.get("WORKBUDDY_TOOL_RESULTS") or ""
if not TOOL_RESULTS:
    raise SystemExit("请设置环境变量 WORKBUDDY_TOOL_RESULTS 指向本地 MCP tool-results 目录")
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "prefetched.json")

# westock 批量快照（2026-07-31 收盘）: code -> (price, pe_ttm, pb, change_pct)
WESTOCK = {
    "600519": (1350.6, 20.41, 7.25, -0.82),
    "000858": (78.0, 24.03, 2.57, -0.71),
    "601318": (54.9, 7.49, 1.01, -1.61),
    "600036": (39.62, 6.63, 0.9, -2.29),
    "000333": (87.6, 15.12, 3.28, -1.52),
    "300750": (395.3, 21.52, 4.82, -1.64),
    "600276": (54.08, 44.21, 5.76, -1.04),
    "002594": (95.77, 31.7, 3.82, -0.07),
    "600900": (29.09, 19.73, 3.41, -1.36),
    "000725": (5.51, 34.3, 1.52, 2.8),
    "002415": (37.65, 21.0, 4.09, 5.7),
    "601888": (58.01, 29.45, 2.1, -0.12),
}

WATCHLIST = [
    "600519", "000858", "601318", "600036", "000333", "300750",
    "600276", "002594", "600900", "000725", "002415", "601888",
]


def norm_bar(b):
    def g(*ks):
        for k in ks:
            if k in b and b[k] not in (None, ""):
                return b[k]
        return None
    return {
        "date": str(g("date", "Data") or ""),
        "open": float(g("open", "Open") or 0),
        "high": float(g("high", "High") or 0),
        "low": float(g("low", "Low") or 0),
        "close": float(g("close", "Close") or 0),
        "volume": float(g("volume", "Volume", "vol", "VolInStock") or 0),
        "amount": float(g("amount", "Amount") or 0),
    }


def parse_tdx(path):
    with open(path, "r", encoding="utf-8") as f:
        txt = f.read()
    start = txt.find("{")
    if start < 0:
        return None
    obj = json.loads(txt[start:])
    code = str(obj.get("Code") or "").strip()
    name = obj.get("AttachInfo", {}).get("Name") or code
    fhsl = obj.get("AttachInfo", {}).get("fHSL")
    turnover = float(fhsl) if fhsl not in (None, "") else 0.0
    rows = obj.get("Rows", [])
    bars = [norm_bar(r) for r in rows]
    return code, name, turnover, bars


def main():
    files = sorted(glob.glob(os.path.join(TOOL_RESULTS, "*tdx_kline*.txt")))
    # 跳过空文件（如那个 0 字节的）
    files = [f for f in files if os.path.getsize(f) > 1000]
    print(f"找到 {len(files)} 个有效 K线文件")

    klines = {}
    meta = {}  # code -> (name, turnover)
    for fp in files:
        res = parse_tdx(fp)
        if not res:
            print(f"  跳过(无法解析): {os.path.basename(fp)}")
            continue
        code, name, turnover, bars = res
        klines[code] = bars
        meta[code] = (name, turnover)
        print(f"  {code} {name}: {len(bars)} 根K线, 换手率={turnover:.4f}%")

    # 按 watchlist 顺序组装 quotes，缺失的用 tdx 兜底
    quotes = {}
    for code in WATCHLIST:
        name, _ = meta.get(code, (code, 0.0))
        price, pe, pb, chg = WESTOCK.get(code, (0.0, 0.0, 0.0, 0.0))
        turnover = meta.get(code, (None, 0.0))[1]
        quotes[code] = {
            "name": name,
            "price": float(price),
            "pe_ttm": float(pe),
            "pb": float(pb),
            "turnover_pct": float(turnover),
            "change_pct": float(chg),
        }

    prefetched = {
        "universe": WATCHLIST,
        "config": {},
        "klines": {c: klines[c] for c in WATCHLIST if c in klines},
        "quotes": quotes,
        "hot": [],
    }

    missing = [c for c in WATCHLIST if c not in klines]
    if missing:
        print(f"警告：以下标的缺少 K线数据: {missing}")

    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(prefetched, f, ensure_ascii=False, indent=2)
    print(f"\n已写出 {OUT}")
    print(f"  universe={len(prefetched['universe'])} klines={len(prefetched['klines'])} quotes={len(prefetched['quotes'])}")


if __name__ == "__main__":
    main()
