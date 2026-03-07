/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Copied from Kilocode: src/core/tools/ToolRepetitionDetector.ts
// Adapted for tianhe-zhikai-ide: 使用本地i18n系统
// P2优化：增强Doom Loop检测（借鉴Cline）

import { ToolUse } from './toolTypes.js';
import { t } from '../i18n/index.js';

/**
 * P2优化：工具调用历史条目
 */
interface ToolCallHistoryEntry {
	name: string;
	paramsHash: string;
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

	// P2优化：Doom Loop检测
	private toolCallHistory: ToolCallHistoryEntry[] = [];
	private readonly HISTORY_WINDOW_SIZE = 20; // 保留最近20个工具调用
	private readonly LOOP_DETECTION_THRESHOLD = 3; // 🔥 优化：降低到3次（从5次），更快检测死循环
	private readonly TIME_WINDOW_MS = 60000; // 60秒时间窗口
	private doomLoopDetected = false;
	private doomLoopCount = 0;

	// 同一文件反复写入检测
	private fileWriteHistory: Array<{ file: string; tool: string; timestamp: number }> = [];
	private readonly FILE_WRITE_LOOP_THRESHOLD = 3; // 同一文件写入3次触发检测
	private readonly WRITE_TOOLS = new Set(['apply_diff', 'edit', 'write_to_file', 'multiedit', 'patch']);

	/**
	 * Creates a new ToolRepetitionDetector
	 * @param limit The maximum number of identical consecutive tool calls allowed (default: 3)
	 */
	constructor(limit: number = 3) {
		this.consecutiveIdenticalToolCallLimit = limit;
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
		const currentToolCallJson = this.serializeToolUse(currentToolCallBlock);
		const paramsHash = this.hashParams(currentToolCallBlock.params);

		// P2优化：记录到历史
		this.addToHistory(currentToolCallBlock.name, paramsHash);

		// 同一文件反复写入检测（优先级最高，在连续相同检测之前）
		if (this.WRITE_TOOLS.has(currentToolCallBlock.name)) {
			const fileWriteResult = this.detectSameFileWriteLoop(currentToolCallBlock);
			if (fileWriteResult.detected) {
				this.doomLoopDetected = true;
				this.doomLoopCount++;
				console.warn(`[ToolRepetitionDetector] 同一文件反复写入检测触发: ${currentToolCallBlock.name}`);
				return {
					allowExecution: false,
					askUser: {
						messageKey: 'doom_loop_detected',
						messageDetail: fileWriteResult.message,
					},
				};
			}
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
			console.warn(`[ToolRepetitionDetector] Doom Loop检测触发: ${currentToolCallBlock.name} (第${this.doomLoopCount}次)`);

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

		// 🔥 检测重复读取同一文件的不同部分（参数不同但目标相同）
		if (name === 'read_file') {
			const sameFileResult = this.detectSameFileReading();
			if (sameFileResult.detected) {
				return sameFileResult;
			}
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
	private detectSameFileWriteLoop(toolUse: ToolUse): { detected: boolean; message: string } {
		// 提取目标文件路径
		const filePath = (toolUse.params as any).path as string | undefined;
		if (!filePath) {
			return { detected: false, message: '' };
		}

		const now = Date.now();
		const windowStart = now - this.TIME_WINDOW_MS;

		// 记录本次写入
		this.fileWriteHistory.push({ file: filePath, tool: toolUse.name, timestamp: now });
		// 清理过期记录
		this.fileWriteHistory = this.fileWriteHistory.filter(e => e.timestamp >= windowStart);

		// 统计同一文件在时间窗口内的写入次数（不包含本次）
		const previousWrites = this.fileWriteHistory.filter(
			e => e.file === filePath && e.timestamp < now
		);

		if (previousWrites.length >= this.FILE_WRITE_LOOP_THRESHOLD) {
			const toolNames = previousWrites.map(e => e.tool).join(' → ');
			return {
				detected: true,
				message: `🔴 检测到对同一文件的重复修改！文件 "${filePath}" 在过去 ${Math.round(this.TIME_WINDOW_MS / 1000)} 秒内已被写入 ${previousWrites.length} 次（${toolNames}）。\n\n⚠️ 你陷入了"改了又改"的死循环！这通常意味着：\n1. 你的修改策略有误——已修改的内容被你重新覆盖\n2. LSP 错误并非源于这个文件，而是其他文件引用了已被删除的字段\n\n💡 立即停止修改此文件，转向：\n1. 检查引用了该文件字段的其他文件（使用 search_files 搜索字段名）\n2. 使用 read_file 确认当前文件实际内容，再决定是否需要修改\n3. 如果不确定，使用 ask_followup_question 询问用户`
			};
		}

		return { detected: false, message: '' };
	}

	/**
	 * 🔥 检测重复读取同一文件的不同部分
	 * 例如：连续多次 read_file("game.js", start_line=1, end_line=100)
	 *                  read_file("game.js", start_line=101, end_line=200)
	 */
	private detectSameFileReading(): { detected: boolean; message: string } {
		const now = Date.now();
		const windowStart = now - this.TIME_WINDOW_MS;

		// 获取最近的 read_file 调用
		const recentReadFiles = this.toolCallHistory.filter(entry =>
			entry.timestamp >= windowStart &&
			entry.name === 'read_file'
		);

		if (recentReadFiles.length < 3) {
			return { detected: false, message: '' };
		}

		// 简单检测：最近 3 次以上调用都是 read_file，很可能是重复读取
		if (recentReadFiles.length >= 3) {
			return {
				detected: true,
				message: `🔴 检测到重复读取文件！你在 ${Math.round(this.TIME_WINDOW_MS / 1000)} 秒内调用了 ${recentReadFiles.length} 次 read_file。\n\n⚠️ 不要分批读取文件！应该一次性读取完整文件内容。\n\n💡 正确做法：\n1. 使用 read_file(path) 读取整个文件（不带 start_line/end_line 参数）\n2. 如果文件太大（>2000行），可以使用 start_line/end_line 读取关键部分\n3. 但不要连续多次读取同一文件的不同部分！\n\n💡 如果你需要了解文件结构，使用 list_code_definition_names 工具！`
			};
		}

		return { detected: false, message: '' };
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
		const json = JSON.stringify(params, Object.keys(params).sort());
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

	/**
	 * Serializes a ToolUse object into a canonical JSON string for comparison
	 *
	 * @param toolUse The ToolUse object to serialize
	 * @returns JSON string representation of the tool use with sorted parameter keys
	 */
	private serializeToolUse(toolUse: ToolUse): string {
		// Create a new parameters object with alphabetically sorted keys
		const sortedParams: Record<string, unknown> = {};

		// Get parameter keys and sort them alphabetically
		const sortedKeys = Object.keys(toolUse.params).sort();

		// Populate the sorted parameters object in a type-safe way
		for (const key of sortedKeys) {
			if (Object.prototype.hasOwnProperty.call(toolUse.params, key)) {
				sortedParams[key] = toolUse.params[key as keyof typeof toolUse.params];
			}
		}

		// Create the object with the tool name and sorted parameters
		const toolObject = {
			name: toolUse.name,
			parameters: sortedParams,
		};

		// Convert to a canonical JSON string
		return JSON.stringify(toolObject);
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
