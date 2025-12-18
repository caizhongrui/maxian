/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Multiedit 多处编辑工具
 * 参考 OpenCode tool/multiedit.ts 实现
 *
 * 核心功能：
 * - 在单个文件中执行多处编辑操作
 * - 原子性：所有编辑要么全部成功，要么全部不执行
 * - 顺序执行：每个编辑基于前一个的结果
 *
 * 预期效果：修改同一文件多处从多次API调用减少到1次
 */

import { ToolResponse } from './toolTypes.js';

/**
 * 单个编辑操作
 */
export interface EditOperation {
	/** 要替换的原始文本 */
	oldString: string;
	/** 替换后的新文本 */
	newString: string;
	/** 是否替换所有匹配项 */
	replaceAll?: boolean;
}

/**
 * Multiedit 执行结果
 */
export interface MultieditResult {
	success: boolean;
	/** 成功的编辑数 */
	successCount: number;
	/** 总编辑数 */
	totalCount: number;
	/** 最终文件内容 */
	finalContent?: string;
	/** 错误信息 */
	error?: string;
	/** 每个编辑的详细结果 */
	details: Array<{
		index: number;
		success: boolean;
		oldString: string;
		matchCount: number;
		error?: string;
	}>;
}

/**
 * Multiedit 工具配置
 */
export const MULTIEDIT_CONFIG = {
	/** 最大编辑操作数 */
	MAX_EDITS: 50,

	/** 最大文件大小（字符数） */
	MAX_FILE_SIZE: 1000000, // 1MB

	/** oldString 最大长度 */
	MAX_OLD_STRING_LENGTH: 50000,
};

/**
 * 执行多处编辑
 * @param content 原始文件内容
 * @param edits 编辑操作列表
 * @returns 编辑结果
 */
export function executeMultiedit(content: string, edits: EditOperation[]): MultieditResult {
	// 验证参数
	if (!content && content !== '') {
		return {
			success: false,
			successCount: 0,
			totalCount: edits.length,
			error: '文件内容不能为 undefined',
			details: [],
		};
	}

	if (!edits || edits.length === 0) {
		return {
			success: false,
			successCount: 0,
			totalCount: 0,
			error: '编辑操作列表不能为空',
			details: [],
		};
	}

	if (edits.length > MULTIEDIT_CONFIG.MAX_EDITS) {
		return {
			success: false,
			successCount: 0,
			totalCount: edits.length,
			error: `编辑操作数超过限制 (最多 ${MULTIEDIT_CONFIG.MAX_EDITS} 个)`,
			details: [],
		};
	}

	// 执行编辑
	let currentContent = content;
	const details: MultieditResult['details'] = [];
	let successCount = 0;

	for (let i = 0; i < edits.length; i++) {
		const edit = edits[i];

		// 验证编辑操作
		if (!edit.oldString && edit.oldString !== '') {
			details.push({
				index: i,
				success: false,
				oldString: '',
				matchCount: 0,
				error: 'oldString 不能为 undefined',
			});
			// 原子性：任何编辑失败都中止
			return {
				success: false,
				successCount,
				totalCount: edits.length,
				error: `编辑 #${i + 1} 失败: oldString 不能为 undefined`,
				details,
			};
		}

		if (edit.newString === undefined) {
			details.push({
				index: i,
				success: false,
				oldString: edit.oldString.substring(0, 50),
				matchCount: 0,
				error: 'newString 不能为 undefined',
			});
			return {
				success: false,
				successCount,
				totalCount: edits.length,
				error: `编辑 #${i + 1} 失败: newString 不能为 undefined`,
				details,
			};
		}

		// 检查 oldString 和 newString 是否相同
		if (edit.oldString === edit.newString) {
			details.push({
				index: i,
				success: false,
				oldString: edit.oldString.substring(0, 50),
				matchCount: 0,
				error: 'oldString 和 newString 相同，无需修改',
			});
			return {
				success: false,
				successCount,
				totalCount: edits.length,
				error: `编辑 #${i + 1} 失败: oldString 和 newString 相同`,
				details,
			};
		}

		// 计算匹配次数
		let matchCount = 0;
		let searchIndex = 0;
		while ((searchIndex = currentContent.indexOf(edit.oldString, searchIndex)) !== -1) {
			matchCount++;
			searchIndex += edit.oldString.length;
		}

		if (matchCount === 0) {
			details.push({
				index: i,
				success: false,
				oldString: edit.oldString.substring(0, 50),
				matchCount: 0,
				error: '在文件中未找到匹配的内容',
			});
			return {
				success: false,
				successCount,
				totalCount: edits.length,
				error: `编辑 #${i + 1} 失败: 未找到匹配内容 "${edit.oldString.substring(0, 30)}..."`,
				details,
			};
		}

		// 执行替换
		if (edit.replaceAll) {
			// 替换所有匹配项
			currentContent = currentContent.split(edit.oldString).join(edit.newString);
		} else {
			// 只替换第一个匹配项
			currentContent = currentContent.replace(edit.oldString, edit.newString);
		}

		details.push({
			index: i,
			success: true,
			oldString: edit.oldString.substring(0, 50),
			matchCount: edit.replaceAll ? matchCount : 1,
		});
		successCount++;
	}

	return {
		success: true,
		successCount,
		totalCount: edits.length,
		finalContent: currentContent,
		details,
	};
}

/**
 * 格式化 multiedit 结果为工具响应
 */
export function formatMultieditResponse(result: MultieditResult, filePath: string): ToolResponse {
	if (result.success) {
		const editSummary = result.details
			.map(d => `  ${d.index + 1}. 替换了 ${d.matchCount} 处匹配`)
			.join('\n');

		return `文件 ${filePath} 多处编辑成功！\n\n执行了 ${result.successCount} 个编辑操作：\n${editSummary}`;
	} else {
		return `文件 ${filePath} 多处编辑失败！\n\n错误: ${result.error}\n\n已完成 ${result.successCount}/${result.totalCount} 个编辑`;
	}
}

/**
 * Multiedit 工具描述
 */
export const MULTIEDIT_TOOL_DESCRIPTION = `## multiedit
在单个文件中执行多处编辑操作（原子性操作）

**使用场景**：
- 需要修改同一文件的多个位置
- 重命名变量/函数
- 批量更新导入语句

**重要**：所有编辑要么全部成功，要么全部不执行（原子性）

**规则**：
- 编辑按顺序执行，每个基于前一个的结果
- oldString 必须与文件内容精确匹配
- 最多支持 ${MULTIEDIT_CONFIG.MAX_EDITS} 个编辑操作

**参数**：
- path: 文件路径
- edits: 编辑操作数组，每个包含：
  - oldString: 要替换的原始文本
  - newString: 替换后的新文本
  - replaceAll: (可选) 是否替换所有匹配项

**示例**：
\`\`\`
path: "src/utils.ts"
edits: [
  {"oldString": "const foo", "newString": "const bar"},
  {"oldString": "import { foo }", "newString": "import { bar }", "replaceAll": true}
]
\`\`\``;
