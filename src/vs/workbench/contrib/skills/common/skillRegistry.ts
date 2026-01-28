/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { ISkill, ISkillFilter, ISkillLoadOptions, SkillCategory } from './skillTypes.js';

/**
 * Skill 注册表
 *
 * 管理所有已注册的 Skills，提供查询、搜索、加载等功能
 *
 * 使用方式：
 * ```typescript
 * const registry = new SkillRegistry();
 *
 * // 注册 Skill
 * registry.register(skill);
 *
 * // 获取 Skill
 * const skill = registry.get('code-review');
 *
 * // 搜索 Skill
 * const skills = registry.search({ category: SkillCategory.CodeQuality });
 *
 * // 列出所有 Skills
 * const all = registry.list();
 * ```
 */
export class SkillRegistry extends Disposable {

	private skills: Map<string, ISkill> = new Map();

	private readonly _onDidRegister = this._register(new Emitter<ISkill>());
	readonly onDidRegister: Event<ISkill> = this._onDidRegister.event;

	private readonly _onDidUnregister = this._register(new Emitter<string>());
	readonly onDidUnregister: Event<string> = this._onDidUnregister.event;

	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange: Event<void> = this._onDidChange.event;

	/**
	 * 注册一个 Skill
	 * @param skill 要注册的 Skill
	 * @throws 如果 slug 已存在，抛出错误
	 */
	register(skill: ISkill): void {
		if (this.skills.has(skill.slug)) {
			throw new Error(`Skill 已存在: ${skill.slug}`);
		}

		this.skills.set(skill.slug, skill);
		console.log(`[SkillRegistry] 注册 Skill: ${skill.name} (${skill.slug})`);

		this._onDidRegister.fire(skill);
		this._onDidChange.fire();
	}

	/**
	 * 批量注册 Skills
	 * @param skills 要注册的 Skills 数组
	 * @returns 成功注册的数量
	 */
	registerAll(skills: ISkill[]): number {
		let count = 0;

		for (const skill of skills) {
			try {
				this.register(skill);
				count++;
			} catch (error) {
				console.error(`[SkillRegistry] 注册 Skill 失败: ${skill.slug}`, error);
			}
		}

		console.log(`[SkillRegistry] 批量注册完成: ${count}/${skills.length}`);
		return count;
	}

	/**
	 * 注销一个 Skill
	 * @param slug Skill 的 slug
	 * @returns 是否成功注销
	 */
	unregister(slug: string): boolean {
		const existed = this.skills.delete(slug);

		if (existed) {
			console.log(`[SkillRegistry] 注销 Skill: ${slug}`);
			this._onDidUnregister.fire(slug);
			this._onDidChange.fire();
		}

		return existed;
	}

	/**
	 * 获取指定的 Skill
	 * @param slug Skill 的 slug
	 * @returns Skill 对象，如果不存在返回 undefined
	 */
	get(slug: string): ISkill | undefined {
		return this.skills.get(slug);
	}

	/**
	 * 检查 Skill 是否存在
	 * @param slug Skill 的 slug
	 * @returns 是否存在
	 */
	has(slug: string): boolean {
		return this.skills.has(slug);
	}

	/**
	 * 列出所有 Skills
	 * @returns 所有 Skill 的数组
	 */
	list(): ISkill[] {
		return Array.from(this.skills.values());
	}

	/**
	 * 搜索 Skills
	 * @param filter 搜索过滤器
	 * @returns 符合条件的 Skills 数组
	 */
	search(filter: ISkillFilter): ISkill[] {
		let results = this.list();

		// 分类过滤
		if (filter.category) {
			results = results.filter(skill => skill.category === filter.category);
		}

		// 标签过滤
		if (filter.tags && filter.tags.length > 0) {
			results = results.filter(skill =>
				skill.tags && filter.tags!.some(tag => skill.tags!.includes(tag))
			);
		}

		// 关键词搜索
		if (filter.query) {
			const query = filter.query.toLowerCase();
			results = results.filter(skill =>
				skill.name.toLowerCase().includes(query) ||
				skill.description.toLowerCase().includes(query) ||
				(skill.tags && skill.tags.some(tag => tag.toLowerCase().includes(query)))
			);
		}

		// 官方 Skill 过滤
		if (filter.officialOnly) {
			results = results.filter(skill => skill.official);
		}

		return results;
	}

	/**
	 * 按分类分组
	 * @returns 按分类分组的 Skills
	 */
	groupByCategory(): Map<SkillCategory, ISkill[]> {
		const groups = new Map<SkillCategory, ISkill[]>();

		for (const skill of this.skills.values()) {
			const category = skill.category;
			if (!groups.has(category)) {
				groups.set(category, []);
			}
			groups.get(category)!.push(skill);
		}

		return groups;
	}

	/**
	 * 获取所有官方 Skills
	 * @returns 官方 Skills 数组
	 */
	getOfficialSkills(): ISkill[] {
		return this.search({ officialOnly: true });
	}

	/**
	 * 加载 Skill 内容
	 * @param slug Skill 的 slug
	 * @param options 加载选项
	 * @returns Skill 的完整内容（包含示例和模板）
	 */
	async load(slug: string, options: ISkillLoadOptions = {}): Promise<string | undefined> {
		const skill = this.get(slug);
		if (!skill) {
			return undefined;
		}

		// 检查 Token 限制
		if (options.maxTokens && skill.estimatedTokens > options.maxTokens) {
			console.warn(`[SkillRegistry] Skill ${slug} 超出 Token 限制: ${skill.estimatedTokens} > ${options.maxTokens}`);
			return undefined;
		}

		let content = skill.content;

		// 加载示例
		if (options.includeExamples && skill.examplePaths && skill.examplePaths.length > 0) {
			content += '\n\n## Examples\n\n';
			// TODO: 实际读取示例文件内容
			content += `<!-- ${skill.examplePaths.length} examples available -->\n`;
		}

		// 加载模板
		if (options.includeTemplates && skill.templatePaths && skill.templatePaths.length > 0) {
			content += '\n\n## Templates\n\n';
			// TODO: 实际读取模板文件内容
			content += `<!-- ${skill.templatePaths.length} templates available -->\n`;
		}

		console.log(`[SkillRegistry] 加载 Skill: ${skill.name} (~${skill.estimatedTokens} tokens)`);
		return content;
	}

	/**
	 * 批量加载多个 Skills
	 * @param slugs Skill slugs 数组
	 * @param options 加载选项
	 * @returns 所有 Skills 的内容合并后的字符串
	 */
	async loadMultiple(slugs: string[], options: ISkillLoadOptions = {}): Promise<string> {
		const contents: string[] = [];
		let totalTokens = 0;

		for (const slug of slugs) {
			const skill = this.get(slug);
			if (!skill) {
				console.warn(`[SkillRegistry] Skill 不存在: ${slug}`);
				continue;
			}

			// 检查累计 Token 限制
			if (options.maxTokens && (totalTokens + skill.estimatedTokens) > options.maxTokens) {
				console.warn(`[SkillRegistry] 达到 Token 限制，停止加载更多 Skills`);
				break;
			}

			const content = await this.load(slug, options);
			if (content) {
				contents.push(`# ${skill.name}\n\n${content}`);
				totalTokens += skill.estimatedTokens;
			}
		}

		console.log(`[SkillRegistry] 批量加载 ${contents.length} 个 Skills (~${totalTokens} tokens)`);
		return contents.join('\n\n---\n\n');
	}

	/**
	 * 获取统计信息
	 * @returns 统计数据
	 */
	getStats(): {
		total: number;
		official: number;
		byCategory: Map<SkillCategory, number>;
		totalEstimatedTokens: number;
	} {
		const byCategory = new Map<SkillCategory, number>();
		let totalEstimatedTokens = 0;
		let officialCount = 0;

		for (const skill of this.skills.values()) {
			// 按分类统计
			const count = byCategory.get(skill.category) || 0;
			byCategory.set(skill.category, count + 1);

			// 统计总 Token 数
			totalEstimatedTokens += skill.estimatedTokens;

			// 统计官方 Skill 数量
			if (skill.official) {
				officialCount++;
			}
		}

		return {
			total: this.skills.size,
			official: officialCount,
			byCategory,
			totalEstimatedTokens
		};
	}

	/**
	 * 清空所有 Skills
	 */
	clear(): void {
		this.skills.clear();
		console.log(`[SkillRegistry] 清空所有 Skills`);
		this._onDidChange.fire();
	}

	override dispose(): void {
		this.clear();
		super.dispose();
	}
}
