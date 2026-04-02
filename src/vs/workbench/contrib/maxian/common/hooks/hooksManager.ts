/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * C5: Hooks 系统
 *
 * 允许用户配置在工具调用前/后自动执行的 shell 命令。
 *
 * 配置文件：工作区根目录 `.maxian/hooks.json`（或通过 VS Code 设置 `zhikai.hooks`）
 *
 * 配置格式：
 * ```json
 * {
 *   "PreToolUse": [
 *     { "matcher": "edit", "command": "echo 'Pre-edit hook: {tool_name} {path}'" }
 *   ],
 *   "PostToolUse": [
 *     { "matcher": "*", "command": "echo 'Done: {tool_name}'" }
 *   ]
 * }
 * ```
 *
 * 行为：
 * - PreToolUse：hook 命令退出码非0 → 阻止工具执行，向 AI 返回 stderr 作为错误
 * - PostToolUse：hook 命令的 stdout 非空 → 替换工具原始输出（空则保持原输出）
 * - 支持环境变量：MAXIAN_TOOL_NAME, MAXIAN_TOOL_PARAMS, MAXIAN_TOOL_RESULT
 */

/**
 * 单条 Hook 配置
 */
export interface HookConfig {
	/** 匹配的工具名（支持 "*" 通配符） */
	matcher: string;
	/** 要执行的 shell 命令，支持 {tool_name}/{path}/{params}/{result} 占位符 */
	command: string;
	/** 工作目录（默认为工作区根目录） */
	cwd?: string;
	/** 超时毫秒数（默认 10 秒） */
	timeoutMs?: number;
}

/**
 * Hooks 配置文件格式
 */
export interface HooksConfig {
	PreToolUse?: HookConfig[];
	PostToolUse?: HookConfig[];
}

/**
 * Hook 执行结果
 */
export interface HookResult {
	/** 是否执行了 hook */
	ran: boolean;
	/** 是否阻止工具执行（PreToolUse 非0退出码） */
	blocked?: boolean;
	/** 阻止原因（PreToolUse stderr） */
	blockReason?: string;
	/** 替换后的输出（PostToolUse stdout 非空时） */
	replacedOutput?: string;
}

// 环境检测：只在 Node.js 环境下真正执行 hooks
const IS_NODE_ENV = typeof process !== 'undefined' && process.versions && !!process.versions.node;

/**
 * Hooks 管理器
 *
 * 生命周期：与 ToolExecutorImpl 相同（每个 Agent 任务一个实例）。
 */
export class HooksManager {
	private config: HooksConfig | null = null;
	private configLoaded = false;

	constructor(
		private readonly workspaceRoot: string
	) {}

	/**
	 * 加载 hooks 配置（懒加载）
	 */
	private async loadConfig(): Promise<HooksConfig | null> {
		if (this.configLoaded) {
			return this.config;
		}
		this.configLoaded = true;

		if (!IS_NODE_ENV || !this.workspaceRoot) {
			return null;
		}

		try {
			const pathMod = await import('path');
			const fsMod = await import('fs');
			const hooksFile = pathMod.join(this.workspaceRoot, '.maxian', 'hooks.json');
			if (!fsMod.existsSync(hooksFile)) {
				return null;
			}
			const raw = fsMod.readFileSync(hooksFile, 'utf-8');
			this.config = JSON.parse(raw) as HooksConfig;
			console.log(`[HooksManager] C5: 加载 hooks 配置，PreToolUse=${this.config.PreToolUse?.length ?? 0} PostToolUse=${this.config.PostToolUse?.length ?? 0}`);
		} catch (e) {
			console.warn('[HooksManager] C5: 加载 hooks 配置失败:', e);
			this.config = null;
		}

		return this.config;
	}

	/**
	 * 检查 hook matcher 是否匹配工具名
	 */
	private matchesTool(matcher: string, toolName: string): boolean {
		if (matcher === '*') { return true; }
		if (matcher === toolName) { return true; }
		// 支持前缀通配符（如 "lsp_*" 匹配所有 lsp 工具）
		if (matcher.endsWith('*') && toolName.startsWith(matcher.slice(0, -1))) { return true; }
		return false;
	}

	/**
	 * 展开命令中的占位符
	 */
	private expandPlaceholders(
		command: string,
		toolName: string,
		params: Record<string, unknown>,
		result?: string
	): string {
		const path = (params.path as string) ?? '';
		const paramsJson = JSON.stringify(params).replace(/"/g, '\\"');
		const resultEscaped = (result ?? '').replace(/"/g, '\\"').substring(0, 1000);

		return command
			.replace(/\{tool_name\}/g, toolName)
			.replace(/\{path\}/g, path)
			.replace(/\{params\}/g, paramsJson)
			.replace(/\{result\}/g, resultEscaped);
	}

	/**
	 * 执行单条 shell 命令，返回 { stdout, stderr, exitCode }
	 */
	private async runCommand(
		command: string,
		env: Record<string, string>,
		cwd: string,
		timeoutMs: number
	): Promise<{ stdout: string; stderr: string; exitCode: number }> {
		try {
			const { execFile } = await import('child_process');
			const { promisify } = await import('util');
			const execFileAsync = promisify(execFile);

			const { stdout, stderr } = await Promise.race([
				execFileAsync('/bin/sh', ['-c', command], {
					env: { ...process.env, ...env },
					cwd,
					maxBuffer: 1024 * 1024, // 1MB
				}),
				new Promise<never>((_, reject) =>
					setTimeout(() => reject(new Error(`Hook 超时（${timeoutMs}ms）`)), timeoutMs)
				),
			]);

			return { stdout: stdout || '', stderr: stderr || '', exitCode: 0 };
		} catch (err: any) {
			const exitCode = err.code ?? (err.killed ? 143 : 1);
			return {
				stdout: err.stdout ?? '',
				stderr: err.stderr ?? err.message ?? String(err),
				exitCode: typeof exitCode === 'number' ? exitCode : 1,
			};
		}
	}

	/**
	 * C5: 执行 PreToolUse hooks
	 *
	 * @param toolName 工具名
	 * @param params 工具参数
	 * @returns HookResult（blocked=true 表示应阻止工具执行）
	 */
	async runPreToolUseHooks(
		toolName: string,
		params: Record<string, unknown>
	): Promise<HookResult> {
		const config = await this.loadConfig();
		if (!config?.PreToolUse?.length) {
			return { ran: false };
		}

		const matchingHooks = config.PreToolUse.filter(h => this.matchesTool(h.matcher, toolName));
		if (matchingHooks.length === 0) {
			return { ran: false };
		}

		const env: Record<string, string> = {
			MAXIAN_TOOL_NAME: toolName,
			MAXIAN_TOOL_PARAMS: JSON.stringify(params),
		};

		for (const hook of matchingHooks) {
			const command = this.expandPlaceholders(hook.command, toolName, params);
			const cwd = hook.cwd ?? this.workspaceRoot;
			const timeoutMs = hook.timeoutMs ?? 10000;

			console.log(`[HooksManager] C5 PreToolUse: 执行 hook [${hook.matcher}] 工具=${toolName}`);
			const { stdout, stderr, exitCode } = await this.runCommand(command, env, cwd, timeoutMs);

			if (exitCode !== 0) {
				console.warn(`[HooksManager] C5 PreToolUse: hook 退出码=${exitCode}，阻止工具执行`);
				const reason = stderr || stdout || `PreToolUse hook 退出码 ${exitCode}`;
				return {
					ran: true,
					blocked: true,
					blockReason: reason.trim(),
				};
			}

			if (stdout.trim()) {
				console.log(`[HooksManager] C5 PreToolUse: hook stdout=${stdout.substring(0, 100)}`);
			}
		}

		return { ran: true, blocked: false };
	}

	/**
	 * C5: 执行 PostToolUse hooks
	 *
	 * @param toolName 工具名
	 * @param params 工具参数
	 * @param result 工具原始输出
	 * @returns HookResult（replacedOutput 非空时替换原始输出）
	 */
	async runPostToolUseHooks(
		toolName: string,
		params: Record<string, unknown>,
		result: string
	): Promise<HookResult> {
		const config = await this.loadConfig();
		if (!config?.PostToolUse?.length) {
			return { ran: false };
		}

		const matchingHooks = config.PostToolUse.filter(h => this.matchesTool(h.matcher, toolName));
		if (matchingHooks.length === 0) {
			return { ran: false };
		}

		const env: Record<string, string> = {
			MAXIAN_TOOL_NAME: toolName,
			MAXIAN_TOOL_PARAMS: JSON.stringify(params),
			MAXIAN_TOOL_RESULT: result.substring(0, 10000), // 限制大小
		};

		let currentResult = result;

		for (const hook of matchingHooks) {
			const command = this.expandPlaceholders(hook.command, toolName, params, currentResult);
			const cwd = hook.cwd ?? this.workspaceRoot;
			const timeoutMs = hook.timeoutMs ?? 10000;

			console.log(`[HooksManager] C5 PostToolUse: 执行 hook [${hook.matcher}] 工具=${toolName}`);
			const { stdout, exitCode } = await this.runCommand(command, env, cwd, timeoutMs);

			if (exitCode === 0 && stdout.trim()) {
				console.log(`[HooksManager] C5 PostToolUse: hook 替换输出 (${stdout.length} 字符)`);
				currentResult = stdout.trim();
			}
		}

		const replaced = currentResult !== result;
		return {
			ran: true,
			replacedOutput: replaced ? currentResult : undefined,
		};
	}

	/**
	 * 重置缓存（配置文件可能已更新）
	 */
	resetCache(): void {
		this.config = null;
		this.configLoaded = false;
	}

	/**
	 * 是否有任何 hooks 配置
	 */
	hasHooks(): boolean {
		return !!(this.config?.PreToolUse?.length || this.config?.PostToolUse?.length);
	}
}
