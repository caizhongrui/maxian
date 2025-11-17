/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DIRS_TO_IGNORE } from './globConstants.js';

/**
 * 检查文件路径是否在忽略的目录中
 *
 * @param filePath 文件路径
 * @returns 如果路径应该被忽略返回true，否则返回false
 */
export function isPathInIgnoredDirectory(filePath: string): boolean {
	// 标准化路径分隔符
	const normalizedPath = filePath.replace(/\\/g, '/');
	const pathParts = normalizedPath.split('/');

	// 检查路径中的每个部分是否匹配忽略规则
	for (const part of pathParts) {
		// 跳过空部分（来自前导或尾随斜杠）
		if (!part) {
			continue;
		}

		// 处理 ".*" 模式（隐藏目录）
		if (DIRS_TO_IGNORE.includes('.*') && part.startsWith('.') && part !== '.') {
			return true;
		}

		// 检查精确匹配
		if (DIRS_TO_IGNORE.includes(part)) {
			return true;
		}
	}

	// 检查路径是否包含任何忽略的目录模式
	for (const dir of DIRS_TO_IGNORE) {
		if (dir === '.*') {
			// 上面已经处理过
			continue;
		}

		// 检查目录是否出现在路径中
		if (normalizedPath.includes(`/${dir}/`)) {
			return true;
		}
	}

	return false;
}
