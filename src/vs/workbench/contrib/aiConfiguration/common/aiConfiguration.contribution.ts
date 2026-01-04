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
		'zhikai.ai.enableCache': {
			type: 'boolean',
			default: true,
			description: '启用 AI 响应缓存（提升速度，降低成本）',
			scope: ConfigurationScope.MACHINE,
			order: 1
		},
		'zhikai.ai.timeout': {
			type: 'number',
			default: 30000,
			minimum: 5000,
			maximum: 120000,
			description: 'API 请求超时时间（毫秒，5000-120000）',
			scope: ConfigurationScope.MACHINE,
			order: 2
		},
		'zhikai.ai.enableInlineCompletions': {
			type: 'boolean',
			default: true,
			description: '启用 AI 行内代码补全（类似 GitHub Copilot）',
			scope: ConfigurationScope.WINDOW,
			order: 3
		},
		'zhikai.ai.completionTriggerMode': {
			type: 'string',
			default: 'automatic',
			enum: [
				'automatic',
				'manual'
			],
			enumDescriptions: [
				'自动触发（默认）- 输入代码时自动调用 AI',
				'手动触发 - 按快捷键（Alt+K 或 Cmd+I）时才调用 AI'
			],
			description: 'AI 补全触发模式：自动（automatic）或手动（manual）',
			scope: ConfigurationScope.WINDOW,
			order: 4
		},
		'zhikai.ai.completionDelay': {
			type: 'number',
			default: 500,
			minimum: 100,
			maximum: 2000,
			description: '代码补全延迟时间（毫秒）。较低值响应更快，但可能增加 API 调用。仅在自动模式下生效',
			scope: ConfigurationScope.WINDOW,
			order: 5
		},
		'zhikai.ai.contextLines': {
			type: 'number',
			default: 30,
			minimum: 10,
			maximum: 100,
			description: '代码补全时提取的上下文行数（10-100）',
			scope: ConfigurationScope.WINDOW,
			order: 6
		},
		'zhikai.ai.showDebugLogs': {
			type: 'boolean',
			default: false,
			description: '在开发者控制台显示 AI 调试日志',
			scope: ConfigurationScope.WINDOW,
			order: 7
		},
		// 认证配置
		'zhikai.auth.apiUrl': {
			type: 'string',
			default: 'http://192.168.0.185:8088',
			description: '后端 API 地址（例如: http://192.168.0.185:8088）',
			scope: ConfigurationScope.MACHINE,
			order: 8
		},
		'zhikai.auth.username': {
			type: 'string',
			default: '',
			description: '登录用户名（密码将加密存储，不会显示在设置中）',
			scope: ConfigurationScope.MACHINE,
			order: 9
		}
	}
});
