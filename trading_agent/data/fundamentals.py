"""基本面数据管线（质量因子 · ROE / 股息率 数据源）

质量因子（screener 的 w_quality）需要 ROE 与股息率，而默认行情源
（腾讯/东财直连 quote）不提供。本模块是「接入基本面数据源」的统一入口：

  1) 本地缓存 cache/fundamentals.json（code -> {roe, dividend_yield, updated}）
     —— 任意数据源（a-stock-data 技能 / westock 财务接口 / 手动）都能写它；
  2) 兜底：实时拉东财 F10 数据中心，取最新 ROE（ROEJQ，净资产收益率加权）；
     股息率尽力尝试，取不到则留空（质量因子退化为仅用 ROE）。

设计要点：
  - 全部网络调用都 try/except 包裹，失败不破坏选股流程（质量因子自动跳过）。
  - 结果按周缓存，避免重复打网络 / 触发风控。
  - screener 在 quote 带 roe / dividend_yield 时自动启用质量因子，本模块
    正是负责把这些字段喂进 quote（见 provider 集成）。
"""
from __future__ import annotations

import json
import os
import time
import urllib.parse
import urllib.request
from typing import Optional

import config

_CACHE_DIR = config.CACHE_DIR
_CACHE_FILE = os.path.join(_CACHE_DIR, "fundamentals.json")
_MAX_AGE_SEC = 7 * 86400  # 缓存 7 天
_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/117.0.0.0 Safari/537.36"


def _now() -> float:
    return time.time()


def _load_cache() -> dict:
    if not os.path.exists(_CACHE_FILE):
        return {}
    try:
        with open(_CACHE_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def _save_cache(data: dict):
    os.makedirs(_CACHE_DIR, exist_ok=True)
    try:
        with open(_CACHE_FILE, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False)
    except Exception:
        pass


def _http_json(url: str, params: dict, timeout: int = 12):
    if params:
        url = url + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": _UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        charset = r.headers.get_content_charset() or "utf-8"
        return json.loads(r.read().decode(charset, errors="replace"))


def _datacenter(report_name: str, flt: str, page_size: int = 1) -> list[dict]:
    """东财数据中心 v1/get，返回 data 数组（一行一 dict）。失败抛异常。"""
    params = {
        "reportName": report_name,
        "columns": "ALL",
        "filter": f"({flt})",
        "pageSize": str(page_size),
        "sortColumns": "REPORT_DATE",
        "sortTypes": "-1",
    }
    d = _http_json("https://datacenter-web.eastmoney.com/api/data/v1/get", params)
    res = (d.get("result") or {})
    arr = res.get("data") or []
    return [r for r in arr if isinstance(r, dict)]


def _fetch_em_roe(code: str) -> Optional[float]:
    """东财 F10 主要财务指标：最新 ROE（加权，ROEJQ，单位 %）。"""
    try:
        rows = _datacenter("RPT_F10_FINANCE_MAINFINADATA", f'SECURITY_CODE="{code}"', 3)
        for r in rows:
            v = r.get("ROEJQ")
            if v is not None:
                try:
                    return float(v)
                except (TypeError, ValueError):
                    continue
    except Exception:
        pass
    return None


def _fetch_em_dividend_yield(code: str) -> Optional[float]:
    """东财分红融资明细：尽力取股息率（字段不稳定，失败返回 None）。

    不同报表字段名差异大，这里扫描常见股息/分红相关字段；取不到即 None，
    质量因子将退化为仅用 ROE。
    """
    candidates = ["RPT_DMSK_DIVIDEND", "RPT_F10_FINANCE_DIVIDEND"]
    keys_of_interest = ("DIVIDEND", "YIELD", "SGPA", "GXL", "BONUS_RATIO", "DIVIDEND_RATIO")
    for rn in candidates:
        try:
            rows = _datacenter(rn, f'SECURITY_CODE="{code}"', 5)
            for r in rows:
                for k, v in r.items():
                    if any(t in k.upper() for t in keys_of_interest) and v not in (None, "", "-"):
                        try:
                            return float(v)
                        except (TypeError, ValueError):
                            continue
        except Exception:
            continue
    return None


def fetch_fundamentals(code: str, force: bool = False) -> dict:
    """返回单只标的的基本面 {roe, dividend_yield}（均为百分比数值或 None）。

    优先读本地缓存；缺失 / 过期 / force=True 时实时拉取并写回缓存。
    任何网络失败都返回已有缓存或双 None，不影响选股。
    """
    cache = _load_cache()
    entry = cache.get(code)
    fresh = entry and (not force) and (_now() - entry.get("updated", 0) < _MAX_AGE_SEC)
    if fresh:
        return {"roe": entry.get("roe"), "dividend_yield": entry.get("dividend_yield")}

    roe = _fetch_em_roe(code)
    div = _fetch_em_dividend_yield(code)
    # 保留另一方已有的缓存值（部分失败时不丢数据）
    if entry:
        roe = roe if roe is not None else entry.get("roe")
        div = div if div is not None else entry.get("dividend_yield")
    if roe is not None or div is not None:
        cache[code] = {"roe": roe, "dividend_yield": div, "updated": _now()}
        _save_cache(cache)
    return {"roe": roe, "dividend_yield": div}


def fetch_all_fundamentals(codes: list[str], throttle: float = 0.25, force: bool = False) -> dict:
    """批量拉取并写缓存，返回 {code: {roe, dividend_yield}}。"""
    out: dict = {}
    for c in codes:
        out[c] = fetch_fundamentals(c, force=force)
        if throttle:
            time.sleep(throttle)
    return out
