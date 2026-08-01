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
    p.add_argument("--no-connectors", action="store_true", help="跳过 westock/tdx 连接器（强制直连）")
    p.add_argument("--no-writeback", action="store_true", help="跳过把信号写回通达信（即使已配置 tdx）")
    p.add_argument("--serve", action="store_true", help="以 HTTP 服务方式运行（可被 WorkBuddy 调度）")
    p.add_argument("--port", type=int, default=None, help="--serve 时监听端口（默认 AGENT_BIND_PORT）")
    args = p.parse_args()

    cfg = build_cfg(args)
    if args.no_connectors:
        cfg.connectors.westock_url = ""
        cfg.connectors.tdx_url = ""

    if args.serve:
        from agent_server import serve
        serve(cfg, host=config.AGENT_BIND_HOST, port=args.port or config.AGENT_BIND_PORT)
        return

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

    # 执行回写 + 提醒推送（架构图「WorkBuddy 中枢 · 执行回写 + 推送提醒」）
    _run_connectors(cfg, result, args)

    notifier = get_notifier(cfg)
    path = notifier.notify(result, cfg)
    print(f"报告已生成: {path}")

    # 本地报告轮转：保留最近 N 次，自动清理更早的（云端单文件覆盖，不受影响）
    from reports.report import prune_reports
    removed = prune_reports()
    if removed:
        print(f"本地报告轮转：清理了 {removed} 个旧文件（默认保留最近 20 次，可用 REPORT_KEEP 调整）")


def _run_connectors(cfg: config.AppConfig, result: dict, args: argparse.Namespace):
    """在闭环末尾把结果写回通达信并推送企业微信提醒。"""
    from bridge import ConnectorHub

    if not (cfg.connectors.tdx_url or cfg.connectors.westock_url or cfg.connectors.wecom_webhook):
        return  # 未配置任何连接器
    hub = ConnectorHub(cfg)

    # 1) 执行回写：把最终信号转成委托写回通达信（默认 dry_run 安全）
    if cfg.connectors.tdx_url and not args.no_writeback:
        signals = _build_writeback_signals(result)
        if signals:
            dry = not cfg.connectors.enable_writeback
            receipts = hub.writeback_signals(signals, dry_run=dry)
            print(f"[回写] 已下发 {len(receipts)} 笔委托（dry_run={dry}）")

    # 2) 提醒推送：企业微信
    if cfg.connectors.wecom_webhook:
        r = hub.notify(result)
        print(f"[推送] 企业微信: {r}")


def _build_writeback_signals(result: dict) -> list:
    """从最终信号中抽取待回写的委托（每只标的首买信号）。"""
    meta = result.get("meta", {})
    final = result.get("final", {})
    # final.dates / final.equity 提供时间序列；这里用 selected 列表构造样例委托
    signals = []
    for r in result.get("selected", [])[: cfg_max_positions(result)]:
        code = r.get("code", "")
        if not code:
            continue
        signals.append({
            "code": code,
            "side": "BUY",
            "price": float(r.get("price", 0) or 0),
            "quantity": 100,
        })
    return signals


def cfg_max_positions(result: dict) -> int:
    return int(result.get("meta", {}).get("top_n", 8))



if __name__ == "__main__":
    main()
