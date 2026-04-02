/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export type StructuredLogLevel = 'error' | 'warn' | 'info' | 'debug';

const levelRank: Record<StructuredLogLevel, number> = {
	error: 0,
	warn: 1,
	info: 2,
	debug: 3,
};

function normalizeLevel(value: string | undefined): StructuredLogLevel | undefined {
	switch ((value || '').toLowerCase()) {
		case 'error': return 'error';
		case 'warn':
		case 'warning': return 'warn';
		case 'info': return 'info';
		case 'debug':
		case 'trace': return 'debug';
		default: return undefined;
	}
}

function resolveGlobalLevel(): StructuredLogLevel {
	const processLevel = normalizeLevel(typeof process !== 'undefined' ? process.env?.ZHIKAI_LOG_LEVEL : undefined);
	if (processLevel) {
		return processLevel;
	}

	const globalLevel = normalizeLevel((globalThis as any).__ZHIKAI_LOG_LEVEL);
	if (globalLevel) {
		return globalLevel;
	}

	// 默认生产风格：仅输出 warn/error
	return 'warn';
}

function shouldLog(level: StructuredLogLevel, minLevel: StructuredLogLevel): boolean {
	return levelRank[level] <= levelRank[minLevel];
}

function emit(level: StructuredLogLevel, payload: Record<string, unknown>): void {
	const line = JSON.stringify(payload);
	switch (level) {
		case 'error':
			console.error(line);
			return;
		case 'warn':
			console.warn(line);
			return;
		case 'info':
			console.info(line);
			return;
		default:
			console.debug(line);
	}
}

export function createStructuredLogger(scope: string, minLevel?: StructuredLogLevel) {
	const resolvedMinLevel = minLevel ?? resolveGlobalLevel();

	const log = (level: StructuredLogLevel, event: string, data?: Record<string, unknown>) => {
		if (!shouldLog(level, resolvedMinLevel)) {
			return;
		}
		emit(level, {
			ts: new Date().toISOString(),
			level,
			scope,
			event,
			...(data ?? {}),
		});
	};

	return {
		error: (event: string, data?: Record<string, unknown>) => log('error', event, data),
		warn: (event: string, data?: Record<string, unknown>) => log('warn', event, data),
		info: (event: string, data?: Record<string, unknown>) => log('info', event, data),
		debug: (event: string, data?: Record<string, unknown>) => log('debug', event, data),
	};
}

