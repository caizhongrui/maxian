/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { URI } from '../../../../base/common/uri.js';

export const IMemoryBankService = createDecorator<IMemoryBankService>('memoryBankService');

/**
 * Memory Bank Entry - 项目记忆条目
 */
export interface MemoryEntry {
	readonly id: string;
	readonly title: string;
	readonly content: string;
	readonly category: MemoryCategory;
	readonly tags: string[];
	readonly createdAt: number;
	readonly updatedAt: number;
}

/**
 * Memory Category - 记忆类别
 */
export type MemoryCategory =
	| 'architecture'      // 架构设计
	| 'coding-style'      // 编码规范
	| 'project-structure' // 项目结构
	| 'dependencies'      // 依赖关系
	| 'best-practices'    // 最佳实践
	| 'common-patterns'   // 常用模式
	| 'custom';           // 自定义

/**
 * Memory Bank Service - 项目记忆服务
 *
 * 参考KiloCode的Memory Bank设计:
 * - 存储项目特定的上下文信息
 * - 自动学习项目结构和规范
 * - 提供持久化的项目知识库
 */
export interface IMemoryBankService {
	readonly _serviceBrand: undefined;

	/**
	 * 初始化Memory Bank(如果不存在则创建)
	 */
	initialize(workspaceUri: URI): Promise<void>;

	/**
	 * 添加记忆条目
	 */
	addEntry(workspaceUri: URI, entry: Omit<MemoryEntry, 'id' | 'createdAt' | 'updatedAt'>): Promise<MemoryEntry>;

	/**
	 * 更新记忆条目
	 */
	updateEntry(workspaceUri: URI, id: string, updates: Partial<Omit<MemoryEntry, 'id' | 'createdAt'>>): Promise<MemoryEntry>;

	/**
	 * 删除记忆条目
	 */
	deleteEntry(workspaceUri: URI, id: string): Promise<void>;

	/**
	 * 获取所有记忆条目
	 */
	getAllEntries(workspaceUri: URI): Promise<MemoryEntry[]>;

	/**
	 * 根据类别获取记忆条目
	 */
	getEntriesByCategory(workspaceUri: URI, category: MemoryCategory): Promise<MemoryEntry[]>;

	/**
	 * 根据标签搜索记忆条目
	 */
	searchByTags(workspaceUri: URI, tags: string[]): Promise<MemoryEntry[]>;

	/**
	 * 获取单个记忆条目
	 */
	getEntry(workspaceUri: URI, id: string): Promise<MemoryEntry | null>;

	/**
	 * 自动学习项目结构并添加到Memory Bank
	 */
	learnProjectStructure(workspaceUri: URI): Promise<void>;

	/**
	 * 从代码中提取编码规范并添加到Memory Bank
	 */
	learnCodingStyle(workspaceUri: URI, sampleFiles: URI[]): Promise<void>;

	/**
	 * 生成项目上下文摘要(用于AI prompt)
	 */
	generateContextSummary(workspaceUri: URI): Promise<string>;
}
