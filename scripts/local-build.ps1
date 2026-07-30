# =============================================================================
# 复盘簿 - 本地构建并推送镜像到远程服务器
#
# 用法（在 Windows 开发机上执行）:
#   .\scripts\local-build.ps1
#
# 流程:
#   1. Docker 构建镜像（利用缓存，仅变更层重跑）
#   2. 导出为 tar.gz
#   3. SCP 推送到服务器
#   4. 服务器端加载镜像 + 重启容器
# =============================================================================
param(
  [string]$Server = "admin@xilasuo",           # 服务器 SSH 地址
  [string]$RemotePath = "~/code/AIStock",       # 服务器项目路径
  [string]$ImageName = "fupanbu-trading-journal:latest"
)

$ErrorActionPreference = "Stop"
Set-Location "$PSScriptRoot\.."

$tarFile = "fupanbu-image.tar.gz"

# ---------- 1. 构建镜像 ----------
Write-Host "`n==> [1/5] 构建 Docker 镜像 ..." -ForegroundColor Cyan
docker build -t $ImageName -f Dockerfile .
if ($LASTEXITCODE -ne 0) { throw "Docker build failed" }

# ---------- 2. 导出镜像 ----------
Write-Host "`n==> [2/5] 导出镜像到 $tarFile ..." -ForegroundColor Cyan
docker save $ImageName | gzip > $tarFile

$size = [math]::Round((Get-Item $tarFile).Length / 1MB, 1)
Write-Host "  镜像大小: ${size}MB" -ForegroundColor Green

# ---------- 3. 推送源码到服务器（同步代码变更）----------
Write-Host "`n==> [3/5] 推送源码到服务器 ..." -ForegroundColor Cyan
ssh $Server "cd $RemotePath && git pull origin main"
if ($LASTEXITCODE -ne 0) {
  Write-Host "  git pull 失败，跳过（可能需手动处理）" -ForegroundColor Yellow
}

# ---------- 4. 推送镜像到服务器 ----------
Write-Host "`n==> [4/5] 推送镜像文件到服务器 ..." -ForegroundColor Cyan
scp $tarFile "${Server}:${RemotePath}/"
if ($LASTEXITCODE -ne 0) {
  Remove-Item -Force $tarFile -ErrorAction SilentlyContinue
  throw "SCP failed"
}

# ---------- 5. 服务器加载镜像并部署 ----------
Write-Host "`n==> [5/5] 服务器加载镜像并重启容器 ..." -ForegroundColor Cyan
ssh $Server "cd $RemotePath && chmod +x scripts/server-load-deploy.sh && bash scripts/server-load-deploy.sh"
if ($LASTEXITCODE -ne 0) {
  Remove-Item -Force $tarFile -ErrorAction SilentlyContinue
  throw "Remote deploy failed"
}

# ---------- 清理 ----------
Remove-Item -Force $tarFile -ErrorAction SilentlyContinue

Write-Host "`n==================================================" -ForegroundColor Green
Write-Host "  部署完成! 访问 http://$Server`:9003" -ForegroundColor Green
Write-Host "==================================================`n" -ForegroundColor Green
