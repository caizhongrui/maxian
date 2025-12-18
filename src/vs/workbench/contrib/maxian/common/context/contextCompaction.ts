/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * 上下文压缩模块
 * 参考 OpenCode session/compaction.ts 实现
 *
 * 核心功能：
 * - P0-2: 上下文溢出检测和压缩
 * - P0-3: 工具输出修剪 (Prune)
 * - P0-4: 输出占位符替换
 *
 * 预期效果：
 * - 支持无限长对话
 * - Token消耗减少40-50%
 */

import { MessageParam, ContentBlock } from '../api/types.js';

/**
 * Compaction 配置常量
 * 参考 OpenCode compaction.ts
 */
export const COMPACTION_CONFIG = {
	/** 保护最近的 token 数（不会被修剪） */
	PRUNE_PROTECT: 40000,

	/** 最少需要修剪的 token 数 */
	PRUNE_MINIMUM: 20000,

	/** 最大上下文 token 数 */
	MAX_CONTEXT_TOKENS: 100000,

	/** 预留给响应的 token 数 */
	OUTPUT_TOKEN_RESERVE: 20000,

	/** 触发压缩的上下文使用百分比 */
	COMPACTION_THRESHOLD_PERCENT: 80,

	/** 已压缩输出的占位符文本 */
	COMPACTED_PLACEHOLDER: '[旧工具结果内容已清除]',
};

/**
 * 工具调用部分（带压缩状态）
 */
export interface ToolCallPart {
	type: 'tool_result';
	tool_use_id: string;
	content: string;
	is_error?: boolean;
	/** 压缩时间戳，如果设置则表示已被压缩 */
	compactedAt?: number;
	/** 原始内容长度（用于统计） */
	originalLength?: number;
}

/**
 * 消息（带压缩元数据）
 */
export interface CompactableMessage extends MessageParam {
	/** 消息时间戳 */
	ts?: number;
	/** 是否为摘要消息 */
	isSummary?: boolean;
	/** 压缩元数据 */
	compaction?: {
		/** 消息被压缩的时间 */
		compactedAt?: number;
		/** 原始 token 数 */
		originalTokens?: number;
	};
}

/**
 * 上下文压缩状态
 */
export interface CompactionState {
	/** 当前输入 token 数 */
	inputTokens: number;
	/** 缓存读取 token 数 */
	cacheTokens: number;
	/** 输出 token 数 */
	outputTokens: number;
	/** 模型上下文限制 */
	contextLimit: number;
	/** 输出限制 */
	outputLimit: number;
}

/**
 * Prune 结果
 */
export interface PruneResult {
	/** 是否执行了修剪 */
	pruned: boolean;
	/** 修剪的 token 数 */
	prunedTokens: number;
	/** 修剪的部分数 */
	prunedParts: number;
	/** 修剪后的消息 */
	messages: CompactableMessage[];
}

/**
 * 检测上下文是否溢出
 * 参考 OpenCode compaction.ts:isOverflow
 */
export function isContextOverflow(state: CompactionState): boolean {
	const usableContext = state.contextLimit - state.outputLimit;
	const currentUsage = state.inputTokens + state.cacheTokens + state.outputTokens;
	return currentUsage > usableContext;
}

/**
 * 检测是否需要压缩
 */
export function shouldCompact(state: CompactionState): boolean {
	const usableContext = state.contextLimit - state.outputLimit;
	const currentUsage = state.inputTokens + state.cacheTokens + state.outputTokens;
	const usagePercent = (currentUsage / usableContext) * 100;
	return usagePercent >= COMPACTION_CONFIG.COMPACTION_THRESHOLD_PERCENT;
}

/**
 * 估算内容的 token 数
 * 简单估算：中文约2字符/token，英文约4字符/token，取平均3字符/token
 */
export function estimateTokens(content: string | ContentBlock[]): number {
	if (typeof content === 'string') {
		return Math.ceil(content.length / 3);
	}

	let totalChars = 0;
	for (const block of content) {
		if (block.type === 'text') {
			totalChars += block.text.length;
		} else if (block.type === 'tool_result') {
			totalChars += block.content.length;
		} else if (block.type === 'tool_use') {
			totalChars += JSON.stringify(block.input).length;
		}
	}
	return Math.ceil(totalChars / 3);
}

/**
 * 执行工具输出修剪 (Prune)
 * 参考 OpenCode compaction.ts:prune
 *
 * 策略：
 * 1. 从后向前遍历消息
 * 2. 保护最近 PRUNE_PROTECT tokens
 * 3. 超过保护范围的工具输出标记为 compacted
 * 4. 只有累计超过 PRUNE_MINIMUM 才执行修剪
 */
export function pruneToolOutputs(messages: CompactableMessage[]): PruneResult {
	let totalTokens = 0;
	let prunedTokens = 0;
	const toPrune: Array<{ msgIndex: number; partIndex: number; tokens: number }> = [];

	// 从后向前遍历消息
	for (let msgIndex = messages.length - 1; msgIndex >= 0; msgIndex--) {
		const msg = messages[msgIndex];

		// 只处理工具结果消息
		if (msg.role !== 'tool' || !Array.isArray(msg.content)) {
			continue;
		}

		for (let partIndex = 0; partIndex < msg.content.length; partIndex++) {
			const part = msg.content[partIndex] as ToolCallPart;

			// 只处理工具结果且未被压缩的
			if (part.type !== 'tool_result' || part.compactedAt) {
				continue;
			}

			const partTokens = estimateTokens(part.content);
			totalTokens += partTokens;

			// 超过保护范围的标记为需要修剪
			if (totalTokens > COMPACTION_CONFIG.PRUNE_PROTECT) {
				toPrune.push({ msgIndex, partIndex, tokens: partTokens });
				prunedTokens += partTokens;
			}
		}
	}

	// 只有累计超过最小值才执行修剪
	if (prunedTokens < COMPACTION_CONFIG.PRUNE_MINIMUM) {
		return {
			pruned: false,
			prunedTokens: 0,
			prunedParts: 0,
			messages,
		};
	}

	// 执行修剪：创建消息的深拷贝并标记压缩
	const prunedMessages = JSON.parse(JSON.stringify(messages)) as CompactableMessage[];

	for (const { msgIndex, partIndex } of toPrune) {
		const msg = prunedMessages[msgIndex];
		if (Array.isArray(msg.content)) {
			const part = msg.content[partIndex] as ToolCallPart;
			part.originalLength = part.content.length;
			part.compactedAt = Date.now();
			// 内容替换为占位符
			part.content = COMPACTION_CONFIG.COMPACTED_PLACEHOLDER;
		}
	}

	console.log(`[Compaction] 修剪完成: 修剪了 ${toPrune.length} 个工具输出, 节省约 ${prunedTokens} tokens`);

	return {
		pruned: true,
		prunedTokens,
		prunedParts: toPrune.length,
		messages: prunedMessages,
	};
}

/**
 * 转换消息为 API 格式
 * 已压缩的工具输出使用占位符替换
 * 参考 OpenCode message-v2.ts:toModelMessage
 */
export function toModelMessages(messages: CompactableMessage[]): MessageParam[] {
	return messages.map(msg => {
		// 非数组内容直接返回
		if (!Array.isArray(msg.content)) {
			return {
				role: msg.role,
				content: msg.content,
			};
		}

		// 处理数组内容
		const processedContent = msg.content.map(block => {
			// 工具结果：检查是否已压缩
			if (block.type === 'tool_result') {
				const toolResult = block as ToolCallPart;
				return {
					type: 'tool_result' as const,
					tool_use_id: toolResult.tool_use_id,
					content: toolResult.compactedAt
						? COMPACTION_CONFIG.COMPACTED_PLACEHOLDER
						: toolResult.content,
					is_error: toolResult.is_error,
				};
			}
			return block;
		});

		return {
			role: msg.role,
			content: processedContent,
		};
	});
}

/**
 * 生成压缩提示词
 * 参考 OpenCode compaction.ts
 */
export function generateCompactionPrompt(): string {
	return `请为继续我们的对话提供一个详细的提示词。
重点关注对继续对话有帮助的信息，包括：
- 我们做了什么
- 我们正在做什么
- 我们正在处理哪些文件
- 考虑到新会话无法访问我们的对话，接下来要做什么

请用简洁的中文总结。`;
}

/**
 * 上下文压缩器类
 * 整合所有压缩功能
 */
export class ContextCompactor {
	private messages: CompactableMessage[] = [];
	private compactionState: CompactionState;

	constructor(contextLimit: number = COMPACTION_CONFIG.MAX_CONTEXT_TOKENS) {
		this.compactionState = {
			inputTokens: 0,
			cacheTokens: 0,
			outputTokens: 0,
			contextLimit,
			outputLimit: COMPACTION_CONFIG.OUTPUT_TOKEN_RESERVE,
		};
	}

	/**
	 * 更新消息并检查是否需要压缩
	 */
	updateMessages(messages: CompactableMessage[]): {
		needsCompaction: boolean;
		needsPrune: boolean;
		messages: CompactableMessage[];
	} {
		this.messages = messages;

		// 估算当前 token 使用
		let totalTokens = 0;
		for (const msg of messages) {
			if (typeof msg.content === 'string') {
				totalTokens += estimateTokens(msg.content);
			} else if (Array.isArray(msg.content)) {
				totalTokens += estimateTokens(msg.content);
			}
		}
		this.compactionState.inputTokens = totalTokens;

		const needsCompaction = shouldCompact(this.compactionState);
		const needsPrune = totalTokens > COMPACTION_CONFIG.PRUNE_PROTECT;

		// 如果需要修剪，自动执行
		let resultMessages = messages;
		if (needsPrune) {
			const pruneResult = pruneToolOutputs(messages);
			if (pruneResult.pruned) {
				resultMessages = pruneResult.messages;
			}
		}

		return {
			needsCompaction,
			needsPrune,
			messages: resultMessages,
		};
	}

	/**
	 * 获取用于 API 调用的消息
	 */
	getModelMessages(): MessageParam[] {
		return toModelMessages(this.messages);
	}

	/**
	 * 获取压缩统计信息
	 */
	getStats(): {
		totalTokens: number;
		compactedParts: number;
		savedTokens: number;
	} {
		let totalTokens = 0;
		let compactedParts = 0;
		let savedTokens = 0;

		for (const msg of this.messages) {
			if (Array.isArray(msg.content)) {
				for (const block of msg.content) {
					if (block.type === 'tool_result') {
						const part = block as ToolCallPart;
						if (part.compactedAt) {
							compactedParts++;
							savedTokens += Math.ceil((part.originalLength || 0) / 3);
						} else {
							totalTokens += estimateTokens(part.content);
						}
					}
				}
			}
		}

		return { totalTokens, compactedParts, savedTokens };
	}
}

/**
 * 导出配置供其他模块使用
 */
export const CompactionConfig = COMPACTION_CONFIG;
