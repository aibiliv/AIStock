"""连接器包（对应架构图「WorkBuddy 中枢 · 桥接连接器」）

把上层策略与底层数据源/执行通道解耦：
- WestockConnector：腾讯自选股 westock-mcp（行情/估值/K线/财务查询）
- TdxConnector：通达信 tdx-connector（行情 + 条件选股 + 交易接口/执行回写）
- WeComPusher：企业微信群机器人（微信/App 提醒推送）

全部基于 stdlib（urllib），无第三方依赖；配置驱动，留空即不启用。
mcp.py 提供 MCP over Streamable HTTP 的通用客户端，可被任意连接器复用。
"""

from .mcp import MCPHTTPClient, MCPConnector, first_text
from .westock import WestockConnector
from .tdx import TdxConnector
from .push import WeComPusher

__all__ = [
    "MCPHTTPClient",
    "MCPConnector",
    "first_text",
    "WestockConnector",
    "TdxConnector",
    "WeComPusher",
]
