@echo off
REM Windows 分步打包脚本
REM 每一步都会暂停，让您确认后再继续

echo ==========================================
echo   天和智开 IDE - 分步打包脚本
echo ==========================================
echo.

echo 选择构建类型:
echo [1] 快速测试（只编译，不打包）
echo [2] 绿色版（免安装版本）
echo [3] 完整打包（含安装包）
echo.
set /p choice="请选择 (1/2/3): "

if "%choice%"=="1" goto quick_build
if "%choice%"=="2" goto portable_build
if "%choice%"=="3" goto full_build

echo 无效选择，退出
pause
exit /b 1

:quick_build
echo.
echo === 快速测试模式 ===
echo.

echo [步骤 1/2] 编译源代码...
call npm run compile
if %ERRORLEVEL% NEQ 0 (
    echo [错误] 编译失败
    pause
    exit /b 1
)

echo.
echo === 编译完成！===
echo.
echo 运行测试:
echo   npm run electron
echo.
pause
exit /b 0

:portable_build
echo.
echo === 绿色版打包模式 ===
echo.

echo [步骤 1/3] 编译源代码...
call npm run compile
if %ERRORLEVEL% NEQ 0 (
    echo [错误] 编译失败
    pause
    exit /b 1
)

echo.
echo [步骤 2/3] 编译扩展...
call npm run gulp compile-extensions-build
if %ERRORLEVEL% NEQ 0 (
    echo [错误] 扩展编译失败
    pause
    exit /b 1
)

echo.
echo [步骤 3/3] 创建绿色版...
call npm run gulp vscode-win32-x64
if %ERRORLEVEL% NEQ 0 (
    echo [错误] 打包失败
    pause
    exit /b 1
)

echo.
echo === 绿色版创建完成！===
echo.
echo 输出位置:
if exist "..\VSCode-win32-x64\Code.exe" (
    echo   ..\VSCode-win32-x64\Code.exe
    dir "..\VSCode-win32-x64\Code.exe"
) else (
    echo [警告] 未找到 Code.exe
)
echo.
pause
exit /b 0

:full_build
echo.
echo === 完整打包模式 ===
echo.

echo [步骤 1/4] 编译源代码...
call npm run compile
if %ERRORLEVEL% NEQ 0 (
    echo [错误] 编译失败
    pause
    exit /b 1
)

echo.
echo [步骤 2/4] 编译扩展...
call npm run gulp compile-extensions-build
if %ERRORLEVEL% NEQ 0 (
    echo [错误] 扩展编译失败
    pause
    exit /b 1
)

echo.
echo [步骤 3/4] 创建绿色版...
call npm run gulp vscode-win32-x64
if %ERRORLEVEL% NEQ 0 (
    echo [错误] 打包失败
    pause
    exit /b 1
)

echo.
echo [步骤 4/4] 创建安装包...
call npm run gulp vscode-win32-x64-system-setup
if %ERRORLEVEL% NEQ 0 (
    echo [错误] 安装包创建失败
    pause
    exit /b 1
)

echo.
echo === 完整打包完成！===
echo.
echo 输出位置:
if exist ".build\win32-x64\system-setup\VSCodeSetup.exe" (
    echo   .build\win32-x64\system-setup\VSCodeSetup.exe
    dir ".build\win32-x64\system-setup\VSCodeSetup.exe"
) else (
    echo [警告] 未找到安装包
)
echo.
pause
exit /b 0
