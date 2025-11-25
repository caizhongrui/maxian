/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { IAILogService, AICallLogData } from '../../../../platform/aiLog/common/aiLog.js';
import { IStorageService, StorageScope } from '../../../../platform/storage/common/storage.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';

/**
 * AI调用日志记录服务实现
 */
export class AILogService extends Disposable implements IAILogService {
	declare readonly _serviceBrand: undefined;

	constructor(
		@IStorageService private readonly storageService: IStorageService,
		@IConfigurationService private readonly configurationService: IConfigurationService
	) {
		super();
	}

	/**
	 * 记录AI调用日志
	 */
	async logAICall(logData: AICallLogData): Promise<number | null> {
		try {
			// 1. 获取API URL
			const apiUrl = this.configurationService.getValue<string>('zhikai.auth.apiUrl');
			if (!apiUrl) {
				console.warn('[AILogService] API URL 未配置，跳过日志记录');
				return null;
			}

			// 2. 获取认证凭据
			const credentials = this.loadAuthCredentials();
			if (!credentials) {
				console.warn('[AILogService] 未找到认证凭据，跳过日志记录');
				return null;
			}

			// 3. 构建请求体
			const requestBody = this.buildRequestBody(logData);

			// 4. 发送请求
			const baseUrl = apiUrl.replace(/\/+$/, ''); // 移除末尾斜杠
			const logUrl = `${baseUrl}/ai/call-log`;

			console.log('[AILogService] 记录AI调用日志:', {
				url: logUrl,
				traceId: logData.traceId,
				mode: logData.mode,
				status: logData.status
			});

			const response = await fetch(logUrl, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'username': credentials.username,
					'password': credentials.password
				},
				body: JSON.stringify(requestBody)
			});

			if (!response.ok) {
				const errorText = await response.text();
				console.error('[AILogService] 记录日志失败:', response.status, errorText);
				return null;
			}

			const result = await response.json();
			console.log('[AILogService] 日志记录成功:', result);

			// 返回记录ID
			return result.data || null;

		} catch (error) {
			console.error('[AILogService] 记录AI调用日志失败:', error);
			return null;
		}
	}

	/**
	 * 构建请求体
	 */
	private buildRequestBody(logData: AICallLogData): any {
		return {
			traceId: logData.traceId,
			userEmail: logData.userEmail,
			deviceInfo: logData.deviceInfo,
			ideInfo: logData.ideInfo,
			knowledgeBaseInfo: logData.knowledgeBaseInfo,
			provider: logData.provider,
			model: logData.model,
			operation: logData.operation,
			mode: logData.mode,
			inputTokens: logData.inputTokens,
			outputTokens: logData.outputTokens,
			inputCost: null, // 暂不计算，由后端计算
			outputCost: null, // 暂不计算，由后端计算
			durationMs: logData.durationMs,
			firstTokenMs: logData.firstTokenMs,
			status: logData.status,
			errorCode: logData.errorCode,
			errorMessage: logData.errorMessage,
			requestSummary: logData.requestSummary,
			responseSummary: logData.responseSummary,
			hasTools: logData.hasTools,
			toolCallsCount: logData.toolCallsCount,
			clientIp: logData.clientIp,
			startTime: this.formatDate(logData.startTime),
			endTime: logData.endTime ? this.formatDate(logData.endTime) : null
		};
	}

	/**
	 * 格式化日期为后端所需格式
	 */
	private formatDate(date: Date): string {
		const year = date.getFullYear();
		const month = String(date.getMonth() + 1).padStart(2, '0');
		const day = String(date.getDate()).padStart(2, '0');
		const hours = String(date.getHours()).padStart(2, '0');
		const minutes = String(date.getMinutes()).padStart(2, '0');
		const seconds = String(date.getSeconds()).padStart(2, '0');
		return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
	}

	/**
	 * 从StorageService加载认证凭据
	 */
	private loadAuthCredentials(): { username: string; password: string } | undefined {
		try {
			const stored = this.storageService.get('zhikai.auth.credentials', StorageScope.APPLICATION);
			if (!stored) {
				return undefined;
			}

			const parsed = JSON.parse(stored);
			if (parsed && parsed.username && parsed.password) {
				return {
					username: btoa(parsed.username), // Base64编码
					password: btoa(parsed.password)  // Base64编码
				};
			}

			return undefined;
		} catch (error) {
			console.error('[AILogService] 加载认证凭据失败:', error);
			return undefined;
		}
	}
}

registerSingleton(IAILogService, AILogService, InstantiationType.Delayed);
