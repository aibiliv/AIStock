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
echo "==> 拉取最新镜像 & 重建容器 ..."
$COMPOSE_CMD down --remove-orphans 2>/dev/null || true
$COMPOSE_CMD build --pull --no-cache
$COMPOSE_CMD up -d

# 等待容器健康
echo "==> 等待服务就绪 ..."
for i in $(seq 1 30); do
  if curl -s -o /dev/null -w "%{http_code}" http://localhost:9003/ 2>/dev/null | grep -q "200\|302"; then
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
