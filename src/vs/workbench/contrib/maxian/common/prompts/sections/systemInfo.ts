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
	return `====

SYSTEM INFORMATION

操作系统: ${systemInfo.platform}
架构: ${systemInfo.arch}
Node.js 版本: ${systemInfo.nodeVersion}
Shell: ${systemInfo.shell}
工作区: ${workspaceRoot}

环境说明:
- 命令需与当前系统兼容
- 路径格式应符合操作系统规范
- Windows 使用反斜杠，Unix/Mac 使用正斜杠
- 某些命令可能需要管理员权限`;
}
