"""企业微信群机器人推送（对应架构图「微信 / 腾讯自选股 App 提醒」）

腾讯自选股 App 推送无公开 MCP 工具，最稳妥的触达通道是企业微信群机器人
Webhook（msgtype=markdown）。留空 webhook_url 则不推送。
"""
from __future__ import annotations

import json
import os
import urllib.request
import urllib.error
from typing import Optional


class WeComPusher:
    def __init__(self, webhook_url: str = ""):
        self.webhook_url = webhook_url or os.environ.get("WECOM_WEBHOOK_URL", "")

    @property
    def enabled(self) -> bool:
        return bool(self.webhook_url)

    def _post(self, payload: dict) -> dict:
        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(self.webhook_url, data=data, method="POST")
        req.add_header("Content-Type", "application/json")
        try:
            resp = urllib.request.urlopen(req, timeout=15)
            return json.loads(resp.read().decode("utf-8", "replace"))
        except urllib.error.HTTPError as e:
            return {"errcode": e.code, "errmsg": e.read().decode("utf-8", "replace")[:200]}
        except Exception as e:  # noqa: BLE001
            return {"errcode": -1, "errmsg": str(e)}

    def push_markdown(self, content: str) -> dict:
        if not self.enabled:
            return {"errcode": -2, "errmsg": "webhook 未配置，跳过推送"}
        return self._post({"msgtype": "markdown", "markdown": {"content": content}})

    def notify_scan(self, scan_result: dict) -> dict:
        """把选股/信号结果格式化为 markdown 推送到企业微信。"""
        meta = scan_result.get("meta", {})
        final = scan_result.get("final", {})
        fm = final.get("metrics", {})
        selected = scan_result.get("selected", [])[:8]
        lines = [
            "# 交易 Agent 选股结果",
            f"> 候选池 {meta.get('universe_size')} → 选出 {meta.get('selected_n')} 只",
            f"> 最终信号 MA{final.get('signal', {}).get('fast_ma')}/MA{final.get('signal', {}).get('slow_ma')}"
            f" · 信号总数 {final.get('n_signals_total', 0)}",
            f"> 总收益 {fm.get('total_return', 0)*100:+.2f}% · 夏普 {fm.get('sharpe', 0):.2f}"
            f" · 回撤 {fm.get('max_drawdown', 0)*100:+.2f}%",
            "",
        ]
        for r in selected:
            lines.append(
                f"- **{r.get('name', r.get('code'))}** `{r.get('code')}` "
                f"得分 {r.get('score')} · 动量 {r.get('momentum')} · PE {r.get('peTtm')} · PB {r.get('pb')}"
            )
        return self.push_markdown("\n".join(lines))
