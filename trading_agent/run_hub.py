"""中枢驱动：消费 WorkBuddy 中枢写出的 prefetched.json，跑纯引擎闭环。

分工（WorkBuddy 当中枢架构）：
  - 枢纽（本会话 / 定时 automation）负责：用 tdx-connector / westock-mcp 取数，
    把数据写成 prefetched.json，再把运行结果推送出去。
  - 本脚本只做纯计算：选票 -> 信号 -> 回测 -> 优化，产出
      scan_payload.json : 推送云端/企业微信的内容（write_scan_json 同款结构）
      signals_out.json  : 候选 BUY 信号（含最新收盘价，供枢纽回写）

可选推送：若传入 --push-url（或环境变量 CLOUD_WRITEBACK_URL）与 --push-token
（或环境变量 CLOUD_SCAN_TOKEN），会把候选回写信号包装为回写载荷 POST 到该地址，
供云端「回写结果」页展示。未传入则只在本地写出 signals_out.json。

prefetched.json schema：
{
  "universe": ["600519", ...],          # 可选；缺省用 klines 的全部 code
  "config":   { "top_n": 8, "momentum_window": 20, "fast_ma": 5,
                "slow_ma": 10, "optim_enabled": false, ... },  # 可选覆盖
  "klines": { "600519": [ {"date","open","high","low","close","volume","amount"}, ... ] },
  "quotes": { "600519": { "name","price","pe_ttm","pb","turnover_pct","change_pct" } },
  "hot":    []
}
字段命名做了兼容：tdx 的 Data/Open/Close 与 westock 的 pe_ratio/pb_ratio 都会被归一化。
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime
from urllib.request import Request, urlopen
from urllib.error import URLError, HTTPError

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import config
from data.provider import StaticProvider
from hub import run as hub_run, _build_signals
from strategy import presets


def _norm_bar(b: dict) -> dict:
    def g(*ks):
        for k in ks:
            if k in b and b[k] not in (None, ""):
                return b[k]
        return None

    return {
        "date": g("date", "Data"),
        "open": float(g("open", "Open") or 0),
        "high": float(g("high", "High") or 0),
        "low": float(g("low", "Low") or 0),
        "close": float(g("close", "Close") or 0),
        "volume": float(g("volume", "Volume", "vol", "VolInStock") or 0),
        "amount": float(g("amount", "Amount") or 0),
    }


def _norm_quote(q: dict, code: str) -> dict:
    def g(*ks):
        for k in ks:
            if k in q and q[k] not in (None, ""):
                return q[k]
        return None

    return {
        "name": g("name") or code,
        "price": float(g("price") or 0),
        "pe_ttm": float(g("pe_ttm", "pe_ratio") or 0),
        "pb": float(g("pb", "pb_ratio") or 0),
        "turnover_pct": float(g("turnover_pct", "turnover_rate") or 0),
        "change_pct": float(g("change_pct", "change_percent") or 0),
        "mcap_yi": float(g("mcap_yi", "float_mcap_yi", "total_mv", "market_cap") or 0),
        # 质量因子（ROE / 股息率）；缺省为 None，screener 据此判断是否启用质量因子
        "roe": (float(g("roe")) if g("roe") not in (None, "") else None),
        "dividend_yield": (float(g("dividend_yield", "dividendYield")) if g("dividend_yield", "dividendYield") not in (None, "") else None),
    }


def load_prefetched(path: str):
    with open(path, "r", encoding="utf-8") as f:
        raw = json.load(f)
    klines = {c: [_norm_bar(b) for b in bars] for c, bars in raw.get("klines", {}).items()}
    # 合并基本面（ROE / 股息率）：中枢可取数后写入 prefetched["fundamentals"]
    raw_quotes = raw.get("quotes", {})
    fundamentals = raw.get("fundamentals") or {}
    for c, f in fundamentals.items():
        if c in raw_quotes and f:
            raw_quotes[c]["roe"] = f.get("roe")
            raw_quotes[c]["dividend_yield"] = f.get("dividend_yield")
    quotes = {c: _norm_quote(q, c) for c, q in raw_quotes.items()}
    hot = raw.get("hot", [])
    codes = raw.get("universe") or list(klines.keys())
    return klines, quotes, hot, codes, raw.get("config", {})


def apply_config(cfg: config.AppConfig, ov: dict):
    sc = cfg.screener
    if "top_n" in ov:
        sc.top_n = int(ov["top_n"])
    if "max_per_sector" in ov:
        sc.max_per_sector = int(ov["max_per_sector"])
    if "momentum_window" in ov:
        sc.momentum_window = int(ov["momentum_window"])
    if "min_turnover_pct" in ov:
        sc.min_turnover_pct = float(ov["min_turnover_pct"])
    if "max_pe_ttm" in ov:
        sc.max_pe_ttm = float(ov["max_pe_ttm"])
    if "max_pb" in ov:
        sc.max_pb = float(ov["max_pb"])
    if "w_momentum" in ov:
        sc.w_momentum = float(ov["w_momentum"])
    if "w_value" in ov:
        sc.w_value = float(ov["w_value"])
    if "w_liquidity" in ov:
        sc.w_liquidity = float(ov["w_liquidity"])
    if "w_rsi" in ov:
        sc.w_rsi = float(ov["w_rsi"])
    if "w_macd" in ov:
        sc.w_macd = float(ov["w_macd"])
    if "w_trend" in ov:
        sc.w_trend = float(ov["w_trend"])
    if "w_size" in ov:
        sc.w_size = float(ov["w_size"])
    if "w_quality" in ov:
        sc.w_quality = float(ov["w_quality"])
    if "rsi_window" in ov:
        sc.rsi_window = int(ov["rsi_window"])
    if "macd_fast" in ov:
        sc.macd_fast = int(ov["macd_fast"])
    if "macd_slow" in ov:
        sc.macd_slow = int(ov["macd_slow"])
    if "macd_signal" in ov:
        sc.macd_signal = int(ov["macd_signal"])
    if "vol_window" in ov:
        sc.vol_window = int(ov["vol_window"])
    if "fast_ma" in ov:
        cfg.signal.fast_ma = int(ov["fast_ma"])
    if "slow_ma" in ov:
        cfg.signal.slow_ma = int(ov["slow_ma"])
    if "use_breakout_filter" in ov:
        cfg.signal.use_breakout_filter = bool(ov["use_breakout_filter"])
    if "optim_enabled" in ov:
        cfg.optim.enabled = bool(ov["optim_enabled"])
    if "stop_loss_pct" in ov:
        cfg.signal.stop_loss_pct = float(ov["stop_loss_pct"])
    # 市场状态（风控前置）
    if "market_enable" in ov:
        cfg.market.enable = bool(ov["market_enable"])
    if "index_code" in ov:
        cfg.market.index_code = str(ov["index_code"])
    # 前置条件过滤（板块 / ST / 流通市值）
    if "boards" in ov:
        cfg.screener.boards = list(ov["boards"])
    if "st_filter" in ov:
        cfg.screener.st_filter = str(ov["st_filter"])
    if "mcap_min" in ov:
        cfg.screener.mcap_min = float(ov["mcap_min"])
    if "mcap_max" in ov:
        cfg.screener.mcap_max = float(ov["mcap_max"])


def push_writeback(url: str, token: str, payload: dict) -> bool:
    """把候选回写载荷 POST 到云端 /api/writeback-signals。"""
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = Request(
        url,
        data=data,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "x-push-token": token,
        },
    )
    try:
        with urlopen(req, timeout=15) as resp:
            ok = resp.status == 200
            print(f"回写推送 {'成功' if ok else '失败'} (HTTP {resp.status}) -> {url}")
            return ok
    except HTTPError as e:
        print(f"回写推送被拒绝 (HTTP {e.code}): {e.read().decode('utf-8', 'replace')[:200]}")
    except URLError as e:
        print(f"回写推送失败（网络/地址错误）: {e.reason}")
    except Exception as e:  # noqa: BLE001
        print(f"回写推送异常: {e}")
    return False


def push_scan(url: str, token: str, payload: dict) -> bool:
    """把扫描结果 POST 到云端 /api/strategy-scan。"""
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = Request(
        url,
        data=data,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "x-push-token": token,
        },
    )
    try:
        with urlopen(req, timeout=15) as resp:
            ok = resp.status == 200
            print(f"扫描推送 {'成功' if ok else '失败'} (HTTP {resp.status}) -> {url}")
            return ok
    except HTTPError as e:
        print(f"扫描推送被拒绝 (HTTP {e.code}): {e.read().decode('utf-8', 'replace')[:200]}")
    except URLError as e:
        print(f"扫描推送失败（网络/地址错误）: {e.reason}")
    except Exception as e:  # noqa: BLE001
        print(f"扫描推送异常: {e}")
    return False


def build_writeback_payload(signals: list[dict]) -> dict:
    return {
        "generatedAt": datetime.now().isoformat(timespec="seconds"),
        "dryRun": True,
        "channel": "tdx-connector（本环境仅查询工具，无 place_order；回写为模拟 dry-run）",
        "signals": signals,
        "note": (
            "执行回写暂不可用：当前 tdx-connector 未提供下单接口。"
            "以上为候选回写信号，待接入带下单能力的券商 MCP 后切换为真实回写。"
        ),
    }


def render_wechat_digest(payload: dict, signals: list[dict]) -> tuple[str, str]:
    """把选股结果渲染成微信推送用的 (标题, Markdown正文)。"""
    sel = payload.get("selected", [])
    bm = payload.get("backtest", {}).get("baseMetrics", {})
    date = datetime.now().strftime("%Y-%m-%d")
    title = f"盘前选股 {date} · 入选 {payload.get('selectedCount', len(sel))} 只"
    lines: list[str] = []
    if sel:
        lines.append("**入选标的**")
        for r in sel:
            lines.append(
                f"- {r['code']} {r.get('name','')}｜得分 {r.get('score',0):.2f}"
                f"｜PE {r.get('peTtm')}｜PB {r.get('pb')}｜动量 {r.get('momentum',0)*100:.1f}%"
            )
    else:
        lines.append("（今日无入选）")
    lines.append("")
    lines.append(
        f"**基准回测**｜交易 {bm.get('trades')}｜总收益 {bm.get('totalReturn')}｜夏普 {bm.get('sharpe')}"
    )
    if signals:
        lines.append("")
        lines.append(f"**候选回写（模拟 dry-run）** {len(signals)} 笔")
        for s in signals:
            lines.append(f"- BUY {s['code']} {s['name']} @ {s['price']} × {s['quantity']}")
        lines.append("")
        lines.append("> 回写为模拟：当前 tdx-connector 无 place_order，待接入下单能力券商后切真。")
    return title, "\n".join(lines)


def push_wechat(payload: dict, signals: list[dict]) -> bool:
    """把选股结果推送到个人微信（经 Server酱 / PushPlus 中转，落点=微信「服务通知」）。

    依赖环境变量：WX_PUSH_DRIVER(serverchan|pushplus) + 对应 Key。
    """
    driver = (os.environ.get("WX_PUSH_DRIVER") or "").lower()
    if not driver or driver == "none":
        return False
    title, desp = render_wechat_digest(payload, signals)
    try:
        if driver == "serverchan":
            key = os.environ.get("SERVERCHAN_KEY") or ""
            if not key:
                print("WX_PUSH_DRIVER=serverchan 但未配置 SERVERCHAN_KEY，跳过微信推送")
                return False
            url = "https://sctapi.ftqq.com/Send"
            data = json.dumps({"sendkey": key, "title": title, "desp": desp}, ensure_ascii=False).encode("utf-8")
            req = Request(url, data=data, method="POST", headers={"Content-Type": "application/json"})
        elif driver == "pushplus":
            token = os.environ.get("PUSHPLUS_TOKEN") or ""
            if not token:
                print("WX_PUSH_DRIVER=pushplus 但未配置 PUSHPLUS_TOKEN，跳过微信推送")
                return False
            url = "http://www.pushplus.plus/send"
            body = {"token": token, "title": title, "content": desp, "template": "markdown"}
            data = json.dumps(body, ensure_ascii=False).encode("utf-8")
            req = Request(url, data=data, method="POST", headers={"Content-Type": "application/json"})
        else:
            print(f"未知 WX_PUSH_DRIVER={driver}（支持 serverchan / pushplus），跳过微信推送")
            return False
        with urlopen(req, timeout=15) as resp:
            txt = resp.read().decode("utf-8", "replace")
            ok = resp.status == 200
            try:
                obj = json.loads(txt)
                code = obj.get("code")
                ok = ok and (code in (0, 200))
            except Exception:
                pass
            print(f"微信推送（{driver}）{'成功' if ok else '失败'} (HTTP {resp.status})")
            return ok
    except HTTPError as e:
        print(f"微信推送被拒绝 (HTTP {e.code}): {e.read().decode('utf-8', 'replace')[:200]}")
    except URLError as e:
        print(f"微信推送失败（网络/地址错误）: {e.reason}")
    except Exception as e:  # noqa: BLE001
        print(f"微信推送异常: {e}")
    return False


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--prefetched", required=True)
    ap.add_argument("--out-dir", default=os.path.dirname(os.path.abspath(__file__)))
    ap.add_argument("--overrides", default=None,
                    help="JSON 字符串，含 screener/signal/market/optim 覆盖参数（优先级高于 prefetched.config）")
    ap.add_argument("--scan-url", default=os.environ.get("CLOUD_SCAN_URL") or "")
    ap.add_argument("--scan-token", default=os.environ.get("CLOUD_SCAN_TOKEN") or "")
    ap.add_argument("--push-url", default=os.environ.get("CLOUD_WRITEBACK_URL") or "")
    ap.add_argument("--push-token", default=os.environ.get("CLOUD_SCAN_TOKEN") or "")
    args = ap.parse_args()

    klines, quotes, hot, codes, prefetched_cfg = load_prefetched(args.prefetched)
    if not codes:
        print("prefetched.json 中没有可用标的，退出。")
        sys.exit(1)

    # CLI overrides（用户显式意图，优先级最高）
    cli_ov: dict = {}
    if args.overrides:
        try:
            parsed = json.loads(args.overrides)
            if isinstance(parsed, dict):
                cli_ov = parsed
                print(f"已解析 CLI overrides: {list(cli_ov.keys())}")
        except json.JSONDecodeError as e:
            print(f"--overrides JSON 解析失败: {e}，忽略")

    # 解析策略预设：preset 作为「配方基线」，显式字段（prefetched/CLI）覆盖预设
    merged = presets.resolve_preset(cli_ov)
    if cli_ov.get("preset"):
        print(f"已套用策略预设: {cli_ov.get('preset')}")
    # 最终优先级：prefetched 内嵌 config < 预设基线 < 显式覆盖
    ov = {**prefetched_cfg, **merged}

    cfg = config.AppConfig()
    cfg.universe = codes
    # 持久默认：strategy_config.yaml（优先级低于 prefetched/preset/显式 overrides）
    yaml_ov = config.load_strategy_config()
    if yaml_ov:
        apply_config(cfg, yaml_ov)
        print(f"已套用 strategy_config.yaml: {list(yaml_ov.keys())}")
    apply_config(cfg, ov)

    def data_fetcher():
        return klines, quotes, hot

    # 纯引擎运行（回写/推送由枢纽负责，这里不传）
    payload = hub_run(cfg, data_fetcher=data_fetcher)
    signals = _build_signals(payload, klines)

    out_dir = args.out_dir
    os.makedirs(out_dir, exist_ok=True)
    with open(os.path.join(out_dir, "scan_payload.json"), "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2, default=str)
    with open(os.path.join(out_dir, "signals_out.json"), "w", encoding="utf-8") as f:
        json.dump(signals, f, ensure_ascii=False, indent=2, default=str)

    sel = payload.get("selected", [])
    bm = payload.get("backtest", {}).get("baseMetrics", {})
    print("=== trading_agent 引擎运行完成（纯计算，回写/推送由枢纽执行）===")
    print(f"候选池: {payload.get('universeSize')} 只 | 入选: {payload.get('selectedCount')} 只")
    for r in sel:
        print(
            f"  {r['code']} {r.get('name','')}  得分={r.get('score',0):.3f}  "
            f"PE={r.get('peTtm')}  PB={r.get('pb')}  动量={r.get('momentum',0)*100:.1f}%"
        )
    print(f"\n基准回测: 交易={bm.get('trades')} 总收益={bm.get('totalReturn')} 夏普={bm.get('sharpe')}")
    print(f"\n候选回写信号: {len(signals)} 笔")
    for s in signals:
        print(f"  BUY {s['code']} {s['name']} @ {s['price']} x{s['quantity']}")
    print(f"\n已写出: scan_payload.json, signals_out.json")

    # 可选：把扫描结果推送到云端「策略扫描」页
    if args.scan_url and args.scan_token:
        push_scan(args.scan_url, args.scan_token, payload)
    else:
        print("（未配置扫描推送地址/令牌，跳过云端扫描推送；本地 scan_payload.json 已就绪）")

    # 可选：把候选回写信号推送到云端「回写结果」页
    if args.push_url and args.push_token:
        push_writeback(args.push_url, args.push_token, build_writeback_payload(signals))
    else:
        print("（未配置回写推送地址/令牌，跳过云端回写推送；本地 signals_out.json 已就绪）")

    # 可选：把选股结果推送到个人微信（经 Server酱 / PushPlus 中转，落点=微信「服务通知」）
    if (os.environ.get("WX_PUSH_DRIVER") or "").lower() not in ("", "none"):
        push_wechat(payload, signals)
    else:
        print("（未配置 WX_PUSH_DRIVER，跳过微信推送；如需微信接收，在 .env 设置 WX_PUSH_DRIVER + 对应 Key）")


if __name__ == "__main__":
    main()
