"""把云端「策略扫描配置」重置为合理默认值（全市场 / 市值 0~10000 / top_n 8）。
仅用于修复「仅主板+市值 50~300 亿」过严导致选股恒为空的问题。登录 + POST /api/strategy-scan/config。"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pull_cloud_config as pcc

BASE = os.environ.get("CLOUD_BASE_URL") or "http://120.48.87.170:9003"
USER = os.environ.get("CLOUD_CFG_USER") or "admin"
PASS = os.environ.get("CLOUD_CFG_PASS") or ""

cookie = pcc.login(BASE, USER, PASS)
if not cookie:
    print("[FAIL] 登录失败，无法重置云端配置")
    sys.exit(1)
print("[OK] 登录成功")

# 合理默认（全市场、市值 0~10000、top_n 8，行业分散 2）
nested = {
    "screener": {
        "top_n": 8, "max_per_sector": 2, "momentum_window": 20,
        "w_momentum": 0.3, "w_value": 0.18, "w_liquidity": 0.08, "w_rsi": 0.12,
        "w_macd": 0.12, "w_trend": 0.16, "w_size": 0.04, "w_quality": 0.06,
        "rsi_window": 14, "macd_fast": 12, "macd_slow": 26, "macd_signal": 9,
        "vol_window": 20, "min_turnover_pct": 0.15, "max_pe_ttm": 200.0, "max_pb": 20.0,
        "boards": ["main", "cyb", "kc", "bj"], "st_filter": "exclude_st",
        "mcap_min": 0.0, "mcap_max": 10000.0,
    },
    "market": {
        "enable": True, "index_code": "000300", "ma_window": 120, "mom_window": 60,
        "bull_ma_gap": 0.0, "bear_ma_gap": -0.03, "bull_mom": 0.08, "bear_mom": -0.05,
    },
    "signal": {
        "fast_ma": 5, "slow_ma": 20, "use_breakout_filter": True,
        "breakout_window": 20, "stop_loss_pct": -0.08, "max_positions": 8,
    },
    "optim": {"enabled": True},
}

url = BASE.rstrip("/") + "/api/strategy-scan/config"
st, obj = pcc._http_json(
    url, method="POST",
    data=json.dumps({"config": nested}).encode("utf-8"),
    headers={"Content-Type": "application/json", "Cookie": cookie},
)
print(f"[POST] /api/strategy-scan/config -> HTTP {st}, ok={obj.get('ok')}")
if not obj.get("ok"):
    print("   raw:", json.dumps(obj, ensure_ascii=False)[:300])
    sys.exit(1)
print("[OK] 云端配置已重置为合理默认值")
