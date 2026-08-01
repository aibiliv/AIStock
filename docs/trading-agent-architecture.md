# 交易 Agent 架构文档

本文件描述 `trading_agent/` 模块的整体架构、分层职责与数据流，是 `trading_agent/README.md` 中「选票 → 操作 → 回测 → 优化策略」闭环的权威设计说明。

> 定位：本模块是**分析 / 回测 / 模拟**框架，结果基于历史公开数据，不构成投资建议，不做真实资金下单。

---

## 1. 设计目标

提供一个可在本地 PC 直接运行的轻量量化闭环：

1. **零连接启动**：数据底座走真实 A 股公开接口（腾讯财经估值 + 东财前复权日线），免 key、无需接入任何连接器即可跑通。
2. **四步闭环**：选票 → 操作（信号）→ 回测 → 优化策略，由中枢编排器串联。
3. **跨机器联动**：本地 PC 跑完闭环后，把结果推送（HTTP POST）到远程云端的 AIStock 服务（`/api/strategy-scan`），前端「策略扫描」视图读取展示。
4. **可插拔数据源**：通过桥接层（ConnectorHub）把上层策略与底层数据源解耦，连接器接入后即可即插即用切换。

---

## 2. 分层架构

```
┌───────────────────────────────────────────────────────────┐
│  业务层（策略）                                              │
│   strategy/screener.py      选票（多因子打分）              │
│   strategy/signals.py       操作（均线交叉 + 突破 + 止损）  │
│   backtest/engine.py        回测引擎                        │
│   backtest/metrics.py       回测指标（收益/夏普/回撤…）     │
│   optimization/optimizer.py  优化策略（网格搜索）           │
├───────────────────────────────────────────────────────────┤
│  中枢层（WorkBuddy 中枢）                                   │
│   core/loop.py              闭环编排（四步流水线）          │
│   bridge.py                 ConnectorHub（数据源路由）      │
│   notify.py                 执行回写 + 推送                 │
│   reports/report.py         本地报告 / 扫描 JSON 产出        │
├───────────────────────────────────────────────────────────┤
│  数据底座                                                    │
│   data/provider.py          腾讯 / 东财直连（含缓存）       │
│   data/universe.py          候选池构造（默认池 / 同花顺强势）│
├───────────────────────────────────────────────────────────┤
│  触达层                                                      │
│   本地报告（Markdown / CSV / JSON）                          │
│   云端推送 cloud.py → POST AIStock /api/strategy-scan        │
│   邮件 / 微信（架构预留，需连接对应连接器）                  │
└───────────────────────────────────────────────────────────┘
```

---

## 3. 业务层职责

### 3.1 选票 — `strategy/screener.py`
多因子打分选股，因子与权重集中在 `config.ScreenerConfig`：

| 因子 | 含义 | 默认权重 |
|------|------|----------|
| 动量 `w_momentum` | 回看 `momentum_window`（默认 20 交易日）的动量 | 0.50 |
| 估值 `w_value` | 盈利收益率（PE 倒数） | 0.30 |
| 流动性 `w_liquidity` | 换手率 | 0.20 |

过滤条件：`min_turnover_pct`（换手率下限，默认 0.15%）、`max_pe_ttm`（默认 200）、`max_pb`（默认 20）。选出 `top_n`（默认 8）只标的。

### 3.2 操作 — `strategy/signals.py`
基于均线的买卖信号：

- 快线 `fast_ma`（默认 5）/ 慢线 `slow_ma`（默认 20）均线交叉。
- 可选突破过滤 `use_breakout_filter`：要求突破 `breakout_window`（默认 20）日新高才买入。
- 止损 `stop_loss_pct`（默认 -8%，基于买入价）。
- `max_positions`（默认 8，与选股 `top_n` 对齐）。

### 3.3 回测 — `backtest/engine.py` + `backtest/metrics.py`
对每只标的按信号做回测，产出权益曲线 `equity` 与指标 `metrics`（收益率、夏普、回撤等）。回测成本由 `config.BacktestConfig` 控制：初始资金（仅展示量级）、单边手续费 `fee_rate`（万三）、滑点 `slippage`。

### 3.4 优化策略 — `optimization/optimizer.py`
网格搜索最优 `fast_ma` / `slow_ma` 组合，目标指标 `metric`（默认 `sharpe`）。网格来自 `config.OptimConfig`：`fast_ma_grid=[3,5,8,10]`、`slow_ma_grid=[15,20,30,60]`；`rounds` 为内循环迭代轮数。可用 `--no-optim` 跳过。

---

## 4. 中枢层

### 4.1 闭环编排 — `core/loop.py`
`run(cfg)` 编排四步流水线：

1. `universe.get_universe(cfg)` 取候选池 → `screener.screen` 选票。
2. `provider.fetch_kline` 拉取已选标的历史 K 线 → `signals.generate_signals` 生成当前参数信号 → `engine.backtest` 跑基准回测。
3. （若 `optim.enabled`）`optimizer.optimize` 网格搜索，挑出最优信号与回测。
4. 用最终信号重算信号条数与最终回测，组装 `result` 字典（含 `meta` / `selected` / `base` / `optimized` / `final`）。

### 4.2 桥接连接器 — `bridge.py`
`ConnectorHub` 把上层策略与底层数据源解耦：

- `request_kline`：优先 `TdxConnector`（架构预留，未连接），否则 `EastMoneyConnector`（东财前复权日线）。
- `request_quote`：优先 `WestockConnector`（架构预留，未连接），否则 `TencentConnector`（腾讯估值）。

`TdxConnector` / `WestockConnector` 当前 `available = False`，接入对应连接器后可即插即用。

### 4.3 推送给触达层 — `notify.py` + `reports/report.py`
- `reports/report.py`：写本地报告（Markdown / CSV / JSON），同时 `write_scan_json` 产出与云端同一份 payload；`prune_reports` 轮转（默认保留最近 20 次，可用 `REPORT_KEEP` 调整）。
- `notify.py`：`get_notifier(cfg)` 返回 `local`（默认，仅本地文件）或 `email`（架构预留）。

---

## 5. 数据底座

### 5.1 `data/provider.py`
腾讯 / 东财直连，免费公开接口，含本地缓存（见第 7 节）。

### 5.2 `data/universe.py`
候选池构造：

- 默认池 `config.DEFAULT_UNIVERSE`（跨行业代表性标的，30 只，可作示例）。
- `--use-hot`：同花顺当日强势股作候选池。
- `--universe-size N`：从默认池截取前 N 只。

---

## 6. 跨机器联动（本地 PC → 云端 AIStock）

部署形态：**trading_agent 在本地 PC 运行，AIStock 部署在远程云服务器**。

数据流：

1. 本地 `main.py` 跑完闭环，由 `reports/report.py` 产出 `scan_payload`（共享 JSON，本地查看）。
2. `cloud.push_scan_json` 用 HTTP POST 把 `scan_payload` 推到云端 `POST /api/strategy-scan`，header 带 `x-push-token`（值等于云端环境变量 `STRATEGY_PUSH_TOKEN` / 回退 `CRON_SECRET`）。
3. 云端校验 token 后写入 `/data/strategy-scan/latest.json`（Docker 部署下 `./data` 持久化卷；可用 `STRATEGY_SCAN_FILE` 覆盖路径）。
4. 前端「策略扫描」视图 `GET /api/strategy-scan` 读取并展示。

配置方式（本地 PC 环境变量，部署时填写，不写则仅本地产出）：

```bash
CLOUD_SCAN_URL=https://<云端host>/api/strategy-scan
CLOUD_SCAN_TOKEN=<与云端 STRATEGY_PUSH_TOKEN / CRON_SECRET 一致>
python main.py
```

也可 `python main.py --no-push` 跳过云端推送（仅本地产出）。推送失败不影响本地闭环（控制台打印状态，不抛异常）。

---

## 7. 数据缓存

`cache/` 下按代码缓存 K 线 / 估值（1 天有效期）。重复运行不再打网络，加速迭代。

---

## 8. 用户调参接口

### 8.1 配置类（集中在 `config.py`）

| 配置类 | 关键字段 | 说明 |
|--------|----------|------|
| `ScreenerConfig` | `top_n` / `w_momentum` / `w_value` / `w_liquidity` / `max_pe_ttm` / `max_pb` | 选股因子与过滤 |
| `SignalConfig` | `fast_ma` / `slow_ma` / `use_breakout_filter` / `breakout_window` / `stop_loss_pct` / `max_positions` | 信号与止损 |
| `BacktestConfig` | `initial_cash` / `fee_rate` / `slippage` | 回测成本 |
| `OptimConfig` | `enabled` / `fast_ma_grid` / `slow_ma_grid` / `metric` / `rounds` | 网格优化 |
| `PushConfig` | `url` / `token` | 云端推送目标与鉴权 |
| `AppConfig` | `universe` / `use_hot_universe` / `beg` / `end` / `notifier` | 顶层配置 |

### 8.2 命令行覆盖（`main.py`）

```bash
python main.py                      # 默认：选 8 只 + 优化
python main.py --top-n 10           # 选出 10 只
python main.py --no-optim           # 跳过参数优化
python main.py --use-hot            # 同花顺当日强势股作候选池
python main.py --universe-size 20   # 仅用默认池前 20 只
python main.py --fast-ma 5 --slow-ma 20
python main.py --beg 20250101 --end 20250630
python main.py --notifier email     # local | email
python main.py --no-push            # 跳过云端推送
```

环境变量：`CLOUD_SCAN_URL` / `CLOUD_SCAN_TOKEN`（云端推送）、`STRATEGY_SCAN_DIR`（本地扫描 JSON 目录）、`REPORT_KEEP`（报告保留份数）。

---

## 9. 已知边界

- 结果为历史数据分析 / 回测 / 模拟，不构成投资建议，不做真实下单。
- `TdxConnector`（通达信）、`WestockConnector`（腾讯自选股）连接器当前未连接；`bridge.py` 已预留接口，连接后可即插即用切换数据源与模拟交易。
- 触达层当前为本地报告；邮件推送需连接 `agent-mail`，微信 / App 推送需连接 westock / 微信连接器（架构预留）。
