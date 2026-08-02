"""把云端策略配置翻译成「多连接器」的全市场选股查询，用于「按勾选板块全市场选股」。

用法:
    python build_market_universe.py
输出(打印到 stdout, 机器可解析):
    TDEX_QUERY=<自然语言查询，直接作为 tdx_screener 的 message>
    WESTOCK_FILTER_PRESET=<腾讯自选股 tool_filter 的 preset，如 low_pe>
    WESTOCK_FILTER_MAX_PE=<preset 的 max_pe 参数，对应云端 max_pe_ttm>
    BOARDS=<云端 boards>
    ST_FILTER=<云端 st_filter>
并打印云端 screener 配置原文，便于核对。

说明:
    - 本脚本只负责「翻译 + 打印」，不调用任何连接器(MCP 工具由中枢/WorkBuddy 调用)。
    - 双连接器候选源:
        * 通达信 tdx_screener: 自然语言组合(板块/非ST/换手/市值/PE/PB)。
        * 腾讯自选股 tool_filter: preset=low_pe + max_pe(对应云端 PE 上限)，
          与 tdx 结果合并去重，扩大候选覆盖。
      (注: tool_filter 的 INTERSECT 复合语法服务端报错，故用 preset 单维度，
       其余门槛(换手/PB/市值)由引擎硬过滤或 tdx 查询覆盖。)
    - 板块映射: main→主板, cyb→创业板, kc→科创板, bj→北交所。
    - 市值单位为「亿」，与 tdx_screener 的「流通市值大于X亿」一致。
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

    # 腾讯自选股 tool_filter 参数: 用 low_pe preset 覆盖云端 PE 上限
    # (INTERSECT 复合语法服务端报错，故用单维度 preset，其余门槛引擎硬过滤)
    westock_preset = "low_pe"
    max_pe = pe if (pe and pe < 500) else 500

    print(f"TDEX_QUERY={query}")
    print(f"WESTOCK_FILTER_PRESET={westock_preset}")
    print(f"WESTOCK_FILTER_MAX_PE={max_pe}")
    print(f"BOARDS={','.join(boards)}")
    print(f"ST_FILTER={st}")
    print("--- 云端 screener 配置原文 ---")
    print(json.dumps(sc, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
