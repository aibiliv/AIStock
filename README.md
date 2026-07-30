# 我的复盘助手

面向个人使用的 A 股记录与复盘工具。它负责整理公开行情、记录交易、触发价格提醒并辅助复盘，不提供荐股或自动交易。

## 主要功能

- 单用户账号登录，页面和数据接口均受保护
- 公开渠道行情、财务和题材信息整理
- DeepSeek 或 OpenAI 兼容模型解释
- 关注股票、买卖记录、持仓与盈亏计算
- 止盈止损提醒、公告摘要和交易复盘
- JSON 数据备份

## 本地运行

需要 Node.js 22.13 或更高版本。

```bash
npm install
npm run dev
```

访问终端显示的本地地址。登录与 AI 配置放在不会提交到 Git 的 `.env` 或 `.env.local` 中：

```dotenv
APP_USERNAME=owner
APP_PASSWORD=至少12位密码
APP_AUTH_SECRET=至少32位随机字符

DEEPSEEK_API_KEY=
```

完整字段说明见 `.env.example`。

## 检查

```bash
npm run lint
npm test
```

## 部署

- Sites：使用 `.openai/hosting.json`、`worker/` 和 `build/`。
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

访问 `http://<服务器IP>:9003`。查看日志：`docker compose logs -f`；重启：`docker compose restart`；停止：`docker compose down`。D1 数据持久化在宿主机 `./data` 目录（容器重建不丢）。

### 部署提速说明（重要）

`deploy.sh` 使用 `docker compose build`（**不带 `--no-cache`**）+ BuildKit 缓存挂载，复用依赖安装层，避免每次重新 `npm install`：

- **只改源码的部署**：`node_modules` 层直接命中缓存，`npm install` 约 0 秒，仅重跑 `npm run build`。
- **改了 `package.json` / `package-lock.json`**：依赖层失效并重装，但借助 `/root/.npm` 缓存挂载（`--prefer-offline`）只补下载变动的包，而非全量。
- 依赖安装用 `npm ci`（比 `npm install` 更快、更确定，且强制 lock 与 package.json 同步）。

注意事项：

- **不要**在部署前运行 `docker builder prune -a` 或 `docker system prune`，否则会清空 npm 缓存挂载，重新变回全量下载。
- 想更新基础镜像（`node:22-bookworm`）的安全补丁时，偶尔跑一次 `docker compose build --pull` 即可。
- 若改了依赖却想强制重装（绕过缓存层），用 `docker compose build --no-cache`。

### 环境变量

登录与 AI 配置放在不会提交到 Git 的 `.env` 中；字段说明见 `.env.example`：

```dotenv
APP_USERNAME=owner
APP_PASSWORD=至少12位密码
APP_AUTH_SECRET=至少32位随机字符   # 生成: openssl rand -hex 32

DEEPSEEK_API_KEY=
AI_PROVIDER=
AI_API_KEY=
AI_API_BASE=
AI_MODEL=
```

数据库迁移位于 `drizzle/`，不要手工删除或重新编号。
