/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';

/**
 * FIM 补全支持的语言列表
 * 与 GitHub Copilot 和 aiInlineCompletions 保持一致
 */
export const FIM_SUPPORTED_LANGUAGES = new Set([
	'typescript',
	'typescriptreact',
	'javascript',
	'javascriptreact',
	'java',
	'python',
	'vue',
	'go',
	'rust',
	'c',
	'cpp',
	'csharp',
	'php',
	'ruby',
	'kotlin',
	'swift',
	'scala',
	'css',
	'scss',
	'less',
	'html',
	'json',
	'yaml',
	'toml',
	'shell',
	'bash',
	'markdown',
	'sql',
	'xml',
]);

/**
 * FIM 补全配置
 */
export interface FimSettings {
	/** FIM 补全是否启用 */
	enabled: boolean;
	/** 防抖延迟（毫秒） */
	debounceDelay: number;
	/** 光标前最大行数（prefix 上下文） */
	maxPrefixLines: number;
	/** 光标后最大行数（suffix 上下文） */
	maxSuffixLines: number;
	/** 请求超时时间（毫秒） */
	requestTimeout: number;
	/** 触发模式：manual（快捷键）或 automatic（自动） */
	triggerMode: 'manual' | 'automatic';
	/** 是否启用补全缓存 */
	cacheEnabled: boolean;
	/** 缓存有效期（毫秒） */
	cacheTtlMs: number;
	/** prefix 最大 token 预算（近似值） */
	maxPrefixTokens: number;
	/** suffix 最大 token 预算（近似值） */
	maxSuffixTokens: number;
}

/**
 * 读取 FIM 配置
 */
export function readFimSettings(configurationService: IConfigurationService): FimSettings {
	const enabled = configurationService.getValue<boolean>('maxian.fim.enabled') ?? true;
	const fimTriggerMode = configurationService.getValue<string>('maxian.fim.triggerMode');
	const legacyTriggerMode = configurationService.getValue<string>('zhikai.ai.completionTriggerMode');
	const resolvedTriggerMode = (fimTriggerMode ?? legacyTriggerMode ?? 'automatic');
	const triggerMode = (resolvedTriggerMode === 'manual' || resolvedTriggerMode === 'automatic')
		? resolvedTriggerMode
		: 'automatic';
	const debounceDelay = configurationService.getValue<number>('maxian.fim.debounceDelay') ?? 300;
	const maxPrefixLines = configurationService.getValue<number>('maxian.fim.maxPrefixLines') ?? 60;
	const maxSuffixLines = configurationService.getValue<number>('maxian.fim.maxSuffixLines') ?? 10;
	const requestTimeout = configurationService.getValue<number>('maxian.fim.requestTimeout') ?? 5000;
	const cacheEnabled = configurationService.getValue<boolean>('maxian.fim.cacheEnabled') ?? true;
	const cacheTtlMs = configurationService.getValue<number>('maxian.fim.cacheTtlMs') ?? 8000;
	const maxPrefixTokens = configurationService.getValue<number>('maxian.fim.maxPrefixTokens') ?? 1600;
	const maxSuffixTokens = configurationService.getValue<number>('maxian.fim.maxSuffixTokens') ?? 320;

	return {
		enabled,
		triggerMode,
		debounceDelay,
		maxPrefixLines,
		maxSuffixLines,
		requestTimeout,
		cacheEnabled,
		cacheTtlMs,
		maxPrefixTokens,
		maxSuffixTokens,
	};
}

/**
 * 判断给定语言是否支持 FIM 补全
 */
export function isFimSupportedLanguage(languageId: string): boolean {
	return FIM_SUPPORTED_LANGUAGES.has(languageId);
}
