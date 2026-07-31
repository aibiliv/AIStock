#!/usr/bin/env bash
# =============================================================================
# 复盘簿（fupanbu-trading-journal）Ubuntu 24 一键部署脚本
#
# 前置条件（在 Ubuntu 24 服务器上执行一次即可）：
#   sudo apt update && sudo apt install -y docker.io
#   sudo systemctl enable docker --now
#   sudo usermod -aG docker $USER && newgrp docker
#   sudo ufw allow 9003/tcp
#
# 首次部署：
#   1. 把项目 clone/pull 到服务器
#   2. cp .env.example .env 并填好密钥
#   3. chmod +x deploy.sh && ./deploy.sh
#
# 后续更新：
#   git pull origin main && ./deploy.sh
# =============================================================================
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_DIR"

# ---------- 前置检查 ----------
check_cmd() {
  if ! command -v "$1" &>/dev/null; then
    echo "❌ 缺少命令: $1，请先安装。"
    exit 1
  fi
}

check_cmd docker

# 检测 docker compose（V2 插件 或 V1 独立命令）
if docker compose version &>/dev/null; then
  COMPOSE_CMD="docker compose"
elif command -v docker-compose &>/dev/null; then
  COMPOSE_CMD="docker-compose"
else
  echo "❌ 未检测到 docker compose，请安装: sudo apt install -y docker-compose-v2"
  exit 1
fi

if [ ! -f .env ]; then
  echo "❌ 未找到 .env 文件，请先执行: cp .env.example .env 并填写配置"
  exit 1
fi

# 安全提示：检查默认密钥是否被修改
if grep -q "dev-only-secret-key-please-change-me-in-production" .env 2>/dev/null; then
  echo "⚠️  警告：.env 中 APP_AUTH_SECRET 仍为示例值，请修改为随机字符串。"
  echo "   生成命令: openssl rand -hex 32"
fi

# ---------- 部署 ----------
# 镜像已存在则跳过耗时的 docker compose build：
#   - npm install 层已缓存（BuildKit + /root/.npm 挂载），仅源码改动时
#     构建阶段只重跑 npm run build（数十秒~一两分钟），不会再现 800s。
#   - 这样后续 ./deploy.sh 只做 docker compose up -d（秒级），且不会因重装
#     吃满内存把弱服务器带崩。
# 需要强制重建依赖/镜像时：REBUILD=1 ./deploy.sh
IMAGE_NAME="fupanbu-trading-journal:latest"

# 判断是否需要重新构建镜像：
#   - 显式 REBUILD=1
#   - 镜像不存在
#   - 源码 commit 与上次构建记录不一致（避免“镜像已存在就跳过 build”，
#     导致新增的路由/页面——如 /api/preferences——未打进镜像而返回空 500）
#   - 工作区存在未提交改动
LAST_BUILD_MARKER="$PROJECT_DIR/.last_build_commit"
needs_build() {
  if [ "${REBUILD:-0}" = "1" ]; then
    return 0
  fi
  if ! docker image inspect "$IMAGE_NAME" >/dev/null 2>&1; then
    return 0
  fi
  if [ ! -f "$LAST_BUILD_MARKER" ]; then
    return 0
  fi
  local current_commit last_commit
  current_commit="$(git rev-parse HEAD 2>/dev/null || echo unknown)"
  last_commit="$(cat "$LAST_BUILD_MARKER" 2>/dev/null || echo unknown)"
  if [ "$current_commit" != "$last_commit" ]; then
    return 0
  fi
  if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
    return 0
  fi
  return 1
}

if needs_build; then
  echo "==> 构建并重建容器 ..."
  $COMPOSE_CMD down --remove-orphans 2>/dev/null || true
  # 注意：不要用 --no-cache，否则每次都从零 npm install（约 3 分钟）。
  # Dockerfile 已分层（先装依赖再拷源码）+ BuildKit 缓存挂载，源码改动时
  # node_modules 层可复用；仅当 package.json 变化时才重装依赖（package-lock.json
  # 已被 .gitignore 忽略，不参与构建，由 npm install 在容器内按本平台重新解析）。
  $COMPOSE_CMD build
  # 记录本次成功构建对应的源码 commit，供下次增量判断
  git rev-parse HEAD > "$LAST_BUILD_MARKER" 2>/dev/null || true
else
  echo "==> 源码未变化（commit 与上次构建一致），跳过构建，直接启动"
  echo "    （强制重建: REBUILD=1 ./deploy.sh）"
fi

# ---------- 部署前备份数据卷 ----------
# 防止 miniflare 本地 D1 持久化目录（由 database_id+database_name 的哈希决定）
# 在未来某次配置变更后“指向新空库”，导致旧数据看起来丢失。备份可随时恢复。
BACKUP_DIR="$PROJECT_DIR/backups"
mkdir -p "$BACKUP_DIR"
if [ -d "$PROJECT_DIR/data" ] && [ -n "$(ls -A "$PROJECT_DIR/data" 2>/dev/null)" ]; then
  TS="$(date +%Y%m%d-%H%M%S)"
  if tar -czf "$BACKUP_DIR/data-$TS.tar.gz" -C "$PROJECT_DIR" data 2>/dev/null; then
    echo "==> 已备份数据卷到 backups/data-$TS.tar.gz"
    # 仅保留最近 10 个备份，避免磁盘占满
    ls -1t "$BACKUP_DIR"/data-*.tar.gz 2>/dev/null | tail -n +11 | xargs -r rm -f
  else
    echo "⚠️ 数据备份失败，但仍继续部署"
  fi
else
  echo "==> 未检测到 data/ 数据，跳过备份"
fi

$COMPOSE_CMD up -d

# 等待容器健康
echo "==> 等待服务就绪 ..."
for i in $(seq 1 30); do
  if curl -s -o /dev/null -w "%{http_code}" http://localhost:9003/ 2>/dev/null | grep -qE "2[0-9][0-9]|3[0-9][0-9]"; then
    echo "✅ 服务已就绪"
    break
  fi
  sleep 2
done

echo ""
echo "============================================"
echo "  部署完成"
echo "  访问地址: http://$(hostname -I 2>/dev/null | awk '{print $1}' || echo 'YOUR_IP'):9003"
echo "  查看日志: $COMPOSE_CMD logs -f"
echo "  重启服务: $COMPOSE_CMD restart"
echo "  停止服务: $COMPOSE_CMD down"
echo "  数据目录: $PROJECT_DIR/data (D1 SQLite)"
echo "============================================"
