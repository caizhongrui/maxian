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
 * 统一估算：每4个字符约1个token（与 aiProxyHandler 一致）
 */
export function estimateTokens(content: string | ContentBlock[]): number {
	if (typeof content === 'string') {
		return Math.ceil(content.length / 4);
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
	return Math.ceil(totalChars / 4);
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
 * AI 摘要压缩结果
 */
export interface SummarizeResult {
	/** 是否成功生成摘要 */
	success: boolean;
	/** 摘要内容 */
	summary?: string;
	/** 压缩前的 token 数 */
	originalTokens: number;
	/** 压缩后的 token 数 */
	summarizedTokens: number;
	/** 错误信息 */
	error?: string;
}

/**
 * 压缩事件类型
 */
export interface CompactionEvent {
	/** 事件类型 */
	type: 'prune_started' | 'prune_completed' | 'summarize_started' | 'summarize_completed';
	/** 压缩的部分数量 */
	compactedParts?: number;
	/** 节省的 token 数 */
	savedTokens?: number;
	/** 错误信息 */
	error?: string;
}

/**
 * 生成 AI 摘要的提示词
 * 参考 OpenCode compaction.ts:summarizePrompt
 */
export function generateSummarizePrompt(conversationHistory: string): string {
	return `请为以下对话历史生成一个详细的摘要，以便在新的对话会话中继续。

重点关注：
1. 已完成的任务和操作
2. 当前正在进行的工作
3. 涉及的文件和代码修改
4. 遇到的问题和解决方案
5. 下一步计划

对话历史：
${conversationHistory}

请用简洁清晰的中文生成摘要，保留所有关键技术细节。`;
}

/**
 * 将消息历史转换为文本格式（用于生成摘要）
 */
export function messagesToText(messages: CompactableMessage[]): string {
	const parts: string[] = [];

	for (const msg of messages) {
		const role = msg.role === 'user' ? '用户' : msg.role === 'assistant' ? 'AI' : '系统';

		if (typeof msg.content === 'string') {
			parts.push(`[${role}]: ${msg.content.substring(0, 2000)}${msg.content.length > 2000 ? '...' : ''}`);
		} else if (Array.isArray(msg.content)) {
			const contentParts: string[] = [];
			for (const block of msg.content) {
				if (block.type === 'text') {
					contentParts.push(block.text.substring(0, 500));
				} else if (block.type === 'tool_use') {
					contentParts.push(`[工具调用: ${block.name}]`);
				} else if (block.type === 'tool_result') {
					const result = block as ToolCallPart;
					if (result.compactedAt) {
						contentParts.push('[工具结果: 已压缩]');
					} else {
						contentParts.push(`[工具结果: ${result.content.substring(0, 200)}...]`);
					}
				}
			}
			parts.push(`[${role}]: ${contentParts.join(' ')}`);
		}
	}

	return parts.join('\n\n');
}

/**
 * 创建摘要消息
 */
export function createSummaryMessage(summary: string): CompactableMessage {
	return {
		role: 'user',
		content: `[上下文摘要]\n\n${summary}\n\n[请基于以上摘要继续我们的对话。]`,
		isSummary: true,
		compaction: {
			compactedAt: Date.now(),
		},
	};
}

/**
 * 分层压缩策略配置
 * 参考 OpenCode 的 Tiered Compaction
 */
export const TIERED_COMPACTION_CONFIG = {
	/** 第一层：最近的消息，保持原样 */
	TIER_1_MESSAGES: 10,

	/** 第二层：较近的消息，压缩工具输出 */
	TIER_2_MESSAGES: 20,

	/** 第三层：较旧的消息，生成摘要 */
	TIER_3_THRESHOLD: 30,

	/** 每层的 token 预算 */
	TIER_1_BUDGET: 30000,
	TIER_2_BUDGET: 20000,
	TIER_3_BUDGET: 10000,

	/** 分层压缩触发条件 */
	TIERED_TRIGGER: {
		/** 消息数量触发阈值 */
		MESSAGE_COUNT: 25,
		/** Token 使用率触发阈值（百分比） */
		TOKEN_USAGE_PERCENT: 70,
	},

	/** 各层的压缩强度 */
	TIER_STRENGTH: {
		/** Tier 1: 不压缩，保持原样 */
		TIER_1: 'none',
		/** Tier 2: 轻度压缩，移除工具输出细节 */
		TIER_2: 'light',
		/** Tier 3: 中度压缩，只保留工具名称和关键结果 */
		TIER_3: 'medium',
		/** Tier 4: 重度压缩，生成 AI 摘要 */
		TIER_4: 'heavy',
	},
};

/**
 * 压缩层级类型
 */
export type CompressionTier = 'tier1' | 'tier2' | 'tier3' | 'tier4';

/**
 * 分层压缩结果
 */
export interface TieredCompactionResult {
	/** 压缩后的消息列表 */
	messages: CompactableMessage[];
	/** 各层的消息数量 */
	tierCounts: {
		tier1: number;  // 未压缩
		tier2: number;  // 轻度压缩
		tier3: number;  // 中度压缩
		tier4: number;  // 重度压缩（摘要）
	};
	/** 压缩前的 token 数 */
	originalTokens: number;
	/** 压缩后的 token 数 */
	compactedTokens: number;
	/** 是否需要 AI 摘要 */
	needsAISummary: boolean;
	/** AI 摘要提示词（如果需要） */
	summaryPrompt?: string;
	/** 需要摘要的消息（如果需要） */
	messagesToSummarize?: CompactableMessage[];
}

/**
 * 执行分层压缩
 * 根据消息的时间/位置进行分层压缩
 */
export function tieredCompact(messages: CompactableMessage[]): {
	tier1: CompactableMessage[];  // 最近的消息
	tier2: CompactableMessage[];  // 压缩的消息
	tier3Summary?: CompactableMessage;  // 摘要消息
} {
	const totalMessages = messages.length;

	// 第一层：保留最近的消息
	const tier1Count = Math.min(TIERED_COMPACTION_CONFIG.TIER_1_MESSAGES, totalMessages);
	const tier1 = messages.slice(-tier1Count);

	// 第二层：压缩工具输出
	const tier2EndIndex = totalMessages - tier1Count;
	const tier2Count = Math.min(TIERED_COMPACTION_CONFIG.TIER_2_MESSAGES, tier2EndIndex);
	const tier2Messages = messages.slice(tier2EndIndex - tier2Count, tier2EndIndex);
	const tier2Result = pruneToolOutputs(tier2Messages);
	const tier2 = tier2Result.messages;

	// 第三层：如果消息很多，需要生成摘要
	let tier3Summary: CompactableMessage | undefined;
	if (tier2EndIndex - tier2Count > 0) {
		const oldMessages = messages.slice(0, tier2EndIndex - tier2Count);
		const summaryText = messagesToText(oldMessages);
		// 注意：实际生成摘要需要调用AI，这里只返回原始文本
		// 实际实现应该在服务层调用AI生成摘要
		tier3Summary = createSummaryMessage(`[需要AI生成摘要]\n原始内容长度: ${summaryText.length} 字符`);
	}

	return { tier1, tier2, tier3Summary };
}

/**
 * 分层压缩管理器
 * 实现完整的分层压缩策略
 */
export class TieredCompactionManager {
	private lastCompactionTime: number = 0;
	private compactionHistory: Array<{
		timestamp: number;
		originalTokens: number;
		compactedTokens: number;
		tierCounts: { tier1: number; tier2: number; tier3: number; tier4: number };
	}> = [];

	/**
	 * 检查是否需要执行分层压缩
	 */
	shouldTieredCompact(messages: CompactableMessage[], currentTokens: number): boolean {
		// 消息数量触发
		if (messages.length >= TIERED_COMPACTION_CONFIG.TIERED_TRIGGER.MESSAGE_COUNT) {
			return true;
		}

		// Token 使用率触发
		const usagePercent = (currentTokens / COMPACTION_CONFIG.MAX_CONTEXT_TOKENS) * 100;
		if (usagePercent >= TIERED_COMPACTION_CONFIG.TIERED_TRIGGER.TOKEN_USAGE_PERCENT) {
			return true;
		}

		return false;
	}

	/**
	 * 确定消息所属的压缩层级
	 */
	private assignTier(messageIndex: number, totalMessages: number): CompressionTier {
		const reverseIndex = totalMessages - messageIndex - 1;

		if (reverseIndex < TIERED_COMPACTION_CONFIG.TIER_1_MESSAGES) {
			return 'tier1';  // 最近的消息，不压缩
		} else if (reverseIndex < TIERED_COMPACTION_CONFIG.TIER_1_MESSAGES + TIERED_COMPACTION_CONFIG.TIER_2_MESSAGES) {
			return 'tier2';  // 轻度压缩
		} else if (reverseIndex < TIERED_COMPACTION_CONFIG.TIER_3_THRESHOLD) {
			return 'tier3';  // 中度压缩
		} else {
			return 'tier4';  // 重度压缩（摘要）
		}
	}

	/**
	 * 对单条消息执行轻度压缩（Tier 2）
	 * - 保留工具调用信息
	 * - 截断工具结果（保留前200字符）
	 */
	private lightCompress(message: CompactableMessage): CompactableMessage {
		if (!Array.isArray(message.content)) {
			return message;
		}

		const compressedContent = message.content.map(block => {
			if (block.type === 'tool_result') {
				const toolResult = block as ToolCallPart;
				if (!toolResult.compactedAt && toolResult.content.length > 200) {
					return {
						...toolResult,
						originalLength: toolResult.content.length,
						content: toolResult.content.substring(0, 200) + '\n... [已截断]',
						compactedAt: Date.now(),
					};
				}
			}
			return block;
		});

		return {
			...message,
			content: compressedContent,
			compaction: {
				...message.compaction,
				compactedAt: Date.now(),
			},
		};
	}

	/**
	 * 对单条消息执行中度压缩（Tier 3）
	 * - 工具调用只保留名称
	 * - 工具结果替换为占位符
	 */
	private mediumCompress(message: CompactableMessage): CompactableMessage {
		if (!Array.isArray(message.content)) {
			// 文本消息截断
			if (typeof message.content === 'string' && message.content.length > 500) {
				return {
					...message,
					content: message.content.substring(0, 500) + '\n... [已压缩]',
					compaction: {
						compactedAt: Date.now(),
						originalTokens: estimateTokens(message.content),
					},
				};
			}
			return message;
		}

		const compressedContent = message.content.map(block => {
			if (block.type === 'tool_result') {
				const toolResult = block as ToolCallPart;
				return {
					...toolResult,
					originalLength: toolResult.content.length,
					content: COMPACTION_CONFIG.COMPACTED_PLACEHOLDER,
					compactedAt: Date.now(),
				};
			} else if (block.type === 'tool_use') {
				// 简化工具输入
				return {
					...block,
					input: { _compressed: true, name: block.name },
				};
			} else if (block.type === 'text' && block.text.length > 300) {
				return {
					...block,
					text: block.text.substring(0, 300) + '\n... [已压缩]',
				};
			}
			return block;
		});

		return {
			...message,
			content: compressedContent,
			compaction: {
				compactedAt: Date.now(),
			},
		};
	}

	/**
	 * 执行完整的分层压缩
	 */
	executeTieredCompaction(messages: CompactableMessage[]): TieredCompactionResult {
		const totalMessages = messages.length;
		const originalTokens = estimateTokens(messagesToText(messages));

		// 分组消息到各层
		const tier1Messages: CompactableMessage[] = [];
		const tier2Messages: CompactableMessage[] = [];
		const tier3Messages: CompactableMessage[] = [];
		const tier4Messages: CompactableMessage[] = [];

		for (let i = 0; i < totalMessages; i++) {
			const tier = this.assignTier(i, totalMessages);
			switch (tier) {
				case 'tier1':
					tier1Messages.push(messages[i]);
					break;
				case 'tier2':
					tier2Messages.push(this.lightCompress(messages[i]));
					break;
				case 'tier3':
					tier3Messages.push(this.mediumCompress(messages[i]));
					break;
				case 'tier4':
					tier4Messages.push(messages[i]);
					break;
			}
		}

		// 检查是否需要 AI 摘要（Tier 4 有消息）
		const needsAISummary = tier4Messages.length > 0;
		let summaryPrompt: string | undefined;
		let messagesToSummarize: CompactableMessage[] | undefined;

		if (needsAISummary) {
			const tier4Text = messagesToText(tier4Messages);
			summaryPrompt = generateSummarizePrompt(tier4Text);
			messagesToSummarize = tier4Messages;
		}

		// 组合压缩后的消息（暂不包含 Tier 4，等待 AI 摘要）
		const compactedMessages: CompactableMessage[] = [
			...tier3Messages,
			...tier2Messages,
			...tier1Messages,
		];

		const compactedTokens = estimateTokens(messagesToText(compactedMessages));

		// 更新压缩历史
		this.compactionHistory.push({
			timestamp: Date.now(),
			originalTokens,
			compactedTokens,
			tierCounts: {
				tier1: tier1Messages.length,
				tier2: tier2Messages.length,
				tier3: tier3Messages.length,
				tier4: tier4Messages.length,
			},
		});
		this.lastCompactionTime = Date.now();

		console.log(`[TieredCompaction] 执行分层压缩: Tier1=${tier1Messages.length}, Tier2=${tier2Messages.length}, Tier3=${tier3Messages.length}, Tier4=${tier4Messages.length}`);
		console.log(`[TieredCompaction] Token变化: ${originalTokens} -> ${compactedTokens} (节省 ${originalTokens - compactedTokens})`);

		return {
			messages: compactedMessages,
			tierCounts: {
				tier1: tier1Messages.length,
				tier2: tier2Messages.length,
				tier3: tier3Messages.length,
				tier4: tier4Messages.length,
			},
			originalTokens,
			compactedTokens,
			needsAISummary,
			summaryPrompt,
			messagesToSummarize,
		};
	}

	/**
	 * 将 AI 摘要整合到压缩结果中
	 */
	integrateSummary(
		compactionResult: TieredCompactionResult,
		summaryText: string
	): CompactableMessage[] {
		// 创建摘要消息
		const summaryMessage = createSummaryMessage(summaryText);

		// 摘要放在最前面
		return [summaryMessage, ...compactionResult.messages];
	}

	/**
	 * 获取压缩统计信息
	 */
	getStats(): {
		lastCompactionTime: number;
		totalCompactions: number;
		totalTokensSaved: number;
		history: Array<{
			timestamp: number;
			originalTokens: number;
			compactedTokens: number;
			tierCounts: { tier1: number; tier2: number; tier3: number; tier4: number };
		}>;
	} {
		const totalTokensSaved = this.compactionHistory.reduce(
			(sum, h) => sum + (h.originalTokens - h.compactedTokens),
			0
		);

		return {
			lastCompactionTime: this.lastCompactionTime,
			totalCompactions: this.compactionHistory.length,
			totalTokensSaved,
			history: this.compactionHistory,
		};
	}
}

/**
 * 导出配置供其他模块使用
 */
export const CompactionConfig = COMPACTION_CONFIG;

/**
 * AI 摘要压缩管理器
 * 管理对话历史的 AI 摘要压缩流程
 */
export class AISummaryCompactor {
	private lastCompactionTime: number = 0;
	private compactionCount: number = 0;

	/**
	 * 检查是否应该执行 AI 摘要压缩
	 * @param messages 消息列表
	 * @param currentTokens 当前 token 数
	 * @returns 是否应该压缩
	 */
	shouldSummarize(messages: CompactableMessage[], currentTokens: number): boolean {
		// 消息数量过多
		if (messages.length > TIERED_COMPACTION_CONFIG.TIER_3_THRESHOLD) {
			return true;
		}

		// Token 使用超过阈值
		const usagePercent = (currentTokens / COMPACTION_CONFIG.MAX_CONTEXT_TOKENS) * 100;
		if (usagePercent >= COMPACTION_CONFIG.COMPACTION_THRESHOLD_PERCENT) {
			return true;
		}

		return false;
	}

	/**
	 * 准备 AI 摘要的输入数据
	 * @param messages 需要压缩的消息
	 * @returns 用于生成摘要的提示词
	 */
	prepareSummaryInput(messages: CompactableMessage[]): {
		prompt: string;
		originalTokens: number;
		messageCount: number;
	} {
		const conversationText = messagesToText(messages);
		const originalTokens = estimateTokens(conversationText);
		const prompt = generateSummarizePrompt(conversationText);

		return {
			prompt,
			originalTokens,
			messageCount: messages.length,
		};
	}

	/**
	 * 处理 AI 返回的摘要并创建新的消息历史
	 * @param summaryText AI 生成的摘要文本
	 * @param recentMessages 需要保留的最近消息
	 * @returns 新的消息列表
	 */
	processSummary(
		summaryText: string,
		recentMessages: CompactableMessage[]
	): {
		messages: CompactableMessage[];
		summaryTokens: number;
	} {
		// 创建摘要消息
		const summaryMessage = createSummaryMessage(summaryText);
		const summaryTokens = estimateTokens(summaryText);

		// 新的消息历史：摘要 + 最近的消息
		const newMessages: CompactableMessage[] = [
			summaryMessage,
			...recentMessages,
		];

		// 更新压缩统计
		this.lastCompactionTime = Date.now();
		this.compactionCount++;

		return {
			messages: newMessages,
			summaryTokens,
		};
	}

	/**
	 * 执行完整的压缩流程（不含 AI 调用）
	 * 返回需要发送给 AI 的摘要请求
	 * @param messages 所有消息
	 * @returns 压缩请求信息
	 */
	prepareCompaction(messages: CompactableMessage[]): {
		needsSummary: boolean;
		summaryPrompt?: string;
		messagesToSummarize?: CompactableMessage[];
		messagesToKeep: CompactableMessage[];
		originalTokens: number;
	} {
		const totalMessages = messages.length;
		const currentTokens = estimateTokens(messagesToText(messages));

		// 计算保留的消息数量
		const keepCount = Math.min(TIERED_COMPACTION_CONFIG.TIER_1_MESSAGES, totalMessages);
		const messagesToKeep = messages.slice(-keepCount);

		// 检查是否需要摘要
		if (totalMessages <= keepCount) {
			return {
				needsSummary: false,
				messagesToKeep,
				originalTokens: currentTokens,
			};
		}

		// 准备需要摘要的消息
		const messagesToSummarize = messages.slice(0, totalMessages - keepCount);
		const { prompt, originalTokens: summaryInputTokens } = this.prepareSummaryInput(messagesToSummarize);

		return {
			needsSummary: true,
			summaryPrompt: prompt,
			messagesToSummarize,
			messagesToKeep,
			originalTokens: summaryInputTokens,
		};
	}

	/**
	 * 获取压缩统计信息
	 */
	getStats(): {
		lastCompactionTime: number;
		compactionCount: number;
	} {
		return {
			lastCompactionTime: this.lastCompactionTime,
			compactionCount: this.compactionCount,
		};
	}
}
