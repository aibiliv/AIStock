#!/bin/sh
# 容器启动脚本：根据宿主环境变量生成 wrangler 本地 secrets(.dev.vars)，
# 再启动 wrangler 本地运行时托管 Worker。
set -e

cd /app/dist/server

# wrangler dev 会读取 cwd 下的 .dev.vars，将其作为 worker env 的 vars 绑定注入。
# 应用代码通过 import { env } from "cloudflare:workers" 读取 env.AI_API_KEY / AI_PROVIDER 等。
node --input-type=module -e '
  import { writeFileSync } from "node:fs";
  const names = [
    "DEEPSEEK_API_KEY",
    "AI_API_KEY",
    "AI_PROVIDER",
    "AI_API_BASE",
    "AI_MODEL",
    "APP_USERNAME",
    "APP_PASSWORD",
    "APP_AUTH_SECRET",
    "MAIRUI_TOKEN",
    "NOTIFY_WEBHOOK_URLS",
    "CRON_SECRET",
  ];
  const lines = names
    .filter((name) => process.env[name])
    .map((name) => `${name} = ${JSON.stringify(process.env[name])}`);
  writeFileSync(".dev.vars", `${lines.join("\n")}\n`, { mode: 0o600 });
'

exec npx wrangler dev --local \
  --config wrangler.json --no-bundle \
  --ip 0.0.0.0 --port 8787 \
  --persist-to /data --show-interactive-dev-session=false
