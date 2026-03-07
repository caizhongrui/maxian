/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Edit 工具
 * 参考 OpenCode tool/edit.ts 实现
 *
 * 功能：
 * - 基于 old_string/new_string 的字符串替换
 * - 9 种容错匹配策略（fuzzyMatch.ts）
 * - 支持全局替换（replace_all）
 * - 自动创建不存在的文件
 * - 详细的执行结果反馈
 *
 * 优势：
 * - 比 apply_diff 更简单直观
 * - 容错能力强，适合 LLM 输出不精确的情况
 * - 支持单处/多处替换
 */

import { fuzzyReplace, FUZZY_MATCH_STRATEGIES } from '../diff/fuzzyMatch.js';

/**
 * Edit 工具参数
 */
export interface EditParams {
	/** 文件路径（必需） */
	path: string;
	/** 要查找的旧字符串（必需，除非创建新文件） */
	old_string?: string;
	/** 替换为的新字符串（必需） */
	new_string: string;
	/** 是否替换所有匹配项（默认 false） */
	replace_all?: boolean;
	/** 是否创建新文件（当文件不存在时） */
	create_if_missing?: boolean;
}

/**
 * Edit 执行结果
 */
export interface EditResult {
	/** 是否成功 */
	success: boolean;
	/** 结果消息 */
	message: string;
	/** 修改后的文件内容（成功时） */
	newContent?: string;
	/** 使用的匹配策略 */
	strategy?: string;
	/** 替换的匹配数量 */
	matchCount?: number;
	/** 是否创建了新文件 */
	created?: boolean;
	/** 文件路径 */
	path: string;
}

/**
 * Edit 工具配置
 */
export const EDIT_TOOL_CONFIG = {
	/** 最大文件大小（字节） */
	MAX_FILE_SIZE: 10 * 1024 * 1024, // 10MB

	/** 是否启用容错匹配 */
	ENABLE_FUZZY_MATCH: true,

	/** 是否自动创建目录 */
	AUTO_CREATE_DIRECTORY: true,
};

/**
 * 验证 Edit 参数
 */
export function validateEditParams(params: Partial<EditParams>): {
	valid: boolean;
	error?: string;
	params?: EditParams;
} {
	// 检查必需参数
	if (!params.path) {
		return {
			valid: false,
			error: '缺少必需参数: path (文件路径)',
		};
	}

	if (params.new_string === undefined) {
		return {
			valid: false,
			error: '缺少必需参数: new_string (新内容)',
		};
	}

	// 创建新文件时不需要 old_string
	const isCreatingFile = params.create_if_missing && !params.old_string;

	if (!isCreatingFile && !params.old_string) {
		return {
			valid: false,
			error: '缺少必需参数: old_string (要替换的内容)。如果要创建新文件，请设置 create_if_missing: true',
		};
	}

	return {
		valid: true,
		params: {
			path: params.path,
			old_string: params.old_string,
			new_string: params.new_string,
			replace_all: params.replace_all ?? false,
			create_if_missing: params.create_if_missing ?? false,
		},
	};
}

/**
 * 执行 Edit 操作
 * @param content 当前文件内容（null 表示文件不存在）
 * @param params Edit 参数
 */
export function executeEdit(
	content: string | null,
	params: EditParams
): EditResult {
	const { path, old_string, new_string, replace_all, create_if_missing } = params;

	// 文件不存在的情况
	if (content === null) {
		if (create_if_missing) {
			// 创建新文件
			return {
				success: true,
				message: `已创建新文件: ${path}`,
				newContent: new_string,
				created: true,
				path,
			};
		} else {
			return {
				success: false,
				message: `文件不存在: ${path}\n\n如需创建新文件，请设置 create_if_missing: true`,
				path,
			};
		}
	}

	// old_string 为空，表示追加内容或替换整个文件
	if (!old_string) {
		if (content === '') {
			// 空文件，直接写入
			return {
				success: true,
				message: `已向空文件写入内容: ${path}`,
				newContent: new_string,
				matchCount: 1,
				path,
			};
		}
		// 非空文件，要求提供 old_string
		return {
			success: false,
			message: `文件非空，需要提供 old_string 参数来指定要替换的内容。\n文件前100字符: ${content.substring(0, 100)}...`,
			path,
		};
	}

	// 精确匹配检查
	if (content.indexOf(old_string) === -1 && !EDIT_TOOL_CONFIG.ENABLE_FUZZY_MATCH) {
		return {
			success: false,
			message: `未找到匹配内容。\n\n要查找的内容:\n${old_string.substring(0, 200)}${old_string.length > 200 ? '...' : ''}`,
			path,
		};
	}

	// 使用容错匹配执行替换
	const result = fuzzyReplace(content, old_string, new_string, replace_all);

	if (!result.success) {
		// P1优化：多处匹配时给出专门提示，对齐 OpenCode "Found multiple matches"
		if (result.error) {
			return {
				success: false,
				message: `${result.error}\n\n要查找的内容:\n\`\`\`\n${old_string.substring(0, 500)}${old_string.length > 500 ? '\n...(内容过长已截断)' : ''}\n\`\`\``,
				path,
			};
		}
		// 未找到匹配：提供详细失败信息
		const hint = generateMatchHint(content, old_string);
		return {
			success: false,
			message: `未找到匹配内容。\n\n要查找的内容:\n\`\`\`\n${old_string.substring(0, 500)}${old_string.length > 500 ? '\n...(内容过长已截断)' : ''}\n\`\`\`\n\n${hint}`,
			path,
		};
	}

	// 生成成功消息
	const strategyInfo = result.strategy !== 'SimpleReplacer'
		? `\n使用策略: ${result.strategy}`
		: '';

	const countInfo = replace_all && result.matchCount > 1
		? `\n替换了 ${result.matchCount} 处匹配`
		: '';

	return {
		success: true,
		message: `已成功编辑文件: ${path}${strategyInfo}${countInfo}`,
		newContent: result.result,
		strategy: result.strategy,
		matchCount: result.matchCount,
		path,
	};
}

/**
 * 生成匹配失败提示
 */
function generateMatchHint(content: string, oldString: string): string {
	const hints: string[] = [];

	// 检查是否是空白问题
	const oldTrimmed = oldString.trim();
	if (content.indexOf(oldTrimmed) !== -1) {
		hints.push('💡 提示: 移除首尾空白后可以找到匹配。请检查 old_string 的空白字符。');
	}

	// 检查是否是换行符问题
	const oldNormalized = oldString.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
	if (content.indexOf(oldNormalized) !== -1) {
		hints.push('💡 提示: 换行符格式不匹配。请使用 \\n 而不是 \\r\\n。');
	}

	// 检查首行是否存在
	const firstLine = oldString.split('\n')[0].trim();
	if (firstLine && content.indexOf(firstLine) === -1) {
		hints.push(`💡 提示: 首行内容 "${firstLine.substring(0, 50)}..." 在文件中不存在。`);
	}

	// 搜索相似内容
	const similarity = findSimilarContent(content, oldString);
	if (similarity) {
		hints.push(`💡 提示: 找到相似内容（相似度 ${Math.round(similarity.similarity * 100)}%）:\n\`\`\`\n${similarity.content.substring(0, 300)}\n\`\`\``);
	}

	if (hints.length === 0) {
		hints.push('💡 建议: 请使用 read_file 工具查看文件当前内容，确保 old_string 与文件内容完全匹配。');
	}

	return hints.join('\n\n');
}

/**
 * 搜索相似内容
 */
function findSimilarContent(content: string, oldString: string): { content: string; similarity: number } | null {
	const oldLines = oldString.split('\n');
	const contentLines = content.split('\n');

	if (oldLines.length === 0 || contentLines.length === 0) {
		return null;
	}

	// 搜索首行
	const firstLine = oldLines[0].trim();
	if (!firstLine) return null;

	let bestMatch: { content: string; similarity: number } | null = null;
	let bestSimilarity = 0;

	for (let i = 0; i < contentLines.length; i++) {
		// 简单的首行匹配检查
		if (contentLines[i].includes(firstLine.substring(0, Math.min(20, firstLine.length)))) {
			const blockLength = Math.min(oldLines.length, contentLines.length - i);
			const block = contentLines.slice(i, i + blockLength).join('\n');

			// 计算相似度（简化版）
			const commonChars = countCommonChars(block, oldString);
			const similarity = commonChars / Math.max(block.length, oldString.length);

			if (similarity > bestSimilarity && similarity > 0.3) {
				bestSimilarity = similarity;
				bestMatch = { content: block, similarity };
			}
		}
	}

	return bestMatch;
}

/**
 * 计算公共字符数
 */
function countCommonChars(str1: string, str2: string): number {
	const set1 = new Set(str1.split(''));
	const set2 = new Set(str2.split(''));
	let count = 0;
	for (const char of set1) {
		if (set2.has(char)) {
			count += Math.min(
				str1.split(char).length - 1,
				str2.split(char).length - 1
			);
		}
	}
	return count;
}

/**
 * 格式化 Edit 结果为响应文本
 */
export function formatEditResponse(result: EditResult): string {
	const lines: string[] = [];

	if (result.success) {
		lines.push(`✅ ${result.message}`);

		if (result.strategy && result.strategy !== 'SimpleReplacer') {
			lines.push(`📝 匹配策略: ${result.strategy}`);
		}

		if (result.matchCount && result.matchCount > 1) {
			lines.push(`🔢 替换数量: ${result.matchCount} 处`);
		}

		if (result.created) {
			lines.push('📁 状态: 新创建的文件');
		}
	} else {
		lines.push(`❌ 编辑失败`);
		lines.push('');
		lines.push(result.message);
	}

	return lines.join('\n');
}

/**
 * Edit 工具描述（用于 System Prompt）
 * 参考 OpenCode 的详细描述格式
 */
export const EDIT_TOOL_DESCRIPTION = `## edit
Description: 编辑文件内容。通过指定要替换的旧内容(old_string)和新内容(new_string)来修改文件。

**重要使用说明：**
1. 必须先使用 read_file 工具读取文件内容，然后再使用此工具
2. old_string 必须与文件中的内容完全匹配（包括空白和缩进）
3. new_string 包含替换后的完整内容

**参数：**
- path (必需): 要编辑的文件路径
- old_string (必需): 要被替换的原始内容。必须与文件中的内容精确匹配
- new_string (必需): 替换后的新内容
- replace_all (可选): 设为 true 则替换所有匹配项，默认只替换第一处
- create_if_missing (可选): 设为 true 则在文件不存在时创建新文件

**示例 1 - 修改函数实现：**
<edit>
<path>src/utils/math.ts</path>
<old_string>function add(a: number, b: number): number {
    return a + b;
}</old_string>
<new_string>function add(a: number, b: number): number {
    // 添加参数验证
    if (typeof a !== 'number' || typeof b !== 'number') {
        throw new Error('Parameters must be numbers');
    }
    return a + b;
}</new_string>
</edit>

**示例 2 - 全局替换：**
<edit>
<path>src/config.ts</path>
<old_string>DEBUG = false</old_string>
<new_string>DEBUG = true</new_string>
<replace_all>true</replace_all>
</edit>

**示例 3 - 创建新文件：**
<edit>
<path>src/newFile.ts</path>
<new_string>export const VERSION = '1.0.0';</new_string>
<create_if_missing>true</create_if_missing>
</edit>

**容错匹配：**
此工具支持 ${FUZZY_MATCH_STRATEGIES.length} 种容错匹配策略：
${FUZZY_MATCH_STRATEGIES.map((s, i) => `${i + 1}. ${s}`).join('\n')}

即使 old_string 与文件内容有轻微差异（如空白、缩进），也能尝试匹配成功。
`;

/**
 * Edit 工具 JSON Schema
 */
export const EDIT_TOOL_SCHEMA = {
	name: 'edit',
	description: '编辑文件内容，通过 old_string/new_string 进行字符串替换，支持容错匹配',
	input_schema: {
		type: 'object',
		properties: {
			path: {
				type: 'string',
				description: '要编辑的文件路径',
			},
			old_string: {
				type: 'string',
				description: '要被替换的原始内容',
			},
			new_string: {
				type: 'string',
				description: '替换后的新内容',
			},
			replace_all: {
				type: 'boolean',
				description: '是否替换所有匹配项',
				default: false,
			},
			create_if_missing: {
				type: 'boolean',
				description: '文件不存在时是否创建',
				default: false,
			},
		},
		required: ['path', 'new_string'],
	},
};
