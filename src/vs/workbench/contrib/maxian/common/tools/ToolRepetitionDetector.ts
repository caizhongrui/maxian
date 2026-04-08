/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Copied from Kilocode: src/core/tools/ToolRepetitionDetector.ts
// Adapted for tianhe-zhikai-ide: 使用本地i18n系统
// P2优化：增强Doom Loop检测（借鉴Cline）

import { ToolUse } from './toolTypes.js';
import { t } from '../i18n/index.js';
import * as path from '../../../../../base/common/path.js';

/**
 * P2优化：工具调用历史条目
 */
interface ToolCallHistoryEntry {
	name: string;
	paramsHash: string;
	timestamp: number;
}

interface FileActivityEntry {
	file: string;
	kind: 'read' | 'write';
	tool: string;
	timestamp: number;
}

interface TaskDelegationEntry {
	key: string;
	subagentType: string;
	timestamp: number;
}

/**
 * Class for detecting consecutive identical tool calls
 * to prevent the AI from getting stuck in a loop.
 * P2优化：增强Doom Loop检测，包括循环模式和API调用次数检测
 */
export class ToolRepetitionDetector {
	private previousToolCallJson: string | null = null;
	private consecutiveIdenticalToolCallCount: number = 0;
	private readonly consecutiveIdenticalToolCallLimit: number;
	private readonly workspaceRoot: string;

	// P2优化：Doom Loop检测
	private toolCallHistory: ToolCallHistoryEntry[] = [];
	private readonly HISTORY_WINDOW_SIZE = 20; // 保留最近20个工具调用
	private readonly LOOP_DETECTION_THRESHOLD = 3; // 🔥 优化：降低到3次（从5次），更快检测死循环
	private readonly TIME_WINDOW_MS = 60000; // 60秒时间窗口
	private doomLoopDetected = false;
	private doomLoopCount = 0;

	// 同一文件反复写入检测
	private fileWriteHistory: Array<{ file: string; tool: string; signature: string; timestamp: number }> = [];
	private readonly FILE_WRITE_LOOP_THRESHOLD = 5; // 第五次写同一文件时开始评估高风险
	private readonly SAME_FILE_SAME_TOOL_THRESHOLD = 3; // 同一种写入工具至少重复三次才进入高风险
	private readonly READ_WRITE_OSCILLATION_WINDOW = 6;
	private readonly WRITE_TOOLS = new Set(['apply_diff', 'edit', 'write_to_file', 'multiedit', 'patch']);
	private readonly READ_TOOLS = new Set(['read_file']);
	private fileActivityHistory: FileActivityEntry[] = [];
	private taskDelegationHistory: TaskDelegationEntry[] = [];
	private readonly TASK_DELEGATION_LOOP_THRESHOLD = 2;
	/**
	 * Creates a new ToolRepetitionDetector
	 * @param limit The maximum number of identical consecutive tool calls allowed (default: 3)
	 */
	constructor(limit: number = 3, workspaceRoot: string = '') {
		this.consecutiveIdenticalToolCallLimit = limit;
		this.workspaceRoot = this.normalizePathValue(workspaceRoot);
	}

	/**
	 * Checks if the current tool call is identical to the previous one
	 * and determines if execution should be allowed
	 * P2优化：增加Doom Loop检测
	 *
	 * @param currentToolCallBlock ToolUse object representing the current tool call
	 * @returns Object indicating if execution is allowed and a message to show if not
	 */
	public check(currentToolCallBlock: ToolUse): {
		allowExecution: boolean;
		askUser?: {
			messageKey: string;
			messageDetail: string;
		};
	} {
		// Serialize the block to a canonical JSON string for comparison
		const normalizedToolCall = this.normalizeToolUse(currentToolCallBlock);
		const currentToolCallJson = JSON.stringify(normalizedToolCall);
		const paramsHash = this.hashParams(normalizedToolCall.parameters);

		// P2优化：记录到历史
		this.addToHistory(currentToolCallBlock.name, paramsHash);

		// 同一文件反复写入检测（优先级最高，在连续相同检测之前）
		if (this.WRITE_TOOLS.has(currentToolCallBlock.name)) {
			const fileWriteResult = this.detectSameFileWriteLoop(currentToolCallBlock, paramsHash);
			if (fileWriteResult.detected) {
				this.doomLoopDetected = true;
				this.doomLoopCount++;
				return {
					allowExecution: false,
					askUser: {
						messageKey: 'doom_loop_detected',
						messageDetail: fileWriteResult.message,
					},
				};
			}
		}

		if (currentToolCallBlock.name === 'task') {
			const repeatedTaskResult = this.detectRepeatedTaskDelegation(currentToolCallBlock);
			if (repeatedTaskResult.detected) {
				this.doomLoopDetected = true;
				this.doomLoopCount++;
				return {
					allowExecution: false,
					askUser: {
						messageKey: 'doom_loop_detected',
						messageDetail: repeatedTaskResult.message,
					},
				};
			}
		}

		const oscillationResult = this.detectFileReadWriteOscillation(currentToolCallBlock);
		if (oscillationResult.detected) {
			this.doomLoopDetected = true;
			this.doomLoopCount++;
			return {
				allowExecution: false,
				askUser: {
					messageKey: 'doom_loop_detected',
					messageDetail: oscillationResult.message,
				},
			};
		}

		// 连续相同检测
		if (this.previousToolCallJson === currentToolCallJson) {
			this.consecutiveIdenticalToolCallCount++;
		} else {
			this.consecutiveIdenticalToolCallCount = 0;
			this.previousToolCallJson = currentToolCallJson;
		}

		// 检查连续相同限制
		if (
			this.consecutiveIdenticalToolCallLimit > 0 &&
			this.consecutiveIdenticalToolCallCount >= this.consecutiveIdenticalToolCallLimit
		) {
			this.consecutiveIdenticalToolCallCount = 0;
			this.previousToolCallJson = null;

			return {
				allowExecution: false,
				askUser: {
					messageKey: 'mistake_limit_reached',
					messageDetail: t('tools:toolRepetitionLimitReached', {
						toolName: currentToolCallBlock.name,
						limit: this.consecutiveIdenticalToolCallLimit
					}),
				},
			};
		}

		// P2优化：Doom Loop检测（时间窗口内的循环模式）
		const doomLoopResult = this.detectDoomLoop(currentToolCallBlock.name, paramsHash);
		if (doomLoopResult.detected) {
			this.doomLoopDetected = true;
			this.doomLoopCount++;

			return {
				allowExecution: false,
				askUser: {
					messageKey: 'doom_loop_detected',
					messageDetail: doomLoopResult.message,
				},
			};
		}

		return { allowExecution: true };
	}

	/**
	 * P2优化：添加工具调用到历史
	 */
	private addToHistory(name: string, paramsHash: string): void {
		const entry: ToolCallHistoryEntry = {
			name,
			paramsHash,
			timestamp: Date.now()
		};

		this.toolCallHistory.push(entry);

		// 限制历史大小
		if (this.toolCallHistory.length > this.HISTORY_WINDOW_SIZE) {
			this.toolCallHistory.shift();
		}
	}

	/**
	 * P2优化：检测Doom Loop
	 * 在时间窗口内，如果同一工具调用超过阈值次数，触发检测
	 */
	private detectDoomLoop(name: string, paramsHash: string): { detected: boolean; message: string } {
		// read_file 已有专用重复读取治理（缓存 + guidance），避免双重拦截导致误伤。
		if (name === 'read_file') {
			return { detected: false, message: '' };
		}

		const now = Date.now();
		const windowStart = now - this.TIME_WINDOW_MS;

		// 统计时间窗口内相同工具调用的次数
		const recentCalls = this.toolCallHistory.filter(entry =>
			entry.timestamp >= windowStart &&
			entry.name === name &&
			entry.paramsHash === paramsHash
		);

		if (recentCalls.length >= this.LOOP_DETECTION_THRESHOLD) {
			return {
				detected: true,
				message: `🔴 检测到死循环！工具 "${name}" 在 ${Math.round(this.TIME_WINDOW_MS / 1000)} 秒内被调用了 ${recentCalls.length} 次，参数相同。\n\n⚠️ 这表示你陷入了重复操作，请立即停止并尝试完全不同的策略！\n\n💡 建议：\n1. 如果搜索不到文件，不要继续搜索，应该创建文件\n2. 如果某个工具一直失败，换用其他工具\n3. 如果不确定如何继续，使用 ask_followup_question 询问用户`
			};
		}

		// 检测工具循环模式（如A->B->A->B->A->B）
		const patternResult = this.detectLoopPattern();
		if (patternResult.detected) {
			return patternResult;
		}

		return { detected: false, message: '' };
	}

	/**
	 * 检测同一文件被反复写入（apply_diff/edit/write_to_file 在同一文件上多次调用）
	 * 这是 AI 陷入"改了又改"死循环的核心检测
	 */
	private detectSameFileWriteLoop(toolUse: ToolUse, paramsHash: string): { detected: boolean; message: string } {
		// 提取目标文件路径
		const filePath = this.normalizePathValue((toolUse.params as any).path as string | undefined);
		if (!filePath) {
			return { detected: false, message: '' };
		}

		const now = Date.now();
		const windowStart = now - this.TIME_WINDOW_MS;

		// 记录本次写入
		this.fileWriteHistory.push({ file: filePath, tool: toolUse.name, signature: paramsHash, timestamp: now });
		// 清理过期记录
		this.fileWriteHistory = this.fileWriteHistory.filter(e => e.timestamp >= windowStart);

		// 统计同一文件在时间窗口内的写入次数（不包含本次）
		const previousWrites = this.fileWriteHistory.filter(
			e => e.file === filePath && e.timestamp < now
		);

		const sameToolWrites = previousWrites.filter(e => e.tool === toolUse.name);
		const sameSignatureWrites = previousWrites.filter(e => e.signature === paramsHash);
		const totalWritesIncludingCurrent = previousWrites.length + 1;
		const sameToolWritesIncludingCurrent = sameToolWrites.length + 1;
		const sameSignatureWritesIncludingCurrent = sameSignatureWrites.length + 1;
		const distinctSignatures = new Set(previousWrites.map(e => e.signature)).size + (previousWrites.some(e => e.signature === paramsHash) ? 0 : 1);
		if (sameSignatureWritesIncludingCurrent >= 2) {
			return {
				detected: true,
				message: `🔴 检测到对同一文件提交了重复写入参数！文件 "${filePath}" 已至少 2 次收到等价写入请求（同工具/同参数签名）。\n\n这通常是“未生效就重复提交同一补丁”或“写入内容完全一致”的无效重试。\n\n请立即切换策略：\n1. 先 read_file 确认当前文件是否已包含目标改动\n2. 若改动已存在，直接 attempt_completion\n3. 若未生效，重新定位并生成新的最小补丁，禁止继续提交等价参数`
			};
		}
		const sameFileHighRisk =
			(totalWritesIncludingCurrent >= this.FILE_WRITE_LOOP_THRESHOLD && sameToolWritesIncludingCurrent >= this.SAME_FILE_SAME_TOOL_THRESHOLD) ||
			(totalWritesIncludingCurrent > this.FILE_WRITE_LOOP_THRESHOLD && distinctSignatures <= 2);
		if (
			sameFileHighRisk
		) {
			return {
				detected: true,
				message: `🔴 检测到对同一文件的重复修改！文件 "${filePath}" 在短时间内已被写入 ${totalWritesIncludingCurrent} 次，其中同一种写入工具 "${toolUse.name}" 已重复 ${sameToolWritesIncludingCurrent} 次。\n\n这通常意味着你没有真正推进，只是在围绕同一个文件重试。\n\n请立即切换策略：\n1. 如果同一文件还要改多处，先完整读取当前版本，再合并成一次 multiedit\n2. 如果错误已经转移到其他文件，去查调用方、配置入口或引用方\n3. 如果当前修改实际上已经完成，直接总结并调用 attempt_completion`
			};
		}

		return { detected: false, message: '' };
	}

	private detectFileReadWriteOscillation(toolUse: ToolUse): { detected: boolean; message: string } {
		const filePath = this.normalizePathValue((toolUse.params as any).path as string | undefined);
		if (!filePath) {
			return { detected: false, message: '' };
		}

		const kind: 'read' | 'write' | null = this.READ_TOOLS.has(toolUse.name)
			? 'read'
			: (this.WRITE_TOOLS.has(toolUse.name) ? 'write' : null);

		if (!kind) {
			return { detected: false, message: '' };
		}

		const now = Date.now();
		const windowStart = now - this.TIME_WINDOW_MS;
		this.fileActivityHistory.push({ file: filePath, kind, tool: toolUse.name, timestamp: now });
		this.fileActivityHistory = this.fileActivityHistory.filter(entry => entry.timestamp >= windowStart);

		const recentSameFile = this.fileActivityHistory.filter(entry => entry.file === filePath).slice(-this.READ_WRITE_OSCILLATION_WINDOW);
		if (recentSameFile.length < this.READ_WRITE_OSCILLATION_WINDOW) {
			return { detected: false, message: '' };
		}

		const kinds = recentSameFile.map(entry => entry.kind);
		const isAlternating = kinds.every((entryKind, index) => index === 0 || entryKind !== kinds[index - 1]);
		const writeCount = recentSameFile.filter(entry => entry.kind === 'write').length;
		const readCount = recentSameFile.filter(entry => entry.kind === 'read').length;

		if (!isAlternating || writeCount < 3 || readCount < 3) {
			return { detected: false, message: '' };
		}

		return {
			detected: true,
			message: `🔴 检测到同一文件的读写振荡！文件 "${filePath}" 在短时间内出现了 ${recentSameFile.map(entry => `${entry.kind}:${entry.tool}`).join(' → ')}。\n\n这表示你正在围绕同一文件反复读取、修改、再读取、再修改，而不是在推进任务。\n\n立即停止继续围绕这个文件打转，并改用不同策略：\n1. 先判断新增错误是否真的仍在这个文件中\n2. 如果同一文件还需要继续改，先完整 read_file 当前版本，再合并为一次 multiedit\n3. 如果错误已经在其他文件，转去查调用链或配置入口`
		};
	}

	private detectRepeatedTaskDelegation(toolUse: ToolUse): { detected: boolean; message: string } {
		const subagentType = this.normalizeTextValue((toolUse.params as any).subagent_type ?? '');
		const prompt = this.normalizeTextValue((toolUse.params as any).prompt ?? (toolUse.params as any).task ?? '');
		const taskId = this.normalizeTextValue((toolUse.params as any).task_id ?? '');

		if (!subagentType && !prompt && !taskId) {
			return { detected: false, message: '' };
		}

		// 显式 task_id 表示继续同一个子任务上下文，不应被视为“重复新建子任务”。
		if (taskId) {
			return { detected: false, message: '' };
		}

		const now = Date.now();
		const windowStart = now - this.TIME_WINDOW_MS;
		const key = `prompt:${subagentType}:${prompt}`;

		this.taskDelegationHistory.push({ key, subagentType, timestamp: now });
		this.taskDelegationHistory = this.taskDelegationHistory.filter(entry => entry.timestamp >= windowStart);

		const previousDelegations = this.taskDelegationHistory.filter(
			entry => entry.key === key && entry.timestamp < now
		);

		if (previousDelegations.length < this.TASK_DELEGATION_LOOP_THRESHOLD - 1) {
			return { detected: false, message: '' };
		}

		return {
			detected: true,
			message: `🔴 检测到重复派发同一个子任务！你在短时间内重复启动了 ${subagentType || 'unknown'} 子 Agent（${taskId ? `task_id=${taskId}` : `prompt=${prompt.substring(0, 80)}` }）。\n\n这不会带来新的信息，只会继续消耗时间和上下文。\n\n立即停止再次派发相同子任务，并改用以下策略：\n1. 直接使用上一个子任务的结果做判断\n2. 只读取已经明确的具体文件，不要再开新的 explore 子任务\n3. 如果目标文件已明确，直接修改或调用 attempt_completion`
		};
	}

	/**
	 * P2优化：检测工具调用循环模式
	 * 如：A->B->A->B->A->B 或 A->B->C->A->B->C
	 */
	private detectLoopPattern(): { detected: boolean; message: string } {
		if (this.toolCallHistory.length < 6) {
			return { detected: false, message: '' };
		}

		// 检测最近的调用中是否有重复的模式
		const recentCalls = this.toolCallHistory.slice(-10).map(e => `${e.name}:${e.paramsHash.substring(0, 8)}`);

		// 检测长度为2-4的循环模式
		for (let patternLen = 2; patternLen <= 4; patternLen++) {
			if (recentCalls.length < patternLen * 3) continue;

			const pattern = recentCalls.slice(-patternLen);
			let matchCount = 0;

			for (let i = recentCalls.length - patternLen; i >= patternLen; i -= patternLen) {
				const segment = recentCalls.slice(i - patternLen, i);
				if (segment.join(',') === pattern.join(',')) {
					matchCount++;
				} else {
					break;
				}
			}

			if (matchCount >= 2) {
				const patternNames = pattern.map(p => p.split(':')[0]).join(' → ');
				return {
					detected: true,
					message: `🔴 检测到循环模式！工具调用顺序：${patternNames}（重复了${matchCount + 1}次）\n\n⚠️ 这表示你陷入了无意义的循环，当前策略无法解决问题！\n\n💡 必须立即换新策略：\n1. 如果在搜索和查看文件之间循环，应该直接创建文件\n2. 如果在多个工具间循环，说明信息不足，应该 ask_followup_question\n3. 重新思考任务目标，尝试完全不同的方法`
				};
			}
		}

		return { detected: false, message: '' };
	}

	/**
	 * P2优化：计算参数哈希（用于快速比较）
	 */
	private hashParams(params: Record<string, any>): string {
		const json = this.stableStringify(params);
		// 简单哈希
		let hash = 0;
		for (let i = 0; i < json.length; i++) {
			const char = json.charCodeAt(i);
			hash = ((hash << 5) - hash) + char;
			hash = hash & hash;
		}
		return hash.toString(16);
	}

	/**
	 * Checks if a tool use is a browser scroll action
	 * Note: Currently disabled as browser_action tool is not supported
	 */
	/*
	private isBrowserScrollAction(toolUse: ToolUse): boolean {
		if (toolUse.name !== 'browser_action') {
			return false;
		}

		const action = toolUse.params.action as string;
		return action === 'scroll_down' || action === 'scroll_up';
	}
	*/

	private normalizeToolUse(toolUse: ToolUse): { name: string; parameters: Record<string, unknown> } {
		return {
			name: toolUse.name,
			parameters: this.normalizeToolParams(toolUse),
		};
	}

	private normalizeToolParams(toolUse: ToolUse): Record<string, unknown> {
		switch (toolUse.name) {
			case 'edit':
				return {
					path: this.normalizePathValue(toolUse.params.path),
					edits: [
						this.normalizeEditSignature({
							old_string: (toolUse.params as any).old_string,
							new_string: (toolUse.params as any).new_string,
							replace_all: (toolUse.params as any).replace_all,
						}),
					],
				};
			case 'multiedit': {
				const rawEdits = this.parseJsonArray(toolUse.params.edits);
				return {
					path: this.normalizePathValue(toolUse.params.path),
					edits: rawEdits.map((edit: any) => this.normalizeEditSignature({
						old_string: edit.old_string ?? edit.oldString,
						new_string: edit.new_string ?? edit.newString,
						replace_all: edit.replace_all ?? edit.replaceAll,
					})),
				};
			}
			case 'patch': {
				const rawPatches = this.parseJsonArray(toolUse.params.patches);
				return {
					patches: rawPatches.map((patch: any) => ({
						path: this.normalizePathValue(patch.path),
						operations: Array.isArray(patch.operations)
							? patch.operations.map((operation: any) => this.normalizeEditSignature(operation))
							: [],
					})),
				};
			}
			case 'write_to_file':
				return {
					path: this.normalizePathValue(toolUse.params.path),
					content: this.normalizeTextValue((toolUse.params as any).content ?? ''),
				};
			case 'apply_diff':
				return {
					path: this.normalizePathValue(toolUse.params.path),
					diff: this.normalizeTextValue((toolUse.params as any).diff ?? ''),
				};
			case 'read_file':
				return {
					path: this.normalizePathValue(toolUse.params.path),
					start_line: toolUse.params.start_line ?? '',
					end_line: toolUse.params.end_line ?? '',
				};
			case 'search_files':
				return {
					path: this.normalizePathValue(toolUse.params.path),
					regex: this.normalizeTextValue((toolUse.params as any).regex ?? ''),
					file_pattern: this.normalizeTextValue((toolUse.params as any).file_pattern ?? ''),
					output_mode: this.normalizeTextValue((toolUse.params as any).output_mode ?? ''),
					head_limit: this.normalizeTextValue((toolUse.params as any).head_limit ?? ''),
					offset: this.normalizeTextValue((toolUse.params as any).offset ?? ''),
				};
			case 'glob':
				return {
					path: this.normalizePathValue(toolUse.params.path),
					file_pattern: this.normalizeTextValue((toolUse.params as any).file_pattern ?? ''),
				};
			case 'task':
				return {
					subagent_type: this.normalizeTextValue((toolUse.params as any).subagent_type ?? ''),
					prompt: this.normalizeTextValue((toolUse.params as any).prompt ?? (toolUse.params as any).task ?? ''),
					has_task_id: Boolean((toolUse.params as any).task_id),
				};
			default: {
				const sortedParams: Record<string, unknown> = {};
				for (const key of Object.keys(toolUse.params).sort()) {
					if (Object.prototype.hasOwnProperty.call(toolUse.params, key)) {
						sortedParams[key] = toolUse.params[key as keyof typeof toolUse.params];
					}
				}
				return sortedParams;
			}
		}
	}

	private normalizeEditSignature(edit: { old_string?: string; new_string?: string; replace_all?: unknown }): Record<string, unknown> {
		return {
			old_string: this.normalizeTextValue(edit.old_string ?? ''),
			new_string: this.normalizeTextValue(edit.new_string ?? ''),
			replace_all: edit.replace_all === true || edit.replace_all === 'true',
		};
	}

	private normalizePathValue(value: unknown): string {
		if (typeof value !== 'string' || value.length === 0) {
			return '';
		}
		const rawPath = value.replace(/^file:\/\//, '');
		const withWorkspaceRoot = rawPath.startsWith('/') || !this.workspaceRoot
			? rawPath
			: `${this.workspaceRoot.replace(/\/$/, '')}/${rawPath.replace(/^\.\//, '')}`;
		return path.normalize(withWorkspaceRoot).replace(/\\/g, '/');
	}

	private normalizeTextValue(value: unknown): string {
		if (typeof value !== 'string') {
			return '';
		}
		return value.replace(/\r\n/g, '\n').replace(/[ \t]+\n/g, '\n').trim();
	}

	private parseJsonArray(value: unknown): any[] {
		if (Array.isArray(value)) {
			return value;
		}
		if (typeof value !== 'string') {
			return [];
		}
		try {
			const parsed = JSON.parse(value);
			return Array.isArray(parsed) ? parsed : [];
		} catch {
			return [];
		}
	}

	private stableStringify(value: unknown): string {
		if (Array.isArray(value)) {
			return `[${value.map(item => this.stableStringify(item)).join(',')}]`;
		}
		if (value && typeof value === 'object') {
			const objectValue = value as Record<string, unknown>;
			const keys = Object.keys(objectValue).sort();
			return `{${keys.map(key => `${JSON.stringify(key)}:${this.stableStringify(objectValue[key])}`).join(',')}}`;
		}
		return JSON.stringify(value);
	}

	/**
	 * Reset the detector state
	 * Useful when starting a new task or conversation
	 * P2优化：同时重置Doom Loop检测状态
	 */
	public reset(): void {
		this.previousToolCallJson = null;
		this.consecutiveIdenticalToolCallCount = 0;
		this.toolCallHistory = [];
		this.fileWriteHistory = [];
		this.taskDelegationHistory = [];
		this.doomLoopDetected = false;
		// 不重置doomLoopCount，保留统计
	}

	/**
	 * P2优化：获取Doom Loop统计
	 */
	public getDoomLoopStats(): {
		detected: boolean;
		count: number;
		historySize: number;
	} {
		return {
			detected: this.doomLoopDetected,
			count: this.doomLoopCount,
			historySize: this.toolCallHistory.length
		};
	}
}
