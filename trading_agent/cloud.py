"""云端推送：本地 PC -> 远程云服务器 AIStock 接收接口

跨机器部署时，trading_agent 运行在本地 PC，AIStock（Next.js）部署在远程云服务器。
闭环跑完后把扫描 JSON（与 write_scan_json 同一份 payload）用 HTTP POST 推到云端，
由云端接口校验 token 后写入其 /data 卷文件，前端再读取展示。
"""
from __future__ import annotations

import json
import urllib.error
import urllib.request

import config


def push_scan_json(payload: dict, cfg: config.AppConfig) -> str:
    """把扫描 payload POST 到云端接收接口。

    返回人类可读的状态串（供控制台日志）；不抛异常（推送失败不影响本地闭环）。
    """
    url = (cfg.push.url or "").strip()
    if not url:
        return "SKIP 未配置 CLOUD_SCAN_URL，跳过云端推送（仅本地产出）。"

    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(url, data=body, method="POST")
    req.add_header("Content-Type", "application/json")
    token = (cfg.push.token or "").strip()
    if token:
        req.add_header("x-push-token", token)

    try:
        with urllib.request.urlopen(req, timeout=25) as r:
            resp = json.loads(r.read().decode("utf-8"))
        if resp.get("ok"):
            return f"PUSH OK -> {url}  (云端保存于 {resp.get('savedAt', 'n/a')})"
        return f"PUSH FAIL -> {url}  (云端返回: {resp.get('error', resp)})"
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="replace")[:200]
        return f"PUSH HTTP {e.code} -> {url}  ({detail})"
    except Exception as e:  # noqa: BLE001 - 推送失败不能中断本地闭环
        return f"PUSH ERROR -> {url}  ({type(e).__name__}: {e})"
