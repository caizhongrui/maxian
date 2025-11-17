/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ITerminalService } from '../../../terminal/browser/terminal.js';
import { ExecuteCommandToolUse, ToolResponse } from '../../common/tools/toolTypes.js';

/**
 * 命令执行工具类
 * 实现终端命令执行功能
 */
export class CommandExecutionTool {
	constructor(
		private readonly terminalService: ITerminalService
	) { }

	/**
	 * 执行命令
	 * @param toolUse 执行命令工具使用信息
	 * @returns 执行结果
	 */
	async executeCommand(toolUse: ExecuteCommandToolUse): Promise<ToolResponse> {
		const { command, cwd } = toolUse.params;

		if (!command) {
			return '错误: 未提供命令';
		}

		try {
			// 创建终端实例
			const terminal = await this.terminalService.createTerminal({
				config: {
					name: '码弦 Agent',
					cwd: cwd
				}
			});

			// 等待终端准备就绪
			await terminal.processReady;

			// 执行命令
			await terminal.sendText(command, true);

			// 使用revealTerminal显示终端
			await this.terminalService.revealTerminal(terminal);

			return `命令已发送到终端: ${command}`;
		} catch (error) {
			return `执行命令失败: ${error instanceof Error ? error.message : String(error)}`;
		}
	}

	/**
	 * 在后台执行命令并返回结果
	 * 注意：VSCode的终端API主要是交互式的，后台执行需要使用Node.js的child_process
	 * 这里我们先提供一个占位实现
	 */
	async executeCommandSilent(command: string, cwd?: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
		// TODO: 实现后台命令执行
		// 可能需要使用VSCode的扩展主机进程或Node.js的child_process
		return {
			stdout: '',
			stderr: '后台命令执行功能暂未实现',
			exitCode: -1
		};
	}
}
