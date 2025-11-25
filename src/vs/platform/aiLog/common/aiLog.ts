/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../instantiation/common/instantiation.js';

export const IAILogService = createDecorator<IAILogService>('aiLogService');

/**
 * AI调用日志记录服务
 */
export interface IAILogService {
	readonly _serviceBrand: undefined;

	/**
	 * 记录AI调用日志
	 * @param logData 日志数据
	 * @returns 记录ID
	 */
	logAICall(logData: AICallLogData): Promise<number | null>;
}

/**
 * AI调用日志数据
 */
export interface AICallLogData {
	// ========== 必填字段 ==========
	traceId: string;           // 追踪ID
	provider: string;          // AI提供商 (qwen, dify, openai等)
	model: string;             // 模型名称
	operation: string;         // 操作类型 (chat, completion, embedding等)
	mode: string;              // 调用模式 (ask, code, architect, debug等)
	status: 'success' | 'failed' | 'aborted';  // 状态
	startTime: Date;           // 开始时间

	// ========== Token统计 ==========
	inputTokens?: number;      // 输入Token数
	outputTokens?: number;     // 输出Token数

	// ========== 性能 ==========
	durationMs?: number;       // 调用耗时(毫秒)
	firstTokenMs?: number;     // 首Token耗时(毫秒)

	// ========== 用户信息 ==========
	userEmail?: string;        // 用户邮箱

	// ========== 设备信息 ==========
	deviceInfo?: DeviceInfo;

	// ========== IDE信息 ==========
	ideInfo?: IdeInfo;

	// ========== 知识库信息 ==========
	knowledgeBaseInfo?: KnowledgeBaseInfo;

	// ========== 错误信息 ==========
	errorCode?: string;        // 错误代码
	errorMessage?: string;     // 错误信息

	// ========== 请求详情 ==========
	requestSummary?: string;   // 请求摘要
	responseSummary?: string;  // 响应摘要
	hasTools?: boolean;        // 是否使用工具
	toolCallsCount?: number;   // 工具调用次数

	// ========== IP ==========
	clientIp?: string;         // 客户端IP

	// ========== 时间 ==========
	endTime?: Date;            // 结束时间
}

/**
 * 设备信息
 */
export interface DeviceInfo {
	type?: string;             // 设备类型
	id?: string;               // 设备ID
	name?: string;             // 设备名称
	osVersion?: string;        // 操作系统版本
}

/**
 * IDE信息
 */
export interface IdeInfo {
	type?: string;             // IDE类型
	version?: string;          // IDE版本
	pluginVersion?: string;    // 插件版本
	projectName?: string;      // 项目名称
}

/**
 * 知识库信息（ask模式）
 */
export interface KnowledgeBaseInfo {
	id?: number;               // 知识库ID
	name?: string;             // 知识库名称
	type?: string;             // 知识库类型
	retrievalCount?: number;   // 检索文档数量
}
