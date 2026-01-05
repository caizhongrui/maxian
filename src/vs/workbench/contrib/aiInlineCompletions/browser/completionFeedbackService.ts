/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../base/common/event.js';

/**
 * 补全反馈类型
 */
export type FeedbackType = 'accepted' | 'rejected' | 'modified' | 'ignored';

/**
 * 补全反馈记录
 */
export interface CompletionFeedback {
	/** 反馈ID */
	id: string;
	/** 时间戳 */
	timestamp: number;
	/** 反馈类型 */
	type: FeedbackType;
	/** 原始补全文本 */
	originalCompletion: string;
	/** 最终采用的文本（如果修改） */
	finalText?: string;
	/** 补全的上下文信息 */
	context: {
		languageId: string;
		currentClass?: string;
		currentMethod?: string;
		framework?: string;
		prefix: string;
	};
	/** 补全的评分 */
	score?: number;
	/** 响应时间（ms） */
	responseTime?: number;
}

/**
 * 反馈统计信息
 */
export interface FeedbackStats {
	/** 总补全次数 */
	totalCompletions: number;
	/** 接受次数 */
	acceptedCount: number;
	/** 拒绝次数 */
	rejectedCount: number;
	/** 修改后接受次数 */
	modifiedCount: number;
	/** 忽略次数 */
	ignoredCount: number;
	/** 接受率 */
	acceptanceRate: number;
	/** 平均响应时间 */
	avgResponseTime: number;
	/** 按语言统计 */
	byLanguage: Map<string, LanguageStats>;
	/** 按框架统计 */
	byFramework: Map<string, FrameworkStats>;
}

/**
 * 语言级统计
 */
export interface LanguageStats {
	total: number;
	accepted: number;
	acceptanceRate: number;
}

/**
 * 框架级统计
 */
export interface FrameworkStats {
	total: number;
	accepted: number;
	acceptanceRate: number;
}

/**
 * 反馈驱动的优化建议
 */
export interface OptimizationSuggestion {
	/** 建议类型 */
	type: 'prompt' | 'context' | 'validation' | 'caching';
	/** 建议描述 */
	description: string;
	/** 优先级 (1-5) */
	priority: number;
	/** 基于的数据 */
	evidence: string;
}

/**
 * 补全反馈收集服务
 * 收集用户对补全的反馈，驱动持续优化
 */
export class CompletionFeedbackService {

	// 反馈历史（内存中保留最近1000条）
	private feedbackHistory: CompletionFeedback[] = [];
	private readonly maxHistorySize = 1000;

	// 统计信息
	private stats: FeedbackStats = {
		totalCompletions: 0,
		acceptedCount: 0,
		rejectedCount: 0,
		modifiedCount: 0,
		ignoredCount: 0,
		acceptanceRate: 0,
		avgResponseTime: 0,
		byLanguage: new Map(),
		byFramework: new Map()
	};

	// 响应时间历史
	private responseTimes: number[] = [];

	// 事件发射器
	private readonly _onFeedbackReceived = new Emitter<CompletionFeedback>();
	public readonly onFeedbackReceived: Event<CompletionFeedback> = this._onFeedbackReceived.event;

	private readonly _onStatsUpdated = new Emitter<FeedbackStats>();
	public readonly onStatsUpdated: Event<FeedbackStats> = this._onStatsUpdated.event;

	// 持久化键
	private readonly storageKey = 'maxian_completion_feedback_stats';

	constructor() {
		this.loadStats();
	}

	/**
	 * 记录补全被接受
	 */
	recordAccepted(
		completion: string,
		context: CompletionFeedback['context'],
		score?: number,
		responseTime?: number
	): void {
		this.recordFeedback({
			type: 'accepted',
			originalCompletion: completion,
			context,
			score,
			responseTime
		});
	}

	/**
	 * 记录补全被拒绝
	 */
	recordRejected(
		completion: string,
		context: CompletionFeedback['context'],
		score?: number,
		responseTime?: number
	): void {
		this.recordFeedback({
			type: 'rejected',
			originalCompletion: completion,
			context,
			score,
			responseTime
		});
	}

	/**
	 * 记录补全被修改后接受
	 */
	recordModified(
		originalCompletion: string,
		finalText: string,
		context: CompletionFeedback['context'],
		score?: number,
		responseTime?: number
	): void {
		this.recordFeedback({
			type: 'modified',
			originalCompletion,
			finalText,
			context,
			score,
			responseTime
		});
	}

	/**
	 * 记录补全被忽略（显示但未操作）
	 */
	recordIgnored(
		completion: string,
		context: CompletionFeedback['context'],
		responseTime?: number
	): void {
		this.recordFeedback({
			type: 'ignored',
			originalCompletion: completion,
			context,
			responseTime
		});
	}

	/**
	 * 获取当前统计信息
	 */
	getStats(): FeedbackStats {
		return { ...this.stats };
	}

	/**
	 * 获取最近的反馈历史
	 */
	getRecentFeedback(count: number = 50): CompletionFeedback[] {
		return this.feedbackHistory.slice(-count);
	}

	/**
	 * 基于反馈生成优化建议
	 */
	generateOptimizationSuggestions(): OptimizationSuggestion[] {
		const suggestions: OptimizationSuggestion[] = [];

		// 1. 检查整体接受率
		if (this.stats.acceptanceRate < 0.5 && this.stats.totalCompletions > 50) {
			suggestions.push({
				type: 'prompt',
				description: '整体接受率较低，建议增强提示词约束或调整补全策略',
				priority: 5,
				evidence: `接受率仅 ${(this.stats.acceptanceRate * 100).toFixed(1)}%`
			});
		}

		// 2. 检查特定语言的表现
		for (const [lang, langStats] of this.stats.byLanguage.entries()) {
			if (langStats.acceptanceRate < 0.4 && langStats.total > 20) {
				suggestions.push({
					type: 'context',
					description: `${lang} 语言补全接受率较低，建议优化该语言的上下文提取`,
					priority: 4,
					evidence: `${lang} 接受率 ${(langStats.acceptanceRate * 100).toFixed(1)}%，共 ${langStats.total} 次`
				});
			}
		}

		// 3. 检查特定框架的表现
		for (const [framework, fwStats] of this.stats.byFramework.entries()) {
			if (fwStats.acceptanceRate < 0.4 && fwStats.total > 20) {
				suggestions.push({
					type: 'context',
					description: `${framework} 框架补全接受率较低，建议增强框架特化处理`,
					priority: 4,
					evidence: `${framework} 接受率 ${(fwStats.acceptanceRate * 100).toFixed(1)}%，共 ${fwStats.total} 次`
				});
			}
		}

		// 4. 检查响应时间
		if (this.stats.avgResponseTime > 2000) {
			suggestions.push({
				type: 'caching',
				description: '平均响应时间较长，建议扩展缓存策略或优化API调用',
				priority: 3,
				evidence: `平均响应时间 ${this.stats.avgResponseTime.toFixed(0)}ms`
			});
		}

		// 5. 检查修改率
		const modifyRate = this.stats.totalCompletions > 0
			? this.stats.modifiedCount / this.stats.totalCompletions
			: 0;
		if (modifyRate > 0.3 && this.stats.totalCompletions > 50) {
			suggestions.push({
				type: 'validation',
				description: '较多补全需要修改后使用，建议加强验证器规则',
				priority: 3,
				evidence: `修改率 ${(modifyRate * 100).toFixed(1)}%`
			});
		}

		// 6. 分析最近的拒绝模式
		const recentRejections = this.feedbackHistory
			.filter(f => f.type === 'rejected')
			.slice(-20);

		if (recentRejections.length >= 10) {
			// 检查是否有共同模式
			const classPatterns = new Map<string, number>();
			for (const fb of recentRejections) {
				if (fb.context.currentClass) {
					classPatterns.set(
						fb.context.currentClass,
						(classPatterns.get(fb.context.currentClass) || 0) + 1
					);
				}
			}

			for (const [className, count] of classPatterns.entries()) {
				if (count >= 5) {
					suggestions.push({
						type: 'context',
						description: `类 ${className} 的补全频繁被拒绝，可能需要更好的类型信息`,
						priority: 3,
						evidence: `最近 20 次拒绝中 ${count} 次涉及该类`
					});
				}
			}
		}

		// 按优先级排序
		suggestions.sort((a, b) => b.priority - a.priority);

		return suggestions;
	}

	/**
	 * 分析拒绝原因模式
	 */
	analyzeRejectionPatterns(): { pattern: string; count: number; percentage: number }[] {
		const recentRejections = this.feedbackHistory
			.filter(f => f.type === 'rejected')
			.slice(-100);

		if (recentRejections.length === 0) {
			return [];
		}

		const patterns = new Map<string, number>();

		for (const fb of recentRejections) {
			// 分析可能的拒绝原因
			const completion = fb.originalCompletion;

			// 1. 过长
			if (completion.split('\n').length > 10) {
				patterns.set('补全过长', (patterns.get('补全过长') || 0) + 1);
			}

			// 2. 语法问题
			if (!this.checkBracketBalance(completion)) {
				patterns.set('括号不匹配', (patterns.get('括号不匹配') || 0) + 1);
			}

			// 3. 包含解释文本
			if (/^(\/\/|#|--|\/\*)/.test(completion.trim())) {
				patterns.set('包含注释', (patterns.get('包含注释') || 0) + 1);
			}

			// 4. 无代码特征
			if (!/[{}\[\]();]/.test(completion)) {
				patterns.set('缺少代码特征', (patterns.get('缺少代码特征') || 0) + 1);
			}
		}

		const result: { pattern: string; count: number; percentage: number }[] = [];
		for (const [pattern, count] of patterns.entries()) {
			result.push({
				pattern,
				count,
				percentage: count / recentRejections.length
			});
		}

		result.sort((a, b) => b.count - a.count);
		return result;
	}

	/**
	 * 导出反馈数据（用于离线分析）
	 */
	exportFeedbackData(): string {
		return JSON.stringify({
			stats: {
				...this.stats,
				byLanguage: Object.fromEntries(this.stats.byLanguage),
				byFramework: Object.fromEntries(this.stats.byFramework)
			},
			recentFeedback: this.feedbackHistory.slice(-200)
		}, null, 2);
	}

	/**
	 * 重置统计信息
	 */
	resetStats(): void {
		this.stats = {
			totalCompletions: 0,
			acceptedCount: 0,
			rejectedCount: 0,
			modifiedCount: 0,
			ignoredCount: 0,
			acceptanceRate: 0,
			avgResponseTime: 0,
			byLanguage: new Map(),
			byFramework: new Map()
		};
		this.feedbackHistory = [];
		this.responseTimes = [];
		this.saveStats();
	}

	// ========== 私有方法 ==========

	private recordFeedback(feedback: Omit<CompletionFeedback, 'id' | 'timestamp'>): void {
		const fullFeedback: CompletionFeedback = {
			...feedback,
			id: this.generateId(),
			timestamp: Date.now()
		};

		// 添加到历史
		this.feedbackHistory.push(fullFeedback);
		if (this.feedbackHistory.length > this.maxHistorySize) {
			this.feedbackHistory.shift();
		}

		// 更新统计
		this.updateStats(fullFeedback);

		// 发射事件
		this._onFeedbackReceived.fire(fullFeedback);

		// 定期保存
		if (this.feedbackHistory.length % 10 === 0) {
			this.saveStats();
		}
	}

	private updateStats(feedback: CompletionFeedback): void {
		this.stats.totalCompletions++;

		switch (feedback.type) {
			case 'accepted':
				this.stats.acceptedCount++;
				break;
			case 'rejected':
				this.stats.rejectedCount++;
				break;
			case 'modified':
				this.stats.modifiedCount++;
				break;
			case 'ignored':
				this.stats.ignoredCount++;
				break;
		}

		// 更新接受率
		this.stats.acceptanceRate = this.stats.totalCompletions > 0
			? (this.stats.acceptedCount + this.stats.modifiedCount) / this.stats.totalCompletions
			: 0;

		// 更新响应时间
		if (feedback.responseTime !== undefined) {
			this.responseTimes.push(feedback.responseTime);
			if (this.responseTimes.length > 100) {
				this.responseTimes.shift();
			}
			this.stats.avgResponseTime = this.responseTimes.reduce((a, b) => a + b, 0) / this.responseTimes.length;
		}

		// 更新语言统计
		const langStats = this.stats.byLanguage.get(feedback.context.languageId) || {
			total: 0, accepted: 0, acceptanceRate: 0
		};
		langStats.total++;
		if (feedback.type === 'accepted' || feedback.type === 'modified') {
			langStats.accepted++;
		}
		langStats.acceptanceRate = langStats.total > 0 ? langStats.accepted / langStats.total : 0;
		this.stats.byLanguage.set(feedback.context.languageId, langStats);

		// 更新框架统计
		if (feedback.context.framework) {
			const fwStats = this.stats.byFramework.get(feedback.context.framework) || {
				total: 0, accepted: 0, acceptanceRate: 0
			};
			fwStats.total++;
			if (feedback.type === 'accepted' || feedback.type === 'modified') {
				fwStats.accepted++;
			}
			fwStats.acceptanceRate = fwStats.total > 0 ? fwStats.accepted / fwStats.total : 0;
			this.stats.byFramework.set(feedback.context.framework, fwStats);
		}

		// 发射统计更新事件
		this._onStatsUpdated.fire(this.stats);
	}

	private generateId(): string {
		return `fb_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
	}

	private checkBracketBalance(code: string): boolean {
		const brackets: Record<string, string> = { '(': ')', '{': '}', '[': ']' };
		const stack: string[] = [];

		for (const char of code) {
			if (char in brackets) {
				stack.push(brackets[char]);
			} else if (Object.values(brackets).includes(char)) {
				if (stack.pop() !== char) {
					return false;
				}
			}
		}

		return stack.length === 0;
	}

	private saveStats(): void {
		try {
			if (typeof localStorage !== 'undefined') {
				const data = {
					...this.stats,
					byLanguage: Object.fromEntries(this.stats.byLanguage),
					byFramework: Object.fromEntries(this.stats.byFramework)
				};
				localStorage.setItem(this.storageKey, JSON.stringify(data));
			}
		} catch (e) {
			// 存储失败，忽略
		}
	}

	private loadStats(): void {
		try {
			if (typeof localStorage !== 'undefined') {
				const raw = localStorage.getItem(this.storageKey);
				if (raw) {
					const data = JSON.parse(raw);
					this.stats = {
						...data,
						byLanguage: new Map(Object.entries(data.byLanguage || {})),
						byFramework: new Map(Object.entries(data.byFramework || {}))
					};
				}
			}
		} catch (e) {
			// 加载失败，使用默认值
		}
	}

	dispose(): void {
		this.saveStats();
		this._onFeedbackReceived.dispose();
		this._onStatsUpdated.dispose();
	}
}

// 单例导出
export const completionFeedbackService = new CompletionFeedbackService();
