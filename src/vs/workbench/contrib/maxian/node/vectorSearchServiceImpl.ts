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
	/** 模型预热失败信息（用于状态栏展示） */
	private _modelWarmupError: string | null = null;
	/** 当前是否正在预热（避免并发预热） */
	private _warmingUp = false;
	/** 上次预热尝试时间（ms） */
	private _lastWarmupAttemptAt = 0;

	constructor() {
		this._service = SemanticSearchService.getInstance();
		// 启动时在后台预热模型（不阻塞，只记录结果）
		this._warmUpModel();
	}

	private _warmUpModel(): void {
		if (this._warmingUp) {
			return;
		}
		this._warmingUp = true;
		this._lastWarmupAttemptAt = Date.now();
		EmbeddingService.getInstance().warmUp().then(() => {
			this._modelReady = true;
			this._modelWarmupError = null;
			log.debug('embedding_model_warmup_completed');
		}).catch((err) => {
			this._modelReady = false;
			this._modelWarmupError = String(err?.message ?? err);
			log.warn('embedding_model_warmup_failed', { error: this._modelWarmupError });
		}).finally(() => {
			this._warmingUp = false;
		});
	}

	private _maybeRetryWarmup(): void {
		if (this._modelReady || this._warmingUp) {
			return;
		}
		const RETRY_INTERVAL = 30_000;
		if (Date.now() - this._lastWarmupAttemptAt >= RETRY_INTERVAL) {
			log.info('embedding_model_warmup_retry');
			this._warmUpModel();
		}
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
		this._maybeRetryWarmup();
		const stats = await this._service.getIndexStats(cwd);
		return {
			...stats,
			modelReady: this._modelReady,
			modelError: this._modelWarmupError ?? undefined,
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
