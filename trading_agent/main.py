"""交易 Agent MVP · 入口

用法示例：
  python main.py                      # 默认运行（选 8 只 + 优化）
  python main.py --top-n 10           # 选出 10 只
  python main.py --no-optim           # 跳过参数优化
  python main.py --use-hot            # 用同花顺当日强势股作候选池
  python main.py --universe-size 20   # 仅用默认池前 20 只
  python main.py --fast-ma 5 --slow-ma 20
  python main.py --no-push            # 跳过云端推送（仅本地产出）
  CLOUD_SCAN_URL=https://host:9003/api/strategy-scan CLOUD_SCAN_TOKEN=xxx python main.py
"""
from __future__ import annotations

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import config
from core import loop
from notify import get_notifier


def build_cfg(args: argparse.Namespace) -> config.AppConfig:
    cfg = config.AppConfig()
    if args.top_n is not None:
        cfg.screener.top_n = args.top_n
    if args.beg:
        cfg.beg = args.beg
    if args.end:
        cfg.end = args.end
    if args.no_optim:
        cfg.optim.enabled = False
    if args.notifier:
        cfg.notifier = args.notifier
    if args.use_hot:
        cfg.use_hot_universe = True
    if args.universe_size is not None:
        cfg.universe = config.DEFAULT_UNIVERSE[: args.universe_size]
    if args.fast_ma is not None:
        cfg.signal.fast_ma = args.fast_ma
    if args.slow_ma is not None:
        cfg.signal.slow_ma = args.slow_ma
    return cfg


def main():
    p = argparse.ArgumentParser(description="交易 Agent MVP 闭环（选票→操作→回测→优化）")
    p.add_argument("--top-n", type=int, default=None, help="选出标的数量")
    p.add_argument("--beg", type=str, default=None, help="行情起始 YYYYMMDD")
    p.add_argument("--end", type=str, default=None, help="行情结束 YYYYMMDD")
    p.add_argument("--no-optim", action="store_true", help="跳过参数优化")
    p.add_argument("--notifier", type=str, default=None, choices=["local", "email"])
    p.add_argument("--use-hot", action="store_true", help="用同花顺当日强势股作候选池")
    p.add_argument("--universe-size", type=int, default=None, help="从默认池截取前 N 只")
    p.add_argument("--fast-ma", type=int, default=None)
    p.add_argument("--slow-ma", type=int, default=None)
    p.add_argument("--no-push", action="store_true", help="跳过云端推送（仅本地产出）")
    args = p.parse_args()

    cfg = build_cfg(args)
    result = loop.run(cfg)
    # 本地产出：写共享 JSON（本地查看用）
    from reports.report import write_scan_json
    scan_payload = write_scan_json(result, cfg)
    local_path = os.path.join(config.SCAN_SHARE_DIR, "latest.json")
    print(f"本地扫描 JSON: {local_path}")

    # 云端推送：本地 PC -> 远程 AIStock 接收接口（跨机器联动）
    if not args.no_push:
        from cloud import push_scan_json
        status = push_scan_json(scan_payload, cfg)
        print(status)
    else:
        print("SKIP 已指定 --no-push，跳过云端推送。")

    notifier = get_notifier(cfg)
    path = notifier.notify(result, cfg)
    print(f"报告已生成: {path}")

    # 本地报告轮转：保留最近 N 次，自动清理更早的（云端单文件覆盖，不受影响）
    from reports.report import prune_reports
    removed = prune_reports()
    if removed:
        print(f"本地报告轮转：清理了 {removed} 个旧文件（默认保留最近 20 次，可用 REPORT_KEEP 调整）")


if __name__ == "__main__":
    main()
