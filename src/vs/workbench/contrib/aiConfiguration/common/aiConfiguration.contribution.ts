/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Registry } from '../../../../platform/registry/common/platform.js';
import { IConfigurationRegistry, Extensions, ConfigurationScope } from '../../../../platform/configuration/common/configurationRegistry.js';

const configurationRegistry = Registry.as<IConfigurationRegistry>(Extensions.Configuration);

configurationRegistry.registerConfiguration({
	id: 'zhikai',
	title: '码弦 AI',  // 使用中文
	type: 'object',
	order: 1,  // 排在最前面
	properties: {
		'zhikai.ai.apiKey': {
			type: 'string',
			default: '',
			description: 'Qwen API Key（通义千问 API 密钥）',
			scope: ConfigurationScope.MACHINE,
			order: 1
		},
		'zhikai.ai.model': {
			type: 'string',
			default: 'qwen-coder-turbo',
			enum: [
				'qwen-coder-turbo',
				'qwen3-coder-480b-a35b-instruct',
				'qwen-max',
				'qwen-plus'
			],
			enumDescriptions: [
				'Qwen Coder Turbo（推荐，代码补全专用）',
				'Qwen3 Coder 480B（最新大模型，精准度最高）',
				'Qwen Max（质量高，适合复杂任务）',
				'Qwen Plus（平衡性能和质量）'
			],
			description: 'AI 模型选择',
			scope: ConfigurationScope.MACHINE,
			order: 2
		},
		'zhikai.ai.temperature': {
			type: 'number',
			default: 0.15,
			minimum: 0,
			maximum: 2,
			description: 'AI 温度参数（0-2）。较低值（0.1-0.2）适合代码补全，较高值（0.5-0.7）适合创意生成',
			scope: ConfigurationScope.MACHINE,
			order: 3
		},
		'zhikai.ai.maxTokens': {
			type: 'number',
			default: 1000,
			minimum: 100,
			maximum: 4000,
			description: 'AI 最大生成 Token 数量（100-4000）',
			scope: ConfigurationScope.MACHINE,
			order: 4
		},
		'zhikai.ai.enableCache': {
			type: 'boolean',
			default: true,
			description: '启用 AI 响应缓存（提升速度，降低成本）',
			scope: ConfigurationScope.MACHINE,
			order: 5
		},
		'zhikai.ai.timeout': {
			type: 'number',
			default: 30000,
			minimum: 5000,
			maximum: 120000,
			description: 'API 请求超时时间（毫秒，5000-120000）',
			scope: ConfigurationScope.MACHINE,
			order: 6
		},
		'zhikai.ai.enableInlineCompletions': {
			type: 'boolean',
			default: true,
			description: '启用 AI 行内代码补全（类似 GitHub Copilot）',
			scope: ConfigurationScope.WINDOW,
			order: 7
		},
		'zhikai.ai.completionTriggerMode': {
			type: 'string',
			default: 'manual',
			enum: [
				'manual',
				'automatic'
			],
			enumDescriptions: [
				'手动触发（推荐）- 按快捷键（Alt+K 或 Cmd+I）时才调用 AI',
				'自动触发 - 输入代码时自动调用 AI（会增加 API 调用次数和成本）'
			],
			description: 'AI 补全触发模式：手动（manual）或自动（automatic）',
			scope: ConfigurationScope.WINDOW,
			order: 8
		},
		'zhikai.ai.completionDelay': {
			type: 'number',
			default: 500,
			minimum: 100,
			maximum: 2000,
			description: '代码补全延迟时间（毫秒）。较低值响应更快，但可能增加 API 调用。仅在自动模式下生效',
			scope: ConfigurationScope.WINDOW,
			order: 9
		},
		'zhikai.ai.contextLines': {
			type: 'number',
			default: 30,
			minimum: 10,
			maximum: 100,
			description: '代码补全时提取的上下文行数（10-100）',
			scope: ConfigurationScope.WINDOW,
			order: 10
		},
		'zhikai.ai.showDebugLogs': {
			type: 'boolean',
			default: false,
			description: '在开发者控制台显示 AI 调试日志',
			scope: ConfigurationScope.WINDOW,
			order: 11
		},
		// 认证配置
		'zhikai.auth.apiUrl': {
			type: 'string',
			default: 'http://192.168.0.185:8088/',
			description: '后端 API 地址（例如: http://192.168.0.185:8088/）',
			scope: ConfigurationScope.MACHINE,
			order: 12
		},
		'zhikai.auth.username': {
			type: 'string',
			default: '',
			description: '登录用户名（密码将加密存储，不会显示在设置中）',
			scope: ConfigurationScope.MACHINE,
			order: 13
		}
	}
});
