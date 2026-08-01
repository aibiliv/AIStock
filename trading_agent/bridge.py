"""桥接层（对应架构「WorkBuddy 中枢 · 桥接连接器」）

把上层策略与底层数据源解耦：上层只调用 ConnectorHub.request_kline / request_quote，
由 Hub 路由到最优可用连接器。当前已落地腾讯 / 东财直连；通达信(westock)、
腾讯自选股(westock-mcp) 连接器在对应连接器接入后可即插即用。
"""
from __future__ import annotations

import config
from data import provider


class TencentConnector:
    """实时估值（PE/PB/市值/换手率）。不封 IP。"""

    name = "tencent"

    def request_quote(self, code: str) -> dict:
        return provider.fetch_quote(code)


class EastMoneyConnector:
    """前复权日线 K 线。低风控。"""

    name = "eastmoney"

    def request_kline(self, code: str, beg: str, end: str) -> list[dict]:
        return provider.fetch_kline(code, beg, end)


class TdxConnector:
    """架构预留：接入 tdx-connector 后启用（行情/深度/选股）。"""

    name = "tdx"
    available = False

    def request_kline(self, code: str, beg: str, end: str):
        raise NotImplementedError("tdx-connector 未连接。请在连接器面板连接 tdx-connector。")


class WestockConnector:
    """架构预留：接入 westock-mcp 后启用（行情/自选/模拟交易）。"""

    name = "westock"
    available = False

    def request_quote(self, code: str):
        raise NotImplementedError("westock-mcp 未连接。请在连接器面板连接 westock-mcp。")


class ConnectorHub:
    """连接器中枢：路由数据请求到可用源。"""

    def __init__(self):
        self.tencent = TencentConnector()
        self.eastmoney = EastMoneyConnector()
        self.tdx = TdxConnector()
        self.westock = WestockConnector()

    def request_kline(self, code: str, beg: str, end: str) -> list[dict]:
        if self.tdx.available:
            return self.tdx.request_kline(code, beg, end)
        return self.eastmoney.request_kline(code, beg, end)

    def request_quote(self, code: str) -> dict:
        if self.westock.available:
            return self.westock.request_quote(code)
        return self.tencent.request_quote(code)
