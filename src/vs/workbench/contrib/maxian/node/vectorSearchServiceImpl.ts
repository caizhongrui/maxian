/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IVectorSearchService, ISemanticSearchResult } from '../common/vector/IVectorSearchService.js';
import { SemanticSearchService } from '../common/vector/semanticSearchService.js';

/**
 * 向量搜索服务 Node.js 层实现（运行在 electron-main 进程，有完整 Node.js 权限）
 * 通过 IPC 通道（ProxyChannel）暴露给 renderer 进程
 */
export class VectorSearchServiceImpl implements IVectorSearchService {
	readonly _serviceBrand: undefined;

	private readonly _service: SemanticSearchService;

	constructor() {
		this._service = SemanticSearchService.getInstance();
	}

	async semanticSearch(query: string, cwd: string, maxResults: number): Promise<ISemanticSearchResult[]> {
		return this._service.semanticSearch(query, cwd, maxResults);
	}

	formatResults(results: ISemanticSearchResult[], query: string): string {
		return this._service.formatResults(results, query);
	}
}
