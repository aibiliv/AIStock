"""WorkBuddy 中枢编排（架构图「WorkBuddy 中枢」的真实实现）

设计意图：trading_agent 只做**纯计算引擎**（选股/信号/回测/优化），
数据获取、执行回写、提醒推送全部由 **WorkBuddy 中枢**负责。

中枢在本会话里直接调用 westock-mcp / tdx-connector 连接器取数，
把数据注入引擎（StaticProvider），跑完后再调用 tdx 连接器回写、
调用企业微信/复盘应用推送。trading_agent 自身**不直连任何 MCP**。

本模块既是可测试的参考实现，也是中枢调用的入口：
  - run()：接收三个可注入回调（data_fetcher / writeback / push），
          中枢把真实连接器调用包进这些回调即可。
  - 沙箱内可用 mock 回调验证整条「中枢→引擎→回写→推送」链路。
"""
from __future__ import annotations

from typing import Callable, Optional

import config
from core import loop
from data.provider import StaticProvider
from reports.report import write_scan_json


def _build_signals(result: dict, klines: Optional[dict] = None) -> list[dict]:
    """从闭环结果派生回写信号：把最终入选标的作为 BUY 委托。

    klines: 中枢注入的 K 线（用于取最新收盘价作委托价）。
    """
    out = []
    for r in result.get("selected", []):
        code = r["code"]
        price = None
        if klines:
            bars = klines.get(code) or []
            if bars:
                price = float(bars[-1].get("close") or 0)
        out.append({
            "code": code,
            "name": r.get("name", code),
            "side": "BUY",
            "price": price,
            "quantity": 100,  # 默认 100 股，真实下单按仓位管理调整
        })
    return out


def run(
    cfg: config.AppConfig,
    *,
    data_fetcher: Optional[Callable[[], tuple[dict, dict, list]]] = None,
    writeback: Optional[Callable[[list, bool], list]] = None,
    push: Optional[Callable[[dict], object]] = None,
    dry_run: bool = True,
) -> dict:
    """中枢编排一次完整运行。

    参数
    ----
    data_fetcher: 可选，返回 (klines, quotes, hot)。中枢从连接器取数后提供；
                  为 None 时引擎回退默认数据源（腾讯/东财直连，零配置可用）。
    writeback:    可选，callable(signals, dry_run) -> receipts。中枢调用 tdx 连接器。
    push:         可选，callable(result) -> status。中枢调用企业微信/复盘应用。
    dry_run:      回写是否仅模拟（默认 True，安全）。
    """
    klines = quotes = None
    hot = []
    if data_fetcher is not None:
        klines, quotes, hot = data_fetcher()
        dp = StaticProvider(klines=klines, quotes=quotes, hot=hot)
    else:
        dp = None  # 默认数据源

    result = loop.run(cfg, dp=dp)
    payload = write_scan_json(result, cfg)

    # 执行回写（中枢 -> tdx 连接器）
    if writeback is not None:
        signals = _build_signals(result, klines)
        receipts = writeback(signals, dry_run=dry_run)
        result["writeback"] = receipts

    # 提醒推送（中枢 -> 企业微信/复盘应用）
    if push is not None:
        status = push(payload)
        result["push"] = status

    return payload


# ----------------------------------------------------------------------------
# 中枢侧适配器（本会话内由 WorkBuddy 调用连接器实现，这里给出契约说明）
# ----------------------------------------------------------------------------
#
# 真实部署时，WorkBuddy 在一次编排中做：
#   1) 取候选池 codes（可用 universe 配置或连接器热点）
#   2) 对每个 code 调 westock-mcp.get_quote / tdx-connector.stock_kline 取数
#   3) 调 hub.run(cfg, data_fetcher=lambda: (klines, quotes, hot),
#                   writeback=tdx_place_order, push=wecom_push, dry_run=True)
#   4) tdx_place_order 内部调用 tdx-connector.place_order（dry_run 安全）
#   5) wecom_push 调用企业微信群机器人 webhook，并把 payload POST 到云端
#      /api/strategy-scan（若配置了 CLOUD_SCAN_URL）
#
# 这样 trading_agent 完全不需要知道连接器存在，真正由 WorkBuddy 当中枢。
