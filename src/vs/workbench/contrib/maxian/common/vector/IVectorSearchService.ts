/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';

/**
 * 语义搜索结果
 */
export interface ISemanticSearchResult {
	relPath: string;
	filePath: string;
	startLine: number;
	endLine: number;
	code: string;
	score: number;
}

/**
 * 向量搜索服务接口
 * 运行在 electron-main（Node.js）进程，通过 IPC 暴露给 renderer
 */
export interface IVectorSearchService {
	readonly _serviceBrand: undefined;

	/**
	 * 语义搜索
	 * @param query 自然语言查询
	 * @param cwd 工作区根目录
	 * @param maxResults 最大返回数
	 */
	semanticSearch(query: string, cwd: string, maxResults: number): Promise<ISemanticSearchResult[]>;

	/**
	 * 格式化搜索结果为字符串
	 */
	formatResults(results: ISemanticSearchResult[], query: string): string;
}

export const IVectorSearchService = createDecorator<IVectorSearchService>('maxianVectorSearchService');
