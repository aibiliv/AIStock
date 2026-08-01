# 交易 Agent

实现 `docs/trading-agent-architecture.md` 的完整闭环：**选票 → 操作 → 回测 → 优化策略**，
并补齐架构图的「桥接连接器 / 执行回写 / 推送提醒 / 用户反馈闭环 / Agent 调度」。

数据底座默认走**真实 A 股公开接口**（腾讯财经估值 + 东财前复权日线），免 key、无需连接连接器即可运行；
接入 `westock-mcp` / `tdx-connector` 后即通过连接器取数，并把信号回写通达信、推送到企业微信。

## 架构与文档映射

| 文档分层 | 本实现 |
|----------|--------|
| 业务层：选票 | `strategy/screener.py`（多因子打分） |
| 业务层：操作 | `strategy/signals.py`（均线交叉 + 突破 + 止损） |
| 业务层：回测 | `backtest/engine.py` + `backtest/metrics.py` |
| 业务层：优化策略 | `optimization/optimizer.py`（网格搜索 + 消费用户反馈） |
| 中枢：桥接连接器 | `bridge.py` + `connectors/`（westock / tdx / push 真实实现） |
| 中枢：策略计算 Agent | `core/loop.py`（四步编排） |
| 中枢：执行回写 + 推送 | `bridge.writeback_signals` + `connectors/push.py`（企业微信） |
| 中枢：Agent 调度 | `agent_server.py`（HTTP 服务，可被 WorkBuddy 调用） |
| 数据底座 | `data/provider.py`（腾讯 / 东财直连，含缓存；连接器启用后切换） |
| 用户反馈闭环 | `feedback_store.py` + `app/api/feedback`（前端有效/无效 → 优化权重） |
| 触达层 | 本地报告 + 云端推送 + 企业微信提醒 |

## 运行

```bash
cd trading_agent
python main.py                  # 默认：选 8 只 + 参数优化
python main.py --top-n 10       # 选出 10 只
python main.py --no-optim       # 跳过优化
python main.py --use-hot        # 同花顺当日强势股作候选池
python main.py --universe-size 20
python main.py --no-connectors  # 强制直连（不碰任何连接器）
python main.py --no-writeback   # 跳过把信号写回通达信
python main.py --serve --port 8080   # 以 HTTP 调度服务运行
```

## 连接器接入（可选，配置即启用）

```bash
# 腾讯自选股 westock-mcp（行情/估值/K线查询）
export WESTOCK_MCP_URL=https://<host>/mcp
export WESTOCK_MCP_TOKEN=<token>
# 通达信 tdx-connector（行情 + 条件选股 + 交易/执行回写）
export TDX_MCP_URL=https://mcp.tdx.com.cn:3001/mcp
export TDX_API_KEY=TDX:xxxxxx
# 企业微信机器人（微信/App 提醒）
export WECOM_WEBHOOK_URL=https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxxx
# 真实回写开关（默认 dry-run 安全）
export TDX_ENABLE_WRITEBACK=1
python main.py
```

未配置上述变量时，自动退回腾讯/东财直连，保持零连接可跑。

## 可调参数

集中在 `config.py`：`ScreenerConfig`（因子权重/过滤）、`SignalConfig`（均线/突破/止损）、
`BacktestConfig`（手续费/滑点）、`OptimConfig`（网格与目标指标）、`ConnectorsConfig`（连接器）。
亦可经 `main.py` 命令行覆盖。

## 数据缓存

`cache/` 下按代码缓存 K 线 / 估值（1 天有效期），重复运行不再打网络。

## 已知边界

- 本系统为**分析 / 回测 / 模拟**框架，结果基于历史数据，不构成投资建议。
- 执行回写默认 `dry_run=True` 安全，真实下单需显式开启 `enable_writeback` 且 `dry_run=False`。
- 微信 / App 提醒经企业微信 Webhook 实现；推送到腾讯自选股 App 本身需另行接入官方通道。
