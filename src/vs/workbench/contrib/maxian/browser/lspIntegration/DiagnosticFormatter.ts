/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { FileDiagnostics, Diagnostic, DiagnosticSeverity } from '../../common/lsp/lspDiagnostics.js';
import { basename } from '../../../../../base/common/path.js';

// 类型别名，保持代码的可读性
type DiagnosticResult = FileDiagnostics;
type DiagnosticEntry = Diagnostic;

/**
 * 诊断信息格式化配置
 */
export interface IDiagnosticFormatterOptions {
	/**
	 * 包含的严重程度
	 */
	includeSeverities: DiagnosticSeverity[];

	/**
	 * 最大诊断数量
	 */
	maxCount: number;

	/**
	 * 是否包含建议修复
	 */
	includeSuggestions: boolean;
}

/**
 * 默认格式化选项
 */
export const DEFAULT_FORMATTER_OPTIONS: IDiagnosticFormatterOptions = {
	includeSeverities: [DiagnosticSeverity.Error, DiagnosticSeverity.Warning], // Error and Warning only
	maxCount: 10,
	includeSuggestions: true,
};

/**
 * 严重程度图标映射
 */
const SEVERITY_ICONS: Record<DiagnosticSeverity, string> = {
	[DiagnosticSeverity.Error]: '🔴',
	[DiagnosticSeverity.Warning]: '🟡',
	[DiagnosticSeverity.Information]: '🔵',
	[DiagnosticSeverity.Hint]: '⚪',
};

/**
 * 严重程度名称映射
 */
const SEVERITY_NAMES: Record<DiagnosticSeverity, string> = {
	[DiagnosticSeverity.Error]: '错误',
	[DiagnosticSeverity.Warning]: '警告',
	[DiagnosticSeverity.Information]: '信息',
	[DiagnosticSeverity.Hint]: '提示',
};

/**
 * 诊断信息格式化器
 * 将LSP诊断结果格式化为适合System Prompt注入的文本
 */
export class DiagnosticFormatter {

	/**
	 * 格式化诊断结果为System Prompt文本
	 * @param results 诊断结果列表（可能来自多个文件）
	 * @param options 格式化选项
	 * @returns 格式化后的文本，如果没有诊断信息则返回null
	 */
	static formatForSystemPrompt(
		results: DiagnosticResult[],
		options: Partial<IDiagnosticFormatterOptions> = {}
	): string | null {
		const opts = { ...DEFAULT_FORMATTER_OPTIONS, ...options };

		// 过滤和收集所有诊断条目
		const allEntries: Array<{ filePath: string; entry: DiagnosticEntry }> = [];
		for (const result of results) {
			const filteredEntries = result.diagnostics.filter(
				entry => opts.includeSeverities.includes(entry.severity)
			);
			for (const entry of filteredEntries) {
				allEntries.push({ filePath: result.filePath, entry });
			}
		}

		// 如果没有诊断信息，返回null
		if (allEntries.length === 0) {
			return null;
		}

		// 按严重程度和位置排序
		allEntries.sort((a, b) => {
			// 首先按严重程度排序（Error > Warning > Info > Hint）
			if (a.entry.severity !== b.entry.severity) {
				return a.entry.severity - b.entry.severity;
			}
			// 然后按文件路径排序
			if (a.filePath !== b.filePath) {
				return a.filePath.localeCompare(b.filePath);
			}
			// 最后按行号排序
			return a.entry.range.startLine - b.entry.range.startLine;
		});

		// 限制数量
		const limitedEntries = allEntries.slice(0, opts.maxCount);

		// 统计信息
		const totalCount = allEntries.length;
		const errorCount = allEntries.filter(e => e.entry.severity === DiagnosticSeverity.Error).length;
		const warningCount = allEntries.filter(e => e.entry.severity === DiagnosticSeverity.Warning).length;
		const truncated = totalCount > opts.maxCount;

		// 生成格式化文本
		const lines: string[] = [];

		// 标题和统计
		lines.push('## 当前代码诊断信息');
		lines.push('');
		lines.push(`检测到 ${errorCount} 个错误和 ${warningCount} 个警告${truncated ? `（共 ${totalCount} 个问题，仅显示前 ${opts.maxCount} 个）` : ''}：`);
		lines.push('');

		// 按文件分组显示
		const entriesByFile = new Map<string, Array<{ entry: DiagnosticEntry }>>();
		for (const item of limitedEntries) {
			if (!entriesByFile.has(item.filePath)) {
				entriesByFile.set(item.filePath, []);
			}
			entriesByFile.get(item.filePath)!.push({ entry: item.entry });
		}

		// 生成每个文件的诊断信息
		for (const [filePath, entries] of entriesByFile) {
			const fileName = basename(filePath);
			lines.push(`### ${fileName}`);
			lines.push(`路径: ${filePath}`);
			lines.push('');

			for (const { entry } of entries) {
				const icon = SEVERITY_ICONS[entry.severity] || '⚫';
				const severityName = SEVERITY_NAMES[entry.severity] || '未知';
				const location = `第 ${entry.range.startLine}:${entry.range.startColumn} 行`;

				// 基本信息
				lines.push(`${icon} **${severityName}** - ${location}`);
				lines.push(`  消息: ${entry.message}`);

				// 来源信息（例如：TypeScript, ESLint等）
				if (entry.source) {
					lines.push(`  来源: ${entry.source}`);
				}

				// 错误代码（例如：TS2304）
				if (entry.code) {
					lines.push(`  代码: ${entry.code}`);
				}

				lines.push('');
			}
		}

		// 添加修复建议
		if (opts.includeSuggestions) {
			lines.push('---');
			lines.push('');
			lines.push('**建议**: 请在回复中考虑并修复上述诊断问题。优先修复错误（🔴），然后处理警告（🟡）。');
			lines.push('');
		}

		return lines.join('\n');
	}

	/**
	 * 格式化单个文件的诊断结果（快速版本）
	 * @param result 单个文件的诊断结果
	 * @param options 格式化选项
	 * @returns 格式化后的文本，如果没有诊断信息则返回null
	 */
	static formatSingleFile(
		result: DiagnosticResult,
		options: Partial<IDiagnosticFormatterOptions> = {}
	): string | null {
		return this.formatForSystemPrompt([result], options);
	}

	/**
	 * 获取诊断摘要（简短版本，用于状态栏等UI）
	 * @param results 诊断结果列表
	 * @param options 格式化选项
	 * @returns 诊断摘要文本
	 */
	static getSummary(
		results: DiagnosticResult[],
		options: Partial<IDiagnosticFormatterOptions> = {}
	): string {
		const opts = { ...DEFAULT_FORMATTER_OPTIONS, ...options };

		// 收集所有诊断条目
		const allEntries: DiagnosticEntry[] = [];
		for (const result of results) {
			const filteredEntries = result.diagnostics.filter(
				entry => opts.includeSeverities.includes(entry.severity)
			);
			allEntries.push(...filteredEntries);
		}

		// 统计
		const errorCount = allEntries.filter(e => e.severity === DiagnosticSeverity.Error).length;
		const warningCount = allEntries.filter(e => e.severity === DiagnosticSeverity.Warning).length;
		const infoCount = allEntries.filter(e => e.severity === DiagnosticSeverity.Information).length;

		// 生成摘要
		const parts: string[] = [];
		if (errorCount > 0) {
			parts.push(`${errorCount} 个错误`);
		}
		if (warningCount > 0) {
			parts.push(`${warningCount} 个警告`);
		}
		if (infoCount > 0 && opts.includeSeverities.includes(DiagnosticSeverity.Information)) {
			parts.push(`${infoCount} 个信息`);
		}

		if (parts.length === 0) {
			return '无诊断问题';
		}

		return parts.join('，');
	}

	/**
	 * 检查是否有严重错误（用于决定是否需要立即注入）
	 * @param results 诊断结果列表
	 * @returns 如果有Error级别的诊断则返回true
	 */
	static hasCriticalErrors(results: DiagnosticResult[]): boolean {
		for (const result of results) {
			if (result.diagnostics.some(entry => entry.severity === DiagnosticSeverity.Error)) {
				return true;
			}
		}
		return false;
	}

	/**
	 * 获取诊断总数
	 * @param results 诊断结果列表
	 * @param includeSeverities 包含的严重程度
	 * @returns 诊断总数
	 */
	static getCount(results: DiagnosticResult[], includeSeverities: DiagnosticSeverity[] = [DiagnosticSeverity.Error, DiagnosticSeverity.Warning]): number {
		let count = 0;
		for (const result of results) {
			count += result.diagnostics.filter(
				entry => includeSeverities.includes(entry.severity)
			).length;
		}
		return count;
	}
}
