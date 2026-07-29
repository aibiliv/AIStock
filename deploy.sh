#!/usr/bin/env bash
# 复盘簿（fupanbu-trading-journal）一键部署脚本
# 用法（在 Linux 部署服务器上）：
#   chmod +x deploy.sh
#   ./deploy.sh
set -euo pipefail

cd "$(dirname "$0")"

echo "==> 构建并启动 复盘簿 (fupanbu) ..."
docker compose up -d --build

echo ""
echo "==> 部署完成"
echo "    访问地址: http://120.48.87.170:9003"
echo "    查看日志: docker compose logs -f"
echo "    停止服务: docker compose down"
echo "    数据库数据持久化在 ./data 目录"
