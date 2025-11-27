@echo off
REM Windows 本地构建安装包脚本
REM 使用方法：在项目根目录下双击运行或在 CMD 中执行 build-windows-local.bat

echo ==========================================
echo   天和智开 IDE - Windows 构建脚本
echo ==========================================
echo.

REM 检查 Node.js 是否安装
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [错误] Node.js 未安装，请先安装 Node.js
    echo 下载地址: https://nodejs.org/
    pause
    exit /b 1
)

echo [1/4] 检查环境...
node --version
npm --version
echo.

echo [2/4] 编译源代码...
call npm run compile
if %ERRORLEVEL% NEQ 0 (
    echo [错误] 编译失败
    pause
    exit /b 1
)
echo.

echo [3/4] 构建 Windows 应用程序...
call npm run gulp vscode-win32-x64-min
if %ERRORLEVEL% NEQ 0 (
    echo [错误] 构建应用程序失败
    pause
    exit /b 1
)
echo.

echo [4/4] 构建安装包...
call npm run gulp vscode-win32-x64-system-setup
if %ERRORLEVEL% NEQ 0 (
    echo [错误] 构建安装包失败
    pause
    exit /b 1
)
echo.

echo ==========================================
echo   构建完成！
echo ==========================================
echo.
echo 安装包位置：
echo   .build\win32-x64\system-setup\VSCodeSetup.exe
echo.

if exist ".build\win32-x64\system-setup\VSCodeSetup.exe" (
    dir ".build\win32-x64\system-setup\VSCodeSetup.exe"
) else (
    echo [警告] 未找到安装包文件
)

echo.
pause
