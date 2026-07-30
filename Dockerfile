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

# 统一走 npmmirror 国内镜像加速（含 @cloudflare/* 与 wrangler/workerd 二进制包均已同步）。
# 注意：不要将 @cloudflare scope 指向 registry.npmjs.org，国内访问极慢会导致构建卡死。
COPY package.json package-lock.json ./
# BuildKit 缓存挂载：跨构建复用 npm tar 包，第二次起大幅提速
# 用 npm ci（lock 已存在）更快且确定；重试 mintimeout 从 20s 降到 5s，避免限流时空等
RUN --mount=type=cache,target=/root/.npm \
    npm config set registry https://registry.npmmirror.com && \
    npm ci --no-audit --no-fund \
           --fetch-retries=3 --fetch-retry-mintimeout=5000 --fetch-retry-maxtimeout=30000 && \
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
