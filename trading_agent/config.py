"""交易 Agent MVP · 全局配置与可调参数

所有「用户可调参」集中在这里，对应架构文档第五节「用户调参接口」。
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CACHE_DIR = os.path.join(BASE_DIR, "cache")
REPORT_DIR = os.path.join(BASE_DIR, "reports")

# 本地镜像目录：trading_agent 把扫描 JSON 写到这里供本地查看。
# 跨机器场景下，真正送达云端 AIStock 的是「云端推送」（见 PushConfig / cloud.push_scan_json），
# 共享目录不再作为两项目的桥（云服务器读不到本地路径）。
SCAN_SHARE_DIR = os.environ.get(
    "STRATEGY_SCAN_DIR",
    os.path.join(os.path.dirname(os.path.dirname(BASE_DIR)), "strategy-scan"),
)

# 云端推送目标（本地 PC -> 云端 AIStock 接收接口）。
# 可用环境变量 CLOUD_SCAN_URL / CLOUD_SCAN_TOKEN 在部署时填写，不写则跳过推送。
CLOUD_SCAN_URL = os.environ.get("CLOUD_SCAN_URL", "")
CLOUD_SCAN_TOKEN = os.environ.get("CLOUD_SCAN_TOKEN", "")

# 默认股票池：跨行业代表性标的（仅作示例，可在 AppConfig.universe 中修改）
DEFAULT_UNIVERSE = [
    "600519", "000858", "601318", "600036", "000333", "000651", "600276",
    "300750", "002594", "600900", "601012", "000725", "600030", "601888",
    "600887", "002415", "600585", "601166", "000001", "600009", "603288",
    "002475", "600309", "601398", "600000", "000002", "600104", "601857",
    "600028", "601628",
]


@dataclass
class ScreenerConfig:
    """选票（选股）参数"""
    top_n: int = 8                      # 选出标的数量
    momentum_window: int = 20           # 动量回看窗口（交易日）
    w_momentum: float = 0.50            # 因子权重：动量
    w_value: float = 0.30               # 因子权重：估值（盈利收益率）
    w_liquidity: float = 0.20           # 因子权重：流动性（换手率）
    min_turnover_pct: float = 0.15      # 换手率下限，过低剔除（流动性过滤）
    max_pe_ttm: float = 200.0           # PE(TTM) 上限，过高剔除
    max_pb: float = 20.0                # PB 上限，过高剔除


@dataclass
class SignalConfig:
    """操作（信号）参数"""
    fast_ma: int = 5                    # 快线均线周期
    slow_ma: int = 20                   # 慢线均线周期
    use_breakout_filter: bool = True    # 是否要求突破 N 日新高才买入
    breakout_window: int = 20           # 突破窗口
    stop_loss_pct: float = -0.08        # 止损比例（基于买入价）
    max_positions: int = 8              # 最大持仓数（与选股 top_n 对齐）


@dataclass
class BacktestConfig:
    """回测参数"""
    initial_cash: float = 1_000_000.0   # 初始资金（仅用于展示金额量级）
    fee_rate: float = 0.0003            # 单边手续费（万三）
    slippage: float = 0.0005            # 滑点


@dataclass
class OptimConfig:
    """优化策略参数"""
    enabled: bool = True
    fast_ma_grid: list = field(default_factory=lambda: [3, 5, 8, 10])
    slow_ma_grid: list = field(default_factory=lambda: [15, 20, 30, 60])
    metric: str = "sharpe"              # 优化目标指标
    rounds: int = 1                     # 迭代轮数（对应架构内循环）


@dataclass
class PushConfig:
    """云端推送（本地 PC -> 云端 AIStock 接收接口）

    跨机器部署时，trading_agent 在本地 PC 运行，AIStock 在远程云服务器。
    闭环跑完后用 HTTP POST 把扫描 JSON 推到云端接收接口，存到云服务器 /data 卷。
    """
    url: str = CLOUD_SCAN_URL                  # 云端 /api/strategy-scan 完整地址
    token: str = CLOUD_SCAN_TOKEN              # 推送鉴权 token（与云端 STRATEGY_PUSH_TOKEN / CRON_SECRET 一致）


@dataclass
class AppConfig:
    """顶层配置"""
    universe: list = field(default_factory=lambda: list(DEFAULT_UNIVERSE))
    use_hot_universe: bool = False      # 是否用同花顺当日强势股作为候选池
    beg: str = "20250101"               # 行情起始
    end: str = "20500101"               # 行情结束
    screener: ScreenerConfig = field(default_factory=ScreenerConfig)
    signal: SignalConfig = field(default_factory=SignalConfig)
    backtest: BacktestConfig = field(default_factory=BacktestConfig)
    optim: OptimConfig = field(default_factory=OptimConfig)
    notifier: str = "local"             # local（默认）| email
    push: PushConfig = field(default_factory=PushConfig)
