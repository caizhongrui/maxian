/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * 系统信息接口
 */
export interface SystemInfo {
	platform: string;
	arch: string;
	nodeVersion: string;
	shell: string;
}

/**
 * 获取系统信息section
 */
export function getSystemInfoSection(workspaceRoot: string, systemInfo: SystemInfo): string {
	const isWindows = systemInfo.platform.toLowerCase().includes('win');
	const isMac = systemInfo.platform.toLowerCase().includes('darwin');

	const platformCommands = isWindows ? `
⚠️ 当前运行在 Windows 系统，必须严格遵守以下命令规范：

Shell: ${systemInfo.shell}（${systemInfo.shell.includes('powershell') || systemInfo.shell.includes('pwsh') ? 'PowerShell 模式' : 'CMD 模式'}）

【禁止使用的 Unix 命令 → 必须替换为 Windows 等效命令】
- ls / ls -la       → dir 或 dir /a（CMD）/ Get-ChildItem（PowerShell）
- cat <file>        → type <file>（CMD）/ Get-Content <file>（PowerShell）
- rm / rm -rf       → del / rmdir /s /q（CMD）/ Remove-Item -Recurse（PowerShell）
- cp                → copy / xcopy（CMD）/ Copy-Item（PowerShell）
- mv                → move（CMD）/ Move-Item（PowerShell）
- mkdir -p          → mkdir（CMD，自动创建父目录）/ New-Item -ItemType Directory（PowerShell）
- touch             → type nul > file.txt（CMD）/ New-Item（PowerShell）
- grep              → findstr（CMD）/ Select-String（PowerShell）
- find              → dir /s /b（CMD）/ Get-ChildItem -Recurse（PowerShell）
- echo $VAR         → echo %VAR%（CMD）/ $env:VAR（PowerShell）
- export VAR=val    → set VAR=val（CMD）/ $env:VAR="val"（PowerShell）
- chmod / chown     → Windows 不支持，使用 icacls 或忽略
- curl              → 优先用 curl.exe，或 Invoke-WebRequest（PowerShell）
- which             → where（CMD）/ Get-Command（PowerShell）
- pwd               → cd（CMD）/ Get-Location / $PWD（PowerShell）
- clear             → cls（CMD）/ Clear-Host（PowerShell）

【路径规范】
- 路径分隔符使用反斜杠 \\ 或正斜杠 /（PowerShell 兼容 /，CMD 建议用 \\）
- 不能使用 ~ 或 $HOME，改用 %USERPROFILE%（CMD）或 $HOME（PowerShell）
- 绝对路径格式：C:\\path\\to\\dir 或 C:/path/to/dir

【命令链接】
- CMD：用 && 连接（前一条成功才执行后一条）
- PowerShell：用 ; 或 -and 连接

【注意】
- 运行 .sh 脚本需要 Git Bash 或 WSL，不能直接在 CMD/PowerShell 执行
- npm/node/python/git 命令在两种 Shell 下均可使用` : isMac ? `
操作系统: macOS (${systemInfo.platform})
Shell: ${systemInfo.shell}

命令规范:
- 使用标准 Unix/macOS 命令
- 路径使用正斜杠 /
- 可使用 brew 安装软件包` : `
操作系统: Linux (${systemInfo.platform})
Shell: ${systemInfo.shell}

命令规范:
- 使用标准 Unix/Linux 命令
- 路径使用正斜杠 /
- 可使用 apt/yum/dnf 等包管理器`;

	return `====

SYSTEM INFORMATION

操作系统: ${systemInfo.platform}
架构: ${systemInfo.arch}
Node.js 版本: ${systemInfo.nodeVersion}
Shell: ${systemInfo.shell}
工作区: ${workspaceRoot}
${platformCommands}`;
}
