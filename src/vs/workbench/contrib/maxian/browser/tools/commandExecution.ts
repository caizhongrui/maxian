/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ITerminalService, ITerminalInstance } from '../../../terminal/browser/terminal.js';
import { ExecuteCommandToolUse, ToolResponse } from '../../common/tools/toolTypes.js';

/**
 * 命令执行工具类
 * 实现终端命令执行功能
 * 优化：复用终端实例，添加超时机制
 */
export class CommandExecutionTool {
	// 复用的终端实例
	private cachedTerminal: ITerminalInstance | null = null;
	private terminalReady: boolean = false;

	constructor(
		private readonly terminalService: ITerminalService
	) { }

	/**
	 * 获取或创建终端实例（复用机制）
	 */
	private async getOrCreateTerminal(cwd?: string): Promise<ITerminalInstance> {
		// 检查缓存的终端是否可用
		if (this.cachedTerminal && this.terminalReady) {
			try {
				// 检查终端是否还存在
				const terminals = this.terminalService.instances;
				if (terminals.includes(this.cachedTerminal)) {
					return this.cachedTerminal;
				}
			} catch {
				// 终端已失效
			}
			this.cachedTerminal = null;
			this.terminalReady = false;
		}

		// 创建新终端
		console.log('[CommandExecution] 创建新终端...');
		const terminal = await this.terminalService.createTerminal({
			config: {
				name: '码弦 Agent',
				cwd: cwd
			}
		});

		// 带超时的等待终端准备
		const timeout = 5000; // 5秒超时
		const startTime = Date.now();

		try {
			await Promise.race([
				terminal.processReady,
				new Promise((_, reject) =>
					setTimeout(() => reject(new Error('终端准备超时')), timeout)
				)
			]);
			this.cachedTerminal = terminal;
			this.terminalReady = true;
			console.log('[CommandExecution] 终端准备就绪，耗时:', Date.now() - startTime, 'ms');
		} catch (error) {
			console.warn('[CommandExecution] 终端准备超时，继续执行');
			// 即使超时也尝试使用
			this.cachedTerminal = terminal;
			this.terminalReady = true;
		}

		return terminal;
	}

	/**
	 * 执行命令
	 * 优化：复用终端，添加超时机制
	 * @param toolUse 执行命令工具使用信息
	 * @returns 执行结果
	 */
	async executeCommand(toolUse: ExecuteCommandToolUse): Promise<ToolResponse> {
		const { command, cwd } = toolUse.params;

		if (!command) {
			return '错误: 未提供命令';
		}

		const startTime = Date.now();

		try {
			// 获取或创建终端（复用机制）
			const terminal = await this.getOrCreateTerminal(cwd);

			// 发送命令
			await terminal.sendText(command, true);

			// 显示终端
			try {
				await this.terminalService.revealTerminal(terminal);
			} catch {
				// 忽略显示失败
			}

			const elapsed = Date.now() - startTime;
			console.log('[CommandExecution] 命令发送完成，耗时:', elapsed, 'ms');

			return `命令已执行: ${command}\n\n提示: 请在终端中查看命令输出结果。`;
		} catch (error) {
			const elapsed = Date.now() - startTime;
			console.error('[CommandExecution] 命令执行失败，耗时:', elapsed, 'ms', error);
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

	/**
	 * 清理缓存的终端
	 */
	dispose(): void {
		this.cachedTerminal = null;
		this.terminalReady = false;
	}
}
