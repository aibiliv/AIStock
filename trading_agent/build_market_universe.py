"""把云端策略配置翻译成 tdx_screener 的自然语言查询，用于「按勾选板块全市场选股」。

用法:
    python build_market_universe.py
输出(打印到 stdout):
    TDEX_QUERY=<自然语言查询，直接作为 tdx_screener 的 message>
    BOARDS=<云端 boards>
    ST_FILTER=<云端 st_filter>
并打印云端 screener 配置原文，便于核对。

说明:
    - 本脚本只负责「翻译 + 打印」，不调用 tdx(MCP 工具由中枢/WorkBuddy 调用)。
    - 板块映射: main→主板, cyb→创业板, kc→科创板, bj→北交所。
    - 市值单位为「亿」，与 tdx_screener 的「流通市值大于X亿」一致。
    - 为避免候选池过大(主板全市场数千只)，本查询忠实翻译云端配置；
      若云端 min_turnover_pct / mcap 过松导致命中过多，请在上调整云端的
      流动性/市值门槛，或在中枢分页收集时设置上限(见自动化 prompt)。
"""
from __future__ import annotations

import os
import re
import sys
import json

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import pull_cloud_config as pcc

BOARD_CN = {
    "main": "主板",
    "cyb": "创业板",
    "kc": "科创板",
    "bj": "北交所",
}


def read_env(path: str, keys: set[str]) -> dict:
    vals = {}
    try:
        with open(path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                m = re.match(r"^([A-Za-z0-9_]+)=\s*(.*?)\s*$", line)
                if m and m.group(1) in keys:
                    vals[m.group(1)] = m.group(2).strip('"').strip("'")
    except FileNotFoundError:
        pass
    return vals


def main():
    base = os.environ.get("CLOUD_BASE_URL") or ""
    user = os.environ.get("CLOUD_CFG_USER") or ""
    pwd = os.environ.get("CLOUD_CFG_PASS") or ""
    if not base or not user or not pwd:
        # 退而求其次：从项目根 .env 读
        env = read_env(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                    "..", ".env"),
                       {"CLOUD_BASE_URL", "CLOUD_CFG_USER", "CLOUD_CFG_PASS"})
        base = base or env.get("CLOUD_BASE_URL", "")
        user = user or env.get("CLOUD_CFG_USER", "")
        pwd = pwd or env.get("CLOUD_CFG_PASS", "")

    if not base or not user or not pwd:
        print("未配置云端凭据(CLOUD_BASE_URL/CLOUD_CFG_USER/CLOUD_CFG_PASS)", file=sys.stderr)
        sys.exit(1)

    cookie = pcc.login(base, user, pwd)
    if not cookie:
        print("云端登录失败", file=sys.stderr)
        sys.exit(1)
    _status, obj, _raw = pcc.fetch_cloud_config_raw(base, cookie)
    if not obj:
        print("获取云端配置失败", file=sys.stderr)
        sys.exit(1)
    cfg = obj.get("config") or {}
    sc = cfg.get("screener") or {}

    boards = sc.get("boards") or ["main"]
    board_terms = [BOARD_CN.get(b, b) for b in boards]
    board_q = "或".join(board_terms) if len(board_terms) > 1 else board_terms[0]

    parts = [board_q]

    st = sc.get("st_filter", "exclude_st")
    if st == "exclude_st":
        parts.append("非ST")
    elif st == "only_st":
        parts.append("ST")

    mcap_min = sc.get("mcap_min", 0) or 0
    mcap_max = sc.get("mcap_max", 10000) or 10000
    if mcap_min and mcap_min > 0:
        parts.append(f"流通市值大于{mcap_min}亿")
    if mcap_max and mcap_max < 10000:
        parts.append(f"流通市值小于{mcap_max}亿")

    turn = sc.get("min_turnover_pct", 0) or 0
    if turn and turn > 0:
        parts.append(f"换手率大于{turn}%")

    pe = sc.get("max_pe_ttm", 500) or 500
    if pe and pe < 500:
        parts.append(f"市盈率小于{pe}")

    pb = sc.get("max_pb", 50) or 50
    if pb and pb < 50:
        parts.append(f"市净率小于{pb}")

    query = " ".join(parts)

    print(f"TDEX_QUERY={query}")
    print(f"BOARDS={','.join(boards)}")
    print(f"ST_FILTER={st}")
    print("--- 云端 screener 配置原文 ---")
    print(json.dumps(sc, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
