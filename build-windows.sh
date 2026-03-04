#!/bin/bash
# Mac 环境下使用 Docker 构建 Windows 安装包

set -e

echo "=========================================="
echo "  天和智开 IDE - Windows 构建脚本 (Mac)"
echo "=========================================="

# 检查 Docker 是否安装
if ! command -v docker &> /dev/null; then
    echo "❌ Docker 未安装，请先安装 Docker Desktop for Mac"
    echo "   下载地址: https://www.docker.com/products/docker-desktop"
    exit 1
fi

echo ""
echo "🐳 使用 Docker 构建 Windows 安装包..."
echo ""

# 构建 Docker 镜像
echo "[1/3] 构建 Docker 镜像..."
docker build -f Dockerfile.windows-build -t tianhe-zhikai-windows-builder .

# 运行构建
echo ""
echo "[2/3] 运行 Windows 构建..."
docker run --rm \
    -v "$(pwd)/.build:/workspace/.build" \
    -v "$(pwd)/out:/workspace/out" \
    tianhe-zhikai-windows-builder

# 检查输出
echo ""
echo "[3/3] 检查构建结果..."
if [ -f ".build/win32-x64/system-setup/MaxianSetup.exe" ]; then
    echo "✅ 构建成功！"
    echo ""
    echo "安装包位置:"
    echo "  .build/win32-x64/system-setup/MaxianSetup.exe"
    ls -lh .build/win32-x64/system-setup/MaxianSetup.exe
else
    echo "❌ 构建失败，未找到安装包"
    exit 1
fi

echo ""
echo "=========================================="
echo "  构建完成！"
echo "=========================================="
