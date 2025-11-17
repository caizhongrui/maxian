/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IMemoryBankService, MemoryEntry, MemoryCategory } from '../common/memoryBank.js';
import { URI } from '../../../../base/common/uri.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IProjectAnalyzerService } from '../../projectAnalyzer/common/projectAnalyzer.js';
import { IAIService } from '../../../../platform/ai/common/ai.js';
import { VSBuffer } from '../../../../base/common/buffer.js';

/**
 * Memory Bank Service Implementation
 * 参考KiloCode设计,提供项目记忆存储和管理
 */
export class MemoryBankService implements IMemoryBankService {

	declare readonly _serviceBrand: undefined;

	private static readonly MEMORY_BANK_DIR = '.zhikai/memory-bank';

	constructor(
		@IFileService private readonly fileService: IFileService,
		@IProjectAnalyzerService private readonly projectAnalyzer: IProjectAnalyzerService,
		@IAIService private readonly aiService: IAIService
	) { }

	/**
	 * 初始化Memory Bank
	 */
	async initialize(workspaceUri: URI): Promise<void> {
		const memoryBankUri = URI.joinPath(workspaceUri, MemoryBankService.MEMORY_BANK_DIR);

		try {
			await this.fileService.resolve(memoryBankUri);
		} catch {
			// Directory doesn't exist, create it
			await this.fileService.createFolder(memoryBankUri);

			// Create category subdirectories
			const categories: MemoryCategory[] = [
				'architecture',
				'coding-style',
				'project-structure',
				'dependencies',
				'best-practices',
				'common-patterns',
				'custom'
			];

			for (const category of categories) {
				const categoryUri = URI.joinPath(memoryBankUri, category);
				await this.fileService.createFolder(categoryUri);
			}

			// Create README
			const readmeUri = URI.joinPath(memoryBankUri, 'README.md');
			const readmeContent = this.generateReadmeContent();
			await this.fileService.writeFile(readmeUri, VSBuffer.fromString(readmeContent));
		}
	}

	/**
	 * 添加记忆条目
	 */
	async addEntry(workspaceUri: URI, entry: Omit<MemoryEntry, 'id' | 'createdAt' | 'updatedAt'>): Promise<MemoryEntry> {
		const id = Date.now().toString(36) + Math.random().toString(36).substring(2);
		const now = Date.now();

		const fullEntry: MemoryEntry = {
			...entry,
			id,
			createdAt: now,
			updatedAt: now
		};

		await this.saveEntry(workspaceUri, fullEntry);
		return fullEntry;
	}

	/**
	 * 更新记忆条目
	 */
	async updateEntry(workspaceUri: URI, id: string, updates: Partial<Omit<MemoryEntry, 'id' | 'createdAt'>>): Promise<MemoryEntry> {
		const existing = await this.getEntry(workspaceUri, id);
		if (!existing) {
			throw new Error(`Memory entry ${id} not found`);
		}

		const updated: MemoryEntry = {
			...existing,
			...updates,
			id: existing.id,
			createdAt: existing.createdAt,
			updatedAt: Date.now()
		};

		// Delete old file if category changed
		if (updates.category && updates.category !== existing.category) {
			await this.deleteEntryFile(workspaceUri, existing);
		}

		await this.saveEntry(workspaceUri, updated);
		return updated;
	}

	/**
	 * 删除记忆条目
	 */
	async deleteEntry(workspaceUri: URI, id: string): Promise<void> {
		const entry = await this.getEntry(workspaceUri, id);
		if (entry) {
			await this.deleteEntryFile(workspaceUri, entry);
		}
	}

	/**
	 * 获取所有记忆条目
	 */
	async getAllEntries(workspaceUri: URI): Promise<MemoryEntry[]> {
		const memoryBankUri = URI.joinPath(workspaceUri, MemoryBankService.MEMORY_BANK_DIR);
		const entries: MemoryEntry[] = [];

		try {
			const categories = await this.fileService.resolve(memoryBankUri);

			if (categories.children) {
				for (const categoryDir of categories.children) {
					if (categoryDir.isDirectory && categoryDir.name !== 'README.md') {
						const files = await this.fileService.resolve(categoryDir.resource);

						if (files.children) {
							for (const file of files.children) {
								if (file.name.endsWith('.md')) {
									try {
										const entry = await this.loadEntry(file.resource);
										if (entry) {
											entries.push(entry);
										}
									} catch (error) {
										console.error('[Memory Bank] Error loading entry:', file.resource.fsPath, error);
									}
								}
							}
						}
					}
				}
			}
		} catch (error) {
			console.error('[Memory Bank] Error loading entries:', error);
		}

		return entries;
	}

	/**
	 * 根据类别获取记忆条目
	 */
	async getEntriesByCategory(workspaceUri: URI, category: MemoryCategory): Promise<MemoryEntry[]> {
		const all = await this.getAllEntries(workspaceUri);
		return all.filter(e => e.category === category);
	}

	/**
	 * 根据标签搜索记忆条目
	 */
	async searchByTags(workspaceUri: URI, tags: string[]): Promise<MemoryEntry[]> {
		const all = await this.getAllEntries(workspaceUri);
		return all.filter(entry =>
			tags.some(tag => entry.tags.includes(tag))
		);
	}

	/**
	 * 获取单个记忆条目
	 */
	async getEntry(workspaceUri: URI, id: string): Promise<MemoryEntry | null> {
		const all = await this.getAllEntries(workspaceUri);
		return all.find(e => e.id === id) || null;
	}

	/**
	 * 自动学习项目结构
	 */
	async learnProjectStructure(workspaceUri: URI): Promise<void> {
		const projectStructure = await this.projectAnalyzer.analyzeProject(workspaceUri);

		const content = `# 项目结构

## 项目类型
${projectStructure.type}

## 框架
${projectStructure.framework || 'N/A'}

## 主要语言
${projectStructure.language}

## 目录结构
- 源码目录: ${projectStructure.directories.src || 'N/A'}
- 测试目录: ${projectStructure.directories.test || 'N/A'}
- 配置目录: ${projectStructure.directories.config || 'N/A'}
- 前端目录: ${projectStructure.directories.frontend || 'N/A'}
- 后端目录: ${projectStructure.directories.backend || 'N/A'}

## 主要依赖
${projectStructure.dependencies.slice(0, 10).map(d => `- ${d.name}@${d.version} (${d.type})`).join('\n')}
`;

		await this.addEntry(workspaceUri, {
			title: 'Project Structure',
			content,
			category: 'project-structure',
			tags: ['auto-generated', 'structure', projectStructure.type]
		});
	}

	/**
	 * 从代码中提取编码规范
	 */
	async learnCodingStyle(workspaceUri: URI, sampleFiles: URI[]): Promise<void> {
		// Read sample files
		const samples: string[] = [];
		for (const fileUri of sampleFiles.slice(0, 5)) {
			try {
				const content = await this.fileService.readFile(fileUri);
				samples.push(content.value.toString());
			} catch {
				// Skip files that can't be read
			}
		}

		if (samples.length === 0) {
			return;
		}

		// Use AI to analyze coding style
		const prompt = `Analyze these code samples and extract coding style guidelines:

${samples.map((s, i) => `\n---Sample ${i + 1}---\n${s.substring(0, 1000)}`).join('\n')}

Extract:
1. Indentation style (spaces/tabs, size)
2. Naming conventions (variables, functions, classes)
3. Comment style
4. Import organization
5. Common patterns

Provide a concise summary in Chinese.`;

		const styleAnalysis = await this.aiService.complete(prompt);

		await this.addEntry(workspaceUri, {
			title: 'Coding Style Guidelines',
			content: `# 编码规范\n\n${styleAnalysis}`,
			category: 'coding-style',
			tags: ['auto-generated', 'style', 'conventions']
		});
	}

	/**
	 * 生成项目上下文摘要(用于AI prompt)
	 */
	async generateContextSummary(workspaceUri: URI): Promise<string> {
		const entries = await this.getAllEntries(workspaceUri);

		if (entries.length === 0) {
			return '';
		}

		let summary = '【项目记忆】\n\n';

		// Group by category
		const categories: MemoryCategory[] = [
			'architecture',
			'project-structure',
			'coding-style',
			'dependencies',
			'best-practices',
			'common-patterns'
		];

		for (const category of categories) {
			const categoryEntries = entries.filter(e => e.category === category);
			if (categoryEntries.length > 0) {
				summary += `## ${this.getCategoryName(category)}\n\n`;
				for (const entry of categoryEntries) {
					summary += `### ${entry.title}\n${entry.content.substring(0, 500)}\n\n`;
				}
			}
		}

		return summary;
	}

	// Helper methods

	private async saveEntry(workspaceUri: URI, entry: MemoryEntry): Promise<void> {
		const filename = `${entry.id}.md`;
		const fileUri = URI.joinPath(
			workspaceUri,
			MemoryBankService.MEMORY_BANK_DIR,
			entry.category,
			filename
		);

		const content = this.serializeEntry(entry);
		await this.fileService.writeFile(fileUri, VSBuffer.fromString(content));
	}

	private async deleteEntryFile(workspaceUri: URI, entry: MemoryEntry): Promise<void> {
		const filename = `${entry.id}.md`;
		const fileUri = URI.joinPath(
			workspaceUri,
			MemoryBankService.MEMORY_BANK_DIR,
			entry.category,
			filename
		);

		try {
			await this.fileService.del(fileUri);
		} catch {
			// File might not exist
		}
	}

	private async loadEntry(fileUri: URI): Promise<MemoryEntry | null> {
		try {
			const content = await this.fileService.readFile(fileUri);
			return this.deserializeEntry(content.value.toString());
		} catch {
			return null;
		}
	}

	private serializeEntry(entry: MemoryEntry): string {
		const frontmatter = [
			'---',
			`id: ${entry.id}`,
			`title: ${entry.title}`,
			`category: ${entry.category}`,
			`tags: ${entry.tags.join(', ')}`,
			`created: ${new Date(entry.createdAt).toISOString()}`,
			`updated: ${new Date(entry.updatedAt).toISOString()}`,
			'---',
			'',
			entry.content
		].join('\n');

		return frontmatter;
	}

	private deserializeEntry(content: string): MemoryEntry | null {
		const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
		if (!match) {
			return null;
		}

		const [, frontmatter, body] = match;
		const lines = frontmatter.split('\n');

		const metadata: Record<string, string> = {};
		for (const line of lines) {
			const [key, ...valueParts] = line.split(':');
			if (key && valueParts.length > 0) {
				metadata[key.trim()] = valueParts.join(':').trim();
			}
		}

		return {
			id: metadata.id || '',
			title: metadata.title || '',
			content: body.trim(),
			category: (metadata.category as MemoryCategory) || 'custom',
			tags: metadata.tags ? metadata.tags.split(',').map(t => t.trim()) : [],
			createdAt: metadata.created ? new Date(metadata.created).getTime() : Date.now(),
			updatedAt: metadata.updated ? new Date(metadata.updated).getTime() : Date.now()
		};
	}

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

	private generateReadmeContent(): string {
		return `# Memory Bank

这是AI项目记忆库,存储项目特定的上下文信息。

## 目录结构

- **architecture/**: 架构设计文档
- **coding-style/**: 编码规范和风格指南
- **project-structure/**: 项目结构说明
- **dependencies/**: 依赖关系文档
- **best-practices/**: 最佳实践
- **common-patterns/**: 常用设计模式
- **custom/**: 自定义记忆

## 文件格式

所有记忆条目使用Markdown格式,带有YAML frontmatter:

\`\`\`markdown
---
id: unique-id
title: Entry Title
category: architecture
tags: tag1, tag2
created: 2025-01-01T00:00:00.000Z
updated: 2025-01-01T00:00:00.000Z
---

Entry content here...
\`\`\`

## 使用方式

Memory Bank会自动被AI Agent使用,提供项目特定的上下文信息,提升代码生成的准确性。
`;
	}
}

registerSingleton(IMemoryBankService, MemoryBankService, InstantiationType.Delayed);
