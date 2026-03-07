/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ChildProcess, spawn } from 'child_process';
import { ICommandExecutionService, ICommandExecutionResult, ICommandExecutionOptions } from '../common/services/commandExecutionService.js';

const DEFAULT_TIMEOUT = 120_000; // 2 minutes
const MAX_OUTPUT_LENGTH = 100_000; // 100KB output limit
const SIGKILL_DELAY = 200; // ms after SIGTERM before SIGKILL

/**
 * 命令执行服务 Node 层实现（运行在 electron-main 进程）
 * 使用 child_process.spawn 执行命令并捕获输出
 * 通过 IPC 通道（ProxyChannel）暴露给 renderer 进程
 */
export class CommandExecutionServiceImpl implements ICommandExecutionService {
	readonly _serviceBrand: undefined;

	/** 跟踪正在运行的进程，用于取消 */
	private readonly runningProcesses = new Map<string, ChildProcess>();

	async execute(command: string, options?: ICommandExecutionOptions): Promise<ICommandExecutionResult> {
		const cwd = options?.cwd;
		const timeout = options?.timeout ?? DEFAULT_TIMEOUT;
		const commandId = options?.commandId;

		return new Promise((resolve) => {
			const isWindows = process.platform === 'win32';
			const shell = isWindows ? 'cmd.exe' : (process.env.SHELL || '/bin/sh');
			const shellArgs = isWindows ? ['/c', command] : ['-c', command];

			const proc = spawn(shell, shellArgs, {
				cwd: cwd || undefined,
				env: { ...process.env },
				stdio: ['ignore', 'pipe', 'pipe'],
				detached: !isWindows,
			});

			// 注册到运行进程表（用于取消）
			if (commandId) {
				this.runningProcesses.set(commandId, proc);
			}

			let stdout = '';
			let stderr = '';
			let timedOut = false;
			let aborted = false;
			let exited = false;

			// 收集 stdout
			proc.stdout?.on('data', (chunk: Buffer) => {
				stdout += chunk.toString();
				if (stdout.length > MAX_OUTPUT_LENGTH * 2) {
					stdout = stdout.slice(0, MAX_OUTPUT_LENGTH) + '\n\n... (output truncated due to size) ...\n';
				}
			});

			// 收集 stderr
			proc.stderr?.on('data', (chunk: Buffer) => {
				stderr += chunk.toString();
				if (stderr.length > MAX_OUTPUT_LENGTH * 2) {
					stderr = stderr.slice(0, MAX_OUTPUT_LENGTH) + '\n\n... (error output truncated) ...\n';
				}
			});

			// 杀死进程树
			const killProcess = () => {
				if (exited) {
					return;
				}
				try {
					if (!isWindows && proc.pid) {
						process.kill(-proc.pid, 'SIGTERM');
						setTimeout(() => {
							if (!exited) {
								try {
									process.kill(-proc.pid!, 'SIGKILL');
								} catch {
									// 进程可能已经退出
								}
							}
						}, SIGKILL_DELAY);
					} else {
						proc.kill('SIGTERM');
						setTimeout(() => {
							if (!exited) {
								proc.kill('SIGKILL');
							}
						}, SIGKILL_DELAY);
					}
				} catch {
					// 进程可能已经退出
				}
			};

			// 超时处理
			const timeoutTimer = setTimeout(() => {
				timedOut = true;
				killProcess();
			}, timeout);

			const cleanup = () => {
				clearTimeout(timeoutTimer);
				if (commandId) {
					this.runningProcesses.delete(commandId);
				}
			};

			proc.once('exit', (exitCode) => {
				exited = true;
				cleanup();

				// 截断输出
				stdout = truncateOutput(stdout, MAX_OUTPUT_LENGTH);
				stderr = truncateOutput(stderr, MAX_OUTPUT_LENGTH);

				resolve({ stdout, stderr, exitCode, timedOut, aborted });
			});

			proc.once('error', (error) => {
				exited = true;
				cleanup();
				resolve({
					stdout: '',
					stderr: error.message,
					exitCode: -1,
					timedOut,
					aborted
				});
			});
		});
	}

	async cancel(commandId: string): Promise<void> {
		const proc = this.runningProcesses.get(commandId);
		if (!proc) {
			return;
		}

		const isWindows = process.platform === 'win32';
		try {
			if (!isWindows && proc.pid) {
				process.kill(-proc.pid, 'SIGTERM');
				setTimeout(() => {
					try {
						if (!proc.killed) {
							process.kill(-proc.pid!, 'SIGKILL');
						}
					} catch {
						// 进程可能已经退出
					}
				}, SIGKILL_DELAY);
			} else {
				proc.kill('SIGTERM');
				setTimeout(() => {
					if (!proc.killed) {
						proc.kill('SIGKILL');
					}
				}, SIGKILL_DELAY);
			}
		} catch {
			// 进程可能已经退出
		}

		this.runningProcesses.delete(commandId);
	}
}

function truncateOutput(text: string, maxLen: number): string {
	if (!text || text.length <= maxLen) {
		return text;
	}
	const half = Math.floor(maxLen / 2);
	return text.slice(0, half) + '\n\n... (output truncated) ...\n\n' + text.slice(-half);
}
