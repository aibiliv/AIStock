# 复盘簿（fupanbu-trading-journal）Docker 部署
#
# 说明：本项目是为 Cloudflare Workers 设计的（D1 数据库 + Worker 运行时）。
# 数据库层依赖 cloudflare:workers 的 env.DB，无法在纯 Node 下运行，
# 因此这里用 wrangler 的本地运行时（miniflare/workerd）在容器内托管构建产物，
# 并把 D1 持久化到 /data 卷（本质为本地 SQLite 文件）。
FROM node:22-bookworm

WORKDIR /app

# 换 Debian 国内镜像源（百度云等国内环境加速 apt）
RUN sed -i 's/deb.debian.org/mirrors.ustc.edu.cn/g' /etc/apt/sources.list.d/debian.sources

# 安装运行时依赖（curl 用于健康检查）
RUN apt-get update && apt-get install -y --no-install-recommends curl && \
    rm -rf /var/lib/apt/lists/*

# 安装全部依赖（build 需要 vinext/vite，运行需要 wrangler/workerd）
# 使用淘宝镜像加速 npm 下载
COPY package.json package-lock.json ./
RUN npm install --no-audit --no-fund && \
    npm cache clean --force

# 复制源码并构建（vinext build 产出 dist/）
# 注意：构建依赖 .openai/hosting.json（已在仓库中），会被一并复制
COPY . .
RUN npm run build

# 关闭 wrangler 遥测，避免启动阻塞
ENV WRANGLER_SEND_METRICS=false

# 启动时由 start.sh 根据环境变量生成 .dev.vars（wrangler 本地 secrets）
COPY start.sh /app/start.sh
RUN chmod +x /app/start.sh

EXPOSE 8787

CMD ["/app/start.sh"]
