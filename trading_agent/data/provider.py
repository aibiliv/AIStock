"""数据底座 · 真实 A 股数据获取（对应架构「数据底座·连接器」）

数据源（均免 key、HTTP 直连，已实测可用）：
  - 腾讯财经 API   → 实时估值（PE/PB/市值/换手率等），不封 IP
  - 东财 push2his  → 前复权日线 K 线（OHLCV），低风控

内置本地缓存（cache/），避免重复打网络；内置轻量节流。
"""
from __future__ import annotations

import json
import os
import time
import urllib.parse
import urllib.request
from abc import ABC, abstractmethod
from typing import Optional

import config

_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/117.0.0.0 Safari/537.36"
_CACHE_DIR = config.CACHE_DIR
_THROTTLE = 0.15  # 两次网络请求最小间隔（秒）
_last_call = [0.0]


def _throttle():
    wait = _THROTTLE - (time.time() - _last_call[0])
    if wait > 0:
        time.sleep(wait)
    _last_call[0] = time.time()


def _http_get(url: str, params: Optional[dict] = None, timeout: int = 12) -> str:
    if params:
        url = url + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url)
    req.add_header("User-Agent", _UA)
    last_err = None
    for attempt in range(3):
        try:
            _throttle()
            with urllib.request.urlopen(req, timeout=timeout) as r:
                charset = r.headers.get_content_charset() or "utf-8"
                return r.read().decode(charset, errors="replace")
        except Exception as e:  # 瞬时网络错误重试（连接被断开/超时等）
            last_err = e
            time.sleep(0.5 * (attempt + 1))
    raise last_err


def _cache_path(kind: str, key: str) -> str:
    os.makedirs(_CACHE_DIR, exist_ok=True)
    return os.path.join(_CACHE_DIR, f"{kind}_{key}.json")


def _load_cache(kind: str, key: str, max_age_sec: int = 86400) -> Optional[dict]:
    p = _cache_path(kind, key)
    if not os.path.exists(p):
        return None
    if (time.time() - os.path.getmtime(p)) > max_age_sec:
        return None
    try:
        with open(p, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def _save_cache(kind: str, key: str, data: dict):
    p = _cache_path(kind, key)
    with open(p, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)


def market_prefix(code: str) -> str:
    if code.startswith(("6", "9")):
        return "sh"
    if code.startswith("8"):
        return "bj"
    return "sz"


def _sina_kline(code: str) -> list[dict]:
    """新浪日 K 线（免 key、稳定）。scale=240 为日线。返回原始记录列表。"""
    prefix = "sh" if code.startswith(("6", "9")) else ("bj" if code.startswith("8") else "sz")
    url = "https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData"
    params = {"symbol": f"{prefix}{code}", "scale": "240", "ma": "no", "datalen": "400"}
    d = json.loads(_http_get(url, params))
    return d or []


def _em_kline(code: str, beg: str, end: str) -> list[dict]:
    """东财 push2his 日 K 线（兜底源，前复权）。"""
    secid = ("1." if code.startswith("6") else "0.") + code
    url = "https://push2his.eastmoney.com/api/qt/stock/kline/get"
    params = {
        "secid": secid,
        "fields1": "f1,f2,f3,f4,f5,f6",
        "fields2": "f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61",
        "klt": "101", "fqt": "1", "beg": beg, "end": end,
    }
    d = json.loads(_http_get(url, params))
    rows = []
    for line in (d.get("data") or {}).get("klines") or []:
        p = line.split(",")
        if len(p) < 11:
            continue
        rows.append({
            "date": p[0], "open": float(p[1]), "close": float(p[2]),
            "high": float(p[3]), "low": float(p[4]), "vol": float(p[5]),
            "amount": float(p[6]), "amplitude": float(p[7]),
            "pct": float(p[8]), "turnover": float(p[10]) if p[10] not in ("", "-") else 0.0,
        })
    return rows


def _normalize_kline(raw: list[dict]) -> list[dict]:
    """统一字段 -> {date, open, close, high, low, vol, amount, ...}"""
    out = []
    for b in raw:
        if "day" in b:  # 新浪格式
            out.append({
                "date": b["day"], "open": float(b["open"]), "close": float(b["close"]),
                "high": float(b["high"]), "low": float(b["low"]),
                "vol": float(b.get("volume", 0)), "amount": 0.0,
                "amplitude": 0.0, "pct": 0.0, "turnover": 0.0,
            })
        else:  # 东财格式
            out.append(b)
    return out


def fetch_kline(code: str, beg: str = "20250101", end: str = "20500101") -> list[dict]:
    """获取日线 K 线（新浪为主，东财兜底）。

    返回: [{date, open, close, high, low, vol, amount, ...}, ...]（按日期升序）
    注：新浪为未复权价；对 MVP 回测足够，如需前复权可优先走东财。
    """
    cached = _load_cache("kline", f"{code}_{beg}_{end}")
    if cached is not None:
        return cached

    rows: list[dict] = []
    try:
        rows = _normalize_kline(_sina_kline(code))
    except Exception:
        rows = []
    if not rows:  # 兜底
        try:
            rows = _em_kline(code, beg, end)
        except Exception:
            rows = []

    _save_cache("kline", f"{code}_{beg}_{end}", rows)
    return rows


def fetch_quote(code: str) -> dict:
    """获取实时估值（腾讯财经 API）。

    返回: {name, price, pe_ttm, pb, mcap_yi, float_mcap_yi, turnover_pct, change_pct, ...}
    """
    cached = _load_cache("quote", code)
    if cached is not None:
        return cached

    prefix = market_prefix(code)
    url = f"https://qt.gtimg.cn/q={prefix}{code}"
    data = _http_get(url)
    # 形如 v_sh600519="...";
    if '"' not in data:
        return {}
    vals = data.split('"')[1].split("~")
    if len(vals) < 53:
        return {}
    q = {
        "code": code,
        "name": vals[1],
        "price": float(vals[3] or 0),
        "last_close": float(vals[4] or 0),
        "open": float(vals[5] or 0),
        "change_pct": float(vals[32] or 0),
        "high": float(vals[33] or 0),
        "low": float(vals[34] or 0),
        "amount_wan": float(vals[37] or 0),
        "turnover_pct": float(vals[38] or 0),
        "pe_ttm": float(vals[39] or 0),
        "amplitude_pct": float(vals[43] or 0),
        "mcap_yi": float(vals[44] or 0),
        "float_mcap_yi": float(vals[45] or 0),
        "pb": float(vals[46] or 0),
        "limit_up": float(vals[47] or 0),
        "limit_down": float(vals[48] or 0),
        "pe_static": float(vals[52] or 0),
    }
    _save_cache("quote", code, q)
    return q


def fetch_hot_stocks() -> list[dict]:
    """同花顺当日强势股（题材归因），作候选池时调用。零鉴权。"""
    cached = _load_cache("hot", "today")
    if cached is not None:
        return cached
    from datetime import date as _date
    today = _date.today().strftime("%Y-%m-%d")
    url = (
        f"http://zx.10jqka.com.cn/event/api/getharden/"
        f"date/{today}/orderby/date/orderway/desc/charset/GBK/"
    )
    try:
        d = json.loads(_http_get(url))
    except Exception:
        return []
    rows = []
    for it in (d.get("data") or []):
        rows.append({
            "code": str(it.get("code", "")),
            "name": it.get("name", ""),
            "reason": it.get("reason", ""),
            "change_pct": float(it.get("zhangfu") or 0),
        })
    _save_cache("hot", "today", rows)
    return rows


class DataProvider(ABC):
    """数据源抽象（架构图「数据底座·连接器」的统一接口）。

    trading_agent 引擎只认这个接口，不关心数据来自腾讯/东财直连、
    还是来自 WorkBuddy 中枢（westock-mcp / tdx-connector）。
    这让「WorkBuddy 当中枢」成为可能：中枢取数后注入 StaticProvider，
    引擎照常计算，自身不直连任何 MCP。
    """

    @abstractmethod
    def fetch_kline(self, code: str, beg: str, end: str) -> list[dict]: ...

    @abstractmethod
    def fetch_quote(self, code: str) -> dict: ...

    @abstractmethod
    def fetch_hot_stocks(self) -> list[dict]: ...


class TencentEastMoneyProvider(DataProvider):
    """默认数据源：腾讯估值 + 东财/新浪 K 线，免 key 直连。"""

    def fetch_kline(self, code: str, beg: str, end: str) -> list[dict]:
        return fetch_kline(code, beg, end)

    def fetch_quote(self, code: str) -> dict:
        return fetch_quote(code)

    def fetch_hot_stocks(self) -> list[dict]:
        return fetch_hot_stocks()


class StaticProvider(DataProvider):
    """WorkBuddy 中枢注入的预取数据（来自 westock/tdx 连接器）。

    中枢先把 connectors 取到的 K 线/估值/热点放进这里，再交给引擎——
    引擎完全不知道数据来源，实现中枢与引擎解耦。
    """

    def __init__(
        self,
        klines: Optional[dict[str, list[dict]]] = None,
        quotes: Optional[dict[str, dict]] = None,
        hot: Optional[list[dict]] = None,
    ):
        self._klines = klines or {}
        self._quotes = quotes or {}
        self._hot = hot if hot is not None else []

    def fetch_kline(self, code: str, beg: str, end: str) -> list[dict]:
        return list(self._klines.get(code, []))

    def fetch_quote(self, code: str) -> dict:
        return dict(self._quotes.get(code, {}))

    def fetch_hot_stocks(self) -> list[dict]:
        return list(self._hot)


class GatewayProvider(DataProvider):
    """通过 HTTP 网关取数（网关由 WorkBuddy 中枢托管，转发到连接器）。

    适用于：trading_agent 以独立进程/定时任务运行，但仍希望数据走
    WorkBuddy 中枢的连接器。网关地址由 WORKBUDDY_GATEWAY_URL 配置。
    """

    def __init__(self, gateway_url: str, timeout: int = 15):
        self.gateway_url = gateway_url.rstrip("/")
        self.timeout = timeout

    def _get(self, path: str, params: dict) -> dict:
        qs = urllib.parse.urlencode(params)
        req = urllib.request.Request(f"{self.gateway_url}{path}?{qs}")
        with urllib.request.urlopen(req, timeout=self.timeout) as r:
            return json.loads(r.read().decode("utf-8", "replace"))

    def fetch_kline(self, code: str, beg: str, end: str) -> list[dict]:
        return self._get("/kline", {"code": code, "beg": beg, "end": end}).get("bars", [])

    def fetch_quote(self, code: str) -> dict:
        return self._get("/quote", {"code": code}).get("quote", {})

    def fetch_hot_stocks(self) -> list[dict]:
        return self._get("/hot", {}).get("stocks", [])


def default_provider() -> DataProvider:
    """按配置返回数据源：配了网关走网关（中枢托管），否则腾讯/东财直连。"""
    gw = os.environ.get("WORKBUDDY_GATEWAY_URL", "").strip()
    if gw:
        return GatewayProvider(gw)
    return TencentEastMoneyProvider()
