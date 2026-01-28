/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Skill 类型定义
 *
 * Skills 是按需加载的专业领域知识，用于扩展 AI 的能力
 * 相比系统提示词（每次都发送），Skills 只在需要时加载，节省 Token
 */

/**
 * Skill 元数据
 */
export interface ISkillMetadata {
	/** Skill 名称（用于显示） */
	readonly name: string;

	/** URL 友好标识（用于引用） */
	readonly slug: string;

	/** 简短描述（~50 字符） */
	readonly description: string;

	/** 分类 */
	readonly category: SkillCategory;

	/** 预估 Token 数 */
	readonly estimatedTokens: number;

	/** 版本号 */
	readonly version: string;

	/** 作者 */
	readonly author?: string;

	/** 标签 */
	readonly tags?: string[];

	/** 是否为官方 Skill */
	readonly official?: boolean;

	/** 创建时间 */
	readonly createdAt?: string;

	/** 更新时间 */
	readonly updatedAt?: string;
}

/**
 * Skill 分类
 */
export enum SkillCategory {
	/** 代码质量 */
	CodeQuality = 'code-quality',

	/** 开发工作流 */
	Development = 'development',

	/** 测试 */
	Testing = 'testing',

	/** 调试 */
	Debugging = 'debugging',

	/** 性能优化 */
	Performance = 'performance',

	/** 安全 */
	Security = 'security',

	/** 文档 */
	Documentation = 'documentation',

	/** 架构设计 */
	Architecture = 'architecture',

	/** API 设计 */
	ApiDesign = 'api-design',

	/** 其他 */
	Other = 'other'
}

/**
 * Skill 完整定义
 */
export interface ISkill extends ISkillMetadata {
	/** Skill 内容（Markdown 格式） */
	readonly content: string;

	/** Skill 文件路径 */
	readonly filePath: string;

	/** 示例文件路径 */
	examplePaths?: string[];

	/** 模板文件路径 */
	templatePaths?: string[];
}

/**
 * Skill 搜索过滤器
 */
export interface ISkillFilter {
	/** 分类过滤 */
	category?: SkillCategory;

	/** 标签过滤 */
	tags?: string[];

	/** 关键词搜索 */
	query?: string;

	/** 只显示官方 Skill */
	officialOnly?: boolean;
}

/**
 * Skill 加载选项
 */
export interface ISkillLoadOptions {
	/** 是否包含示例 */
	includeExamples?: boolean;

	/** 是否包含模板 */
	includeTemplates?: boolean;

	/** 最大 Token 限制 */
	maxTokens?: number;
}

/**
 * Skill 激活上下文
 */
export interface ISkillActivationContext {
	/** 当前任务描述 */
	taskDescription?: string;

	/** 相关文件路径 */
	relevantFiles?: string[];

	/** 用户偏好 */
	userPreferences?: Record<string, any>;
}
