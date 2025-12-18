/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * 结构化错误响应系统
 * 参考 OpenCode 的错误处理机制实现
 *
 * 功能：
 * - 统一的错误格式
 * - 错误分类和编码
 * - 可操作的修复建议
 * - 错误上下文信息
 * - AI 友好的错误描述
 */

/**
 * 错误类别
 */
export enum ErrorCategory {
	/** 文件操作错误 */
	FileOperation = 'FILE_OPERATION',
	/** 权限错误 */
	Permission = 'PERMISSION',
	/** 验证错误 */
	Validation = 'VALIDATION',
	/** 网络错误 */
	Network = 'NETWORK',
	/** 超时错误 */
	Timeout = 'TIMEOUT',
	/** 资源不存在 */
	NotFound = 'NOT_FOUND',
	/** 资源已存在 */
	AlreadyExists = 'ALREADY_EXISTS',
	/** 内部错误 */
	Internal = 'INTERNAL',
	/** 配置错误 */
	Configuration = 'CONFIGURATION',
	/** 依赖错误 */
	Dependency = 'DEPENDENCY',
	/** 用户取消 */
	UserCancelled = 'USER_CANCELLED',
	/** 限流错误 */
	RateLimit = 'RATE_LIMIT',
}

/**
 * 错误严重程度
 */
export enum ErrorSeverity {
	/** 信息 - 可以继续 */
	Info = 'info',
	/** 警告 - 可能有问题 */
	Warning = 'warning',
	/** 错误 - 操作失败 */
	Error = 'error',
	/** 致命 - 无法恢复 */
	Fatal = 'fatal',
}

/**
 * 修复建议
 */
export interface ErrorSuggestion {
	/** 建议描述 */
	description: string;
	/** 建议的操作（如重试、使用其他方法等） */
	action?: string;
	/** 示例代码或命令 */
	example?: string;
	/** 是否自动可修复 */
	autoFixable?: boolean;
}

/**
 * 错误上下文
 */
export interface ErrorContext {
	/** 相关文件路径 */
	filePath?: string;
	/** 相关行号 */
	lineNumber?: number;
	/** 相关列号 */
	columnNumber?: number;
	/** 工具名称 */
	toolName?: string;
	/** 操作类型 */
	operation?: string;
	/** 原始输入 */
	input?: any;
	/** 其他元数据 */
	metadata?: Record<string, any>;
}

/**
 * 结构化错误
 */
export interface StructuredError {
	/** 错误代码（唯一标识） */
	code: string;
	/** 错误类别 */
	category: ErrorCategory;
	/** 严重程度 */
	severity: ErrorSeverity;
	/** 简短消息 */
	message: string;
	/** 详细描述 */
	details?: string;
	/** 修复建议 */
	suggestions?: ErrorSuggestion[];
	/** 错误上下文 */
	context?: ErrorContext;
	/** 原始错误 */
	cause?: Error;
	/** 时间戳 */
	timestamp: number;
	/** 是否可重试 */
	retryable?: boolean;
}

/**
 * 预定义错误代码
 */
export const ErrorCodes = {
	// 文件操作
	FILE_NOT_FOUND: 'FILE_NOT_FOUND',
	FILE_READ_FAILED: 'FILE_READ_FAILED',
	FILE_WRITE_FAILED: 'FILE_WRITE_FAILED',
	FILE_DELETE_FAILED: 'FILE_DELETE_FAILED',
	FILE_PERMISSION_DENIED: 'FILE_PERMISSION_DENIED',
	FILE_TOO_LARGE: 'FILE_TOO_LARGE',
	FILE_ENCODING_ERROR: 'FILE_ENCODING_ERROR',
	FILE_EXTERNALLY_MODIFIED: 'FILE_EXTERNALLY_MODIFIED',

	// 编辑操作
	EDIT_MATCH_NOT_FOUND: 'EDIT_MATCH_NOT_FOUND',
	EDIT_MULTIPLE_MATCHES: 'EDIT_MULTIPLE_MATCHES',
	EDIT_CONTENT_MISMATCH: 'EDIT_CONTENT_MISMATCH',
	EDIT_INVALID_RANGE: 'EDIT_INVALID_RANGE',

	// 命令执行
	COMMAND_FAILED: 'COMMAND_FAILED',
	COMMAND_TIMEOUT: 'COMMAND_TIMEOUT',
	COMMAND_PERMISSION_DENIED: 'COMMAND_PERMISSION_DENIED',
	COMMAND_NOT_FOUND: 'COMMAND_NOT_FOUND',

	// 搜索操作
	SEARCH_NO_RESULTS: 'SEARCH_NO_RESULTS',
	SEARCH_INVALID_REGEX: 'SEARCH_INVALID_REGEX',
	SEARCH_TIMEOUT: 'SEARCH_TIMEOUT',

	// 网络操作
	NETWORK_REQUEST_FAILED: 'NETWORK_REQUEST_FAILED',
	NETWORK_TIMEOUT: 'NETWORK_TIMEOUT',
	NETWORK_INVALID_URL: 'NETWORK_INVALID_URL',
	NETWORK_SSL_ERROR: 'NETWORK_SSL_ERROR',

	// 权限
	PERMISSION_DENIED: 'PERMISSION_DENIED',
	PERMISSION_WORKSPACE_BOUNDARY: 'PERMISSION_WORKSPACE_BOUNDARY',
	PERMISSION_SENSITIVE_PATH: 'PERMISSION_SENSITIVE_PATH',

	// 验证
	VALIDATION_MISSING_PARAM: 'VALIDATION_MISSING_PARAM',
	VALIDATION_INVALID_PARAM: 'VALIDATION_INVALID_PARAM',
	VALIDATION_INVALID_FORMAT: 'VALIDATION_INVALID_FORMAT',

	// 内部
	INTERNAL_ERROR: 'INTERNAL_ERROR',
	NOT_IMPLEMENTED: 'NOT_IMPLEMENTED',
	CONFIGURATION_ERROR: 'CONFIGURATION_ERROR',

	// 资源
	RESOURCE_EXHAUSTED: 'RESOURCE_EXHAUSTED',
	RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

/**
 * 创建结构化错误
 */
export function createStructuredError(
	code: ErrorCode,
	message: string,
	options: {
		category?: ErrorCategory;
		severity?: ErrorSeverity;
		details?: string;
		suggestions?: ErrorSuggestion[];
		context?: ErrorContext;
		cause?: Error;
		retryable?: boolean;
	} = {}
): StructuredError {
	// 根据错误代码推断默认类别
	const category = options.category || inferCategory(code);
	const severity = options.severity || ErrorSeverity.Error;

	return {
		code,
		category,
		severity,
		message,
		details: options.details,
		suggestions: options.suggestions || getDefaultSuggestions(code),
		context: options.context,
		cause: options.cause,
		timestamp: Date.now(),
		retryable: options.retryable ?? isRetryable(code),
	};
}

/**
 * 根据错误代码推断类别
 */
function inferCategory(code: ErrorCode): ErrorCategory {
	if (code.startsWith('FILE_')) return ErrorCategory.FileOperation;
	if (code.startsWith('EDIT_')) return ErrorCategory.FileOperation;
	if (code.startsWith('COMMAND_')) return ErrorCategory.FileOperation;
	if (code.startsWith('SEARCH_')) return ErrorCategory.FileOperation;
	if (code.startsWith('NETWORK_')) return ErrorCategory.Network;
	if (code.startsWith('PERMISSION_')) return ErrorCategory.Permission;
	if (code.startsWith('VALIDATION_')) return ErrorCategory.Validation;
	if (code.startsWith('RATE_')) return ErrorCategory.RateLimit;
	return ErrorCategory.Internal;
}

/**
 * 判断错误是否可重试
 */
function isRetryable(code: ErrorCode): boolean {
	const retryableCodes: ErrorCode[] = [
		ErrorCodes.NETWORK_REQUEST_FAILED,
		ErrorCodes.NETWORK_TIMEOUT,
		ErrorCodes.COMMAND_TIMEOUT,
		ErrorCodes.SEARCH_TIMEOUT,
		ErrorCodes.RATE_LIMIT_EXCEEDED,
		ErrorCodes.FILE_EXTERNALLY_MODIFIED,
	];
	return retryableCodes.includes(code);
}

/**
 * 获取默认修复建议
 */
function getDefaultSuggestions(code: ErrorCode): ErrorSuggestion[] {
	const suggestions: Partial<Record<ErrorCode, ErrorSuggestion[]>> = {
		[ErrorCodes.FILE_NOT_FOUND]: [
			{
				description: '使用 list_files 或 glob 确认文件路径',
				action: '搜索文件',
				example: '<glob>\n<file_pattern>**/*.ts</file_pattern>\n</glob>',
			},
			{
				description: '检查路径拼写是否正确',
			},
		],
		[ErrorCodes.FILE_PERMISSION_DENIED]: [
			{
				description: '检查文件权限设置',
				action: '使用 execute_command 检查权限',
				example: '<execute_command>\n<command>ls -la path/to/file</command>\n</execute_command>',
			},
		],
		[ErrorCodes.FILE_EXTERNALLY_MODIFIED]: [
			{
				description: '文件已被外部修改，请重新读取',
				action: '使用 read_file 重新读取文件',
				autoFixable: true,
			},
		],
		[ErrorCodes.EDIT_MATCH_NOT_FOUND]: [
			{
				description: '使用 read_file 查看文件当前内容',
				action: '读取文件',
			},
			{
				description: '检查 old_string 是否与文件内容完全匹配',
			},
			{
				description: '注意空白字符和缩进可能有差异',
			},
		],
		[ErrorCodes.EDIT_MULTIPLE_MATCHES]: [
			{
				description: '添加更多上下文使匹配唯一',
			},
			{
				description: '或使用 replace_all=true 替换所有匹配',
			},
		],
		[ErrorCodes.COMMAND_TIMEOUT]: [
			{
				description: '命令执行超时，可以尝试增加超时时间',
			},
			{
				description: '检查命令是否有死循环或等待输入',
			},
		],
		[ErrorCodes.NETWORK_TIMEOUT]: [
			{
				description: '网络请求超时，请稍后重试',
				autoFixable: true,
			},
		],
		[ErrorCodes.RATE_LIMIT_EXCEEDED]: [
			{
				description: '请求过于频繁，请稍等后重试',
				autoFixable: true,
			},
		],
		[ErrorCodes.VALIDATION_MISSING_PARAM]: [
			{
				description: '请提供缺少的必需参数',
			},
		],
		[ErrorCodes.PERMISSION_WORKSPACE_BOUNDARY]: [
			{
				description: '只能访问工作区内的文件',
			},
			{
				description: '如需访问外部文件，请使用绝对路径并确认权限',
			},
		],
		[ErrorCodes.PERMISSION_SENSITIVE_PATH]: [
			{
				description: '该路径被标记为敏感，需要特别确认',
			},
			{
				description: '敏感文件包括 .env、密钥文件等',
			},
		],
	};

	return suggestions[code] || [];
}

/**
 * 格式化结构化错误为用户友好的文本
 */
export function formatStructuredError(error: StructuredError): string {
	const lines: string[] = [];

	// 错误图标和级别
	const icons: Record<ErrorSeverity, string> = {
		[ErrorSeverity.Info]: 'i',
		[ErrorSeverity.Warning]: '!',
		[ErrorSeverity.Error]: 'x',
		[ErrorSeverity.Fatal]: 'X',
	};

	lines.push(`[${icons[error.severity]}] ${error.message}`);
	lines.push(`错误代码: ${error.code}`);

	if (error.details) {
		lines.push('');
		lines.push('详情:');
		lines.push(error.details);
	}

	if (error.context) {
		lines.push('');
		lines.push('上下文:');
		if (error.context.filePath) {
			lines.push(`- 文件: ${error.context.filePath}`);
		}
		if (error.context.lineNumber) {
			lines.push(`- 行号: ${error.context.lineNumber}`);
		}
		if (error.context.toolName) {
			lines.push(`- 工具: ${error.context.toolName}`);
		}
	}

	if (error.suggestions && error.suggestions.length > 0) {
		lines.push('');
		lines.push('建议:');
		for (const suggestion of error.suggestions) {
			lines.push(`- ${suggestion.description}`);
			if (suggestion.example) {
				lines.push('  示例:');
				lines.push(`  ${suggestion.example.split('\n').join('\n  ')}`);
			}
		}
	}

	if (error.retryable) {
		lines.push('');
		lines.push('* 此操作可以重试');
	}

	return lines.join('\n');
}

/**
 * 格式化结构化错误为 AI 友好的格式
 */
export function formatErrorForAI(error: StructuredError): string {
	const lines: string[] = [
		`<error code="${error.code}" category="${error.category}" severity="${error.severity}"${error.retryable ? ' retryable="true"' : ''}>`,
		`<message>${error.message}</message>`,
	];

	if (error.details) {
		lines.push(`<details>${error.details}</details>`);
	}

	if (error.context) {
		lines.push('<context>');
		if (error.context.filePath) {
			lines.push(`  <file_path>${error.context.filePath}</file_path>`);
		}
		if (error.context.lineNumber) {
			lines.push(`  <line_number>${error.context.lineNumber}</line_number>`);
		}
		if (error.context.toolName) {
			lines.push(`  <tool_name>${error.context.toolName}</tool_name>`);
		}
		lines.push('</context>');
	}

	if (error.suggestions && error.suggestions.length > 0) {
		lines.push('<suggestions>');
		for (const suggestion of error.suggestions) {
			lines.push(`  <suggestion${suggestion.autoFixable ? ' auto_fixable="true"' : ''}>`);
			lines.push(`    ${suggestion.description}`);
			if (suggestion.action) {
				lines.push(`    <action>${suggestion.action}</action>`);
			}
			if (suggestion.example) {
				lines.push(`    <example>${suggestion.example}</example>`);
			}
			lines.push('  </suggestion>');
		}
		lines.push('</suggestions>');
	}

	lines.push('</error>');

	return lines.join('\n');
}

/**
 * 错误构建器 - 提供流畅的 API
 */
export class ErrorBuilder {
	private error: Partial<StructuredError> = {
		timestamp: Date.now(),
	};

	code(code: ErrorCode): this {
		this.error.code = code;
		return this;
	}

	message(message: string): this {
		this.error.message = message;
		return this;
	}

	category(category: ErrorCategory): this {
		this.error.category = category;
		return this;
	}

	severity(severity: ErrorSeverity): this {
		this.error.severity = severity;
		return this;
	}

	details(details: string): this {
		this.error.details = details;
		return this;
	}

	context(context: ErrorContext): this {
		this.error.context = context;
		return this;
	}

	suggestion(suggestion: ErrorSuggestion): this {
		if (!this.error.suggestions) {
			this.error.suggestions = [];
		}
		this.error.suggestions.push(suggestion);
		return this;
	}

	cause(cause: Error): this {
		this.error.cause = cause;
		return this;
	}

	retryable(retryable: boolean): this {
		this.error.retryable = retryable;
		return this;
	}

	build(): StructuredError {
		if (!this.error.code) {
			this.error.code = ErrorCodes.INTERNAL_ERROR;
		}
		if (!this.error.message) {
			this.error.message = '未知错误';
		}
		if (!this.error.category) {
			this.error.category = inferCategory(this.error.code as ErrorCode);
		}
		if (!this.error.severity) {
			this.error.severity = ErrorSeverity.Error;
		}

		// 添加默认建议
		if (!this.error.suggestions) {
			this.error.suggestions = getDefaultSuggestions(this.error.code as ErrorCode);
		}

		return this.error as StructuredError;
	}
}

/**
 * 创建错误构建器
 */
export function errorBuilder(): ErrorBuilder {
	return new ErrorBuilder();
}

/**
 * 常用错误快捷创建函数
 */
export const Errors = {
	fileNotFound: (filePath: string) =>
		createStructuredError(ErrorCodes.FILE_NOT_FOUND, `文件不存在: ${filePath}`, {
			context: { filePath },
		}),

	filePermissionDenied: (filePath: string) =>
		createStructuredError(ErrorCodes.FILE_PERMISSION_DENIED, `无权访问文件: ${filePath}`, {
			context: { filePath },
		}),

	fileExternallyModified: (filePath: string) =>
		createStructuredError(ErrorCodes.FILE_EXTERNALLY_MODIFIED, `文件已被外部修改: ${filePath}`, {
			context: { filePath },
			retryable: true,
		}),

	editMatchNotFound: (filePath: string, searchText: string) =>
		createStructuredError(ErrorCodes.EDIT_MATCH_NOT_FOUND, `未找到匹配内容`, {
			context: { filePath },
			details: `搜索内容:\n${searchText.substring(0, 200)}${searchText.length > 200 ? '...' : ''}`,
		}),

	editMultipleMatches: (filePath: string, count: number) =>
		createStructuredError(ErrorCodes.EDIT_MULTIPLE_MATCHES, `找到 ${count} 处匹配，请添加更多上下文`, {
			context: { filePath },
		}),

	commandTimeout: (command: string, timeoutMs: number) =>
		createStructuredError(ErrorCodes.COMMAND_TIMEOUT, `命令执行超时 (${timeoutMs}ms): ${command}`, {
			context: { operation: command },
			retryable: true,
		}),

	validationMissingParam: (paramName: string, toolName: string) =>
		createStructuredError(ErrorCodes.VALIDATION_MISSING_PARAM, `缺少必需参数: ${paramName}`, {
			context: { toolName },
		}),

	permissionDenied: (path: string, reason: string) =>
		createStructuredError(ErrorCodes.PERMISSION_DENIED, `权限被拒绝: ${path}`, {
			details: reason,
			context: { filePath: path },
		}),

	networkTimeout: (url: string) =>
		createStructuredError(ErrorCodes.NETWORK_TIMEOUT, `网络请求超时: ${url}`, {
			retryable: true,
		}),

	rateLimitExceeded: () =>
		createStructuredError(ErrorCodes.RATE_LIMIT_EXCEEDED, '请求过于频繁，请稍后重试', {
			retryable: true,
		}),
};
