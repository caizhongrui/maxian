/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IVectorSearchService, ISemanticSearchResult, IIndexStats } from '../common/vector/IVectorSearchService.js';
import { SemanticSearchService } from '../common/vector/semanticSearchService.js';
import { EmbeddingService } from '../common/vector/embeddingService.js';
import { createStructuredLogger } from '../../../common/structuredLogger.js';

const log = createStructuredLogger('VectorSearchService');

/**
 * 向量搜索服务 Node.js 层实现（运行在 electron-main 进程，有完整 Node.js 权限）
 * 通过 IPC 通道（ProxyChannel）暴露给 renderer 进程
 */
export class VectorSearchServiceImpl implements IVectorSearchService {
	readonly _serviceBrand: undefined;

	private readonly _service: SemanticSearchService;
	/** 模型是否已完成预热加载 */
	private _modelReady = false;

	constructor() {
		this._service = SemanticSearchService.getInstance();
		// 启动时在后台预热模型（不阻塞，只记录结果）
		this._warmUpModel();
	}

	private _warmUpModel(): void {
		EmbeddingService.getInstance().warmUp().then(() => {
			this._modelReady = true;
			log.debug('embedding_model_warmup_completed');
		}).catch((err) => {
			log.warn('embedding_model_warmup_failed', { error: String(err?.message ?? err) });
		});
	}

	async semanticSearch(query: string, cwd: string, maxResults: number): Promise<ISemanticSearchResult[]> {
		return this._service.semanticSearch(query, cwd, maxResults);
	}

	formatResults(results: ISemanticSearchResult[], query: string): string {
		return this._service.formatResults(results, query);
	}

	async triggerIndexing(cwd: string): Promise<void> {
		return this._service.triggerIndexing(cwd);
	}

	async getIndexStats(cwd: string): Promise<IIndexStats> {
		const stats = await this._service.getIndexStats(cwd);
		return {
			...stats,
			modelReady: this._modelReady,
		};
	}

	async indexFile(filePath: string, cwd: string): Promise<void> {
		return this._service.indexFile(filePath, cwd);
	}

	async deleteFileIndex(filePath: string, cwd: string): Promise<void> {
		const normalizedCwd = cwd.replace(/\/$/, '');
		const { getVectorStore } = await import('../common/vector/vectorStore.js');
		const vectorStore = getVectorStore(normalizedCwd);
		await vectorStore.deleteFileItems(filePath);
		log.debug('file_index_deleted', { filePath });
	}

	/**
	 * 返回模型是否已就绪（供 renderer 侧判断是否应该尝试语义搜索）
	 */
	isModelReady(): boolean {
		return this._modelReady;
	}
}
