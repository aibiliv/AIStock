"""联合测试驱动：运行真实 trading_agent 选股 + 推送，验证与云端 /api/strategy-scan 的契约。

- 给 urllib 安装代理（沙箱仅代理可出网），使真实行情抓取可用。
- 用小候选池 + 跳过优化，跑真实的 core.loop.run（选票->操作->回测）。
- 用真实的 reports.report.write_scan_json 生成 payload。
- 用真实的 cloud.push_scan_json 推送到本地 mock 服务端。
"""
import os
import sys
import urllib.request

# 让真实行情抓取能出网（沙箱只有代理）
proxy = os.environ.get("HTTPS_PROXY") or os.environ.get("HTTP_PROXY")
if proxy:
    urllib.request.install_opener(
        urllib.request.build_opener(urllib.request.ProxyHandler({"https": proxy, "http": proxy}))
    )

TRADING_AGENT = r"D:\code\AICode\AIStock\trading_agent"
sys.path.insert(0, TRADING_AGENT)

import config  # noqa: E402
from core import loop  # noqa: E402
from reports.report import write_scan_json  # noqa: E402
from cloud import push_scan_json  # noqa: E402

PUSH_TOKEN = os.environ.get("STRATEGY_PUSH_TOKEN", "joint-test-secret-please-change-me-aaaaaaaaaa")
PUSH_URL = os.environ.get("CLOUD_SCAN_URL", "http://127.0.0.1:9100/api/strategy-scan")

cfg = config.AppConfig()
cfg.universe = config.DEFAULT_UNIVERSE[:5]   # 5 只，快速
cfg.screener.top_n = 3
cfg.optim.enabled = False                     # 跳过网格优化，省时
cfg.notifier = "local"
cfg.push.url = PUSH_URL
cfg.push.token = PUSH_TOKEN

print(f"[driver] universe={cfg.universe}")
print(f"[driver] push -> {PUSH_URL}  token_set={bool(PUSH_TOKEN)}")

print("[driver] running real selection loop (core.loop.run) ...")
result = loop.run(cfg)            # 真实选股 + 回测
print(f"[driver] loop done: selected_n={result['meta']['selected_n']} "
      f"universe={result['meta']['universe_size']}")

payload = write_scan_json(result, cfg)   # 真实 payload 生成
print(f"[driver] payload keys: {sorted(payload.keys())}")
print(f"[driver] selected count in payload: {len(payload.get('selected', []))}")

status = push_scan_json(payload, cfg)     # 真实推送
print(f"[driver] PUSH RESULT: {status}")
