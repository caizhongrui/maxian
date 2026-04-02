/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import * as fs from 'fs';
import { Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { FileAccess } from '../../../../base/common/network.js';
import { ISkillService } from '../common/skillService.js';
import { ISkill, ISkillFilter, ISkillLoadOptions, ISkillActivationContext } from '../common/skillTypes.js';
import { SkillRegistry } from '../common/skillRegistry.js';
import { SkillScanner } from './skillScanner.js';
import { createStructuredLogger } from '../../../common/structuredLogger.js';

/**
 * Skill 服务实现（Node.js 环境）
 *
 * 负责：
 * 1. 确定 Skills 目录位置（.claude/skills）
 * 2. 扫描和加载 Skills
 * 3. 管理 Skill 注册表
 * 4. 监听文件变化
 * 5. 提供 Skill 推荐功能
 */
export class SkillServiceImpl extends Disposable implements ISkillService {

	declare readonly _serviceBrand: undefined;

	private readonly registry: SkillRegistry;
	private readonly logger = createStructuredLogger('SkillService');
	private _skillsDirectory: string;
	private _initialized: boolean = false;
	private disposeWatcher?: () => void;

	constructor() {
		super();

		// 创建 Skill 注册表
		this.registry = this._register(new SkillRegistry());

		// 确定 Skills 目录
		this._skillsDirectory = this.resolveSkillsDirectory();

		this.logger.debug('init', { skillsDirectory: this._skillsDirectory });
	}

	get skillsDirectory(): string {
		return this._skillsDirectory;
	}

	get onDidRegister(): Event<ISkill> {
		return this.registry.onDidRegister;
	}

	get onDidUnregister(): Event<string> {
		return this.registry.onDidUnregister;
	}

	get onDidChange(): Event<void> {
		return this.registry.onDidChange;
	}

	/**
	 * 初始化 Skills 系统
	 */
	async initialize(): Promise<void> {
		if (this._initialized) {
			this.logger.warn('initialize_skipped_already_initialized');
			return;
		}

		this.logger.debug('initialize_started');

		try {
			// 扫描 Skills 目录
			await this.rescan();

			// 监听目录变化
			this.watchDirectory();

			this._initialized = true;
			this.logger.debug('initialize_completed');

		} catch (error) {
			this.logger.error('initialize_failed', { error: String(error) });
			throw error;
		}
	}

	/**
	 * 重新扫描 Skills 目录
	 */
	async rescan(): Promise<void> {
		this.logger.debug('rescan_started');

		try {
			// 扫描目录
			const skills = await SkillScanner.scan(this._skillsDirectory);

			// 清空现有注册
			this.registry.clear();

			// 批量注册
			const count = this.registry.registerAll(skills);

			this.logger.debug('rescan_completed', { count });

		} catch (error) {
			this.logger.error('rescan_failed', { error: String(error) });
			throw error;
		}
	}

	/**
	 * 监听目录变化
	 */
	private watchDirectory(): void {
		// 如果已经在监听，先停止
		if (this.disposeWatcher) {
			this.disposeWatcher();
		}

		// 开始监听
		this.disposeWatcher = SkillScanner.watch(this._skillsDirectory, () => {
			this.logger.debug('skills_changed_rescan');
			this.rescan().catch(error => {
				this.logger.error('rescan_failed_after_change', { error: String(error) });
			});
		});

		// 注册清理函数
		this._register({
			dispose: () => {
				if (this.disposeWatcher) {
					this.disposeWatcher();
					this.disposeWatcher = undefined;
				}
			}
		});
	}

	/**
	 * 获取指定的 Skill
	 */
	get(slug: string): ISkill | undefined {
		if (!this._initialized) {
			this.logger.warn('get_before_initialization', { slug });
			return undefined;
		}
		return this.registry.get(slug);
	}

	/**
	 * 检查 Skill 是否存在
	 */
	has(slug: string): boolean {
		if (!this._initialized) {
			return false;
		}
		return this.registry.has(slug);
	}

	/**
	 * 列出所有 Skills
	 */
	list(): ISkill[] {
		if (!this._initialized) {
			this.logger.warn('list_before_initialization');
			return [];
		}
		return this.registry.list();
	}

	/**
	 * 搜索 Skills
	 */
	search(filter: ISkillFilter): ISkill[] {
		// 如果还未初始化，返回空数组
		if (!this._initialized) {
			this.logger.warn('search_before_initialization', { hasQuery: !!filter.query });
			return [];
		}
		return this.registry.search(filter);
	}

	/**
	 * 获取所有官方 Skills
	 */
	getOfficialSkills(): ISkill[] {
		if (!this._initialized) {
			this.logger.warn('get_official_before_initialization');
			return [];
		}
		return this.registry.getOfficialSkills();
	}

	/**
	 * 加载 Skill 内容
	 */
	async load(slug: string, options?: ISkillLoadOptions): Promise<string | undefined> {
		return this.registry.load(slug, options);
	}

	/**
	 * 批量加载多个 Skills
	 */
	async loadMultiple(slugs: string[], options?: ISkillLoadOptions): Promise<string> {
		return this.registry.loadMultiple(slugs, options);
	}

	/**
	 * AI 推荐相关 Skills
	 *
	 * 简单实现：基于关键词匹配
	 * 未来可以使用更复杂的算法（如向量相似度）
	 */
	async recommend(context: ISkillActivationContext, maxSkills: number = 3): Promise<ISkill[]> {
		const allSkills = this.list();

		if (allSkills.length === 0) {
			return [];
		}

		// 如果没有上下文，返回最常用的官方 Skills
		if (!context.taskDescription && !context.relevantFiles) {
			return this.getOfficialSkills().slice(0, maxSkills);
		}

		// 基于关键词匹配的简单评分
		const scores = new Map<ISkill, number>();

		for (const skill of allSkills) {
			let score = 0;

			// 官方 Skill 加分
			if (skill.official) {
				score += 10;
			}

			// 任务描述匹配
			if (context.taskDescription) {
				const taskLower = context.taskDescription.toLowerCase();

				// 检查 Skill 名称
				if (taskLower.includes(skill.name.toLowerCase())) {
					score += 50;
				}

				// 检查描述
				if (taskLower.includes(skill.description.toLowerCase())) {
					score += 30;
				}

				// 检查标签
				if (skill.tags) {
					for (const tag of skill.tags) {
						if (taskLower.includes(tag.toLowerCase())) {
							score += 20;
						}
					}
				}
			}

			// 相关文件匹配
			if (context.relevantFiles && context.relevantFiles.length > 0) {
				// 简单实现：检查文件扩展名
				const hasTestFiles = context.relevantFiles.some(f => f.includes('.test.') || f.includes('.spec.'));
				const hasDocFiles = context.relevantFiles.some(f => f.endsWith('.md') || f.endsWith('.rst'));

				if (hasTestFiles && skill.slug === 'testing') {
					score += 40;
				}

				if (hasDocFiles && skill.slug === 'documentation') {
					score += 40;
				}
			}

			if (score > 0) {
				scores.set(skill, score);
			}
		}

		// 按评分排序
		const recommended = Array.from(scores.entries())
			.sort((a, b) => b[1] - a[1])
			.slice(0, maxSkills)
			.map(([skill]) => skill);

		this.logger.debug('recommendation_generated', { count: recommended.length, slugs: recommended.map(s => s.slug) });

		return recommended;
	}

	/**
	 * 获取统计信息
	 */
	getStats(): {
		total: number;
		official: number;
		byCategory: Map<string, number>;
		totalEstimatedTokens: number;
	} {
		return this.registry.getStats();
	}

	/**
	 * 验证 Skills 目录结构
	 */
	async validate(): Promise<{ valid: boolean; errors: string[] }> {
		return SkillScanner.validate(this._skillsDirectory);
	}

	/**
	 * 确定 Skills 目录位置
	 *
	 * 优先级：
	 * 1. 用户自定义目录: ~/.claude/skills（如果存在）- 允许用户覆盖或扩展内置Skills
	 * 2. IDE内置目录: {appRoot}/resources/skills - 随IDE打包分发的官方Skills
	 *
	 * 这样既支持IDE打包分发，也支持用户自定义扩展
	 */
	private resolveSkillsDirectory(): string {
		// 1. 优先检查用户自定义 Skills 目录
		const userHome = process.env.HOME || process.env.USERPROFILE || '';
		if (userHome) {
			const userSkillsDir = path.join(userHome, '.claude', 'skills');
			// 如果用户目录存在且有内容，使用用户目录
			if (fs.existsSync(userSkillsDir)) {
				try {
					const entries = fs.readdirSync(userSkillsDir);
					if (entries.length > 0) {
						this.logger.debug('use_user_skills_directory', { dir: userSkillsDir });
						return userSkillsDir;
					}
				} catch (err) {
					this.logger.warn('read_user_skills_directory_failed', { dir: userSkillsDir, error: String(err) });
				}
			}
		}

		// 2. 使用 IDE 内置 Skills 目录（随应用打包分发）
		try {
			// 获取应用根目录（IDE 安装目录）
			const appRoot = path.dirname(FileAccess.asFileUri('').fsPath);
			const builtinSkillsDir = path.join(appRoot, 'resources', 'skills');

			if (fs.existsSync(builtinSkillsDir)) {
				this.logger.debug('use_builtin_skills_directory', { dir: builtinSkillsDir });
				return builtinSkillsDir;
			} else {
				this.logger.warn('builtin_skills_directory_missing', { dir: builtinSkillsDir });
			}
		} catch (err) {
			this.logger.error('resolve_app_root_failed', { error: String(err) });
		}

		// 3. Fallback: 使用当前工作目录（开发环境）
		const fallbackSkillsDir = path.join(process.cwd(), 'resources', 'skills');
		this.logger.warn('fallback_skills_directory', { dir: fallbackSkillsDir });
		return fallbackSkillsDir;
	}

	override dispose(): void {
		this.logger.debug('disposed');
		super.dispose();
	}
}
