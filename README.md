# 我的复盘助手

面向个人使用的 A 股记录与复盘工具。它负责整理公开行情、记录交易、触发价格提醒并辅助复盘，不提供荐股或自动交易。

技术栈：Next.js（App Router，前端页面与 API 路由都在 `app/`）+ Cloudflare Workers（边缘入口在 `worker/`，拉起 Next 构建产物）+ Cloudflare D1（SQLite）+ drizzle ORM。架构是「纯前端 + 边缘函数 + SQLite」，无独立后端单体服务。仓库内也包含 `Dockerfile`/`docker-compose.yml`（方便自托管）与 `trading_agent/`（Python 量化脚本，详见下文）。

## 主要功能

- 单用户账号登录（Cookie session），页面和数据接口均受保护
- 公开渠道行情、财务和题材信息整理（东财 / 腾讯 / Yahoo 等免费接口，可选麦蕊智数增强）
- DeepSeek 或任意 OpenAI 兼容模型解释（也支持 Ollama / OpenRouter / GitHub Models 等免费源）
- 关注股票、买卖记录、持仓与盈亏计算
- 止盈止损提醒（前端轮询 + 可选 Cloudflare Cron 每 15 分钟主动推送通知）
- 公告摘要（支持上传 PDF / 链接，自动解析文本）
- 交易复盘（记录是否按计划、偏离原因、情绪、评分、备注）
- 策略扫描：本地 Python 量化脚本（trading_agent）跑选股/信号/回测，推送结果到云端，前端可视化
- 板块行情与个股主力资金流向查询
- 分析历史留存、数据导出（JSON / 备份）
- 对话式复盘助手（SmartAssistant，调用 `/api/assistant`）

## 本地运行

需要 Node.js 22.13 或更高版本（见 `package.json` engines）。

```bash
npm install
npm run dev      # 实际执行 vinext dev
```

> 本项目使用 `vinext`（Cloudflare 适配的 Next 构建工具）而非原生 `next`，`dev`/`build`/`start` 脚本均已映射。

访问终端显示的本地地址。登录与 AI 配置放在不会提交到 Git 的 `.env` 中（字段说明见 `.env.example`）：

```dotenv
APP_USERNAME=owner
APP_PASSWORD=至少12位密码
APP_AUTH_SECRET=至少32位随机字符

DEEPSEEK_API_KEY=
```

不配置 AI 密钥时应用进入「自动解释」模式（无 AI 分析，其余功能正常）。

## 检查

```bash
npm run lint
npm test
```

## 部署

- Cloudflare Workers：使用 `worker/`（边缘入口）与 `build/`（`vinext build` 产物）。数据库为 D1，迁移位于 `drizzle/`（不要手工删除或重新编号）。
- Docker：使用 `Dockerfile`、`docker-compose.yml`、`start.sh` 和 `deploy.sh`。

### Docker 部署（Ubuntu 24 + Docker 26+）

前置条件（服务器上执行一次）：

```bash
sudo apt update && sudo apt install -y docker.io
sudo systemctl enable docker --now
sudo usermod -aG docker $USER && newgrp docker
sudo ufw allow 9003/tcp
```

首次部署：

```bash
git clone <repo> && cd <repo>
cp .env.example .env        # 填写 AI 密钥与登录凭据（见下方字段说明）
chmod +x deploy.sh
./deploy.sh
```

后续更新（改完代码 push 后）：

```bash
git pull origin main
./deploy.sh
```

访问 `http://<服务器IP>:9003`。查看日志：`docker compose logs -f`；重启：`docker compose restart`；停止：`docker compose down`。数据（D1 与策略扫描结果）持久化在宿主机 `./data` 目录（容器重建不丢）。

### 部署提速说明（重要）

`deploy.sh` 使用 `docker compose build`（**不带 `--no-cache`**）+ BuildKit 缓存挂载，复用依赖安装层，避免每次重新 `npm install`：

- **只改源码的部署**：`node_modules` 层直接命中缓存，`npm install` 约 0 秒，仅重跑 `npm run build`。
- **改了 `package.json`**：依赖层失效并重装，但借助 `/root/.npm` 缓存挂载（`--prefer-offline`）只补下载变动的包，而非全量。
- 依赖安装用 `npm install`（在容器内按 Ubuntu 平台重新解析，不依赖 lock 文件）。`package-lock.json` 已在 `.gitignore` 中忽略（Windows 开发 / Ubuntu 部署，平台相关二进制 `esbuild`/`workerd`/`@webassemblyjs` 解析不同，不跨平台同步），故构建不强制 lock 与 `package.json` 一致，避免跨平台 `npm ci` 报 Missing/Invalid。

注意事项：

- **不要**在部署前运行 `docker builder prune -a` 或 `docker system prune`，否则会清空 npm 缓存挂载，重新变回全量下载。
- 想更新基础镜像（`node:22-bookworm`）的安全补丁时，偶尔跑一次 `docker compose build --pull` 即可。
- 若改了依赖却想强制重装（绕过缓存层），用 `docker compose build --no-cache`。

### 环境变量

登录与 AI 配置放在不会提交到 Git 的 `.env` 中；完整字段与示例见 `.env.example`：

```dotenv
# 单用户登录（必填）：openssl rand -hex 32 生成安全密钥
APP_USERNAME=owner
APP_PASSWORD=至少12位密码
APP_AUTH_SECRET=至少32位随机字符

# AI 模型源（可选；不配则自动解释模式）
DEEPSEEK_API_KEY=
AI_PROVIDER=
AI_API_KEY=
AI_API_BASE=
AI_MODEL=

# 行情增强（可选）：麦蕊智数 licence，覆盖实时现价/涨跌
MAIRUI_TOKEN=

# 主动提醒推送（可选）：止盈/止损触发时 Webhook 推送（企业微信/飞书/Slack/Bark）
NOTIFY_WEBHOOK_URLS=https://qyapi.weixin.qq.com/...,https://api.day.app/KEY/

# 定时器密钥（可选）：外部 Cron 调用 POST /api/cron/check-alerts 时鉴权
CRON_SECRET=

# 策略扫描推送鉴权（可选）：本地 trading_agent 推送结果到云端
STRATEGY_PUSH_TOKEN=
STRATEGY_SCAN_FILE=           # 覆盖扫描结果存储路径，默认 /data/strategy-scan/latest.json
```

## API 路由

所有 `/api/*` 路由均受 `lib/auth.ts` 的 `requireApiUser` 保护（Cron 与策略推送除外，使用各自的 token）。

| 路由 | 方法 | 说明 |
|------|------|------|
| `/api/auth/login` `/api/auth/logout` | POST | 单用户登录 / 登出（Cookie session） |
| `/api/trades` | GET / POST | 交易记录（POST 买入带 `maxLoss` 时自动建止损提醒） |
| `/api/watchlist` | GET / POST / PATCH / DELETE | 关注股票 |
| `/api/alerts` | GET / POST / PATCH | 提醒规则（`PATCH action`: `disable`/`acknowledge`/`trigger`） |
| `/api/reviews` | GET / POST | 交易复盘 |
| `/api/account` | GET / PUT | 账户（初始资金 / 资金流水；`PUT action`: `initialCapital`/`create_flow`/`delete_flow`） |
| `/api/import` | POST | 仅接受 `{csv}` 原始文本，服务端解析券商导出 |
| `/api/export` | GET | 数据导出（JSON 备份） |
| `/api/analyze` | GET / POST | 股票分析（`POST {query, saveHistory, explain}`） |
| `/api/analysis-history` | GET / DELETE | 分析历史留存 |
| `/api/announcements` | GET / POST / DELETE | 公告（`POST` 用 FormData：symbol/name/title/file/sourceUrl，支持 PDF 解析） |
| `/api/assistant` | POST | 对话式复盘助手（SmartAssistant） |
| `/api/market` | GET | 板块行情（`type=concepts`）与个股主力资金流（`type=fundflow&symbol=`） |
| `/api/indices` `/api/sector-heatmap` | GET | 指数与板块热力图 |
| `/api/preferences` | GET / PUT | 用户偏好设置 |
| `/api/strategy-scan` | GET / POST | 策略扫描结果读取（GET）/ 本地 trading_agent 推送（POST，需 `x-push-token`） |
| `/api/cron/check-alerts` | POST | 定时器入口：拉取实时价判断是否触发提醒并推送（需 `Authorization: Bearer <CRON_SECRET>`） |
| `/api/status` | GET | 运行状态 |

## 量化策略脚本（trading_agent/）

`trading_agent/` 是独立的 Python 模块，实现「选票 → 操作 → 回测 → 优化策略」闭环，使用真实 A 股公开接口（腾讯 / 东财，免 key）。详细文档见 `trading_agent/README.md`。

典型用法：

```bash
cd trading_agent
python main.py                  # 默认：选 8 只 + 参数优化
python main.py --top-n 10       # 选出 10 只
python main.py --no-optim       # 跳过优化
python main.py --use-hot        # 同花顺当日强势股作候选池
```

该模块通常在**本地 PC**运行，跑完选股/信号/回测后，将结果 POST 到云端的 `/api/strategy-scan`（带 `x-push-token`，值等于云端的 `STRATEGY_PUSH_TOKEN`/`CRON_SECRET`），前端「策略扫描」视图再 GET 展示。结果为历史数据分析/回测/模拟，不构成投资建议，不做真实下单。

## 前端与组件

- 单页应用：主入口 `app/page.tsx`（服务端校验登录后渲染 `app/Dashboard.tsx`）。
- 视图状态机 `view ∈ home | analysis | watchlist | trades | settings | analytics | strategyScan`；分析页由 `app/AnalyticsView.tsx` 渲染。
- 组件库统一封装在 `app/components.tsx`，样式由 `app/globals.css` 的语义化 class + CSS 变量驱动，新增页面优先复用，详见 `app/UI-COMPONENTS.md`。
- 图表使用 `lightweight-charts`；分析页导出 PDF 用 `html-to-image` + `jspdf`（动态 import）。
- 金额统一以整数存储（`priceMillis` ×1000 为主，旧数据可能仅 `priceCents` ×100），前端避免散落浮点金额计算，格式化集中在 `lib/format.ts`。

数据库迁移位于 `drizzle/`，不要手工删除或重新编号。
