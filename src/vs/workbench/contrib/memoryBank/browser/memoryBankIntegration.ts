/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IMemoryBankService, MemoryCategory } from '../../../services/memoryBank/common/memoryBank.js';
import { IAIService } from '../../../../platform/ai/common/ai.js';
import { URI } from '../../../../base/common/uri.js';

/**
 * Memory Bank 与 AI 服务集成
 * 演示如何在 AI 代码生成中使用项目记忆
 */
export class MemoryBankAIIntegration {

	constructor(
		private readonly memoryBankService: IMemoryBankService,
		private readonly aiService: IAIService
	) { }

	/**
	 * 生成上下文增强的代码
	 *
	 * @param workspaceUri 工作区 URI
	 * @param requirement 用户需求
	 * @param codeType 代码类型（controller, service, model 等）
	 * @returns 生成的代码
	 */
	async generateContextAwareCode(
		workspaceUri: URI,
		requirement: string,
		codeType: 'controller' | 'service' | 'model' | 'component'
	): Promise<string> {
		// 1. 确定需要的记忆类别
		const relevantCategories = this.getRelevantCategories(codeType);

		// 2. 获取相关记忆
		const memories = await this.getRelevantMemories(workspaceUri, relevantCategories);

		// 3. 构建上下文增强的 prompt
		const prompt = this.buildEnhancedPrompt(requirement, memories, codeType);

		// 4. 调用 AI 生成代码
		const generatedCode = await this.aiService.complete(prompt, {
			temperature: 0.2,
			maxTokens: 2000
		});

		return this.extractCode(generatedCode);
	}

	/**
	 * 流式生成上下文增强的代码
	 */
	async generateContextAwareCodeStream(
		workspaceUri: URI,
		requirement: string,
		codeType: 'controller' | 'service' | 'model' | 'component',
		onChunk: (chunk: string) => void,
		abortSignal?: AbortSignal
	): Promise<void> {
		const relevantCategories = this.getRelevantCategories(codeType);
		const memories = await this.getRelevantMemories(workspaceUri, relevantCategories);
		const prompt = this.buildEnhancedPrompt(requirement, memories, codeType);

		await this.aiService.completeStream(
			prompt,
			({ content, isComplete }) => {
				onChunk(content);
			},
			abortSignal
		);
	}

	/**
	 * 根据代码类型确定相关的记忆类别
	 */
	private getRelevantCategories(codeType: string): MemoryCategory[] {
		const categoryMap: Record<string, MemoryCategory[]> = {
			controller: ['architecture', 'coding-style', 'common-patterns', 'best-practices'],
			service: ['architecture', 'coding-style', 'common-patterns', 'dependencies'],
			model: ['coding-style', 'best-practices'],
			component: ['architecture', 'coding-style', 'common-patterns']
		};

		return categoryMap[codeType] || ['coding-style', 'common-patterns'];
	}

	/**
	 * 获取相关记忆
	 */
	private async getRelevantMemories(
		workspaceUri: URI,
		categories: MemoryCategory[]
	): Promise<Array<{ category: string; title: string; content: string }>> {
		const memories: Array<{ category: string; title: string; content: string }> = [];

		for (const category of categories) {
			const categoryMemories = await this.memoryBankService.getEntriesByCategory(workspaceUri, category);

			for (const memory of categoryMemories) {
				memories.push({
					category,
					title: memory.title,
					content: memory.content.substring(0, 500) // 限制长度
				});
			}
		}

		return memories;
	}

	/**
	 * 构建增强的 prompt
	 */
	private buildEnhancedPrompt(
		requirement: string,
		memories: Array<{ category: string; title: string; content: string }>,
		codeType: string
	): string {
		let prompt = '你是一个专业的代码生成助手。请根据以下项目上下文和用户需求生成代码。\n\n';

		// 添加项目上下文
		if (memories.length > 0) {
			prompt += '【项目上下文】\n\n';

			const categorizedMemories = this.categorizeMemories(memories);

			for (const [category, items] of Object.entries(categorizedMemories)) {
				prompt += `## ${this.getCategoryDisplayName(category)}\n\n`;

				for (const item of items) {
					prompt += `### ${item.title}\n${item.content}\n\n`;
				}
			}
		}

		// 添加用户需求
		prompt += '【用户需求】\n\n';
		prompt += requirement + '\n\n';

		// 添加生成要求
		prompt += this.getGenerationRequirements(codeType);

		return prompt;
	}

	/**
	 * 按类别组织记忆
	 */
	private categorizeMemories(
		memories: Array<{ category: string; title: string; content: string }>
	): Record<string, Array<{ title: string; content: string }>> {
		const categorized: Record<string, Array<{ title: string; content: string }>> = {};

		for (const memory of memories) {
			if (!categorized[memory.category]) {
				categorized[memory.category] = [];
			}
			categorized[memory.category].push({
				title: memory.title,
				content: memory.content
			});
		}

		return categorized;
	}

	/**
	 * 获取类别显示名称
	 */
	private getCategoryDisplayName(category: string): string {
		const names: Record<string, string> = {
			'architecture': '架构设计',
			'coding-style': '编码规范',
			'project-structure': '项目结构',
			'dependencies': '依赖关系',
			'best-practices': '最佳实践',
			'common-patterns': '常用模式',
			'custom': '自定义'
		};
		return names[category] || category;
	}

	/**
	 * 获取代码生成要求
	 */
	private getGenerationRequirements(codeType: string): string {
		const requirements: Record<string, string> = {
			controller: `
【生成要求】
1. 遵循项目的架构设计和编码规范
2. 使用项目中常用的设计模式
3. 包含必要的注释（使用项目的注释风格）
4. 实现完整的 CRUD 操作
5. 包含适当的错误处理
6. 遵循 RESTful API 设计规范
7. 【重要】只返回代码，不要返回任何解释
8. 【重要】不要包含 markdown 代码块标记
`,
			service: `
【生成要求】
1. 遵循项目的编码规范和设计模式
2. 实现清晰的业务逻辑
3. 包含必要的事务处理
4. 添加适当的日志记录
5. 实现错误处理和异常转换
6. 遵循依赖注入原则
7. 【重要】只返回代码，不要返回任何解释
8. 【重要】不要包含 markdown 代码块标记
`,
			model: `
【生成要求】
1. 遵循项目的编码规范
2. 使用适当的数据类型
3. 添加必要的验证注解
4. 包含清晰的字段注释
5. 实现必要的 getter/setter（如果需要）
6. 【重要】只返回代码，不要返回任何解释
7. 【重要】不要包含 markdown 代码块标记
`,
			component: `
【生成要求】
1. 遵循项目的组件设计规范
2. 使用项目的状态管理模式
3. 实现清晰的 props 定义
4. 包含必要的类型定义
5. 遵循项目的样式规范
6. 【重要】只返回代码，不要返回任何解释
7. 【重要】不要包含 markdown 代码块标记
`
		};

		return requirements[codeType] || `
【生成要求】
1. 遵循项目的编码规范
2. 代码清晰、易读
3. 包含必要的注释
4. 【重要】只返回代码，不要返回任何解释
5. 【重要】不要包含 markdown 代码块标记
`;
	}

	/**
	 * 提取生成的代码
	 */
	private extractCode(response: string): string {
		let code = response.trim();

		// 移除 markdown 代码块
		const codeBlockMatch = code.match(/```(?:\w+)?\s*\n([\s\S]*?)```/);
		if (codeBlockMatch) {
			code = codeBlockMatch[1].trim();
		}

		code = code.replace(/```/g, '').trim();

		return code;
	}

	/**
	 * 智能代码补全（使用记忆增强）
	 */
	async smartCodeCompletion(
		workspaceUri: URI,
		currentCode: string,
		cursorPosition: { line: number; character: number }
	): Promise<string> {
		// 1. 分析当前上下文
		const context = this.analyzeCodeContext(currentCode, cursorPosition);

		// 2. 根据上下文搜索相关记忆
		const relevantMemories = await this.memoryBankService.searchByTags(
			workspaceUri,
			context.keywords
		);

		// 3. 构建补全 prompt
		let prompt = '你是一个代码补全助手。请根据以下上下文完成代码。\n\n';

		if (relevantMemories.length > 0) {
			prompt += '【相关项目规范】\n\n';
			for (const memory of relevantMemories.slice(0, 2)) {
				prompt += `${memory.title}:\n${memory.content.substring(0, 300)}\n\n`;
			}
		}

		prompt += '【当前代码】\n```\n' + currentCode + '\n```\n\n';
		prompt += '【补全位置】\n第 ' + cursorPosition.line + ' 行，第 ' + cursorPosition.character + ' 列\n\n';
		prompt += '请补全代码（只返回需要插入的代码片段）：';

		// 4. 调用 AI 补全
		const completion = await this.aiService.complete(prompt, {
			temperature: 0.1,
			maxTokens: 500
		});

		return this.extractCode(completion);
	}

	/**
	 * 分析代码上下文
	 */
	private analyzeCodeContext(code: string, cursorPosition: { line: number; character: number }): {
		keywords: string[];
		type: string;
	} {
		const lines = code.split('\n');
		const currentLine = lines[cursorPosition.line] || '';

		const keywords: string[] = [];

		// 提取关键词
		if (currentLine.includes('class')) keywords.push('class');
		if (currentLine.includes('function') || currentLine.includes('method')) keywords.push('method');
		if (currentLine.includes('import')) keywords.push('import');
		if (currentLine.includes('@')) keywords.push('annotation');

		// 分析前几行找到更多上下文
		const contextLines = lines.slice(Math.max(0, cursorPosition.line - 5), cursorPosition.line);
		for (const line of contextLines) {
			if (line.includes('Controller')) keywords.push('controller');
			if (line.includes('Service')) keywords.push('service');
			if (line.includes('Repository')) keywords.push('repository');
			if (line.includes('Component')) keywords.push('component');
		}

		return {
			keywords,
			type: this.inferCodeType(keywords)
		};
	}

	/**
	 * 推断代码类型
	 */
	private inferCodeType(keywords: string[]): string {
		if (keywords.includes('controller')) return 'controller';
		if (keywords.includes('service')) return 'service';
		if (keywords.includes('repository')) return 'repository';
		if (keywords.includes('component')) return 'component';
		return 'general';
	}

	/**
	 * 代码审查（基于项目记忆）
	 */
	async reviewCode(workspaceUri: URI, code: string): Promise<{
		issues: Array<{ severity: 'error' | 'warning' | 'info'; message: string; line?: number }>;
		suggestions: string[];
	}> {
		// 1. 获取编码规范和最佳实践
		const codingStyleMemories = await this.memoryBankService.getEntriesByCategory(workspaceUri, 'coding-style');
		const bestPracticesMemories = await this.memoryBankService.getEntriesByCategory(workspaceUri, 'best-practices');

		// 2. 构建审查 prompt
		let prompt = '你是一个代码审查专家。请根据以下项目规范审查代码。\n\n';

		if (codingStyleMemories.length > 0) {
			prompt += '【编码规范】\n\n';
			for (const memory of codingStyleMemories) {
				prompt += `${memory.title}:\n${memory.content.substring(0, 400)}\n\n`;
			}
		}

		if (bestPracticesMemories.length > 0) {
			prompt += '【最佳实践】\n\n';
			for (const memory of bestPracticesMemories) {
				prompt += `${memory.title}:\n${memory.content.substring(0, 400)}\n\n`;
			}
		}

		prompt += '【待审查代码】\n```\n' + code + '\n```\n\n';
		prompt += `请审查以上代码，输出以下格式的 JSON：
{
  "issues": [
    { "severity": "error|warning|info", "message": "问题描述", "line": 行号 }
  ],
  "suggestions": ["改进建议1", "改进建议2"]
}`;

		// 3. 调用 AI 审查
		const reviewResult = await this.aiService.complete(prompt);

		// 4. 解析结果
		try {
			const jsonMatch = reviewResult.match(/\{[\s\S]*\}/);
			if (jsonMatch) {
				return JSON.parse(jsonMatch[0]);
			}
		} catch (error) {
			console.error('Failed to parse review result:', error);
		}

		return {
			issues: [],
			suggestions: []
		};
	}
}

/**
 * 使用示例
 */
export class MemoryBankUsageExample {

	constructor(
		private readonly integration: MemoryBankAIIntegration
	) { }

	/**
	 * 示例1：生成 Controller
	 */
	async example1_generateController(workspaceUri: URI): Promise<void> {
		const code = await this.integration.generateContextAwareCode(
			workspaceUri,
			'创建一个用户管理的 Controller，包含 CRUD 操作',
			'controller'
		);

		console.log('生成的 Controller 代码：');
		console.log(code);
	}

	/**
	 * 示例2：流式生成 Service
	 */
	async example2_generateServiceStream(workspaceUri: URI): Promise<void> {
		await this.integration.generateContextAwareCodeStream(
			workspaceUri,
			'创建一个用户服务，包含注册、登录、修改密码功能',
			'service',
			(chunk) => {
				// 实时输出生成的代码
				process.stdout.write(chunk);
			}
		);
	}

	/**
	 * 示例3：智能代码补全
	 */
	async example3_smartCompletion(workspaceUri: URI): Promise<void> {
		const currentCode = `
public class UserService {
    @Autowired
    private UserRepository userRepository;

    public User findById(Long id) {
        // 光标在这里，需要补全
`;

		const completion = await this.integration.smartCodeCompletion(
			workspaceUri,
			currentCode,
			{ line: 5, character: 0 }
		);

		console.log('智能补全：');
		console.log(completion);
	}

	/**
	 * 示例4：代码审查
	 */
	async example4_codeReview(workspaceUri: URI): Promise<void> {
		const codeToReview = `
public class UserController {
    @Autowired
    private UserService userService;

    @GetMapping("/users/{id}")
    public User getUser(@PathVariable Long id) {
        return userService.findById(id);
    }
}
`;

		const review = await this.integration.reviewCode(workspaceUri, codeToReview);

		console.log('代码审查结果：');
		console.log('问题：', review.issues);
		console.log('建议：', review.suggestions);
	}
}
