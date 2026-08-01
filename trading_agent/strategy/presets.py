"""经典短线选股策略预设

每个预设是一组 screener / signal 的「权重 + 阈值」覆盖值（overrides）。
它与现有多因子引擎解耦：引擎仍按 8 因子打分，预设只是把权重/阈值
调成对应风格。新增策略只需在此追加条目，前端/CLI/API 三处自动生效。

使用方式：
  - 命令行：run_hub.py --overrides '{"preset":"breakout"}'
  - API    ：POST /api/strategy-scan/run   body 含 "preset":"breakout"
  - 前端    ：配置面板「策略预设」下拉框

优先级（低 -> 高）：
  prefetched 内嵌 config  <  预设基线(preset)  <  前端/CLI 显式覆盖字段
"""
from __future__ import annotations


# 三套经典短线打法：数据现成、风险可控（不含打板/题材等需实时涨停盘口数据的策略）
STRATEGY_PRESETS: dict[str, dict] = {
    "breakout": {
        "label": "放量突破",
        "desc": "强调动量 + 量能，要求活跃换手，捕捉横盘后放量突破前高。",
        "overrides": {
            # 因子权重（运行时归一化）
            "w_momentum": 0.40,
            "w_liquidity": 0.22,
            "w_trend": 0.16,
            "w_rsi": 0.10,
            "w_macd": 0.08,
            "w_value": 0.02,
            "w_size": 0.02,
            "w_quality": 0.00,
            # 阈值 / 参数
            "momentum_window": 20,
            "min_turnover_pct": 1.0,       # 要求活跃换手，过滤无量假突破
            "use_breakout_filter": True,   # 信号侧：突破 N 日新高才买入
            "breakout_window": 20,
        },
    },
    "ma_golden": {
        "label": "均线多头金叉",
        "desc": "趋势跟随：重趋势 + 动量，快/慢均线 5/10 金叉确认。",
        "overrides": {
            "w_trend": 0.38,
            "w_momentum": 0.26,
            "w_liquidity": 0.14,
            "w_rsi": 0.12,
            "w_macd": 0.06,
            "w_value": 0.02,
            "w_size": 0.02,
            "w_quality": 0.00,
            "fast_ma": 5,
            "slow_ma": 10,
            "min_turnover_pct": 0.30,
        },
    },
    "macd_cross": {
        "label": "MACD 金叉",
        "desc": "动能反转：重 MACD 动能 + 趋势，捕捉 DIF 上穿 DEA。",
        "overrides": {
            "w_macd": 0.40,
            "w_trend": 0.24,
            "w_momentum": 0.18,
            "w_rsi": 0.10,
            "w_liquidity": 0.06,
            "w_value": 0.02,
            "w_size": 0.00,
            "w_quality": 0.00,
            "macd_fast": 12,
            "macd_slow": 26,
            "macd_signal": 9,
            "min_turnover_pct": 0.30,
        },
    },
}


def get_preset(name: str) -> dict | None:
    """返回预设定义（含 label/desc/overrides）；不存在返回 None。"""
    return STRATEGY_PRESETS.get(name)


def resolve_preset(overrides: dict) -> dict:
    """若 overrides 含 'preset'，把对应预设的覆盖值合并为基线。

    优先级：显式覆盖字段 > 预设基线。预设键本身保留在返回 dict 中，
    便于调用方感知当前生效的预设。不修改入参，返回新 dict。
    """
    preset_name = overrides.get("preset")
    if not preset_name:
        return dict(overrides)
    preset = STRATEGY_PRESETS.get(preset_name)
    if not preset:
        return dict(overrides)
    merged: dict = dict(preset.get("overrides", {}))
    for k, v in overrides.items():
        if k == "preset":
            continue
        merged[k] = v
    merged["preset"] = preset_name
    return merged
