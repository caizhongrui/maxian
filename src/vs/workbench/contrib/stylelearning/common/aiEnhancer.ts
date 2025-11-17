/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CodeStyleProfile, EnhancedProfile, LearningProgress } from './styleTypes.js';
import { IAIService } from '../../../../platform/ai/common/ai.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';

/**
 * AI 增强器
 * 使用 AI 进行深度代码风格分析和最佳实践提取
 */
export class AIEnhancer {

	constructor(
		private readonly aiService: IAIService
	) { }

	/**
	 * 增强代码风格配置文件
	 */
	async enhanceProfile(
		profile: CodeStyleProfile,
		onProgress?: (progress: LearningProgress) => void,
		token?: CancellationToken
	): Promise<EnhancedProfile> {
		console.log('[AIEnhancer] Starting profile enhancement...');

		try {
			// 1. 分析最佳实践
			onProgress?.({
				status: 'enhancing',
				progress: 25,
				message: '正在识别最佳实践...',
				filesScanned: profile.fileCount,
				totalFiles: profile.fileCount
			});
			const bestPractices = await this.extractBestPractices(profile, token);

			// 2. 识别代码模式
			onProgress?.({
				status: 'enhancing',
				progress: 50,
				message: '正在识别代码模式...',
				filesScanned: profile.fileCount,
				totalFiles: profile.fileCount
			});
			const patterns = await this.extractPatterns(profile, token);

			// 3. 生成风格总结
			onProgress?.({
				status: 'enhancing',
				progress: 75,
				message: '正在生成风格总结...',
				filesScanned: profile.fileCount,
				totalFiles: profile.fileCount
			});
			const styleSummary = await this.generateStyleSummary(profile, bestPractices, patterns, token);

			console.log('[AIEnhancer] Enhancement completed');

			// 4. 构建增强后的配置文件
			const enhanced: EnhancedProfile = {
				...profile,
				bestPractices,
				patterns,
				styleSummary
			};

			return enhanced;
		} catch (error) {
			console.error('[AIEnhancer] Enhancement failed:', error);
			// 如果 AI 增强失败，返回基础配置
			return {
				...profile,
				bestPractices: [],
				patterns: [],
				styleSummary: '由于 AI 服务不可用，无法生成详细的风格总结。'
			};
		}
	}

	/**
	 * 提取最佳实践
	 */
	private async extractBestPractices(
		profile: CodeStyleProfile,
		token?: CancellationToken
	): Promise<string[]> {
		console.log('[AIEnhancer] Extracting best practices...');

		const prompt = this.buildBestPracticesPrompt(profile);

		try {
			const response = await this.aiService.complete(prompt);
			const practices = this.parseBestPractices(response);

			console.log('[AIEnhancer] Extracted', practices.length, 'best practices');
			return practices;
		} catch (error) {
			console.error('[AIEnhancer] Failed to extract best practices:', error);
			return this.getDefaultBestPractices(profile.primaryLanguage);
		}
	}

	/**
	 * 提取代码模式
	 */
	private async extractPatterns(
		profile: CodeStyleProfile,
		token?: CancellationToken
	): Promise<string[]> {
		console.log('[AIEnhancer] Extracting code patterns...');

		const prompt = this.buildPatternsPrompt(profile);

		try {
			const response = await this.aiService.complete(prompt);
			const patterns = this.parsePatterns(response);

			console.log('[AIEnhancer] Extracted', patterns.length, 'patterns');
			return patterns;
		} catch (error) {
			console.error('[AIEnhancer] Failed to extract patterns:', error);
			return this.getDefaultPatterns(profile.primaryLanguage);
		}
	}

	/**
	 * 生成风格总结
	 */
	private async generateStyleSummary(
		profile: CodeStyleProfile,
		bestPractices: string[],
		patterns: string[],
		token?: CancellationToken
	): Promise<string> {
		console.log('[AIEnhancer] Generating style summary...');

		const prompt = this.buildSummaryPrompt(profile, bestPractices, patterns);

		try {
			const summary = await this.aiService.complete(prompt);

			console.log('[AIEnhancer] Summary generated');
			return summary.trim();
		} catch (error) {
			console.error('[AIEnhancer] Failed to generate summary:', error);
			return this.getDefaultSummary(profile);
		}
	}

	// ==================== Prompt 构建方法 ====================

	/**
	 * 构建最佳实践提取 Prompt
	 */
	private buildBestPracticesPrompt(profile: CodeStyleProfile): string {
		return `你是一个资深的代码审查专家。请分析以下项目的代码风格配置，识别其中体现的编码最佳实践。

项目信息：
- 主要语言：${profile.primaryLanguage}
- 文件数量：${profile.fileCount}
- 代码行数：${profile.totalLines}
- 主要框架：${profile.frameworks.primaryFramework || '无'}

命名约定：
- 类名模式：${profile.naming.classPattern}
- 类名后缀：${profile.naming.classSuffix.join(', ')}
- 方法名模式：${profile.naming.methodPattern}
- 方法名前缀：${profile.naming.methodPrefix.join(', ')}
- 接口前缀：${profile.naming.interfacePrefix}

代码结构：
- 缩进方式：${profile.structure.indentation} (${profile.structure.indentSize} spaces)
- 大括号风格：${profile.structure.braceStyle}
- 引号风格：${profile.structure.quoteStyle}
- 使用分号：${profile.structure.useSemicolon ? '是' : '否'}
- 最大行长度：${profile.structure.maxLineLength}

注释风格：
- 类注释要求：${profile.comments.requireClassComment ? '必需' : '可选'}
- 方法注释要求：${profile.comments.requireMethodComment ? '必需' : '可选'}
- 注释语言：${profile.comments.commentLanguage}
- 包含作者信息：${profile.comments.includeAuthor ? '是' : '否'}

框架使用：
- 主要框架：${profile.frameworks.primaryFramework || '无'}
- 架构模式：${profile.frameworks.architecturePattern || '未识别'}
- 依赖注入：${profile.frameworks.dependencyInjection || '无'}

代码示例：
${this.formatCodeExamples(profile.examples.sampleMethods.slice(0, 2))}

请基于以上信息，列出该项目遵循的5-8条主要编码最佳实践。要求：
1. 每条实践用一句话概括，简洁明了
2. 重点关注代码质量、可维护性、团队协作方面
3. 结合具体的命名、结构、注释习惯
4. 用中文回答
5. 每行一条，使用 "- " 开头

示例格式：
- 采用统一的命名规范，提高代码可读性
- 遵循单一职责原则，类和方法职责明确
...

请直接输出最佳实践列表：`;
	}

	/**
	 * 构建代码模式提取 Prompt
	 */
	private buildPatternsPrompt(profile: CodeStyleProfile): string {
		return `你是一个代码架构专家。请分析以下项目的代码风格配置，识别其中的常见代码模式和设计模式。

项目信息：
- 主要语言：${profile.primaryLanguage}
- 主要框架：${profile.frameworks.primaryFramework || '无'}
- 架构模式：${profile.frameworks.architecturePattern || '未识别'}
- 常用库：${profile.frameworks.commonLibraries.join(', ')}

命名约定分析：
- 类名后缀模式：${profile.naming.classSuffix.join(', ')}
  ${this.analyzeClassSuffixes(profile.naming.classSuffix)}
- 方法名前缀模式：${profile.naming.methodPrefix.join(', ')}
  ${this.analyzeMethodPrefixes(profile.naming.methodPrefix)}

代码示例：
${this.formatCodeExamples(profile.examples.sampleClasses.slice(0, 2))}

请基于以上信息，识别该项目中使用的5-8个主要代码模式或设计模式。要求：
1. 每个模式用一句话描述
2. 关注设计模式、架构模式、编码惯例
3. 结合具体的命名和结构特征
4. 用中文回答
5. 每行一条，使用 "- " 开头

示例格式：
- Service层模式：业务逻辑封装在XxxService类中
- 工厂模式：使用XxxFactory进行对象创建
...

请直接输出代码模式列表：`;
	}

	/**
	 * 构建风格总结 Prompt
	 */
	private buildSummaryPrompt(
		profile: CodeStyleProfile,
		bestPractices: string[],
		patterns: string[]
	): string {
		return `你是一个技术文档撰写专家。请为以下项目的代码风格生成一份简洁的总结报告。

项目基本信息：
- 主要语言：${profile.primaryLanguage}
- 文件数量：${profile.fileCount}
- 代码行数：${profile.totalLines}
- 主要框架：${profile.frameworks.primaryFramework || '无'}
- 置信度：${(profile.confidence * 100).toFixed(0)}%

识别的最佳实践：
${bestPractices.map(p => `  ${p}`).join('\n')}

识别的代码模式：
${patterns.map(p => `  ${p}`).join('\n')}

核心风格特征：
- 命名：${profile.naming.classPattern}类名，${profile.naming.methodPattern}方法名
- 结构：${profile.structure.indentation}缩进，${profile.structure.braceStyle}大括号
- 注释：${profile.comments.commentLanguage === 'zh' ? '中文' : profile.comments.commentLanguage === 'en' ? '英文' : '中英文混合'}注释
- 架构：${profile.frameworks.architecturePattern || '标准分层架构'}

请生成一份3-5段的项目代码风格总结，要求：
1. 第一段：概述项目的整体代码风格特点
2. 第二段：详细说明命名和结构规范
3. 第三段：总结最佳实践和代码模式
4. 第四段（可选）：指出值得学习和保持的优点
5. 用中文撰写，专业且易懂
6. 每段2-4句话，简洁有力

请直接输出风格总结：`;
	}

	// ==================== 解析方法 ====================

	/**
	 * 解析最佳实践列表
	 */
	private parseBestPractices(response: string): string[] {
		const lines = response.split('\n');
		const practices: string[] = [];

		for (const line of lines) {
			const trimmed = line.trim();
			// 匹配 "- xxx" 或 "1. xxx" 格式
			const match = trimmed.match(/^(?:-|\d+\.)\s+(.+)$/);
			if (match && match[1]) {
				practices.push(match[1]);
			}
		}

		// 如果没有解析到任何实践，尝试按行分割
		if (practices.length === 0) {
			for (const line of lines) {
				const trimmed = line.trim();
				if (trimmed.length > 10 && !trimmed.startsWith('请') && !trimmed.startsWith('示例')) {
					practices.push(trimmed);
				}
			}
		}

		// 限制数量
		return practices.slice(0, 10);
	}

	/**
	 * 解析代码模式列表
	 */
	private parsePatterns(response: string): string[] {
		return this.parseBestPractices(response); // 使用相同的解析逻辑
	}

	// ==================== 分析辅助方法 ====================

	/**
	 * 分析类名后缀的含义
	 */
	private analyzeClassSuffixes(suffixes: string[]): string {
		const analysis: string[] = [];

		for (const suffix of suffixes) {
			switch (suffix.toLowerCase()) {
				case 'service':
					analysis.push('Service表示业务逻辑层');
					break;
				case 'controller':
					analysis.push('Controller表示控制器层');
					break;
				case 'repository':
				case 'dao':
					analysis.push('Repository/DAO表示数据访问层');
					break;
				case 'manager':
					analysis.push('Manager表示管理类');
					break;
				case 'handler':
					analysis.push('Handler表示处理器');
					break;
				case 'helper':
				case 'util':
					analysis.push('Helper/Util表示工具类');
					break;
				case 'factory':
					analysis.push('Factory表示工厂类');
					break;
				case 'builder':
					analysis.push('Builder表示构建器');
					break;
				case 'impl':
					analysis.push('Impl表示接口实现');
					break;
			}
		}

		return analysis.length > 0 ? '\n  ' + analysis.join(', ') : '';
	}

	/**
	 * 分析方法名前缀的含义
	 */
	private analyzeMethodPrefixes(prefixes: string[]): string {
		const analysis: string[] = [];

		for (const prefix of prefixes) {
			switch (prefix.toLowerCase()) {
				case 'get':
					analysis.push('get表示获取数据');
					break;
				case 'set':
					analysis.push('set表示设置数据');
					break;
				case 'is':
				case 'has':
					analysis.push('is/has表示布尔判断');
					break;
				case 'create':
					analysis.push('create表示创建操作');
					break;
				case 'update':
					analysis.push('update表示更新操作');
					break;
				case 'delete':
					analysis.push('delete表示删除操作');
					break;
				case 'find':
					analysis.push('find表示查询操作');
					break;
				case 'handle':
					analysis.push('handle表示处理操作');
					break;
				case 'process':
					analysis.push('process表示处理流程');
					break;
				case 'validate':
					analysis.push('validate表示验证操作');
					break;
			}
		}

		return analysis.length > 0 ? '\n  ' + analysis.join(', ') : '';
	}

	/**
	 * 格式化代码示例
	 */
	private formatCodeExamples(examples: string[]): string {
		if (examples.length === 0) {
			return '（无代码示例）';
		}

		return examples.slice(0, 2).map((example, index) => {
			// 限制长度，避免 prompt 过长
			const lines = example.split('\n').slice(0, 10);
			return `示例 ${index + 1}：\n\`\`\`\n${lines.join('\n')}\n\`\`\``;
		}).join('\n\n');
	}

	// ==================== 默认值方法 ====================

	/**
	 * 获取默认最佳实践（当 AI 调用失败时）
	 */
	private getDefaultBestPractices(language: string): string[] {
		const common = [
			'采用统一的命名规范，提高代码可读性',
			'合理使用注释，说明复杂逻辑的意图',
			'保持代码结构清晰，职责分明',
			'遵循语言和框架的惯用法'
		];

		const languageSpecific: { [key: string]: string[] } = {
			'java': [
				'使用驼峰命名法，类名首字母大写',
				'遵循面向对象设计原则',
				'合理使用设计模式'
			],
			'typescript': [
				'使用类型注解增强代码安全性',
				'遵循函数式编程风格',
				'利用 TypeScript 类型系统'
			],
			'javascript': [
				'使用现代 ES6+ 语法',
				'避免回调地狱，使用 Promise/async',
				'保持代码简洁明了'
			],
			'python': [
				'遵循 PEP 8 编码规范',
				'使用 Pythonic 的编码风格',
				'合理使用装饰器和生成器'
			]
		};

		return [...common, ...(languageSpecific[language] || [])];
	}

	/**
	 * 获取默认代码模式（当 AI 调用失败时）
	 */
	private getDefaultPatterns(language: string): string[] {
		const common = [
			'单一职责原则：每个类/函数只负责一个功能',
			'分层架构：代码按照功能分层组织',
			'依赖注入：通过构造函数注入依赖'
		];

		const languageSpecific: { [key: string]: string[] } = {
			'java': [
				'Service 层模式：业务逻辑封装在 Service 类中',
				'DAO 模式：数据访问封装在 DAO/Repository 中',
				'工厂模式：使用工厂类创建对象'
			],
			'typescript': [
				'接口优先：定义明确的接口契约',
				'装饰器模式：使用装饰器增强功能',
				'模块化设计：代码按模块组织'
			],
			'javascript': [
				'函数式编程：使用高阶函数和纯函数',
				'事件驱动：基于事件的异步处理',
				'模块化：使用 ES6 模块系统'
			],
			'python': [
				'Duck Typing：关注对象的行为而非类型',
				'装饰器模式：使用装饰器增强功能',
				'上下文管理器：使用 with 语句管理资源'
			]
		};

		return [...common, ...(languageSpecific[language] || [])];
	}

	/**
	 * 获取默认风格总结（当 AI 调用失败时）
	 */
	private getDefaultSummary(profile: CodeStyleProfile): string {
		return `该项目是一个${profile.primaryLanguage}项目，包含${profile.fileCount}个源文件，总计${profile.totalLines}行代码。

项目采用${profile.naming.classPattern}的类命名风格和${profile.naming.methodPattern}的方法命名风格，整体命名规范统一清晰。代码格式化方面，使用${profile.structure.indentation}缩进，${profile.structure.braceStyle}的大括号风格，代码结构整齐规范。

项目${profile.comments.requireClassComment ? '要求' : '不强制'}类注释，${profile.comments.requireMethodComment ? '要求' : '不强制'}方法注释，注释使用${profile.comments.commentLanguage === 'zh' ? '中文' : profile.comments.commentLanguage === 'en' ? '英文' : '中英文混合'}编写。${profile.frameworks.primaryFramework ? `使用${profile.frameworks.primaryFramework}作为主要开发框架。` : ''}

总体而言，该项目代码风格规范统一，体现了良好的工程实践和团队协作意识。`;
	}
}
