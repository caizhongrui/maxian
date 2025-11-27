# Windows 本地构建安装包脚本 (PowerShell 版本)
# 使用方法：在 PowerShell 中执行 .\build-windows-local.ps1

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "  天和智开 IDE - Windows 构建脚本" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""

# 检查 Node.js 是否安装
try {
    $nodeVersion = node --version
    $npmVersion = npm --version
    Write-Host "[1/4] 检查环境..." -ForegroundColor Green
    Write-Host "Node.js 版本: $nodeVersion"
    Write-Host "npm 版本: $npmVersion"
    Write-Host ""
} catch {
    Write-Host "[错误] Node.js 未安装，请先安装 Node.js" -ForegroundColor Red
    Write-Host "下载地址: https://nodejs.org/" -ForegroundColor Yellow
    exit 1
}

# 编译源代码
Write-Host "[2/4] 编译源代码..." -ForegroundColor Green
npm run compile
if ($LASTEXITCODE -ne 0) {
    Write-Host "[错误] 编译失败" -ForegroundColor Red
    exit 1
}
Write-Host ""

# 构建 Windows 应用程序
Write-Host "[3/4] 构建 Windows 应用程序..." -ForegroundColor Green
npm run gulp vscode-win32-x64-min
if ($LASTEXITCODE -ne 0) {
    Write-Host "[错误] 构建应用程序失败" -ForegroundColor Red
    exit 1
}
Write-Host ""

# 构建安装包
Write-Host "[4/4] 构建安装包..." -ForegroundColor Green
npm run gulp vscode-win32-x64-system-setup
if ($LASTEXITCODE -ne 0) {
    Write-Host "[错误] 构建安装包失败" -ForegroundColor Red
    exit 1
}
Write-Host ""

# 检查结果
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "  构建完成！" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""

$setupPath = ".build\win32-x64\system-setup\VSCodeSetup.exe"
if (Test-Path $setupPath) {
    Write-Host "安装包位置：" -ForegroundColor Green
    Write-Host "  $setupPath" -ForegroundColor Yellow
    Write-Host ""
    Get-ChildItem $setupPath | Format-Table Name, Length, LastWriteTime
} else {
    Write-Host "[警告] 未找到安装包文件" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "按任意键退出..." -ForegroundColor Gray
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
