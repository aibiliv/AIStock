#!/bin/sh
# 容器启动脚本：根据宿主环境变量生成 wrangler 本地 secrets(.dev.vars)，
# 再启动 wrangler 本地运行时托管 Worker。
set -e

cd /app/dist/server

# wrangler dev 会读取 cwd 下的 .dev.vars，将其作为 worker env 的 vars 绑定注入。
# 应用代码通过 import { env } from "cloudflare:workers" 读取 env.AI_API_KEY / AI_PROVIDER 等。
: > .dev.vars
append_var() {
  name="$1"; value="$2"
  [ -n "$value" ] && printf '%s = "%s"\n' "$name" "$value" >> .dev.vars
}
append_var DEEPSEEK_API_KEY "$DEEPSEEK_API_KEY"
append_var AI_API_KEY "$AI_API_KEY"
append_var AI_PROVIDER "$AI_PROVIDER"
append_var AI_API_BASE "$AI_API_BASE"
append_var AI_MODEL "$AI_MODEL"
append_var APP_USERNAME "$APP_USERNAME"
append_var APP_PASSWORD "$APP_PASSWORD"
append_var APP_AUTH_SECRET "$APP_AUTH_SECRET"

exec npx wrangler dev --local \
  --config wrangler.json --no-bundle \
  --ip 0.0.0.0 --port 8787 \
  --persist-to /data --show-interactive-dev-session=false
