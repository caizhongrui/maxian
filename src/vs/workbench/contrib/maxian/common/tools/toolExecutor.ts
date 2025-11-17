/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ToolUse, ToolResponse, ToolName } from './toolTypes.js';

/**
 * 工具执行器接口
 * 负责执行各种工具调用
 */
export interface IToolExecutor {
	/**
	 * 执行工具调用
	 * @param toolUse 工具使用信息
	 * @returns 工具执行结果
	 */
	executeTool(toolUse: ToolUse): Promise<ToolResponse>;

	/**
	 * 检查工具是否可用
	 * @param toolName 工具名称
	 * @returns 是否可用
	 */
	isToolAvailable(toolName: ToolName): boolean;

	/**
	 * 获取可用工具列表
	 * @returns 可用工具名称数组
	 */
	getAvailableTools(): ToolName[];
}

/**
 * 工具执行上下文
 * 包含执行工具所需的环境信息
 */
export interface ToolExecutionContext {
	cwd: string; // 当前工作目录
	workspaceRoot?: string; // 工作区根目录
}

/**
 * 工具执行结果
 */
export interface ToolExecutionResult {
	success: boolean;
	result?: ToolResponse;
	error?: string;
	metadata?: Record<string, any>;
}
