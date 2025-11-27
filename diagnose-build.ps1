# Windows 构建诊断脚本
Write-Host "=== Windows 构建环境诊断 ===" -ForegroundColor Cyan
Write-Host ""

# 1. 检查项目路径
Write-Host "[1] 检查项目路径" -ForegroundColor Yellow
$projectPath = Get-Location
Write-Host "项目路径: $projectPath"

# 2. 检查 package.json
Write-Host ""
Write-Host "[2] 检查 package.json" -ForegroundColor Yellow
if (Test-Path "package.json") {
    $pkg = Get-Content "package.json" | ConvertFrom-Json
    Write-Host "项目名称: $($pkg.name)" -ForegroundColor Green
    Write-Host "版本: $($pkg.version)" -ForegroundColor Green
} else {
    Write-Host "错误: 找不到 package.json" -ForegroundColor Red
    exit 1
}

# 3. 检查 Innosetup
Write-Host ""
Write-Host "[3] 检查 Innosetup" -ForegroundColor Yellow
$innoPath = "node_modules\innosetup\bin\ISCC.exe"
if (Test-Path $innoPath) {
    Write-Host "Innosetup 路径: $innoPath" -ForegroundColor Green
    $innoVersion = & $innoPath /? 2>&1 | Select-String "Inno Setup"
    if ($innoVersion) {
        Write-Host "Innosetup 版本: $innoVersion" -ForegroundColor Green
    } else {
        Write-Host "警告: 无法获取 Innosetup 版本信息" -ForegroundColor Yellow
    }
} else {
    Write-Host "错误: 找不到 Innosetup" -ForegroundColor Red
    Write-Host "请运行: npm install innosetup --force" -ForegroundColor Yellow
}

# 4. 检查构建目录
Write-Host ""
Write-Host "[4] 检查构建目录" -ForegroundColor Yellow
$parentPath = Split-Path $projectPath -Parent
$buildPath = Join-Path $parentPath "VSCode-win32-x64"
Write-Host "预期构建路径: $buildPath"

if (Test-Path $buildPath) {
    Write-Host "✓ 构建目录存在" -ForegroundColor Green
    $exePath = Join-Path $buildPath "Code.exe"
    if (Test-Path $exePath) {
        Write-Host "✓ Code.exe 存在" -ForegroundColor Green
        $fileInfo = Get-Item $exePath
        Write-Host "  大小: $([math]::Round($fileInfo.Length / 1MB, 2)) MB"
        Write-Host "  修改时间: $($fileInfo.LastWriteTime)"
    } else {
        Write-Host "✗ Code.exe 不存在" -ForegroundColor Red
    }

    # 统计文件数量
    $fileCount = (Get-ChildItem -Recurse -File $buildPath -ErrorAction SilentlyContinue).Count
    Write-Host "  文件总数: $fileCount"
} else {
    Write-Host "✗ 构建目录不存在" -ForegroundColor Red
    Write-Host "  需要先运行: npm run gulp vscode-win32-x64-min" -ForegroundColor Yellow
}

# 5. 检查 .build 目录
Write-Host ""
Write-Host "[5] 检查 .build 目录" -ForegroundColor Yellow
if (Test-Path ".build") {
    Write-Host "✓ .build 目录存在" -ForegroundColor Green

    # 检查 system-setup
    $systemSetupPath = ".build\win32-x64\system-setup"
    if (Test-Path $systemSetupPath) {
        Write-Host "  ✓ system-setup 目录存在" -ForegroundColor Green
        $setupExe = Join-Path $systemSetupPath "VSCodeSetup.exe"
        if (Test-Path $setupExe) {
            $setupInfo = Get-Item $setupExe
            Write-Host "  ✓ VSCodeSetup.exe 存在" -ForegroundColor Green
            Write-Host "    大小: $([math]::Round($setupInfo.Length / 1MB, 2)) MB"
            Write-Host "    修改时间: $($setupInfo.LastWriteTime)"
        } else {
            Write-Host "  ✗ VSCodeSetup.exe 不存在" -ForegroundColor Yellow
        }
    } else {
        Write-Host "  ✗ system-setup 目录不存在" -ForegroundColor Yellow
    }
} else {
    Write-Host "✗ .build 目录不存在" -ForegroundColor Yellow
}

# 6. 检查 Inno Setup 脚本
Write-Host ""
Write-Host "[6] 检查 Inno Setup 脚本" -ForegroundColor Yellow
$issPath = "build\win32\code.iss"
if (Test-Path $issPath) {
    Write-Host "✓ code.iss 存在: $issPath" -ForegroundColor Green
} else {
    Write-Host "✗ code.iss 不存在" -ForegroundColor Red
}

# 7. 检查 product.json
Write-Host ""
Write-Host "[7] 检查 product.json" -ForegroundColor Yellow
if (Test-Path "product.json") {
    $product = Get-Content "product.json" | ConvertFrom-Json
    Write-Host "应用名称: $($product.nameShort)" -ForegroundColor Green
    Write-Host "Win32 AppId: $($product.win32x64AppId)" -ForegroundColor Green
} else {
    Write-Host "错误: 找不到 product.json" -ForegroundColor Red
}

Write-Host ""
Write-Host "=== 诊断完成 ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "建议操作:" -ForegroundColor Yellow
Write-Host "1. 如果 Innosetup 有问题: npm install innosetup --force"
Write-Host "2. 如果构建目录不存在: npm run gulp vscode-win32-x64-min"
Write-Host "3. 如果都正常，运行: npm run gulp vscode-win32-x64-system-setup -- --verbose"
Write-Host ""
