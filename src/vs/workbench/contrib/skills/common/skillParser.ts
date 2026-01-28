/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ISkill, ISkillMetadata, SkillCategory } from './skillTypes.js';

/**
 * Skill 文件解析器
 *
 * 负责解析 Markdown 格式的 Skill 文件，提取元数据和内容
 *
 * Skill 文件格式：
 * ```markdown
 * ---
 * name: Code Review
 * slug: code-review
 * description: 代码审查检查清单和最佳实践
 * category: code-quality
 * estimatedTokens: 1500
 * version: 1.0.0
 * author: Official
 * tags: [review, quality, best-practices]
 * official: true
 * ---
 *
 * # Code Review
 *
 * ## 概述
 * ...
 * ```
 */
export class SkillParser {

	/**
	 * 解析 Skill 文件内容
	 * @param content Skill 文件内容（Markdown 格式）
	 * @param filePath Skill 文件路径
	 * @returns 解析后的 Skill 对象
	 */
	static parse(content: string, filePath: string): ISkill {
		// 提取 frontmatter（YAML 格式的元数据）
		const { metadata, mainContent } = this.extractFrontmatter(content);

		// 验证必需字段
		this.validateMetadata(metadata, filePath);

		// 构建完整的 Skill 对象
		const skill: ISkill = {
			name: metadata.name,
			slug: metadata.slug,
			description: metadata.description,
			category: this.parseCategory(metadata.category),
			estimatedTokens: parseInt(metadata.estimatedTokens, 10),
			version: metadata.version,
			author: metadata.author,
			tags: this.parseTags(metadata.tags),
			official: metadata.official === 'true' || metadata.official === true,
			createdAt: metadata.createdAt,
			updatedAt: metadata.updatedAt,
			content: mainContent.trim(),
			filePath: filePath
		};

		return skill;
	}

	/**
	 * 提取 frontmatter 和主要内容
	 */
	private static extractFrontmatter(content: string): { metadata: Record<string, any>; mainContent: string } {
		const frontmatterRegex = /^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/;
		const match = content.match(frontmatterRegex);

		if (!match) {
			throw new Error('Skill 文件格式错误：缺少 frontmatter');
		}

		const [, frontmatterText, mainContent] = match;
		const metadata = this.parseFrontmatter(frontmatterText);

		return { metadata, mainContent };
	}

	/**
	 * 解析 frontmatter（简化的 YAML 解析器）
	 */
	private static parseFrontmatter(text: string): Record<string, any> {
		const metadata: Record<string, any> = {};
		const lines = text.split('\n');

		for (const line of lines) {
			const trimmed = line.trim();
			if (!trimmed || trimmed.startsWith('#')) {
				continue;
			}

			const colonIndex = trimmed.indexOf(':');
			if (colonIndex === -1) {
				continue;
			}

			const key = trimmed.substring(0, colonIndex).trim();
			let value = trimmed.substring(colonIndex + 1).trim();

			// 处理数组格式 [item1, item2]
			if (value.startsWith('[') && value.endsWith(']')) {
				value = value.substring(1, value.length - 1);
				metadata[key] = value.split(',').map(item => item.trim());
			} else {
				metadata[key] = value;
			}
		}

		return metadata;
	}

	/**
	 * 验证元数据必需字段
	 */
	private static validateMetadata(metadata: Record<string, any>, filePath: string): void {
		const requiredFields = ['name', 'slug', 'description', 'category', 'estimatedTokens', 'version'];

		for (const field of requiredFields) {
			if (!metadata[field]) {
				throw new Error(`Skill 文件 ${filePath} 缺少必需字段：${field}`);
			}
		}
	}

	/**
	 * 解析分类
	 */
	private static parseCategory(category: string): SkillCategory {
		const categoryMap: Record<string, SkillCategory> = {
			'code-quality': SkillCategory.CodeQuality,
			'development': SkillCategory.Development,
			'testing': SkillCategory.Testing,
			'debugging': SkillCategory.Debugging,
			'performance': SkillCategory.Performance,
			'security': SkillCategory.Security,
			'documentation': SkillCategory.Documentation,
			'architecture': SkillCategory.Architecture,
			'api-design': SkillCategory.ApiDesign,
			'other': SkillCategory.Other
		};

		return categoryMap[category] || SkillCategory.Other;
	}

	/**
	 * 解析标签
	 */
	private static parseTags(tags: any): string[] | undefined {
		if (!tags) {
			return undefined;
		}

		if (Array.isArray(tags)) {
			return tags;
		}

		if (typeof tags === 'string') {
			return tags.split(',').map(tag => tag.trim()).filter(tag => tag);
		}

		return undefined;
	}

	/**
	 * 估算内容的 Token 数
	 * 简化估算：英文约 0.75 tokens/word，中文约 1.5 tokens/字
	 */
	static estimateTokens(content: string): number {
		// 移除代码块（代码块的 token 计算更复杂，这里简化处理）
		const withoutCodeBlocks = content.replace(/```[\s\S]*?```/g, '');

		// 统计中文字符
		const chineseChars = (withoutCodeBlocks.match(/[\u4e00-\u9fa5]/g) || []).length;

		// 统计英文单词
		const englishWords = withoutCodeBlocks
			.replace(/[\u4e00-\u9fa5]/g, ' ')
			.split(/\s+/)
			.filter(word => word.length > 0).length;

		// 估算 tokens
		const estimatedTokens = Math.ceil(chineseChars * 1.5 + englishWords * 0.75);

		return estimatedTokens;
	}

	/**
	 * 序列化 Skill 为 Markdown 格式
	 * @param skill Skill 对象
	 * @returns Markdown 格式的内容
	 */
	static serialize(skill: ISkillMetadata & { content: string }): string {
		const frontmatter = [
			'---',
			`name: ${skill.name}`,
			`slug: ${skill.slug}`,
			`description: ${skill.description}`,
			`category: ${skill.category}`,
			`estimatedTokens: ${skill.estimatedTokens}`,
			`version: ${skill.version}`,
			skill.author ? `author: ${skill.author}` : null,
			skill.tags && skill.tags.length > 0 ? `tags: [${skill.tags.join(', ')}]` : null,
			skill.official !== undefined ? `official: ${skill.official}` : null,
			skill.createdAt ? `createdAt: ${skill.createdAt}` : null,
			skill.updatedAt ? `updatedAt: ${skill.updatedAt}` : null,
			'---',
			''
		].filter(line => line !== null).join('\n');

		return frontmatter + skill.content;
	}
}
