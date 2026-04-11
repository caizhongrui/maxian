/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ITerminalService, ITerminalInstance } from '../../../terminal/browser/terminal.js';
import { ExecuteCommandToolUse, ToolResponse } from '../../common/tools/toolTypes.js';
import { ICommandExecutionService } from '../../common/services/commandExecutionService.js';
import { generateUuid } from '../../../../../base/common/uuid.js';
import { truncateOutput } from '../../common/utils/outputTruncation.js';

/**
 * 命令执行工具类
 *
 * 优先使用 ICommandExecutionService（主进程实现，通过 IPC 代理注入）执行命令并捕获输出。
 * 若 ICommandExecutionService 不可用（如 web 环境），降级使用终端 sendText 执行。
 */
export class CommandExecutionTool {
	// 复用的终端实例（降级模式用）
	private cachedTerminal: ITerminalInstance | null = null;
	private terminalReady: boolean = false;

	private commandExecutionService: ICommandExecutionService | undefined;

	/** AI 命令执行回调（由 maxianService 注入，用于终端面板镜像） */
	private _aiCommandCallback?: (command: string, cwd?: string) => void;

	/** 设置 AI 命令执行回调 */
	setAiCommandCallback(cb: (command: string, cwd?: string) => void): void {
		this._aiCommandCallback = cb;
	}

	constructor(
		private readonly terminalService: ITerminalService
	) { }

	/**
	 * 设置命令执行服务（通过 IPC 代理注入）
	 */
	setCommandExecutionService(service: ICommandExecutionService): void {
		this.commandExecutionService = service;
	}

	/**
	 * 执行命令并捕获输出
	 */
	async executeCommand(toolUse: ExecuteCommandToolUse, abortSignal?: AbortSignal): Promise<ToolResponse> {
		const { command, cwd } = toolUse.params;

		if (!command) {
			return '错误: 未提供命令';
		}

		// 优先使用 ICommandExecutionService（主进程，通过 IPC 完整输出捕获）
		if (this.commandExecutionService) {
			return this.executeWithService(command, cwd, abortSignal);
		}

		// 降级：使用终端 sendText（无输出捕获）
		return this.executeWithTerminal(command, cwd);
	}

	/**
	 * 通过 ICommandExecutionService 执行（主进程 IPC，完整输出捕获）
	 * AbortSignal 不可通过 IPC 序列化，使用 commandId + cancel() 实现取消。
	 */
	private async executeWithService(command: string, cwd?: string, abortSignal?: AbortSignal): Promise<ToolResponse> {
		const commandId = generateUuid();

		// 触发 AI 命令镜像回调（终端面板联动）
		this._aiCommandCallback?.(command, cwd);

		// 如果已经被取消，直接返回
		if (abortSignal?.aborted) {
			return '命令被用户中止';
		}

		// 监听取消信号，调用 cancel() 通知主进程杀死进程
		let abortHandler: (() => void) | undefined;
		if (abortSignal) {
			abortHandler = () => {
				this.commandExecutionService!.cancel(commandId).catch(() => { /* ignore */ });
			};
			abortSignal.addEventListener('abort', abortHandler, { once: true });
		}

		try {
			const result = await this.commandExecutionService!.execute(command, {
				cwd,
				commandId
			});

			const outputParts: string[] = [];
			if (result.stdout) {
				outputParts.push(result.stdout);
			}
			if (result.stderr) {
				outputParts.push(`\nSTDERR:\n${result.stderr}`);
			}

			const metadata: string[] = [];
			if (result.timedOut) {
				metadata.push('命令超时（120秒后终止）');
			}
			if (result.aborted || abortSignal?.aborted) {
				metadata.push('命令被用户中止');
			}
			if (result.exitCode !== null && result.exitCode !== 0) {
				metadata.push(`退出码: ${result.exitCode}`);
			}

			if (metadata.length > 0) {
				outputParts.push(`\n<command_metadata>\n${metadata.join('\n')}\n</command_metadata>`);
			}

			const rawOutput = outputParts.join('\n') || '(无输出)';

			// 统一输出截断（对齐 OpenCode truncation.ts：MAX_LINES=2000, MAX_BYTES=50KB）
			const truncateResult = await truncateOutput(rawOutput, { saveToFile: true });
			return truncateResult.content;
		} catch (error) {
			if (abortSignal?.aborted) {
				return '命令被用户中止';
			}
			return `执行命令失败: ${error instanceof Error ? error.message : String(error)}`;
		} finally {
			if (abortSignal && abortHandler) {
				abortSignal.removeEventListener('abort', abortHandler);
			}
		}
	}

	/**
	 * 获取或创建终端实例（降级模式复用机制）
	 */
	private async getOrCreateTerminal(cwd?: string): Promise<ITerminalInstance> {
		if (this.cachedTerminal && this.terminalReady) {
			try {
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

		const terminal = await this.terminalService.createTerminal({
			config: {
				name: '码弦 Agent',
				cwd: cwd
			}
		});

		const timeout = 5000;
		try {
			await Promise.race([
				terminal.processReady,
				new Promise((_, reject) =>
					setTimeout(() => reject(new Error('终端准备超时')), timeout)
				)
			]);
			this.cachedTerminal = terminal;
			this.terminalReady = true;
		} catch {
			this.cachedTerminal = terminal;
			this.terminalReady = true;
		}

		return terminal;
	}

	/**
	 * 通过终端 sendText 执行（降级方案，无输出捕获）
	 */
	private async executeWithTerminal(command: string, cwd?: string): Promise<ToolResponse> {
		try {
			// 触发 AI 命令镜像回调
			this._aiCommandCallback?.(command, cwd);
			const terminal = await this.getOrCreateTerminal(cwd);
			await terminal.sendText(command, true);

			try {
				await this.terminalService.revealTerminal(terminal);
			} catch {
				// 忽略显示失败
			}

			return `命令已执行: ${command}\n\n提示: 请在终端中查看命令输出结果。`;
		} catch (error) {
			return `执行命令失败: ${error instanceof Error ? error.message : String(error)}`;
		}
	}

	/**
	 * 在后台执行命令并返回结果
	 */
	async executeCommandSilent(command: string, cwd?: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
		if (this.commandExecutionService) {
			try {
				const result = await this.commandExecutionService.execute(command, { cwd });
				return {
					stdout: result.stdout,
					stderr: result.stderr,
					exitCode: result.exitCode ?? -1
				};
			} catch (error) {
				return {
					stdout: '',
					stderr: error instanceof Error ? error.message : String(error),
					exitCode: -1
				};
			}
		}
		return {
			stdout: '',
			stderr: '命令执行服务不可用',
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
