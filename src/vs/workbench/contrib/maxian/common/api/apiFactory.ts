/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { IApiHandler, ApiConfiguration } from './types.js';
import { QwenHandler } from './qwenHandler.js';
import { AiProxyHandler, AiProxyConfiguration } from './aiProxyHandler.js';

/**
 * API 工厂类
 * 负责创建和管理 API Handler 实例
 */
export class ApiFactory {
	constructor(
		private readonly configurationService: IConfigurationService
	) { }

	/**
	 * 创建 API Handler 实例
	 * 优先使用 AI 代理服务（如果配置了 zhikai.auth.apiUrl），否则使用直接调用千问 API
	 * @param credentials 可选的认证凭证（用户名和密码），如果不提供则从配置读取
	 */
	createHandler(credentials?: { username: string; password: string }): IApiHandler {
		// 检查是否配置了 AI 代理服务
		const apiUrl = this.configurationService.getValue<string>('zhikai.auth.apiUrl');
		const username = credentials?.username || this.configurationService.getValue<string>('zhikai.auth.username');
		const password = credentials?.password || this.configurationService.getValue<string>('zhikai.auth.password');

		if (apiUrl && username && password) {
			// 使用 AI 代理服务（推荐方式）
			console.log('[ApiFactory] 使用 AI 代理服务:', apiUrl);

			const model = this.configurationService.getValue<string>('zhikai.ai.model') || 'qwen-plus';
			const provider = this.configurationService.getValue<string>('zhikai.ai.provider') || 'qwen';

			const config: AiProxyConfiguration = {
				apiUrl,
				username: btoa(username), // Base64编码
				password: btoa(password), // Base64编码
				provider,
				model
			};

			return new AiProxyHandler(config);
		} else {
			// 回退到直接调用千问 API（向后兼容）
			console.log('[ApiFactory] 使用千问 API 直连模式（已废弃，请配置 zhikai.auth.* 使用代理服务）');

			const apiKey = this.configurationService.getValue<string>('zhikai.ai.apiKey') || '';
			const model = this.configurationService.getValue<string>('zhikai.ai.model') || 'qwen-coder-turbo';
			const temperature = this.configurationService.getValue<number>('zhikai.ai.temperature') ?? 0.15;
			const maxTokens = this.configurationService.getValue<number>('zhikai.ai.maxTokens') ?? 1000;
			const timeout = this.configurationService.getValue<number>('zhikai.ai.timeout') ?? 30000;

			const config: ApiConfiguration = {
				apiKey,
				model,
				temperature,
				maxTokens,
				timeout
			};

			return new QwenHandler(config);
		}
	}

	/**
	 * 验证配置是否有效
	 */
	validateConfiguration(): { valid: boolean; error?: string } {
		// 检查是否配置了 AI 代理服务
		const apiUrl = this.configurationService.getValue<string>('zhikai.auth.apiUrl');
		const username = this.configurationService.getValue<string>('zhikai.auth.username');
		const password = this.configurationService.getValue<string>('zhikai.auth.password');

		if (apiUrl && username && password) {
			// 代理服务配置完整
			return { valid: true };
		}

		// 回退检查千问 API 配置
		const apiKey = this.configurationService.getValue<string>('zhikai.ai.apiKey');

		if (!apiKey) {
			return {
				valid: false,
				error: '未配置 AI 服务。请在设置中配置 zhikai.auth.* (推荐) 或 zhikai.ai.apiKey (已废弃)'
			};
		}

		return { valid: true };
	}
}
