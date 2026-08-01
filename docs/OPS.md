# AIStock 运维手册（OPS）

本文件沉淀**部署 / 重建 / 推送联动**的实操知识，是 `README.md`（部署流程）与 `trading-agent-architecture.md`（设计）的补充。设计原理看架构文档，怎么安全重建和排错看这里。

> 密钥（token / webhook / 邮箱地址的明文）**只存在于 `.env`，绝不写进本仓库任何文档或代码注释**。下文一律以环境变量名指代。

---

## 1. 推送联动接口（本地 PC → 云端）

trading_agent 在本地 PC 跑完闭环，把结果 HTTP POST 到云端 AIStock（Docker，端口 9003）：

| 用途 | 端点 | 存储 | 前端读取 |
|------|------|------|----------|
| 策略扫描 | `POST /api/strategy-scan` | D1 表 `strategy_scan` | `GET /api/strategy-scan` → 「策略扫描」页 |
| 回写结果 | `POST /api/writeback-signals` | D1 表 `strategy_writeback` | `GET /api/writeback-signals` → 「回写结果」页 |

鉴权：两个 POST 都要求 header `x-push-token`，值须等于云端 `STRATEGY_PUSH_TOKEN`（未设则回退 `CRON_SECRET`）。
不匹配返回 `401`；payload 缺 `selected` 字段返回 `400`；正常返回 `200`。

本地 PC 侧环境变量（填了才推送，不填仅本地产出）：

```bash
CLOUD_SCAN_URL=http://<云端host>:9003/api/strategy-scan
CLOUD_SCAN_TOKEN=<与云端 STRATEGY_PUSH_TOKEN 一致>
CLOUD_WRITEBACK_URL=http://<云端host>:9003/api/writeback-signals
# run_hub.py 会优先读以上变量；也可用参数覆盖：
#   python run_hub.py --prefetched prefetched.json \
#     --scan-url $CLOUD_SCAN_URL --push-url $CLOUD_WRITEBACK_URL
```

> ⚠️ 调用 `run_hub.py` 时**务必让 token 从 `.env` 读取，不要硬编码 `--scan-token` 覆盖**，否则会与云端 `STRATEGY_PUSH_TOKEN` 不一致，导致 `401`。

---

## 2. 重建 / 更新部署（最重要）

### 2.1 标准流程（README 已有）

```bash
git pull origin main
./deploy.sh          # 内部 docker compose build（不带 --no-cache）+ up
```

### 2.2 两个真实踩坑（务必遵守）

**坑一：本地没 push，服务器 pull 不到新代码。**
服务器是从它**自己的 git checkout** 构建的。本地改了 `route.ts` 但没 `git push`，服务器 `git pull` 拿不到任何东西，容器跑的仍是旧代码。
→ 改完代码后**先 `git push origin main`**，再上服务器 `git pull`。

**坑二：Docker 层缓存把旧构建产物喂给你。**
`deploy.sh` 为加速**不带 `--no-cache`**。仅改源码时这没问题（命中 `node_modules` 缓存，只重跑 build）；但若曾遇诡异「代码改了但线上行为没变」，是缓存层复用了旧产物。
→ 强制干净重建：

```bash
docker compose build --no-cache fupanbu
docker compose up -d --force-recreate fupanbu
```

**验证新代码确实上线**（以 D1 迁移为例，确认 route 已含 D1 逻辑）：

```bash
# 进容器看源码是否含 strategyScan（D1 版标志）
docker compose exec fupanbu grep -l "strategyScan" /app/app/api/strategy-scan/route.ts
```

### 2.3 一键重建检查清单

1. 本地：`git add -A && git commit -m "..." && git push origin main`
2. 服务器：`git pull origin main`
3. 服务器：`docker compose build --no-cache fupanbu && docker compose up -d --force-recreate fupanbu`
4. 验证：浏览器开 `http://<host>:9003/`，看「策略扫描」「回写结果」是否能正常进（无 500）
5. 本地：跑 `run_hub.py` 推送，确认两端 `HTTP 200`

---

## 3. Cloudflare Workers 的 fs 限制（500 错误的根因）

**现象**：推送后云端返回 `500`，日志 `write failed: operation not permitted`（EPERM）。

**原因**：Cloudflare Workers 沙箱**禁止在请求处理函数里写裸文件系统**（`fs.writeFile('/data/...')` 一律失败）。`--persist-to /data` 只服务于 D1 / KV，不提供任意文件写。

**修复（已落地）**：扫描/回写结果改存 **D1 表** `strategy_scan` / `strategy_writeback`，由 `db/schema.ts` + `db/index.ts` 的 `ensureSchema()` 建表。`docker-compose` 把 `./data` 挂为 `--persist-to /data`，D1 持久化绑定此卷，**容器重建不丢**。

**铁律**：不要为了「落盘可看」把这两处改回文件写入；需要本地查看用 `reports/report.py` 的本地报告。

---

## 4. 个人微信触达通道决策

- **现状**：未配置企业微信。个人微信收提醒走 **WorkBuddy 智能体邮箱（agent-mail）** 中转（零额外账号，已开通）。
- **机制**：WorkBuddy 自动化在盘前（工作日 09:00）编排 → 取数 → 跑引擎 → 用 agent-mail `SendMessage` 把选股摘要发到绑定邮箱，个人微信收邮件提醒。
- **备选**：若想直接推微信消息，可用 Server酱（`SERVERCHAN_KEY`）/ PushPlus（`PUSHPLUS_TOKEN`）等第三方 relay，由 `run_hub.py` 的 `push_wechat()` 发送（本机 Python 出站可达；WorkBuddy 沙箱内出站被限，故在本地 PC 跑）。
- **不要用**企业微信 Webhook（`WECOM_WEBHOOK_URL`）——那是 `connectors/push.py` 的可选代码路径，未配置企业微信时无效。

---

## 5. 连接器边界（诚实声明）

- `tdx-connector` / `westock-mcp` 当前仅暴露**查询类工具**（K 线、行情、估值、条件选股），**无 `place_order`**。
- 因此枢纽推送过来的「回写信号」恒为**候选回写 / dry-run**，前端「回写结果」页已标注「模拟」。真实下单需接入带下单能力的连接器并显式关闭 dry-run。
- 选股结果是历史数据 / 回测 / 模拟，**不构成投资建议**。

---

## 6. 环境变量约定（密钥清单）

| 变量 | 作用 | 位置 |
|------|------|------|
| `STRATEGY_PUSH_TOKEN` | 推送鉴权（云端 + 本地 `CLOUD_SCAN_TOKEN` 须一致） | 云端 `.env`；`start.sh` 注入 wrangler `.dev.vars` |
| `CLOUD_SCAN_URL` / `CLOUD_SCAN_TOKEN` | 本地 PC 推送目标与 token | 本地 PC `.env` |
| `CLOUD_WRITEBACK_URL` | 本地 PC 回写推送目标 | 本地 PC `.env` |
| `WX_PUSH_DRIVER` / `SERVERCHAN_KEY` / `PUSHPLUS_TOKEN` | 微信 relay（可选） | 本地 PC `.env` |
| `CRON_SECRET` | `STRATEGY_PUSH_TOKEN` 的兜底 | 云端 `.env` |

> 任何 token 缺失或错配都会让推送返回 `401`。改 token 后记得本地与云端**两边同步**，并走第 2.3 节重建检查清单。

---

## 7. 快速排错

| 症状 | 可能原因 | 处理 |
|------|----------|------|
| 推送 `401` | token 不一致 / 硬编码覆盖 / 改了没同步 | 核对本地 `CLOUD_SCAN_TOKEN` == 云端 `STRATEGY_PUSH_TOKEN`；去掉 `--scan-token` 硬编码 |
| 推送 `500` + `operation not permitted` | route 仍写 `/data` 文件 | 确认已用 D1 版 route（第 3 节），并走重建检查清单 |
| 页面 404「尚未生成结果」 | 本地还没推送 / 推送失败 | 跑 `run_hub.py` 推送，看是否 `200` |
| 线上行为像旧代码 | 没 push / Docker 缓存 | 第 2.2 节两步排查 |
| 微信收不到 | 未跑本地 agent-mail 自动化 | 检查 WorkBuddy 自动化是否运行、agent-mail 是否连接 |
