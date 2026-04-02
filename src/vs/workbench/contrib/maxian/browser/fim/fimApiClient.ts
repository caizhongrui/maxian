/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { IStorageService, StorageScope } from '../../../../../platform/storage/common/storage.js';

/**
 * FIM 请求参数
 */
export interface FimRequest {
	/** 光标前的代码前缀 */
	prefix: string;
	/** 光标后的代码后缀 */
	suffix: string;
	/** 最大生成 token 数 */
	maxTokens?: number;
	/** 温度参数（0-1，越低越确定性） */
	temperature?: number;
	/** 项目名称，用于日志记录 */
	projectName?: string;
}

/**
 * FIM 响应结果
 */
export interface FimResponse {
	/** 补全的代码文本，若为空则表示无补全或超时 */
	completion: string;
	/** 是否超时 */
	timedOut: boolean;
}

/**
 * 认证凭据
 */
interface AuthCredentials {
	username: string;
	password: string;
}

/**
 * FIM API 客户端
 *
 * 独立于码弦 Agent 聊天的 API 调用，专门用于 Fill-in-the-Middle 代码补全。
 * 通过后端代理的 /ai/proxy/chat/completions 端点，使用 apiType=completions 参数
 * 调用支持 FIM 格式的代码补全模型（如 qwen-coder-turbo）。
 *
 * 认证方式与码弦主服务相同：读取 StorageService 中的 zhikai.auth.credentials。
 */
export class FimApiClient {

	/** FIM 专用 businessCode，后端据此选择补全专用模型 */
	private static readonly FIM_BUSINESS_CODE = 'IDE_CODE_COMPLETION';

	/** 默认请求超时（毫秒），FIM 补全要求低延迟 */
	private static readonly DEFAULT_TIMEOUT = 3000;

	/** FIM 默认最大 token 数，补全通常 <50 tokens，128 足够且避免超时 */
	private static readonly DEFAULT_MAX_TOKENS = 128;

	/** FIM 默认温度，接近 0 以保证确定性代码输出 */
	private static readonly DEFAULT_TEMPERATURE = 0.05;

	constructor(
		private readonly configurationService: IConfigurationService,
		private readonly storageService: IStorageService
	) {}

	/**
	 * 从 StorageService 读取认证凭据
	 * 与 maxianService.loadAuthCredentials() 和 aiService 保持相同的读取逻辑
	 */
	private loadAuthCredentials(): AuthCredentials | undefined {
		try {
			const stored = this.storageService.get('zhikai.auth.credentials', StorageScope.APPLICATION);
			if (!stored) {
				return undefined;
			}
			const parsed = JSON.parse(stored);
			if (parsed && parsed.username && parsed.password) {
				return { username: parsed.username, password: parsed.password };
			}
			return undefined;
		} catch (error) {
			console.error('[FIM API Client] 读取认证凭据失败:', error);
			return undefined;
		}
	}

	/**
	 * 获取 API 基础 URL
	 */
	private getApiUrl(): string | undefined {
		return this.configurationService.getValue<string>('zhikai.auth.apiUrl') || undefined;
	}

	/**
	 * 调用 FIM 补全 API
	 *
	 * 通过后端代理调用 Qwen 等 FIM 模型。请求格式使用
	 * `<|fim_prefix|>{prefix}<|fim_suffix|>{suffix}<|fim_middle|>` 语义，
	 * 由后端代理负责将 fimPrefix/fimSuffix 转换为对应模型的 FIM 格式。
	 *
	 * @param request FIM 请求参数
	 * @param timeoutMs 超时毫秒数，超时返回空补全
	 * @returns FIM 响应结果
	 */
	async complete(request: FimRequest, timeoutMs?: number): Promise<FimResponse> {
		const apiUrl = this.getApiUrl();
		const credentials = this.loadAuthCredentials();

		if (!apiUrl || !credentials) {
			console.warn('[FIM API Client] 未配置 API 地址或认证凭据，跳过 FIM 补全');
			return { completion: '', timedOut: false };
		}

		const endpoint = `${apiUrl.replace(/\/$/, '')}/ai/proxy/chat/completions`;
		const timeout = timeoutMs ?? FimApiClient.DEFAULT_TIMEOUT;

		const requestBody: Record<string, unknown> = {
			businessCode: FimApiClient.FIM_BUSINESS_CODE,
			username: btoa(credentials.username),
			password: btoa(credentials.password),
			apiType: 'completions',          // 告知后端使用 /completions FIM 端点
			fimPrefix: request.prefix,       // 光标前内容
			fimSuffix: request.suffix,       // 光标后内容
			temperature: request.temperature ?? FimApiClient.DEFAULT_TEMPERATURE,
			maxTokens: request.maxTokens ?? FimApiClient.DEFAULT_MAX_TOKENS,
			autoLog: true,                   // 代码补全无显式日志，由后端自动记录
		};
		if (request.projectName) {
			requestBody['projectName'] = request.projectName;
		}

		const controller = new AbortController();
		const timeoutId = setTimeout(() => {
			controller.abort();
		}, timeout);

		try {
			const response = await fetch(endpoint, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
				},
				body: JSON.stringify(requestBody),
				signal: controller.signal,
			});

			clearTimeout(timeoutId);

			if (!response.ok) {
				console.warn('[FIM API Client] HTTP 错误:', response.status, response.statusText);
				return { completion: '', timedOut: false };
			}

			const data = await response.json() as any;

			// 解析后端代理响应格式：{ data: { choices: [{ message: { content } }] } }
			if (data && data.data && data.data.choices && data.data.choices[0]) {
				const choice = data.data.choices[0];
				// FIM completions 端点返回的文本在 message.content 或 text 字段
				const content: string = choice.message?.content ?? choice.text ?? '';
				return { completion: content, timedOut: false };
			}

			console.warn('[FIM API Client] 响应格式不符合预期:', JSON.stringify(data).substring(0, 200));
			return { completion: '', timedOut: false };

		} catch (error: any) {
			clearTimeout(timeoutId);

			if (error.name === 'AbortError') {
				console.warn('[FIM API Client] 请求超时 (' + timeout + 'ms)');
				return { completion: '', timedOut: true };
			}

			console.error('[FIM API Client] 请求失败:', error);
			return { completion: '', timedOut: false };
		}
	}
}
