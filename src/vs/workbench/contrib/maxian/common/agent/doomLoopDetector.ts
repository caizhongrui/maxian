/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Doom Loop 检测器
 * 参考 OpenCode agent/agent.ts 实现
 *
 * 核心功能：
 * - 检测同一工具连续相同参数调用
 * - 防止 AI 陷入无限重试循环
 * - 浪费 token 和时间的预防机制
 *
 * 检测逻辑：同一工具连续3次相同参数调用时触发
 */

import { ToolUse } from '../tools/toolTypes.js';

/**
 * Doom Loop 配置
 */
export const DOOM_LOOP_CONFIG = {
	/** 连续相同调用触发阈值 */
	THRESHOLD: 3,

	/** 参数哈希历史保留数量 */
	HISTORY_SIZE: 10,

	/** 检测窗口时间（毫秒） */
	WINDOW_MS: 60000, // 1分钟
};

/**
 * 工具调用记录
 */
interface ToolCallRecord {
	/** 工具名称 */
	toolName: string;
	/** 参数哈希 */
	paramsHash: string;
	/** 调用时间 */
	timestamp: number;
}

/**
 * Doom Loop 检测结果
 */
export interface DoomLoopResult {
	/** 是否检测到死循环 */
	detected: boolean;
	/** 连续相同调用次数 */
	count: number;
	/** 工具名称 */
	toolName?: string;
	/** 建议消息 */
	message?: string;
}

/**
 * Doom Loop 检测器类
 */
export class DoomLoopDetector {
	/** 每个会话的调用历史 */
	private callHistory: Map<string, ToolCallRecord[]> = new Map();
	private static readonly HASH_FULL_STRING_KEYS = new Set([
		'path',
		'cwd',
		'regex',
		'query',
		'file_pattern',
		'start_line',
		'end_line',
		'tool_use_id',
		'id',
	]);

	private normalizeStringForHash(key: string, value: string): string {
		const normalized = value.replace(/\r\n/g, '\n');
		const keyLower = key.toLowerCase();
		const isPathLikeKey = DoomLoopDetector.HASH_FULL_STRING_KEYS.has(keyLower) || keyLower.endsWith('path');
		if (isPathLikeKey || normalized.length <= 800) {
			return normalized;
		}
		// 对超长内容保留头尾和长度，避免只看前缀导致不同参数被误判为相同
		return `${normalized.slice(0, 400)}__LEN_${normalized.length}__TAIL_${normalized.slice(-200)}`;
	}

	/**
	 * 计算参数哈希
	 * 用于比较两次调用的参数是否相同
	 */
	private hashParams(params: Record<string, any>): string {
		// 排序键以确保一致性
		const sortedKeys = Object.keys(params).sort();
		const normalized = sortedKeys.map(key => {
			const value = params[key];
			const normalizedValue = typeof value === 'string'
				? this.normalizeStringForHash(key, value)
				: value;
			return `${key}:${JSON.stringify(normalizedValue)}`;
		}).join('|');

		// 简单哈希函数
		let hash = 0;
		for (let i = 0; i < normalized.length; i++) {
			const char = normalized.charCodeAt(i);
			hash = ((hash << 5) - hash) + char;
			hash = hash & hash; // 转换为32位整数
		}
		return hash.toString(16);
	}

	/**
	 * 记录工具调用
	 * @param sessionId 会话ID
	 * @param toolUse 工具调用信息
	 * @returns 检测结果
	 */
	recordCall(sessionId: string, toolUse: ToolUse): DoomLoopResult {
		const now = Date.now();
		const paramsHash = this.hashParams(toolUse.params);

		// 获取或创建会话历史
		if (!this.callHistory.has(sessionId)) {
			this.callHistory.set(sessionId, []);
		}
		const history = this.callHistory.get(sessionId)!;

		// 添加新记录
		history.push({
			toolName: toolUse.name,
			paramsHash,
			timestamp: now,
		});

		// 清理过期记录
		const windowStart = now - DOOM_LOOP_CONFIG.WINDOW_MS;
		while (history.length > 0 && history[0].timestamp < windowStart) {
			history.shift();
		}

		// 限制历史大小
		while (history.length > DOOM_LOOP_CONFIG.HISTORY_SIZE) {
			history.shift();
		}

		// 检测连续相同调用
		const consecutiveCount = this.countConsecutiveSameCalls(history, toolUse.name, paramsHash);

		if (consecutiveCount >= DOOM_LOOP_CONFIG.THRESHOLD) {
			return {
				detected: true,
				count: consecutiveCount,
				toolName: toolUse.name,
				message: this.generateWarningMessage(toolUse.name, consecutiveCount),
			};
		}

		return {
			detected: false,
			count: consecutiveCount,
		};
	}

	/**
	 * 计算连续相同调用次数
	 */
	private countConsecutiveSameCalls(
		history: ToolCallRecord[],
		toolName: string,
		paramsHash: string
	): number {
		let count = 0;

		// 从最近的记录开始向前查找
		for (let i = history.length - 1; i >= 0; i--) {
			const record = history[i];
			if (record.toolName === toolName && record.paramsHash === paramsHash) {
				count++;
			} else {
				break; // 遇到不同的调用就停止
			}
		}

		return count;
	}

	/**
	 * 生成警告消息
	 */
	private generateWarningMessage(toolName: string, count: number): string {
		const messages: Record<string, string> = {
			edit: `检测到 ${toolName} 工具连续 ${count} 次相同参数调用。这可能表明编辑匹配失败。建议：
1. 使用 read_file 重新读取文件获取最新内容
2. 检查 oldString 是否与文件内容完全匹配
3. 考虑使用不同的匹配策略`,

			apply_diff: `检测到 ${toolName} 工具连续 ${count} 次相同参数调用。这可能表明 diff 应用失败。建议：
1. 使用 read_file 重新读取文件获取最新内容
2. 检查 SEARCH 块是否与文件内容匹配
3. 确保 start_line 参数正确`,

			execute_command: `检测到 ${toolName} 工具连续 ${count} 次相同命令执行。这可能表明：
1. 命令执行失败但返回了相同的错误
2. 需要检查命令参数或环境配置
3. 考虑使用不同的方法解决问题`,

			search_files: `检测到 ${toolName} 工具连续 ${count} 次相同搜索。这可能表明：
1. 搜索模式可能需要调整
2. 目标文件可能不存在
3. 考虑使用不同的搜索策略`,
		};

		return messages[toolName] || `检测到 ${toolName} 工具连续 ${count} 次相同参数调用。
这可能表明操作陷入了死循环。建议：
1. 分析为什么操作重复失败
2. 尝试使用不同的参数或方法
3. 检查相关文件或资源的状态`;
	}

	/**
	 * 清除会话历史
	 * @param sessionId 会话ID
	 */
	clearSession(sessionId: string): void {
		this.callHistory.delete(sessionId);
	}

	/**
	 * 清除所有历史
	 */
	clearAll(): void {
		this.callHistory.clear();
	}

	/**
	 * 获取会话的调用统计
	 * @param sessionId 会话ID
	 */
	getSessionStats(sessionId: string): {
		totalCalls: number;
		uniqueTools: number;
		recentCalls: string[];
	} {
		const history = this.callHistory.get(sessionId) || [];
		const uniqueTools = new Set(history.map(r => r.toolName));
		const recentCalls = history.slice(-5).map(r => r.toolName);

		return {
			totalCalls: history.length,
			uniqueTools: uniqueTools.size,
			recentCalls,
		};
	}

	/**
	 * 重置特定工具的连续计数
	 * 当工具调用成功时调用此方法
	 * @param sessionId 会话ID
	 * @param toolName 工具名称
	 */
	resetToolCount(sessionId: string, toolName: string): void {
		const history = this.callHistory.get(sessionId);
		if (!history) return;

		// 添加一个特殊的"重置"记录来打断连续计数
		history.push({
			toolName: `__reset_${toolName}`,
			paramsHash: 'reset',
			timestamp: Date.now(),
		});
	}
}

/**
 * 全局 Doom Loop 检测器实例
 */
export const globalDoomLoopDetector = new DoomLoopDetector();

/**
 * 便捷函数：检测并记录工具调用
 */
export function detectDoomLoop(sessionId: string, toolUse: ToolUse): DoomLoopResult {
	return globalDoomLoopDetector.recordCall(sessionId, toolUse);
}

/**
 * 便捷函数：工具调用成功后重置计数
 */
export function resetDoomLoopCount(sessionId: string, toolName: string): void {
	globalDoomLoopDetector.resetToolCount(sessionId, toolName);
}

/**
 * 便捷函数：清除会话历史
 */
export function clearDoomLoopHistory(sessionId: string): void {
	globalDoomLoopDetector.clearSession(sessionId);
}
