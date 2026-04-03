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
 * 索引统计/进度信息（用于状态栏显示）
 */
export interface IIndexStats {
	/** 已索引的 chunk 数量 */
	itemCount: number;
	/** 是否正在索引 */
	isIndexing: boolean;
	/** 当前已处理文件数（索引进行中时有效） */
	indexed: number;
	/** 总文件数（索引进行中时有效） */
	total: number;
	/** 最后一次索引完成时间（ms timestamp，0 表示从未完成） */
	lastIndexedAt: number;
	/** 嵌入模型是否已就绪 */
	modelReady: boolean;
	/** 嵌入模型加载失败信息（可选） */
	modelError?: string;
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

	/**
	 * 获取指定工作区的索引统计与进度信息（用于状态栏）
	 */
	getIndexStats(cwd: string): Promise<IIndexStats>;

	/**
	 * 主动触发工作区索引（切换项目时调用）
	 * 如果索引已在进行中或已是最新则无操作
	 */
	triggerIndexing(cwd: string): Promise<void>;

	/**
	 * 增量更新单个文件的索引（文件保存时触发）
	 * @param filePath 文件绝对路径
	 * @param cwd 工作区根目录
	 */
	indexFile(filePath: string, cwd: string): Promise<void>;

	/**
	 * 删除单个文件的索引条目（文件删除时触发）
	 * @param filePath 文件绝对路径
	 * @param cwd 工作区根目录
	 */
	deleteFileIndex(filePath: string, cwd: string): Promise<void>;
}

export const IVectorSearchService = createDecorator<IVectorSearchService>('maxianVectorSearchService');
