#!/usr/bin/env bash
# =============================================================================
# 复盘簿 - 服务器端加载预构建镜像并部署（含自动回滚）
#
# 配合 local-build.ps1 使用：
#   本地构建+导出tar → scp推送 → 服务器执行本脚本
#
# 也可手动使用：
#   1. 先把 fupanbu-image.tar.gz scp 到项目根目录
#   2. bash scripts/server-load-deploy.sh
# =============================================================================
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"
IMAGE_TAR="fupanbu-image.tar.gz"
IMAGE_NAME="fupanbu-trading-journal:latest"
ROLLBACK_TAG="fupanbu-trading-journal:rollback"

# ---------- 检测 docker compose 命令 ----------
if docker compose version &>/dev/null; then
  COMPOSE_CMD="docker compose"
elif command -v docker-compose &>/dev/null; then
  COMPOSE_CMD="docker-compose"
else
  echo "❌ 未检测到 docker compose"
  exit 1
fi

# ---------- 备份当前镜像（用于回滚）----------
CURRENT_ID="$(docker images -q "$IMAGE_NAME" 2>/dev/null | head -1 || true)"
if [ -n "$CURRENT_ID" ]; then
  echo "==> 备份当前镜像用于回滚 ..."
  docker tag "$IMAGE_NAME" "$ROLLBACK_TAG" 2>/dev/null || true
fi

# ---------- 加载新镜像 ----------
if [ -f "$IMAGE_TAR" ]; then
  echo "==> 加载镜像 $IMAGE_TAR ..."
  zcat "$IMAGE_TAR" | docker load
  rm -f "$IMAGE_TAR"
  echo "✅ 镜像加载完成"
else
  echo "⚠️  未找到 $IMAGE_TAR，将使用本地已有镜像"
fi

# ---------- 部署 ----------
echo "==> 重启容器 ..."
$COMPOSE_CMD down --remove-orphans 2>/dev/null || true
$COMPOSE_CMD up -d

# ---------- 健康检查 ----------
echo "==> 等待服务就绪 ..."
READY=false
for i in $(seq 1 30); do
  if curl -s -o /dev/null -w "%{http_code}" http://localhost:9003/ 2>/dev/null | grep -q "200\|302"; then
    READY=true
    echo "✅ 服务已就绪"
    break
  fi
  sleep 2
done

# ---------- 失败回滚 ----------
if [ "$READY" = false ]; then
  echo "❌ 健康检查失败，正在回滚到上一个版本 ..."
  $COMPOSE_CMD down --remove-orphans 2>/dev/null || true
  if docker image inspect "$ROLLBACK_TAG" &>/dev/null; then
    docker tag "$ROLLBACK_TAG" "$IMAGE_NAME"
    $COMPOSE_CMD up -d
    echo "🔄 已回滚到上一个可用版本"
  else
    echo "❌ 无可用回滚镜像，请手动检查"
  fi
  exit 1
fi

# ---------- 清理回滚镜像 ----------
docker rmi "$ROLLBACK_TAG" 2>/dev/null || true

echo ""
echo "============================================"
echo "  部署完成 - $(date '+%Y-%m-%d %H:%M:%S')"
echo "  查看日志: $COMPOSE_CMD logs -f"
echo "============================================"
