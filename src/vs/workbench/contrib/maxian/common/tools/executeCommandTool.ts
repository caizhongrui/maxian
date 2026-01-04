/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Execute Command Tool - 增强版
 *
 * 性能优化（借鉴 Cline CommandOrchestrator）：
 * - 输出缓冲与分块（避免大输出内存问题）
 * - 流式输出收集（实时反馈）
 * - 后台任务支持
 * - 智能输出截断（保留首尾关键信息）
 * - 超时控制与进程管理
 * - 常见命令优化（npm、yarn、git 等）
 */

import * as path from 'path';
import * as fs from 'fs';
import { spawn, ChildProcess } from 'child_process';

import type { Task } from '../task/Task.js';
import type { ToolResponse } from './toolTypes.js';

// ========== 配置常量 ==========
const EXECUTE_CONFIG = {
	/** 默认超时（60秒） */
	DEFAULT_TIMEOUT: 60000,

	/** 最大超时（10分钟） */
	MAX_TIMEOUT: 600000,

	/** 最大输出长度（字符） */
	MAX_OUTPUT_LENGTH: 50000,

	/** 最大输出行数 */
	MAX_OUTPUT_LINES: 2000,

	/** 输出截断时保留的首尾行数 */
	SUMMARY_LINES_TO_KEEP: 100,

	/** 输出缓冲刷新间隔（毫秒） */
	BUFFER_FLUSH_INTERVAL: 300,

	/** 大输出阈值（超过此值写入临时文件） */
	LARGE_OUTPUT_THRESHOLD: 100000,

	/** 危险命令模式 */
	DANGEROUS_COMMANDS: [
		/rm\s+-rf\s+[\/~]/i,
		/rm\s+-rf\s+\*/i,
		/mkfs/i,
		/dd\s+if=/i,
		/:(){ :|:& };:/,
		/>\s*\/dev\/sd/i,
		/chmod\s+-R\s+777\s+\//i,
	],

	/** 长时间运行命令模式（需要更长超时） */
	LONG_RUNNING_COMMANDS: [
		/npm\s+(install|i|ci)/i,
		/yarn(\s+install)?$/i,
		/pnpm\s+install/i,
		/pip\s+install/i,
		/cargo\s+build/i,
		/mvn\s+(clean\s+)?install/i,
		/gradle\s+build/i,
		/make(\s+|$)/i,
		/docker\s+build/i,
	],
};

// ========== 后台任务管理 ==========
interface BackgroundTask {
	process: ChildProcess;
	command: string;
	startTime: number;
	output: string[];
	exitCode: number | null;
	completed: boolean;
}

const backgroundTasks = new Map<string, BackgroundTask>();

/**
 * 生成任务 ID
 */
function generateTaskId(): string {
	return `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * 获取后台任务状态
 */
export function getBackgroundTaskStatus(taskId: string): BackgroundTask | undefined {
	return backgroundTasks.get(taskId);
}

/**
 * 列出所有后台任务
 */
export function listBackgroundTasks(): { id: string; command: string; running: boolean; duration: number }[] {
	return Array.from(backgroundTasks.entries()).map(([id, task]) => ({
		id,
		command: task.command,
		running: !task.completed,
		duration: Date.now() - task.startTime,
	}));
}

/**
 * 终止后台任务
 */
export function killBackgroundTask(taskId: string): boolean {
	const task = backgroundTasks.get(taskId);
	if (task && !task.completed) {
		task.process.kill('SIGTERM');
		setTimeout(() => {
			if (!task.completed) {
				task.process.kill('SIGKILL');
			}
		}, 5000);
		return true;
	}
	return false;
}

// ========== 输出处理 ==========

/**
 * 输出缓冲器
 */
class OutputBuffer {
	private lines: string[] = [];
	private totalBytes = 0;
	private truncated = false;

	constructor(
		private maxLines: number,
		private maxBytes: number
	) { }

	append(data: string): void {
		if (this.truncated) return;

		const newLines = data.split('\n');
		for (const line of newLines) {
			if (this.lines.length >= this.maxLines || this.totalBytes >= this.maxBytes) {
				this.truncated = true;
				return;
			}

			this.lines.push(line);
			this.totalBytes += line.length + 1;
		}
	}

	getOutput(): { content: string; truncated: boolean; lineCount: number } {
		return {
			content: this.lines.join('\n'),
			truncated: this.truncated,
			lineCount: this.lines.length,
		};
	}

	getTruncatedOutput(keepLines: number): string {
		if (this.lines.length <= keepLines * 2) {
			return this.lines.join('\n');
		}

		const head = this.lines.slice(0, keepLines);
		const tail = this.lines.slice(-keepLines);
		const skipped = this.lines.length - keepLines * 2;

		return [
			...head,
			'',
			`... (${skipped} lines omitted) ...`,
			'',
			...tail,
		].join('\n');
	}
}

// ========== 命令分析 ==========

/**
 * 检查是否为危险命令
 */
function isDangerousCommand(command: string): { dangerous: boolean; reason?: string } {
	for (const pattern of EXECUTE_CONFIG.DANGEROUS_COMMANDS) {
		if (pattern.test(command)) {
			return {
				dangerous: true,
				reason: `命令匹配危险模式: ${pattern.toString()}`,
			};
		}
	}
	return { dangerous: false };
}

/**
 * 检查是否为长时间运行命令
 */
function isLongRunningCommand(command: string): boolean {
	return EXECUTE_CONFIG.LONG_RUNNING_COMMANDS.some(pattern => pattern.test(command));
}

/**
 * 解析命令获取程序名
 */
function getCommandProgram(command: string): string {
	// 处理环境变量前缀
	const cleanCmd = command.replace(/^[A-Z_]+=\S+\s+/g, '');
	// 获取第一个单词
	const match = cleanCmd.match(/^\s*(\S+)/);
	return match ? match[1] : '';
}

/**
 * 获取命令建议
 */
function getCommandSuggestions(command: string, error: string): string[] {
	const suggestions: string[] = [];
	const program = getCommandProgram(command);

	// 常见错误处理
	if (error.includes('command not found') || error.includes('not recognized')) {
		if (program === 'node' || program === 'npm') {
			suggestions.push('请确保已安装 Node.js');
		} else if (program === 'python' || program === 'python3') {
			suggestions.push('请确保已安装 Python');
		} else if (program === 'git') {
			suggestions.push('请确保已安装 Git');
		} else {
			suggestions.push(`请确保 ${program} 已安装并在 PATH 中`);
		}
	}

	if (error.includes('permission denied')) {
		suggestions.push('尝试添加执行权限: chmod +x <file>');
		if (!command.startsWith('sudo')) {
			suggestions.push('或使用 sudo 提升权限');
		}
	}

	if (error.includes('ENOENT')) {
		suggestions.push('请检查文件或目录路径是否正确');
	}

	if (error.includes('ETIMEDOUT') || error.includes('timeout')) {
		suggestions.push('命令执行超时，尝试增加超时时间或检查网络连接');
	}

	return suggestions;
}

// ========== 主函数 ==========

export async function executeCommandTool(
	task: Task,
	params: any,
): Promise<ToolResponse> {
	const command = params.command;
	const customCwd = params.cwd;
	const background = params.background === 'true' || params.background === true;

	if (!command) {
		return 'Error: No command provided';
	}

	// 检查危险命令
	const dangerCheck = isDangerousCommand(command);
	if (dangerCheck.dangerous) {
		return `⚠️ 危险命令被阻止\n\n命令: ${command}\n原因: ${dangerCheck.reason}\n\n如果确实需要执行此命令，请手动在终端中运行。`;
	}

	try {
		// 确定工作目录
		let workingDir: string;
		if (!customCwd) {
			workingDir = task.workspacePath;
		} else if (path.isAbsolute(customCwd)) {
			workingDir = customCwd;
		} else {
			workingDir = path.resolve(task.workspacePath, customCwd);
		}

		// 检查目录是否存在
		if (!fs.existsSync(workingDir)) {
			return `Error: Working directory does not exist: ${workingDir}`;
		}

		// 确定超时时间
		const timeout = isLongRunningCommand(command)
			? EXECUTE_CONFIG.MAX_TIMEOUT
			: EXECUTE_CONFIG.DEFAULT_TIMEOUT;

		console.log(`[ExecuteCommand] 执行命令: ${command}`);
		console.log(`[ExecuteCommand] 工作目录: ${workingDir}`);
		console.log(`[ExecuteCommand] 超时时间: ${timeout}ms`);
		console.log(`[ExecuteCommand] 后台模式: ${background}`);

		// 后台任务模式
		if (background) {
			return await executeBackgroundCommand(command, workingDir);
		}

		// 前台任务模式
		return await executeForegroundCommand(command, workingDir, timeout, task);

	} catch (error: any) {
		const errorMessage = error.message || String(error);
		const suggestions = getCommandSuggestions(command, errorMessage);

		const output = [
			`❌ 命令执行失败`,
			'',
			`命令: ${command}`,
			`错误: ${errorMessage}`,
		];

		if (suggestions.length > 0) {
			output.push('');
			output.push('💡 建议:');
			suggestions.forEach(s => output.push(`  - ${s}`));
		}

		return output.join('\n');
	}
}

/**
 * 执行前台命令
 */
async function executeForegroundCommand(
	command: string,
	workingDir: string,
	timeout: number,
	task: Task
): Promise<ToolResponse> {
	return new Promise((resolve) => {
		const startTime = Date.now();
		const stdoutBuffer = new OutputBuffer(
			EXECUTE_CONFIG.MAX_OUTPUT_LINES,
			EXECUTE_CONFIG.MAX_OUTPUT_LENGTH
		);
		const stderrBuffer = new OutputBuffer(
			EXECUTE_CONFIG.MAX_OUTPUT_LINES / 2,
			EXECUTE_CONFIG.MAX_OUTPUT_LENGTH / 2
		);

		// 使用 shell 执行命令
		const childProcess = spawn(command, {
			cwd: workingDir,
			shell: true,
			env: {
				...process.env,
				FORCE_COLOR: '0', // 禁用颜色输出
				CI: 'true', // 一些工具在 CI 环境下输出更简洁
			},
		});

		let completed = false;

		// 超时处理
		const timeoutId = setTimeout(() => {
			if (!completed) {
				childProcess.kill('SIGTERM');
				setTimeout(() => {
					if (!completed) {
						childProcess.kill('SIGKILL');
					}
				}, 5000);
			}
		}, timeout);

		// 收集 stdout
		childProcess.stdout?.on('data', (data: Buffer) => {
			stdoutBuffer.append(data.toString());
		});

		// 收集 stderr
		childProcess.stderr?.on('data', (data: Buffer) => {
			stderrBuffer.append(data.toString());
		});

		// 进程结束
		childProcess.on('close', (code) => {
			completed = true;
			clearTimeout(timeoutId);

			const elapsed = Date.now() - startTime;
			const stdout = stdoutBuffer.getOutput();
			const stderr = stderrBuffer.getOutput();

			// 标记任务状态
			task.didEditFile = true;

			// 构建输出
			resolve(formatCommandResult(
				command,
				workingDir,
				code ?? -1,
				stdout,
				stderr,
				elapsed,
				timeout
			));
		});

		// 进程错误
		childProcess.on('error', (error) => {
			completed = true;
			clearTimeout(timeoutId);

			const elapsed = Date.now() - startTime;

			resolve([
				`❌ 命令启动失败`,
				'',
				`命令: ${command}`,
				`工作目录: ${workingDir}`,
				`错误: ${error.message}`,
				`耗时: ${formatDuration(elapsed)}`,
			].join('\n'));
		});
	});
}

/**
 * 执行后台命令
 */
async function executeBackgroundCommand(
	command: string,
	workingDir: string
): Promise<ToolResponse> {
	const taskId = generateTaskId();

	const childProcess = spawn(command, {
		cwd: workingDir,
		shell: true,
		detached: true,
		env: {
			...process.env,
			FORCE_COLOR: '0',
		},
	});

	const task: BackgroundTask = {
		process: childProcess,
		command,
		startTime: Date.now(),
		output: [],
		exitCode: null,
		completed: false,
	};

	backgroundTasks.set(taskId, task);

	// 收集输出
	childProcess.stdout?.on('data', (data: Buffer) => {
		task.output.push(data.toString());
		// 限制输出大小
		if (task.output.length > EXECUTE_CONFIG.MAX_OUTPUT_LINES) {
			task.output.shift();
		}
	});

	childProcess.stderr?.on('data', (data: Buffer) => {
		task.output.push(`[stderr] ${data.toString()}`);
	});

	childProcess.on('close', (code) => {
		task.exitCode = code;
		task.completed = true;
	});

	childProcess.on('error', (error) => {
		task.output.push(`[error] ${error.message}`);
		task.completed = true;
	});

	// 分离进程
	childProcess.unref();

	return [
		`🚀 后台任务已启动`,
		'',
		`任务 ID: ${taskId}`,
		`命令: ${command}`,
		`工作目录: ${workingDir}`,
		'',
		'💡 使用以下方式管理任务:',
		`  - 查看状态: 调用 execute_command 工具，参数 command="task_status ${taskId}"`,
		`  - 终止任务: 调用 execute_command 工具，参数 command="task_kill ${taskId}"`,
	].join('\n');
}

/**
 * 格式化命令结果
 */
function formatCommandResult(
	command: string,
	workingDir: string,
	exitCode: number,
	stdout: { content: string; truncated: boolean; lineCount: number },
	stderr: { content: string; truncated: boolean; lineCount: number },
	elapsed: number,
	timeout: number
): string {
	const isSuccess = exitCode === 0;
	const isTimeout = elapsed >= timeout - 1000; // 接近超时

	const header = [
		isSuccess ? `✅ 命令执行成功` : `❌ 命令执行失败 (退出码: ${exitCode})`,
		'',
		`命令: ${command}`,
		`工作目录: ${workingDir}`,
		`耗时: ${formatDuration(elapsed)}${isTimeout ? ' (接近超时)' : ''}`,
	];

	const output: string[] = [...header];

	// 添加 stdout
	if (stdout.content.trim()) {
		output.push('');
		output.push(`📤 输出${stdout.truncated ? ' (已截断)' : ''} (${stdout.lineCount} 行):`);
		output.push('```');

		if (stdout.truncated) {
			// 使用智能截断
			const truncatedContent = truncateOutput(
				stdout.content,
				EXECUTE_CONFIG.SUMMARY_LINES_TO_KEEP
			);
			output.push(truncatedContent);
		} else {
			output.push(stdout.content);
		}

		output.push('```');
	}

	// 添加 stderr
	if (stderr.content.trim()) {
		output.push('');
		output.push(`⚠️ 错误输出${stderr.truncated ? ' (已截断)' : ''} (${stderr.lineCount} 行):`);
		output.push('```');

		if (stderr.truncated) {
			const truncatedContent = truncateOutput(
				stderr.content,
				EXECUTE_CONFIG.SUMMARY_LINES_TO_KEEP / 2
			);
			output.push(truncatedContent);
		} else {
			output.push(stderr.content);
		}

		output.push('```');
	}

	// 如果失败，添加建议
	if (!isSuccess) {
		const errorContent = stderr.content || stdout.content;
		const suggestions = getCommandSuggestions(command, errorContent);
		if (suggestions.length > 0) {
			output.push('');
			output.push('💡 建议:');
			suggestions.forEach(s => output.push(`  - ${s}`));
		}
	}

	return output.join('\n');
}

/**
 * 智能截断输出（保留首尾）
 */
function truncateOutput(content: string, keepLines: number): string {
	const lines = content.split('\n');

	if (lines.length <= keepLines * 2) {
		return content;
	}

	const head = lines.slice(0, keepLines);
	const tail = lines.slice(-keepLines);
	const skipped = lines.length - keepLines * 2;

	return [
		...head,
		'',
		`... (${skipped} 行已省略) ...`,
		'',
		...tail,
	].join('\n');
}

/**
 * 格式化时长
 */
function formatDuration(ms: number): string {
	if (ms < 1000) return `${ms}ms`;
	if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
	const minutes = Math.floor(ms / 60000);
	const seconds = Math.round((ms % 60000) / 1000);
	return `${minutes}m ${seconds}s`;
}
