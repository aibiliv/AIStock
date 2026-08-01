"""Mock MCP server（沙箱内验证 trading_agent 连接器契约用）

模拟一个同时暴露 westock-mcp 与 tdx-connector 工具的 MCP Streamable HTTP 端点。
仅用于本地契约验证，不参与任何真实交易/数据。

运行：python -m connectors.mock_server --port 8700
"""
from __future__ import annotations

import argparse
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse


# 模拟工具目录（名称对齐 westock/tdx 连接器默认 tool_map）
TOOLS = [
    {"name": "search_stock", "description": "搜索股票", "inputSchema": {"type": "object", "properties": {"keyword": {"type": "string"}, "type": {"type": "string"}}}},
    {"name": "get_stock_quote", "description": "实时行情", "inputSchema": {"type": "object", "properties": {"code": {"type": "string"}}}},
    {"name": "get_stock_kline", "description": "K线", "inputSchema": {"type": "object", "properties": {"code": {"type": "string"}, "period": {"type": "string"}}}},
    {"name": "get_finance", "description": "财务", "inputSchema": {"type": "object", "properties": {"code": {"type": "string"}}}},
    {"name": "stock_kline", "description": "tdx K线", "inputSchema": {"type": "object", "properties": {"market": {"type": "integer"}, "code": {"type": "string"}}}},
    {"name": "stock_quotes", "description": "tdx 行情", "inputSchema": {"type": "object", "properties": {"codes": {"type": "array"}}}},
    {"name": "conditional_screen", "description": "条件选股", "inputSchema": {"type": "object", "properties": {"expression": {"type": "string"}}}},
    {"name": "place_order", "description": "委托下单", "inputSchema": {"type": "object", "properties": {"symbol": {"type": "string"}, "side": {"type": "string"}, "price": {"type": "number"}, "quantity": {"type": "integer"}, "dry_run": {"type": "boolean"}}}},
    {"name": "cancel_order", "description": "撤单", "inputSchema": {"type": "object", "properties": {"order_id": {"type": "string"}}}},
    {"name": "get_positions", "description": "持仓", "inputSchema": {"type": "object", "properties": {}}},
]


def _text(s: str) -> dict:
    return {"content": [{"type": "text", "text": s}]}


def dispatch(name: str, arguments: dict) -> dict:
    if name == "search_stock":
        return _text(json.dumps({"keyword": arguments.get("keyword"), "hits": [{"code": "sh600519", "name": "贵州茅台"}]}))
    if name == "get_stock_quote":
        return _text(json.dumps({"code": arguments.get("code"), "price": 1680.0, "pct": 1.2}))
    if name in ("get_stock_kline", "stock_kline"):
        return _text(json.dumps({"code": arguments.get("code"), "bars": [{"date": "2026-07-31", "close": 1680.0}]}))
    if name == "get_finance":
        return _text(json.dumps({"code": arguments.get("code"), "peTtm": 22.1, "pb": 8.4}))
    if name == "stock_quotes":
        return _text(json.dumps({"quotes": [{"code": c, "price": 10.0} for c in arguments.get("codes", [])]}))
    if name == "conditional_screen":
        return _text(json.dumps({"selected": [{"code": "600519", "name": "贵州茅台"}]}))
    if name == "place_order":
        return _text(json.dumps({
            "symbol": arguments.get("symbol"), "side": arguments.get("side"),
            "price": arguments.get("price"), "quantity": arguments.get("quantity"),
            "dry_run": arguments.get("dry_run", True), "status": "accepted" if arguments.get("dry_run", True) else "submitted",
        }))
    if name == "get_positions":
        return _text(json.dumps({"positions": []}))
    return {"content": [{"type": "text", "text": "unknown tool"}], "isError": True}


class Handler(BaseHTTPRequestHandler):
    def _json(self, obj):
        data = json.dumps(obj).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Mcp-Session-Id", "mock-session-001")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0) or 0)
        payload = json.loads(self.rfile.read(length) or b"{}")
        method = payload.get("method")
        pid = payload.get("id")
        if method == "initialize":
            self._json({"jsonrpc": "2.0", "id": pid, "result": {"protocolVersion": "2024-11-05", "capabilities": {}, "serverInfo": {"name": "mock-mcp"}}})
        elif method == "notifications/initialized":
            self.send_response(202); self.end_headers()
        elif method == "tools/list":
            self._json({"jsonrpc": "2.0", "id": pid, "result": {"tools": TOOLS}})
        elif method == "tools/call":
            name = payload["params"]["name"]
            args = payload["params"].get("arguments", {})
            self._json({"jsonrpc": "2.0", "id": pid, "result": dispatch(name, args)})
        else:
            self._json({"jsonrpc": "2.0", "id": pid, "error": {"message": f"unknown method {method}"}})

    def log_message(self, *a):
        return


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8700)
    args = ap.parse_args()
    httpd = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    print(f"mock MCP server on http://127.0.0.1:{args.port}")
    httpd.serve_forever()


if __name__ == "__main__":
    main()
