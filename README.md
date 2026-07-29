# 我的股票助手

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

数据库迁移位于 `drizzle/`，不要手工删除或重新编号。
