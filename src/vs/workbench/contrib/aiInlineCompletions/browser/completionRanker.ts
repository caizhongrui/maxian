/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CompletionContext, FrameworkContext } from './completionContextExtractor.js';

/**
 * 补全候选项评分结果
 */
export interface RankedCompletion {
	/** 补全文本 */
	text: string;
	/** 综合评分 (0-100) */
	score: number;
	/** 各维度评分明细 */
	scores: {
		/** 上下文相关性 (0-100) */
		relevance: number;
		/** 用户习惯匹配度 (0-100) */
		habitMatch: number;
		/** 框架约定遵循度 (0-100) */
		frameworkCompliance: number;
		/** 代码质量评分 (0-100) */
		codeQuality: number;
	};
	/** 排名原因说明 */
	reason: string;
}

/**
 * 用户编码习惯统计
 */
export interface UserHabitStats {
	/** 常用的方法名模式 */
	frequentMethodPatterns: Map<string, number>;
	/** 常用的变量命名风格 */
	namingStyle: 'camelCase' | 'snake_case' | 'PascalCase' | 'mixed';
	/** 偏好的代码风格 */
	codeStyle: {
		/** 偏好简洁还是详细 */
		verbosity: 'concise' | 'verbose' | 'balanced';
		/** 是否使用函数式风格 */
		functional: boolean;
		/** 是否使用链式调用 */
		chainedCalls: boolean;
	};
	/** 最近接受的补全模式 */
	recentAcceptedPatterns: string[];
}

/**
 * 补全排序器
 * 使用多维度评分对补全候选进行智能排序
 */
export class CompletionRanker {

	// 评分权重配置
	private readonly weights = {
		relevance: 0.35,      // 上下文相关性权重
		habitMatch: 0.25,     // 用户习惯权重
		frameworkCompliance: 0.25, // 框架遵循权重
		codeQuality: 0.15     // 代码质量权重
	};

	// 用户习惯统计（运行时收集）
	private userHabits: UserHabitStats = {
		frequentMethodPatterns: new Map(),
		namingStyle: 'camelCase',
		codeStyle: {
			verbosity: 'balanced',
			functional: false,
			chainedCalls: false
		},
		recentAcceptedPatterns: []
	};

	// 框架规则库
	private frameworkRules: Map<string, FrameworkRule[]> = new Map();

	constructor() {
		this.initFrameworkRules();
	}

	/**
	 * 对补全候选进行排序
	 */
	rank(
		completions: string[],
		context: CompletionContext,
		validationScores?: Map<string, number>
	): RankedCompletion[] {
		const ranked: RankedCompletion[] = [];

		for (const completion of completions) {
			const scores = {
				relevance: this.scoreRelevance(completion, context),
				habitMatch: this.scoreHabitMatch(completion),
				frameworkCompliance: this.scoreFrameworkCompliance(completion, context.frameworkContext),
				codeQuality: this.scoreCodeQuality(completion, validationScores?.get(completion))
			};

			// 计算综合评分
			const score = Math.round(
				scores.relevance * this.weights.relevance +
				scores.habitMatch * this.weights.habitMatch +
				scores.frameworkCompliance * this.weights.frameworkCompliance +
				scores.codeQuality * this.weights.codeQuality
			);

			// 生成排名原因
			const reason = this.generateReason(scores);

			ranked.push({
				text: completion,
				score,
				scores,
				reason
			});
		}

		// 按分数降序排序
		ranked.sort((a, b) => b.score - a.score);

		// 去重（相似度>80%的补全只保留分数最高的）
		return this.deduplicateSimilar(ranked);
	}

	/**
	 * 记录用户接受的补全（用于习惯学习）
	 */
	recordAcceptedCompletion(completion: string): void {
		// 添加到最近接受列表
		this.userHabits.recentAcceptedPatterns.unshift(completion);
		if (this.userHabits.recentAcceptedPatterns.length > 100) {
			this.userHabits.recentAcceptedPatterns.pop();
		}

		// 提取方法模式
		const methodPatterns = completion.match(/\b\w+\(/g) || [];
		for (const pattern of methodPatterns) {
			const count = this.userHabits.frequentMethodPatterns.get(pattern) || 0;
			this.userHabits.frequentMethodPatterns.set(pattern, count + 1);
		}

		// 分析命名风格
		this.updateNamingStyle(completion);

		// 分析代码风格
		this.updateCodeStyle(completion);
	}

	/**
	 * 获取当前用户习惯统计
	 */
	getUserHabits(): UserHabitStats {
		return { ...this.userHabits };
	}

	// ========== 评分方法 ==========

	/**
	 * 上下文相关性评分
	 */
	private scoreRelevance(completion: string, context: CompletionContext): number {
		let score = 50; // 基础分

		// 1. 检查是否使用了上下文中的变量
		if (context.variableTypes) {
			for (const varName of context.variableTypes.keys()) {
				if (completion.includes(varName)) {
					score += 10;
				}
			}
		}

		// 2. 检查是否使用了方法参数
		if (context.methodParams) {
			for (const param of context.methodParams) {
				const paramName = param.match(/\s+(\w+)$/)?.[1];
				if (paramName && completion.includes(paramName)) {
					score += 8;
				}
			}
		}

		// 3. 检查是否匹配类型定义中的方法
		if (context.typeDefinitions) {
			for (const typeDef of context.typeDefinitions) {
				for (const method of typeDef.methods) {
					if (completion.includes(method + '(')) {
						score += 15;
					}
				}
			}
		}

		// 4. 检查是否与当前方法名相关
		if (context.currentMethod) {
			if (completion.toLowerCase().includes(context.currentMethod.toLowerCase())) {
				score += 5;
			}
		}

		// 5. 检查与前缀的连贯性
		if (context.prefix) {
			const lastWord = context.prefix.match(/\w+$/)?.[0];
			if (lastWord && completion.toLowerCase().startsWith(lastWord.toLowerCase())) {
				score += 10;
			}
		}

		return Math.min(100, Math.max(0, score));
	}

	/**
	 * 用户习惯匹配评分
	 */
	private scoreHabitMatch(completion: string): number {
		let score = 50; // 基础分

		// 1. 检查是否包含常用方法模式
		const methodPatterns = completion.match(/\b\w+\(/g) || [];
		for (const pattern of methodPatterns) {
			const freq = this.userHabits.frequentMethodPatterns.get(pattern) || 0;
			if (freq > 5) {
				score += 15;
			} else if (freq > 2) {
				score += 8;
			} else if (freq > 0) {
				score += 3;
			}
		}

		// 2. 检查命名风格匹配
		const namingScore = this.checkNamingStyleMatch(completion);
		score += namingScore;

		// 3. 检查代码风格匹配
		const styleScore = this.checkCodeStyleMatch(completion);
		score += styleScore;

		// 4. 检查与最近接受模式的相似度
		for (const recent of this.userHabits.recentAcceptedPatterns.slice(0, 10)) {
			const similarity = this.calculateSimilarity(completion, recent);
			if (similarity > 0.7) {
				score += 10;
				break;
			}
		}

		return Math.min(100, Math.max(0, score));
	}

	/**
	 * 框架遵循度评分
	 */
	private scoreFrameworkCompliance(completion: string, frameworkContext?: FrameworkContext): number {
		if (!frameworkContext) {
			return 70; // 无框架上下文时给予中等分数
		}

		let score = 50;
		const rules = this.frameworkRules.get(frameworkContext.name) || [];

		for (const rule of rules) {
			if (rule.contextType && frameworkContext.contextType !== rule.contextType) {
				continue;
			}

			if (rule.check(completion)) {
				score += rule.bonus;
			}

			if (rule.antiPattern && rule.antiPattern.test(completion)) {
				score -= rule.penalty;
			}
		}

		return Math.min(100, Math.max(0, score));
	}

	/**
	 * 代码质量评分
	 */
	private scoreCodeQuality(completion: string, validationScore?: number): number {
		let score = validationScore !== undefined ? validationScore * 100 : 70;

		// 1. 代码长度适中加分
		const lines = completion.split('\n').length;
		if (lines >= 1 && lines <= 10) {
			score += 10;
		} else if (lines > 20) {
			score -= 10;
		}

		// 2. 无明显语法问题加分
		const bracketBalance = this.checkBracketBalance(completion);
		if (bracketBalance) {
			score += 5;
		} else {
			score -= 15;
		}

		// 3. 无过长行加分
		const hasLongLines = completion.split('\n').some(line => line.length > 120);
		if (!hasLongLines) {
			score += 5;
		}

		// 4. 避免魔法数字
		const hasMagicNumbers = /\b\d{3,}\b/.test(completion) && !/\b\d+L?\b/.test(completion);
		if (!hasMagicNumbers) {
			score += 5;
		}

		return Math.min(100, Math.max(0, score));
	}

	// ========== 辅助方法 ==========

	private checkNamingStyleMatch(completion: string): number {
		const identifiers = completion.match(/\b[a-z][a-zA-Z0-9_]*\b/g) || [];
		if (identifiers.length === 0) {
			return 0;
		}

		let matchCount = 0;
		for (const id of identifiers) {
			const style = this.detectNamingStyle(id);
			if (style === this.userHabits.namingStyle) {
				matchCount++;
			}
		}

		return Math.round((matchCount / identifiers.length) * 15);
	}

	private checkCodeStyleMatch(completion: string): number {
		let score = 0;

		// 检查链式调用偏好
		const hasChainedCalls = /\.\w+\([^)]*\)\.\w+\(/.test(completion);
		if (hasChainedCalls === this.userHabits.codeStyle.chainedCalls) {
			score += 5;
		}

		// 检查函数式风格偏好
		const hasFunctionalStyle = /\.map\(|\.filter\(|\.reduce\(|\.forEach\(/.test(completion);
		if (hasFunctionalStyle === this.userHabits.codeStyle.functional) {
			score += 5;
		}

		return score;
	}

	private detectNamingStyle(identifier: string): 'camelCase' | 'snake_case' | 'PascalCase' | 'mixed' {
		if (/^[a-z]+(_[a-z]+)+$/.test(identifier)) {
			return 'snake_case';
		}
		if (/^[A-Z][a-zA-Z0-9]*$/.test(identifier)) {
			return 'PascalCase';
		}
		if (/^[a-z][a-zA-Z0-9]*$/.test(identifier) && /[A-Z]/.test(identifier)) {
			return 'camelCase';
		}
		return 'mixed';
	}

	private updateNamingStyle(completion: string): void {
		const identifiers = completion.match(/\b[a-z][a-zA-Z0-9_]+\b/g) || [];
		const styleCounts: Record<string, number> = {
			camelCase: 0,
			snake_case: 0,
			PascalCase: 0,
			mixed: 0
		};

		for (const id of identifiers) {
			const style = this.detectNamingStyle(id);
			styleCounts[style]++;
		}

		// 取最多的风格
		let maxStyle: 'camelCase' | 'snake_case' | 'PascalCase' | 'mixed' = 'camelCase';
		let maxCount = 0;
		for (const [style, count] of Object.entries(styleCounts)) {
			if (count > maxCount) {
				maxCount = count;
				maxStyle = style as typeof maxStyle;
			}
		}

		this.userHabits.namingStyle = maxStyle;
	}

	private updateCodeStyle(completion: string): void {
		// 检测链式调用
		if (/\.\w+\([^)]*\)\.\w+\(/.test(completion)) {
			this.userHabits.codeStyle.chainedCalls = true;
		}

		// 检测函数式风格
		if (/\.map\(|\.filter\(|\.reduce\(|\.stream\(/.test(completion)) {
			this.userHabits.codeStyle.functional = true;
		}

		// 检测详细程度
		const avgLineLength = completion.length / Math.max(1, completion.split('\n').length);
		if (avgLineLength > 80) {
			this.userHabits.codeStyle.verbosity = 'verbose';
		} else if (avgLineLength < 40) {
			this.userHabits.codeStyle.verbosity = 'concise';
		}
	}

	private calculateSimilarity(a: string, b: string): number {
		if (a === b) return 1;
		if (a.length === 0 || b.length === 0) return 0;

		// 简单的字符级相似度
		const setA = new Set(a.split(''));
		const setB = new Set(b.split(''));
		const intersection = new Set([...setA].filter(x => setB.has(x)));
		const union = new Set([...setA, ...setB]);

		return intersection.size / union.size;
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

	private generateReason(scores: RankedCompletion['scores']): string {
		const reasons: string[] = [];

		if (scores.relevance >= 80) {
			reasons.push('上下文高度相关');
		}
		if (scores.habitMatch >= 80) {
			reasons.push('符合编码习惯');
		}
		if (scores.frameworkCompliance >= 80) {
			reasons.push('遵循框架约定');
		}
		if (scores.codeQuality >= 80) {
			reasons.push('代码质量优秀');
		}

		return reasons.length > 0 ? reasons.join('，') : '综合评分';
	}

	private deduplicateSimilar(ranked: RankedCompletion[]): RankedCompletion[] {
		const result: RankedCompletion[] = [];

		for (const item of ranked) {
			const isDuplicate = result.some(existing =>
				this.calculateSimilarity(existing.text, item.text) > 0.8
			);

			if (!isDuplicate) {
				result.push(item);
			}
		}

		return result;
	}

	// ========== 框架规则初始化 ==========

	private initFrameworkRules(): void {
		// Spring 框架规则
		this.frameworkRules.set('Spring', [
			{
				name: 'autowired-injection',
				contextType: 'Controller',
				check: (code) => /@Autowired/.test(code) || /private final \w+ \w+;/.test(code),
				bonus: 15,
				penalty: 0
			},
			{
				name: 'service-transactional',
				contextType: 'Service',
				check: (code) => /@Transactional/.test(code),
				bonus: 10,
				penalty: 0
			},
			{
				name: 'no-field-injection',
				antiPattern: /@Autowired\s+private/,
				check: () => false,
				bonus: 0,
				penalty: 10
			},
			{
				name: 'proper-mapping',
				contextType: 'Controller',
				check: (code) => /@(Get|Post|Put|Delete|Patch)Mapping/.test(code),
				bonus: 10,
				penalty: 0
			}
		]);

		// Vue 框架规则
		this.frameworkRules.set('Vue', [
			{
				name: 'composition-api',
				check: (code) => /\b(ref|computed|watch|onMounted)\b/.test(code),
				bonus: 15,
				penalty: 0
			},
			{
				name: 'reactive-ref',
				check: (code) => /\.value\b/.test(code),
				bonus: 10,
				penalty: 0
			},
			{
				name: 'no-mutate-props',
				antiPattern: /props\.\w+\s*=/,
				check: () => false,
				bonus: 0,
				penalty: 20
			}
		]);

		// React 框架规则
		this.frameworkRules.set('React', [
			{
				name: 'hooks-usage',
				check: (code) => /\buse[A-Z]\w*\(/.test(code),
				bonus: 15,
				penalty: 0
			},
			{
				name: 'state-immutability',
				check: (code) => /setState\(\s*\(?\s*prev/.test(code) || /\[.*,\s*set\w+\]/.test(code),
				bonus: 10,
				penalty: 0
			},
			{
				name: 'no-direct-state-mutation',
				antiPattern: /this\.state\.\w+\s*=/,
				check: () => false,
				bonus: 0,
				penalty: 25
			}
		]);
	}
}

/**
 * 框架规则接口
 */
interface FrameworkRule {
	name: string;
	contextType?: string;
	check: (code: string) => boolean;
	antiPattern?: RegExp;
	bonus: number;
	penalty: number;
}

// 单例导出
export const completionRanker = new CompletionRanker();
