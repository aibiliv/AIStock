"""通达信 tdx-connector 连接器

定位：深度行情 + 条件选股 + **交易接口（执行回写）**。
端点形如 https://mcp.tdx.com.cn:3001/mcp ，认证头 tdx-api-key: TDX:xxxx。

执行回写：把 trading_agent 生成的买卖信号通过 tdx 的委托接口写回通达信。
默认 dry_run=True（只校验、不下真实单）；配置 enable_writeback 且显式
dry_run=False 才发真实委托。
"""
from __future__ import annotations

from typing import Optional

from .mcp import MCPConnector


class TdxConnector(MCPConnector):
    name = "tdx"

    def __init__(
        self,
        endpoint: str,
        api_key: Optional[str] = None,
        enabled: bool = False,
        tool_map: Optional[dict] = None,
    ):
        headers = {}
        if api_key:
            headers["tdx-api-key"] = api_key
        default_map = {
            "stock_kline": "stock_kline",
            "stock_quotes": "stock_quotes",
            "screen": "conditional_screen",   # 条件选股（tdxquant-mcp 变体）
            "place_order": "place_order",     # 委托下单（默认 dry-run）
            "cancel_order": "cancel_order",
            "get_positions": "get_positions",
        }
        super().__init__(
            endpoint,
            headers=headers,
            enabled=enabled,
            tool_map={**default_map, **(tool_map or {})},
        )

    # ---- 行情 ----
    def stock_kline(self, market: int, code: str, period: int = 4, times: int = 1, adjust: str = "qfq") -> str:
        # period: 4=日线 5=周线 6=月线 7=1分钟 ... 见 tdx 周期表
        return self.call_text(
            "stock_kline", market=market, code=code, period=period, times=times, adjust_type=adjust
        )

    def stock_quotes(self, codes: list) -> str:
        return self.call_text("stock_quotes", codes=codes)

    # ---- 条件选股（可选替代本地 screener） ----
    def screen(self, expr: str) -> str:
        return self.call_text("screen", expression=expr)

    # ---- 执行回写（交易接口） ----
    def place_order(self, code: str, side: str, price: float, quantity: int, dry_run: bool = True) -> dict:
        """把一笔委托写回通达信。side: BUY/SELL。dry_run=True 仅校验不落单。"""
        return self.call(
            "place_order",
            symbol=code,
            side=side,
            price=price,
            quantity=quantity,
            dry_run=dry_run,
        )

    def cancel_order(self, order_id: str) -> dict:
        return self.call("cancel_order", order_id=order_id)

    def get_positions(self) -> str:
        return self.call_text("get_positions")
