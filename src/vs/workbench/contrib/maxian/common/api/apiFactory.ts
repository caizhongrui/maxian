/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { IApiHandler, ApiConfiguration } from './types.js';
import { QwenHandler } from './qwenHandler.js';

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
	 * 根据配置读取千问 API 设置并创建对应的 Handler
	 */
	createHandler(): IApiHandler {
		// 从配置中读取 API 设置
		const apiKey = this.configurationService.getValue<string>('zhikai.ai.apiKey') || '';
		const model = this.configurationService.getValue<string>('zhikai.ai.model') || 'qwen-coder-turbo';
		const temperature = this.configurationService.getValue<number>('zhikai.ai.temperature') ?? 0.15;
		const maxTokens = this.configurationService.getValue<number>('zhikai.ai.maxTokens') ?? 1000;
		const timeout = this.configurationService.getValue<number>('zhikai.ai.timeout') ?? 30000;

		// 构建配置对象
		const config: ApiConfiguration = {
			apiKey,
			model,
			temperature,
			maxTokens,
			timeout
		};

		// 目前只支持千问模型，直接返回 QwenHandler
		return new QwenHandler(config);
	}

	/**
	 * 验证配置是否有效
	 */
	validateConfiguration(): { valid: boolean; error?: string } {
		const apiKey = this.configurationService.getValue<string>('zhikai.ai.apiKey');

		if (!apiKey) {
			return {
				valid: false,
				error: '未配置 API Key。请在设置中配置 zhikai.ai.apiKey'
			};
		}

		return { valid: true };
	}
}
