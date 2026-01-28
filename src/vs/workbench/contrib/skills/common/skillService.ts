/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { ISkill, ISkillFilter, ISkillLoadOptions, ISkillActivationContext } from './skillTypes.js';

export const ISkillService = createDecorator<ISkillService>('skillService');

/**
 * Skill 服务接口
 *
 * 提供 Skills 系统的核心功能：
 * - 扫描和加载 Skills
 * - 管理 Skill 注册表
 * - 提供 Skill 搜索和查询
 * - 按需加载 Skill 内容
 * - AI 自动推荐 Skills
 */
export interface ISkillService {
	readonly _serviceBrand: undefined;

	/**
	 * Skills 目录路径
	 */
	readonly skillsDirectory: string;

	/**
	 * Skill 注册事件
	 */
	readonly onDidRegister: Event<ISkill>;

	/**
	 * Skill 注销事件
	 */
	readonly onDidUnregister: Event<string>;

	/**
	 * Skills 变化事件
	 */
	readonly onDidChange: Event<void>;

	/**
	 * 初始化 Skills 系统
	 * 扫描并加载所有 Skills
	 */
	initialize(): Promise<void>;

	/**
	 * 重新扫描 Skills 目录
	 */
	rescan(): Promise<void>;

	/**
	 * 获取指定的 Skill
	 * @param slug Skill 的 slug
	 */
	get(slug: string): ISkill | undefined | Promise<ISkill | undefined>;

	/**
	 * 检查 Skill 是否存在
	 * @param slug Skill 的 slug
	 */
	has(slug: string): boolean | Promise<boolean>;

	/**
	 * 列出所有 Skills
	 */
	list(): ISkill[] | Promise<ISkill[]>;

	/**
	 * 搜索 Skills
	 * @param filter 搜索过滤器
	 */
	search(filter: ISkillFilter): ISkill[] | Promise<ISkill[]>;

	/**
	 * 获取所有官方 Skills
	 */
	getOfficialSkills(): ISkill[] | Promise<ISkill[]>;

	/**
	 * 加载 Skill 内容
	 * @param slug Skill 的 slug
	 * @param options 加载选项
	 */
	load(slug: string, options?: ISkillLoadOptions): Promise<string | undefined>;

	/**
	 * 批量加载多个 Skills
	 * @param slugs Skill slugs 数组
	 * @param options 加载选项
	 */
	loadMultiple(slugs: string[], options?: ISkillLoadOptions): Promise<string>;

	/**
	 * AI 推荐相关 Skills
	 *
	 * 根据当前任务上下文，推荐最相关的 Skills
	 *
	 * @param context 激活上下文
	 * @param maxSkills 最多推荐数量
	 * @returns 推荐的 Skills 数组（按相关性排序）
	 */
	recommend(context: ISkillActivationContext, maxSkills?: number): Promise<ISkill[]>;

	/**
	 * 获取统计信息
	 */
	getStats(): {
		total: number;
		official: number;
		byCategory: Map<string, number>;
		totalEstimatedTokens: number;
	};

	/**
	 * 验证 Skills 目录结构
	 */
	validate(): Promise<{ valid: boolean; errors: string[] }>;
}
