"""候选股票池获取（对应架构「选票」的输入）"""
from __future__ import annotations

import config
from . import provider


def get_universe(cfg: config.AppConfig, dp=None) -> list[str]:
    """返回候选股票代码列表。

    - use_hot_universe=True：用同花顺当日强势股作为动态候选池（真实热点）。
    - 否则：使用配置的默认/自定义静态股票池。
    dp: DataProvider（可注入）。None 时回退默认数据源。
    """
    dp = dp or provider.default_provider()
    if cfg.use_hot_universe:
        hot = dp.fetch_hot_stocks()
        codes = [h["code"] for h in hot if h["code"]]
        return codes[:60]  # 限流保护：最多取前 60 只
    return list(cfg.universe)
