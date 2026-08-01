"""联合测试用：忠实复刻 app/api/strategy-scan/route.ts 的服务端。

仅用于本地联合测试（不进生产）。逻辑与 route.ts 一一对应：
- POST：校验 x-push-token（或 Authorization: Bearer）== STRATEGY_PUSH_TOKEN || CRON_SECRET
       校验 body 含 'selected'，写入 DATA_DIR/strategy-scan/latest.json
- GET ：读出落盘 JSON 返回 {ok, scan}
"""
import json
import os
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

DATA_DIR = os.environ.get("MOCK_DATA_DIR", os.path.join(os.path.dirname(__file__), "data"))
SCAN_FILE = os.path.join(DATA_DIR, "strategy-scan", "latest.json")
PUSH_SECRET = os.environ.get("STRATEGY_PUSH_TOKEN") or os.environ.get("CRON_SECRET") or ""


def _secret() -> str:
    return PUSH_SECRET


class Handler(BaseHTTPRequestHandler):
    def _send(self, code: int, obj: dict):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path.rstrip("/") != "/api/strategy-scan":
            self._send(404, {"ok": False, "error": "not found"})
            return
        try:
            with open(SCAN_FILE, "r", encoding="utf-8") as f:
                scan = json.load(f)
            self._send(200, {"ok": True, "scan": scan})
        except FileNotFoundError:
            self._send(404, {"ok": False, "error": "尚未生成策略扫描结果"})
        except Exception as e:  # noqa: BLE001
            self._send(500, {"ok": False, "error": str(e)})

    def do_POST(self):
        if self.path.rstrip("/") != "/api/strategy-scan":
            self._send(404, {"ok": False, "error": "not found"})
            return
        secret = _secret()
        provided = self.headers.get("x-push-token") or (
            self.headers.get("authorization") or "").replace("Bearer ", "", 1) or None
        if not secret or provided != secret:
            self._send(401, {"ok": False, "error": "unauthorized"})
            return
        length = int(self.headers.get("Content-Length", "0") or "0")
        raw = self.rfile.read(length) if length else b"{}"
        try:
            body = json.loads(raw.decode("utf-8"))
        except Exception:
            self._send(400, {"ok": False, "error": "invalid json"})
            return
        if not isinstance(body, dict) or "selected" not in body:
            self._send(400, {"ok": False, "error": "invalid payload: missing 'selected'"})
            return
        try:
            os.makedirs(os.path.dirname(SCAN_FILE), exist_ok=True)
            with open(SCAN_FILE, "w", encoding="utf-8") as f:
                json.dump(body, f, ensure_ascii=False, indent=2)
            self._send(200, {"ok": True, "savedAt": __import__("datetime").datetime.now().isoformat()})
        except Exception as e:  # noqa: BLE001
            self._send(500, {"ok": False, "error": f"write failed: {e}"})

    def log_message(self, *args):  # 静默
        pass


def main():
    port = int(os.environ.get("MOCK_PORT", "9100"))
    srv = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"MOCK_STRATEGY_SCAN listening on http://127.0.0.1:{port}  (secret_set={bool(PUSH_SECRET)})")
    srv.serve_forever()


if __name__ == "__main__":
    main()
