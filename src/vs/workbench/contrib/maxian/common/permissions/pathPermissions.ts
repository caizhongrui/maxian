/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * 路径级权限控制系统
 * 参考 OpenCode 的路径权限管理实现
 *
 * 功能：
 * - 文件/目录级别的读写权限控制
 * - 支持 glob 模式匹配
 * - 敏感路径保护（如 .env、密钥文件等）
 * - 工作区边界检查
 * - 权限继承和覆盖
 */

import * as path from 'path';

/**
 * 权限级别
 */
export enum PermissionLevel {
	/** 允许 */
	Allow = 'allow',
	/** 需要确认 */
	Ask = 'ask',
	/** 拒绝 */
	Deny = 'deny',
}

/**
 * 操作类型
 */
export enum OperationType {
	Read = 'read',
	Write = 'write',
	Delete = 'delete',
	Execute = 'execute',
}

/**
 * 路径权限规则
 */
export interface PathPermissionRule {
	/** 路径模式（支持 glob） */
	pattern: string;
	/** 权限级别 */
	permission: PermissionLevel;
	/** 适用的操作类型（为空表示所有操作） */
	operations?: OperationType[];
	/** 规则优先级（数字越大优先级越高） */
	priority?: number;
	/** 规则描述 */
	description?: string;
}

/**
 * 权限检查结果
 */
export interface PermissionCheckResult {
	/** 是否允许 */
	allowed: boolean;
	/** 权限级别 */
	level: PermissionLevel;
	/** 匹配的规则 */
	matchedRule?: PathPermissionRule;
	/** 原因说明 */
	reason?: string;
}

/**
 * 默认敏感路径模式
 * 这些路径默认需要额外确认或禁止访问
 */
export const DEFAULT_SENSITIVE_PATTERNS: PathPermissionRule[] = [
	// 环境变量和密钥文件 - 拒绝
	{
		pattern: '**/.env*',
		permission: PermissionLevel.Deny,
		operations: [OperationType.Read, OperationType.Write],
		priority: 100,
		description: '环境变量文件',
	},
	{
		pattern: '**/secrets/**',
		permission: PermissionLevel.Deny,
		priority: 100,
		description: '密钥目录',
	},
	{
		pattern: '**/*.pem',
		permission: PermissionLevel.Deny,
		priority: 100,
		description: 'PEM 密钥文件',
	},
	{
		pattern: '**/*.key',
		permission: PermissionLevel.Deny,
		priority: 100,
		description: '密钥文件',
	},
	{
		pattern: '**/id_rsa*',
		permission: PermissionLevel.Deny,
		priority: 100,
		description: 'SSH 私钥',
	},
	{
		pattern: '**/credentials.json',
		permission: PermissionLevel.Deny,
		priority: 100,
		description: '凭据文件',
	},

	// Git 内部文件 - 需要确认
	{
		pattern: '**/.git/**',
		permission: PermissionLevel.Ask,
		operations: [OperationType.Write, OperationType.Delete],
		priority: 90,
		description: 'Git 内部文件',
	},

	// 配置文件 - 需要确认写入
	{
		pattern: '**/package.json',
		permission: PermissionLevel.Ask,
		operations: [OperationType.Write],
		priority: 80,
		description: '包配置文件',
	},
	{
		pattern: '**/tsconfig.json',
		permission: PermissionLevel.Ask,
		operations: [OperationType.Write],
		priority: 80,
		description: 'TypeScript 配置',
	},

	// node_modules - 禁止写入
	{
		pattern: '**/node_modules/**',
		permission: PermissionLevel.Deny,
		operations: [OperationType.Write, OperationType.Delete],
		priority: 95,
		description: 'Node.js 依赖目录',
	},

	// 构建输出 - 允许读取，需确认写入
	{
		pattern: '**/dist/**',
		permission: PermissionLevel.Ask,
		operations: [OperationType.Write],
		priority: 70,
		description: '构建输出目录',
	},
	{
		pattern: '**/build/**',
		permission: PermissionLevel.Ask,
		operations: [OperationType.Write],
		priority: 70,
		description: '构建输出目录',
	},

	// 系统文件 - 拒绝
	{
		pattern: '/etc/**',
		permission: PermissionLevel.Deny,
		priority: 100,
		description: '系统配置目录',
	},
	{
		pattern: '/usr/**',
		permission: PermissionLevel.Deny,
		operations: [OperationType.Write, OperationType.Delete],
		priority: 100,
		description: '系统目录',
	},
	{
		pattern: '/System/**',
		permission: PermissionLevel.Deny,
		priority: 100,
		description: 'macOS 系统目录',
	},
	{
		pattern: 'C:\\Windows\\**',
		permission: PermissionLevel.Deny,
		priority: 100,
		description: 'Windows 系统目录',
	},
];

/**
 * 简单的 glob 模式匹配
 * 支持 * 和 ** 通配符
 */
function matchGlob(pattern: string, filePath: string): boolean {
	// 标准化路径分隔符
	const normalizedPath = filePath.replace(/\\/g, '/');
	const normalizedPattern = pattern.replace(/\\/g, '/');

	// 转换 glob 模式为正则表达式
	const regexPattern = normalizedPattern
		// 转义正则特殊字符（除了 * 和 ?）
		.replace(/[.+^${}()|[\]\\]/g, '\\$&')
		// 处理 **（匹配任意路径）
		.replace(/\*\*/g, '{{DOUBLE_STAR}}')
		// 处理 *（匹配单层路径中的任意字符）
		.replace(/\*/g, '[^/]*')
		// 还原 **
		.replace(/\{\{DOUBLE_STAR\}\}/g, '.*')
		// 处理 ?
		.replace(/\?/g, '[^/]');

	const regex = new RegExp(`^${regexPattern}$`, 'i');
	return regex.test(normalizedPath);
}

/**
 * 路径权限管理器
 */
export class PathPermissionManager {
	private rules: PathPermissionRule[] = [];
	private workspaceRoot: string;

	constructor(workspaceRoot: string) {
		this.workspaceRoot = workspaceRoot.replace(/\\/g, '/');
		// 加载默认敏感路径规则
		this.rules = [...DEFAULT_SENSITIVE_PATTERNS];
	}

	/**
	 * 添加权限规则
	 */
	addRule(rule: PathPermissionRule): void {
		this.rules.push(rule);
		// 按优先级排序（高优先级在前）
		this.rules.sort((a, b) => (b.priority || 0) - (a.priority || 0));
	}

	/**
	 * 批量添加规则
	 */
	addRules(rules: PathPermissionRule[]): void {
		for (const rule of rules) {
			this.addRule(rule);
		}
	}

	/**
	 * 移除规则
	 */
	removeRule(pattern: string): boolean {
		const index = this.rules.findIndex(r => r.pattern === pattern);
		if (index !== -1) {
			this.rules.splice(index, 1);
			return true;
		}
		return false;
	}

	/**
	 * 清空自定义规则（保留默认规则）
	 */
	clearCustomRules(): void {
		this.rules = [...DEFAULT_SENSITIVE_PATTERNS];
	}

	/**
	 * 检查路径权限
	 */
	checkPermission(filePath: string, operation: OperationType): PermissionCheckResult {
		// 标准化路径
		const normalizedPath = this.normalizePath(filePath);

		// 检查是否在工作区内
		if (!this.isWithinWorkspace(normalizedPath)) {
			return {
				allowed: false,
				level: PermissionLevel.Deny,
				reason: `路径 "${filePath}" 不在工作区范围内`,
			};
		}

		// 按优先级检查规则
		for (const rule of this.rules) {
			if (matchGlob(rule.pattern, normalizedPath)) {
				// 检查操作类型是否匹配
				if (!rule.operations || rule.operations.includes(operation)) {
					return {
						allowed: rule.permission === PermissionLevel.Allow,
						level: rule.permission,
						matchedRule: rule,
						reason: rule.description,
					};
				}
			}
		}

		// 默认允许
		return {
			allowed: true,
			level: PermissionLevel.Allow,
			reason: '默认允许',
		};
	}

	/**
	 * 检查读取权限
	 */
	canRead(filePath: string): PermissionCheckResult {
		return this.checkPermission(filePath, OperationType.Read);
	}

	/**
	 * 检查写入权限
	 */
	canWrite(filePath: string): PermissionCheckResult {
		return this.checkPermission(filePath, OperationType.Write);
	}

	/**
	 * 检查删除权限
	 */
	canDelete(filePath: string): PermissionCheckResult {
		return this.checkPermission(filePath, OperationType.Delete);
	}

	/**
	 * 检查执行权限
	 */
	canExecute(filePath: string): PermissionCheckResult {
		return this.checkPermission(filePath, OperationType.Execute);
	}

	/**
	 * 标准化路径
	 */
	private normalizePath(filePath: string): string {
		let normalized = filePath.replace(/\\/g, '/');

		// 如果是相对路径，转换为绝对路径
		if (!path.isAbsolute(normalized)) {
			normalized = path.join(this.workspaceRoot, normalized).replace(/\\/g, '/');
		}

		return normalized;
	}

	/**
	 * 检查路径是否在工作区内
	 */
	isWithinWorkspace(filePath: string): boolean {
		const normalizedPath = this.normalizePath(filePath);
		const normalizedRoot = this.workspaceRoot;

		// 检查路径是否以工作区根目录开头
		return normalizedPath.startsWith(normalizedRoot);
	}

	/**
	 * 获取所有规则
	 */
	getRules(): PathPermissionRule[] {
		return [...this.rules];
	}

	/**
	 * 获取敏感路径列表
	 */
	getSensitivePaths(): string[] {
		return this.rules
			.filter(r => r.permission !== PermissionLevel.Allow)
			.map(r => r.pattern);
	}

	/**
	 * 批量检查路径
	 */
	checkPaths(paths: string[], operation: OperationType): Map<string, PermissionCheckResult> {
		const results = new Map<string, PermissionCheckResult>();
		for (const p of paths) {
			results.set(p, this.checkPermission(p, operation));
		}
		return results;
	}

	/**
	 * 过滤可访问的路径
	 */
	filterAccessible(paths: string[], operation: OperationType): string[] {
		return paths.filter(p => this.checkPermission(p, operation).allowed);
	}
}

/**
 * 格式化权限检查结果
 */
export function formatPermissionResult(result: PermissionCheckResult, filePath: string): string {
	const lines: string[] = [];

	if (result.allowed) {
		lines.push(`✅ 允许访问: ${filePath}`);
	} else {
		lines.push(`❌ 拒绝访问: ${filePath}`);
	}

	if (result.reason) {
		lines.push(`原因: ${result.reason}`);
	}

	if (result.matchedRule) {
		lines.push(`匹配规则: ${result.matchedRule.pattern}`);
	}

	return lines.join('\n');
}

/**
 * 创建权限管理器实例
 */
export function createPermissionManager(workspaceRoot: string): PathPermissionManager {
	return new PathPermissionManager(workspaceRoot);
}

/**
 * 全局权限管理器（需要在应用启动时初始化）
 */
let globalPermissionManager: PathPermissionManager | null = null;

/**
 * 初始化全局权限管理器
 */
export function initGlobalPermissionManager(workspaceRoot: string): PathPermissionManager {
	globalPermissionManager = new PathPermissionManager(workspaceRoot);
	return globalPermissionManager;
}

/**
 * 获取全局权限管理器
 */
export function getGlobalPermissionManager(): PathPermissionManager | null {
	return globalPermissionManager;
}

/**
 * 检查路径权限（便捷函数）
 */
export function checkPathPermission(
	filePath: string,
	operation: OperationType
): PermissionCheckResult {
	if (!globalPermissionManager) {
		// 如果未初始化，默认允许
		return {
			allowed: true,
			level: PermissionLevel.Allow,
			reason: '权限管理器未初始化',
		};
	}
	return globalPermissionManager.checkPermission(filePath, operation);
}
