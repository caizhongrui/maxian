/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';

/**
 * RepoMap生成上下文
 */
export interface IRepoMapContext {
	chatFiles: string[];             // 当前对话中的文件
	otherFiles: string[];            // 其他文件
	mentionedFiles?: Set<string>;    // 用户提到的文件
	mentionedIdents?: Set<string>;   // 用户提到的标识符
	tokenBudget: number;             // Token预算
}

/**
 * RepoMapService接口
 */
export interface IRepoMapService {
	readonly _serviceBrand: undefined;

	/**
	 * 初始化服务
	 */
	initialize(workspaceRoot: string): Promise<void>;

	/**
	 * 生成排序后的RepoMap
	 */
	generateRanked(context: IRepoMapContext): Promise<string>;

	/**
	 * 获取工作区中的所有代码文件
	 */
	getWorkspaceCodeFiles(workspaceRoot: string): Promise<string[]>;

	/**
	 * 清除缓存
	 */
	clearCache(): void;

	/**
	 * 获取统计信息
	 */
	getStats(): {
		mapCacheSize: number;
		tagCacheSize: number;
		lastMapLength: number;
	};
}

export const IRepoMapService = createDecorator<IRepoMapService>('repoMapService');
