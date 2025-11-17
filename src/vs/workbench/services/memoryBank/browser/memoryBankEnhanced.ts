/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IMemoryBankService, MemoryEntry, MemoryCategory } from '../common/memoryBank.js';
import { URI } from '../../../../base/common/uri.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IProjectAnalyzerService } from '../../projectAnalyzer/common/projectAnalyzer.js';
import { IAIService } from '../../../../platform/ai/common/ai.js';

/**
 * Memory Bank 增强功能
 * 提供更高级的项目学习和记忆管理能力
 */
export class MemoryBankEnhancedFeatures {

	constructor(
		private readonly memoryBankService: IMemoryBankService,
		private readonly fileService: IFileService,
		private readonly projectAnalyzer: IProjectAnalyzerService,
		private readonly aiService: IAIService
	) { }

	/**
	 * 智能分析项目并生成完整的记忆库
	 * 这是一个一键式的项目学习功能
	 */
	async autoLearnProject(workspaceUri: URI): Promise<void> {
		console.log('[Memory Bank Enhanced] Starting auto-learn project...');

		// 1. 初始化 Memory Bank
		await this.memoryBankService.initialize(workspaceUri);

		// 2. 学习项目结构
		await this.memoryBankService.learnProjectStructure(workspaceUri);

		// 3. 分析技术栈
		await this.learnTechStack(workspaceUri);

		// 4. 提取常用模式
		await this.extractCommonPatterns(workspaceUri);

		// 5. 学习依赖关系
		await this.learnDependencies(workspaceUri);

		// 6. 提取最佳实践
		await this.extractBestPractices(workspaceUri);

		console.log('[Memory Bank Enhanced] Auto-learn completed!');
	}

	/**
	 * 学习项目技术栈
	 */
	private async learnTechStack(workspaceUri: URI): Promise<void> {
		const projectStructure = await this.projectAnalyzer.analyzeProject(workspaceUri);

		const techStackInfo = `# 技术栈分析

## 核心技术
- **项目类型**: ${projectStructure.type}
- **主要框架**: ${projectStructure.framework || '无'}
- **开发语言**: ${projectStructure.language}

## 依赖统计
- 总依赖数: ${projectStructure.dependencies.length}
- 运行时依赖: ${projectStructure.dependencies.filter(d => d.type === 'runtime').length}
- 开发依赖: ${projectStructure.dependencies.filter(d => d.type === 'dev').length}

## 关键依赖
${projectStructure.dependencies.slice(0, 15).map(d => `- **${d.name}**@${d.version} (${d.type})`).join('\n')}

## 架构特点
${this.inferArchitectureFeatures(projectStructure)}
`;

		await this.memoryBankService.addEntry(workspaceUri, {
			title: '技术栈分析',
			content: techStackInfo,
			category: 'architecture',
			tags: ['tech-stack', 'auto-generated', projectStructure.type]
		});
	}

	/**
	 * 推断架构特点
	 */
	private inferArchitectureFeatures(projectStructure: any): string {
		const features: string[] = [];

		// 根据项目类型推断
		switch (projectStructure.type) {
			case 'spring-boot':
				features.push('- 基于 Spring Boot 的微服务架构');
				features.push('- 使用依赖注入 (DI) 和控制反转 (IoC)');
				features.push('- RESTful API 设计');
				break;
			case 'react':
			case 'vue':
			case 'angular':
				features.push('- 单页应用 (SPA) 架构');
				features.push('- 组件化开发模式');
				features.push('- 前后端分离');
				break;
			case 'express':
				features.push('- Node.js 后端服务');
				features.push('- 中间件架构');
				features.push('- RESTful API');
				break;
		}

		// 根据依赖推断
		const depNames = projectStructure.dependencies.map((d: any) => d.name.toLowerCase());

		if (depNames.some((n: string) => n.includes('redis'))) {
			features.push('- 使用 Redis 缓存');
		}
		if (depNames.some((n: string) => n.includes('mysql') || n.includes('postgres'))) {
			features.push('- 使用关系型数据库');
		}
		if (depNames.some((n: string) => n.includes('mongo'))) {
			features.push('- 使用 MongoDB 文档数据库');
		}
		if (depNames.some((n: string) => n.includes('jwt'))) {
			features.push('- JWT 身份认证');
		}
		if (depNames.some((n: string) => n.includes('swagger') || n.includes('openapi'))) {
			features.push('- API 文档自动生成 (Swagger/OpenAPI)');
		}

		return features.length > 0 ? features.join('\n') : '- 标准架构模式';
	}

	/**
	 * 提取常用模式
	 */
	private async extractCommonPatterns(workspaceUri: URI): Promise<void> {
		// 查找示例文件
		const sampleFiles = await this.findCodeSamples(workspaceUri);

		if (sampleFiles.length === 0) {
			return;
		}

		// 读取示例代码
		const samples: string[] = [];
		for (const fileUri of sampleFiles.slice(0, 3)) {
			try {
				const content = await this.fileService.readFile(fileUri);
				samples.push(content.value.toString());
			} catch {
				// 跳过无法读取的文件
			}
		}

		if (samples.length === 0) {
			return;
		}

		// 使用 AI 分析常用模式
		const prompt = `分析以下代码示例，提取出项目中的常用设计模式和编码模式：

${samples.map((s, i) => `\n---示例 ${i + 1}---\n${s.substring(0, 800)}`).join('\n')}

请提取：
1. 设计模式（如单例、工厂、策略等）
2. 错误处理模式
3. 数据访问模式
4. API 设计模式
5. 其他重要的编码模式

用中文简洁总结，格式化为 Markdown。`;

		const patterns = await this.aiService.complete(prompt);

		await this.memoryBankService.addEntry(workspaceUri, {
			title: '常用设计模式',
			content: `# 项目中的常用模式\n\n${patterns}`,
			category: 'common-patterns',
			tags: ['patterns', 'auto-generated', 'design-patterns']
		});
	}

	/**
	 * 学习依赖关系
	 */
	private async learnDependencies(workspaceUri: URI): Promise<void> {
		const projectStructure = await this.projectAnalyzer.analyzeProject(workspaceUri);

		const dependencyGroups: Record<string, any[]> = {
			'核心框架': [],
			'数据库': [],
			'工具库': [],
			'测试': [],
			'其他': []
		};

		// 分类依赖
		for (const dep of projectStructure.dependencies) {
			const name = dep.name.toLowerCase();

			if (name.includes('spring') || name.includes('express') || name.includes('react') || name.includes('vue')) {
				dependencyGroups['核心框架'].push(dep);
			} else if (name.includes('mysql') || name.includes('mongo') || name.includes('redis') || name.includes('postgres')) {
				dependencyGroups['数据库'].push(dep);
			} else if (name.includes('test') || name.includes('junit') || name.includes('jest') || name.includes('mocha')) {
				dependencyGroups['测试'].push(dep);
			} else if (name.includes('lodash') || name.includes('axios') || name.includes('moment') || name.includes('dayjs')) {
				dependencyGroups['工具库'].push(dep);
			} else {
				dependencyGroups['其他'].push(dep);
			}
		}

		let content = '# 项目依赖分析\n\n';

		for (const [category, deps] of Object.entries(dependencyGroups)) {
			if (deps.length > 0) {
				content += `## ${category}\n\n`;
				for (const dep of deps) {
					content += `- **${dep.name}**@${dep.version}\n`;
					content += `  - 类型: ${dep.type === 'runtime' ? '运行时依赖' : '开发依赖'}\n`;
				}
				content += '\n';
			}
		}

		await this.memoryBankService.addEntry(workspaceUri, {
			title: '依赖关系分析',
			content,
			category: 'dependencies',
			tags: ['dependencies', 'auto-generated']
		});
	}

	/**
	 * 提取最佳实践
	 */
	private async extractBestPractices(workspaceUri: URI): Promise<void> {
		// 查找配置文件和规范文件
		const configFiles = await this.findConfigFiles(workspaceUri);

		let bestPractices = '# 项目最佳实践\n\n';

		// 检查是否有 ESLint/TSConfig 等
		const hasEslint = configFiles.some(f => f.includes('eslint'));
		const hasPrettier = configFiles.some(f => f.includes('prettier'));
		const hasTypeScript = configFiles.some(f => f.includes('tsconfig'));
		const hasEditorConfig = configFiles.some(f => f.includes('.editorconfig'));

		if (hasEslint) {
			bestPractices += '## 代码质量\n- 使用 ESLint 进行代码静态检查\n- 遵循统一的代码规范\n\n';
		}

		if (hasPrettier) {
			bestPractices += '## 代码格式化\n- 使用 Prettier 自动格式化代码\n- 确保代码风格一致性\n\n';
		}

		if (hasTypeScript) {
			bestPractices += '## 类型安全\n- 使用 TypeScript 提供类型安全\n- 减少运行时错误\n\n';
		}

		if (hasEditorConfig) {
			bestPractices += '## 编辑器配置\n- 使用 .editorconfig 统一编辑器设置\n- 确保跨编辑器的一致性\n\n';
		}

		// 添加通用最佳实践
		bestPractices += `## 开发规范

### 命名规范
- 使用清晰、有意义的变量名和函数名
- 遵循项目的命名约定

### 错误处理
- 适当使用 try-catch 捕获异常
- 提供有意义的错误信息

### 注释规范
- 为复杂逻辑添加注释
- 使用文档注释描述公共 API

### 测试规范
- 为关键功能编写单元测试
- 保持测试覆盖率
`;

		await this.memoryBankService.addEntry(workspaceUri, {
			title: '项目最佳实践',
			content: bestPractices,
			category: 'best-practices',
			tags: ['best-practices', 'auto-generated', 'guidelines']
		});
	}

	/**
	 * 查找代码示例文件
	 */
	private async findCodeSamples(workspaceUri: URI): Promise<URI[]> {
		const samples: URI[] = [];

		try {
			const srcDir = URI.joinPath(workspaceUri, 'src');
			await this.scanForSamples(srcDir, samples, 0);
		} catch {
			// src 不存在，尝试其他常见目录
			try {
				await this.scanForSamples(workspaceUri, samples, 0);
			} catch {
				// 忽略
			}
		}

		return samples;
	}

	/**
	 * 扫描目录查找示例文件
	 */
	private async scanForSamples(dirUri: URI, samples: URI[], depth: number): Promise<void> {
		if (depth > 4 || samples.length >= 5) {
			return;
		}

		try {
			const dir = await this.fileService.resolve(dirUri);

			if (dir.children) {
				for (const child of dir.children) {
					if (samples.length >= 5) break;

					if (child.isDirectory) {
						const skipDirs = ['node_modules', 'target', 'build', 'dist', '.git', 'test', 'tests'];
						if (!skipDirs.includes(child.name)) {
							await this.scanForSamples(child.resource, samples, depth + 1);
						}
					} else if (
						child.name.endsWith('.ts') ||
						child.name.endsWith('.js') ||
						child.name.endsWith('.java') ||
						child.name.endsWith('.py')
					) {
						samples.push(child.resource);
					}
				}
			}
		} catch {
			// 忽略错误
		}
	}

	/**
	 * 查找配置文件
	 */
	private async findConfigFiles(workspaceUri: URI): Promise<string[]> {
		const configFiles: string[] = [];

		const configNames = [
			'.eslintrc',
			'.eslintrc.js',
			'.eslintrc.json',
			'.prettierrc',
			'.prettierrc.js',
			'tsconfig.json',
			'.editorconfig',
			'jest.config.js',
			'webpack.config.js',
			'vite.config.js'
		];

		for (const name of configNames) {
			try {
				const configUri = URI.joinPath(workspaceUri, name);
				await this.fileService.resolve(configUri);
				configFiles.push(name);
			} catch {
				// 文件不存在
			}
		}

		return configFiles;
	}

	/**
	 * 基于现有记忆生成上下文增强的 Prompt
	 */
	async generateEnhancedPrompt(
		workspaceUri: URI,
		userPrompt: string,
		relevantCategories?: MemoryCategory[]
	): Promise<string> {
		// 获取相关记忆
		let memories: MemoryEntry[] = [];

		if (relevantCategories && relevantCategories.length > 0) {
			// 只获取相关类别
			for (const category of relevantCategories) {
				const categoryMemories = await this.memoryBankService.getEntriesByCategory(workspaceUri, category);
				memories.push(...categoryMemories);
			}
		} else {
			// 获取所有记忆
			memories = await this.memoryBankService.getAllEntries(workspaceUri);
		}

		if (memories.length === 0) {
			return userPrompt;
		}

		// 构建增强的 prompt
		let enhancedPrompt = '【项目上下文】\n\n';

		// 按类别组织记忆
		const categorizedMemories: Record<string, MemoryEntry[]> = {};
		for (const memory of memories) {
			if (!categorizedMemories[memory.category]) {
				categorizedMemories[memory.category] = [];
			}
			categorizedMemories[memory.category].push(memory);
		}

		// 添加记忆内容
		for (const [category, categoryMemories] of Object.entries(categorizedMemories)) {
			enhancedPrompt += `## ${this.getCategoryName(category as MemoryCategory)}\n\n`;

			for (const memory of categoryMemories) {
				enhancedPrompt += `### ${memory.title}\n`;
				enhancedPrompt += `${memory.content.substring(0, 300)}...\n\n`;
			}
		}

		enhancedPrompt += '\n【用户需求】\n\n';
		enhancedPrompt += userPrompt;

		return enhancedPrompt;
	}

	/**
	 * 获取类别中文名称
	 */
	private getCategoryName(category: MemoryCategory): string {
		const names: Record<MemoryCategory, string> = {
			'architecture': '架构设计',
			'coding-style': '编码规范',
			'project-structure': '项目结构',
			'dependencies': '依赖关系',
			'best-practices': '最佳实践',
			'common-patterns': '常用模式',
			'custom': '自定义'
		};
		return names[category];
	}

	/**
	 * 智能搜索记忆
	 * 根据关键词搜索最相关的记忆条目
	 */
	async smartSearch(workspaceUri: URI, keywords: string[]): Promise<MemoryEntry[]> {
		const allMemories = await this.memoryBankService.getAllEntries(workspaceUri);

		// 计算每个记忆的相关性得分
		const scoredMemories = allMemories.map(memory => {
			let score = 0;

			for (const keyword of keywords) {
				const lowerKeyword = keyword.toLowerCase();

				// 标题匹配权重最高
				if (memory.title.toLowerCase().includes(lowerKeyword)) {
					score += 10;
				}

				// 内容匹配
				if (memory.content.toLowerCase().includes(lowerKeyword)) {
					score += 5;
				}

				// 标签匹配
				if (memory.tags.some(tag => tag.toLowerCase().includes(lowerKeyword))) {
					score += 3;
				}
			}

			return { memory, score };
		});

		// 按得分排序，返回前 5 个
		return scoredMemories
			.filter(item => item.score > 0)
			.sort((a, b) => b.score - a.score)
			.slice(0, 5)
			.map(item => item.memory);
	}
}
