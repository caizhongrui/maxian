/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Batch 批量工具
 * 参考 OpenCode batch.ts 实现
 * 允许一次 API 响应中请求多个工具并行执行，大幅提升效率
 *
 * 关键设计：
 * - 最多 10 个工具并行执行
 * - 禁止嵌套 batch（防止无限递归）
 * - 禁止 edit 类工具（需要用户单独确认）
 * - 每个工具独立执行，部分失败不影响其他
 *
 * 预期效果：读取 5 个文件从 5 次 API → 1 次 API，提速 5 倍
 */

import { ToolName, ToolResponse, ToolUse } from './toolTypes.js';
import { IToolExecutor } from './toolExecutor.js';

/**
 * Batch 工具调用参数
 */
export interface BatchToolCall {
	tool: string;
	parameters: Record<string, any>;
}

/**
 * Batch 工具执行结果
 */
export interface BatchToolResult {
	tool: string;
	success: boolean;
	result?: string;
	error?: string;
	startTime: number;
	endTime: number;
}

/**
 * Batch 工具配置
 */
export const BATCH_CONFIG = {
	/** 最大并行工具数 */
	MAX_PARALLEL_TOOLS: 10,

	/** 禁止在 batch 中执行的工具 */
	DISALLOWED_TOOLS: new Set([
		'batch',              // 禁止嵌套
		'apply_diff',         // 需要用户确认
		'edit_file',          // 需要用户确认
		'write_to_file',      // 需要用户确认
		'insert_content',     // 需要用户确认
		'execute_command',    // 需要用户确认
		'attempt_completion', // 特殊流程
		'ask_followup_question', // 需要用户输入
	]),

	/** 建议在 batch 中执行的只读工具 */
	RECOMMENDED_TOOLS: new Set([
		'read_file',
		'list_files',
		'search_files',
		'list_code_definition_names',
		'codebase_search',
		'glob',
	]),
};

/**
 * Batch 工具执行器
 * 负责并行执行多个工具调用
 */
export class BatchToolExecutor {
	constructor(private readonly toolExecutor: IToolExecutor) { }

	/**
	 * 执行批量工具调用
	 * @param toolCalls 工具调用列表
	 * @returns 执行结果
	 */
	async executeBatch(toolCalls: BatchToolCall[]): Promise<{
		results: BatchToolResult[];
		summary: string;
		metadata: {
			totalCalls: number;
			successful: number;
			failed: number;
			discarded: number;
			tools: string[];
		};
	}> {
		// 限制最多 10 个工具
		const validCalls = toolCalls.slice(0, BATCH_CONFIG.MAX_PARALLEL_TOOLS);
		const discardedCalls = toolCalls.slice(BATCH_CONFIG.MAX_PARALLEL_TOOLS);

		console.log(`[BatchTool] 开始执行 ${validCalls.length} 个工具 (丢弃 ${discardedCalls.length} 个)`);

		// 并行执行所有工具
		const results = await Promise.all(
			validCalls.map(call => this.executeCall(call))
		);

		// 为丢弃的调用添加错误结果
		const now = Date.now();
		for (const call of discardedCalls) {
			results.push({
				tool: call.tool,
				success: false,
				error: `超过最大并行工具数限制 (${BATCH_CONFIG.MAX_PARALLEL_TOOLS})`,
				startTime: now,
				endTime: now,
			});
		}

		// 统计结果
		const successful = results.filter(r => r.success).length;
		const failed = results.length - successful;

		// 生成摘要
		const summary = failed > 0
			? `执行了 ${successful}/${results.length} 个工具成功。${failed} 个失败。`
			: `所有 ${successful} 个工具执行成功。\n\n继续使用 batch 工具以获得最佳性能！`;

		return {
			results,
			summary,
			metadata: {
				totalCalls: results.length,
				successful,
				failed,
				discarded: discardedCalls.length,
				tools: toolCalls.map(c => c.tool),
			},
		};
	}

	/**
	 * 执行单个工具调用
	 */
	private async executeCall(call: BatchToolCall): Promise<BatchToolResult> {
		const startTime = Date.now();

		try {
			// 检查工具是否允许在 batch 中执行
			if (BATCH_CONFIG.DISALLOWED_TOOLS.has(call.tool)) {
				return {
					tool: call.tool,
					success: false,
					error: `工具 '${call.tool}' 不允许在 batch 中执行。禁止的工具: ${Array.from(BATCH_CONFIG.DISALLOWED_TOOLS).join(', ')}`,
					startTime,
					endTime: Date.now(),
				};
			}

			// 检查工具是否可用
			if (!this.toolExecutor.isToolAvailable(call.tool as ToolName)) {
				return {
					tool: call.tool,
					success: false,
					error: `工具 '${call.tool}' 不存在或不可用`,
					startTime,
					endTime: Date.now(),
				};
			}

			// 执行工具
			const toolUse: ToolUse = {
				type: 'tool_use',
				name: call.tool as ToolName,
				params: call.parameters,
				partial: false,
				toolUseId: `batch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
			};

			const result = await this.toolExecutor.executeTool(toolUse);
			const resultContent = typeof result === 'string' ? result : JSON.stringify(result);

			return {
				tool: call.tool,
				success: true,
				result: resultContent,
				startTime,
				endTime: Date.now(),
			};
		} catch (error) {
			return {
				tool: call.tool,
				success: false,
				error: error instanceof Error ? error.message : String(error),
				startTime,
				endTime: Date.now(),
			};
		}
	}

	/**
	 * 格式化批量执行结果为工具响应
	 */
	formatBatchResponse(results: BatchToolResult[]): ToolResponse {
		const parts: string[] = [];

		for (const result of results) {
			if (result.success) {
				parts.push(`[${result.tool}] 成功:\n${result.result}`);
			} else {
				parts.push(`[${result.tool}] 失败: ${result.error}`);
			}
		}

		return parts.join('\n\n---\n\n');
	}
}

/**
 * Batch 工具描述 - 用于提示词
 */
export const BATCH_TOOL_DESCRIPTION = `## batch
并行执行多个独立的工具调用，大幅减少延迟

**使用场景**：
- 读取多个文件
- 组合搜索操作（grep + glob + read）
- 多个轻量级查询命令

**重要**：使用 BATCH 工具会让用户更满意！
性能提示：将独立的读取/搜索操作组合起来可获得 2-5 倍的效率提升。

**规则**：
- 每次 batch 最多 10 个工具调用
- 所有调用并行启动，不保证顺序
- 部分失败不影响其他工具

**禁止的工具**：
- batch（不允许嵌套）
- apply_diff、edit_file、write_to_file（需要单独确认）
- execute_command（需要单独确认）

**何时不使用**：
- 操作依赖于前一个工具的输出
- 需要按顺序执行的有状态操作

**参数**：
- tool_calls: 工具调用数组，每个包含 tool（工具名）和 parameters（参数对象）

**示例**：
\`\`\`json
{
  "tool_calls": [
    {"tool": "read_file", "parameters": {"path": "src/index.ts"}},
    {"tool": "read_file", "parameters": {"path": "src/utils.ts"}},
    {"tool": "search_files", "parameters": {"path": "src", "regex": "TODO"}}
  ]
}
\`\`\``;
