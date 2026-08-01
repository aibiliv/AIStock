"""实测：登录云端复盘 App，GET /api/strategy-scan 读回最近一次推送的扫描结果，
验证『推送落地 + 云端正确读取 + 字段契约』。仅用于验证，不持久化。"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pull_cloud_config as pcc

BASE = os.environ.get("CLOUD_BASE_URL") or "http://120.48.87.170:9003"
USER = os.environ.get("CLOUD_CFG_USER") or "admin"
PASS = os.environ.get("CLOUD_CFG_PASS") or ""

print(f"[1] 云端基地址: {BASE}")
cookie = pcc.login(BASE, USER, PASS)
if not cookie:
    print("[FAIL] 登录失败，无法验证云端读取")
    sys.exit(1)
print("[OK] 登录成功，已拿到 session cookie")

# 读回最近一次扫描结果
st, obj = pcc._http_json(BASE.rstrip("/") + "/api/strategy-scan",
                          headers={"Cookie": cookie})
print(f"[2] GET /api/strategy-scan -> HTTP {st}, ok={obj.get('ok')}")

scan = obj.get("scan")
if not scan:
    print("[FAIL] 云端未返回 scan 数据（可能从未推送或 D1 为空）")
    print("      raw:", json.dumps(obj, ensure_ascii=False)[:300])
    sys.exit(1)

# 前端 StrategyScanView 实际消费的字段契约
expected_top = ["universeSize", "selectedCount", "marketState", "backtest",
                "selected", "generatedAt"]
present = [k for k in expected_top if k in scan]
missing = [k for k in expected_top if k not in scan]

print(f"[3] 前端依赖字段存在情况: 存在={present}")
if missing:
    print(f"    缺失={missing}  <-- 前端消费会报错/不显示")

sel = scan.get("selected") or []
ms = scan.get("marketState") or {}
bt = scan.get("backtest") or {}
print(f"[4] 入选数量(selectedCount)={scan.get('selectedCount')} | 实际 selected 数组长度={len(sel)}")
print(f"    候选池 universeSize={scan.get('universeSize')}")
print(f"    市场状态 marketState={json.dumps(ms, ensure_ascii=False)}")
print(f"    基准回测 keys={list(bt.keys()) if isinstance(bt, dict) else type(bt)}")
print(f"    生成时间 generatedAt={scan.get('generatedAt')}")
if sel:
    print("[5] 入选样本（前3）:")
    for r in sel[:3]:
        print(f"    {r.get('code')} {r.get('name')} 得分={r.get('score')} "
              f"PE={r.get('peTtm')} PB={r.get('pb')} 动量={r.get('momentum')}")
print("\n[结论] 云端可正确存储并读取推送数据，字段契约与前端一致。"
      if not missing else "\n[结论-需修复] 存在字段缺失，前端可能显示异常。")
