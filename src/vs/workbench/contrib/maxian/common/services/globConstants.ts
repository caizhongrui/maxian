/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * 需要忽略的大型目录列表
 * 用于文件列表和代码库扫描时过滤
 */
export const DIRS_TO_IGNORE = [
	'node_modules',
	'__pycache__',
	'env',
	'venv',
	'target/dependency',
	'build/dependencies',
	'dist',
	'out',
	'bundle',
	'vendor',
	'tmp',
	'temp',
	'deps',
	'pkg',
	'Pods',
	'.git',
	'.*',
];
