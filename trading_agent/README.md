# 交易 Agent MVP

实现 `docs/trading-agent-architecture.md` 的核心闭环：**选票 → 操作 → 回测 → 优化策略**。

数据底座使用**真实 A 股公开接口**（腾讯财经估值 + 东财 push2his 前复权日线），免 key、无需连接连接器即可运行。

## 架构与文档映射

| 文档分层 | 本实现 |
|----------|--------|
| 业务层：选票 | `strategy/screener.py`（多因子打分） |
| 业务层：操作 | `strategy/signals.py`（均线交叉 + 突破 + 止损） |
| 业务层：回测 | `backtest/engine.py` + `backtest/metrics.py` |
| 业务层：优化策略 | `optimization/optimizer.py`（网格搜索） |
| 中枢：桥接连接器 | `bridge.py`（ConnectorHub，路由到最优源） |
| 中枢：策略计算 Agent | `core/loop.py`（四步编排） |
| 中枢：执行回写 + 推送 | `notify.py` + `reports/report.py`（本地报告） |
| 数据底座 | `data/provider.py`（腾讯 / 东财直连，含缓存） |
| 触达层 | 本地报告（邮件/微信为架构预留，需连接对应连接器） |

## 运行

```bash
cd trading_agent
python main.py                  # 默认：选 8 只 + 参数优化
python main.py --top-n 10       # 选出 10 只
python main.py --no-optim       # 跳过优化
python main.py --use-hot        # 同花顺当日强势股作候选池
python main.py --universe-size 20
```

## 可调参数

集中在 `config.py`：`ScreenerConfig`（因子权重/过滤）、`SignalConfig`（均线/突破/止损）、
`BacktestConfig`（手续费/滑点）、`OptimConfig`（网格与目标指标）。亦可经 `main.py` 命令行覆盖。

## 数据缓存

`cache/` 下按代码缓存 K 线 / 估值（1 天有效期），重复运行不再打网络。

## 已知边界

- 本系统为**分析 / 回测 / 模拟**框架，结果基于历史数据，不构成投资建议，不做真实资金下单。
- 通达信（`tdx-connector`）、腾讯自选股（`westock-mcp`）连接器当前未连接；`bridge.py` 已预留接口，连接后可即插即用切换数据源与模拟交易。
- 触达层当前为本地报告；邮件推送需连接 `agent-mail`，微信/App 推送需连接 westock / 微信连接器。
