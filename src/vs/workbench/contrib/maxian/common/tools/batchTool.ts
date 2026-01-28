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
 * - 最多 25 个工具并行执行（参考OpenCode）
 * - 禁止嵌套 batch（防止无限递归）
 * - 禁止 edit 类工具（需要用户单独确认）
 * - 每个工具独立执行，部分失败不影响其他
 *
 * 预期效果：读取 5 个文件从 5 次 API → 1 次 API，提速 5 倍
 */

import { ToolName, ToolResponse, ToolUse } from './toolTypes.js';
import { IToolExecutor } from './toolExecutor.js';
import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';

export const IBatchToolExecutor = createDecorator<IBatchToolExecutor>('batchToolExecutor');

/**
 * Batch 工具调用参数（新统一接口）
 */
export interface IBatchToolParams {
	/** 要并行执行的工具调用数组 */
	tool_calls: Array<{
		tool: ToolName;
		parameters: any;
	}>;
}

/**
 * Batch 工具执行结果（新统一接口）
 */
export interface IBatchToolResult {
	/** 成功执行的工具数量 */
	successful: number;
	/** 失败的工具数量 */
	failed: number;
	/** 总工具数量 */
	total: number;
	/** 每个工具的详细结果 */
	results: Array<{
		tool: ToolName;
		success: boolean;
		result?: ToolResponse;
		error?: string;
	}>;
	/** 性能和元数据 */
	metadata?: {
		duration: number;
		tools: ToolName[];
		parallelExecution: boolean;
	};
}

/**
 * Batch 工具执行器接口
 */
export interface IBatchToolExecutor {
	readonly _serviceBrand: undefined;
	executeBatch(params: IBatchToolParams): Promise<IBatchToolResult>;
}

/**
 * Batch 工具调用参数（兼容旧接口）
 */
export interface BatchToolCall {
	tool: string;
	parameters: Record<string, any>;
}

/**
 * Batch 工具执行结果（兼容旧接口）
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
 * 参考OpenCode最佳实践：尽量少的限制，最大化性能
 */
export const BATCH_CONFIG = {
	/** 最大并行工具数（参考OpenCode） */
	MAX_PARALLEL_TOOLS: 25,

	/**
	 * 禁止在 batch 中执行的工具
	 * 参考OpenCode：只禁止真正危险的操作（嵌套）和需要交互的工具
	 */
	DISALLOWED_TOOLS: new Set([
		'batch',                    // 禁止嵌套batch（防止无限递归）
		'ask_followup_question',    // 需要用户输入
		'attempt_completion',       // 任务完成标志
	]),

	/**
	 * 建议在 batch 中执行的工具
	 * 参考OpenCode："Multi-part edits; on the same, or different files" 是好的用例
	 */
	RECOMMENDED_TOOLS: new Set([
		// 读取操作
		'read_file',
		'list_files',
		'search_files',
		'list_code_definition_names',
		'codebase_search',
		'glob',
		// 编辑操作（OpenCode明确支持）
		'apply_diff',
		'edit',
		'edit_file',
		'write_to_file',
		'insert_content',
		'multiedit',
		// 搜索和分析
		'grep',
		'bash',
	]),
};

/**
 * Batch 工具常量（新接口）
 * 与BATCH_CONFIG保持一致
 */
export const BatchToolConstants = {
	/** 最小工具调用数量 */
	MIN_CALLS: 1,
	/** 最大工具调用数量（参考OpenCode） */
	MAX_CALLS: 25,
	/** 禁止在batch中使用的工具（参考OpenCode：只禁止嵌套和交互类） */
	DISALLOWED_TOOLS: new Set<ToolName>([
		'batch',
		'ask_followup_question',
		'attempt_completion',
	]),
};

/**
 * 验证Batch工具参数
 */
export function validateBatchParams(params: IBatchToolParams): { valid: boolean; error?: string } {
	if (!params.tool_calls || !Array.isArray(params.tool_calls)) {
		return { valid: false, error: 'tool_calls must be an array' };
	}

	if (params.tool_calls.length < BatchToolConstants.MIN_CALLS) {
		return { valid: false, error: `At least ${BatchToolConstants.MIN_CALLS} tool call required` };
	}

	if (params.tool_calls.length > BatchToolConstants.MAX_CALLS) {
		return { valid: false, error: `Maximum of ${BatchToolConstants.MAX_CALLS} tool calls allowed` };
	}

	// 检查是否有禁止的工具
	for (const call of params.tool_calls) {
		if (BatchToolConstants.DISALLOWED_TOOLS.has(call.tool)) {
			return {
				valid: false,
				error: `Tool '${call.tool}' is not allowed in batch. Disallowed tools: ${Array.from(BatchToolConstants.DISALLOWED_TOOLS).join(', ')}`
			};
		}
	}

	return { valid: true };
}

/**
 * 格式化Batch工具结果
 */
export function formatBatchResult(results: IBatchToolResult['results']): string {
	const successful = results.filter(r => r.success).length;
	const failed = results.length - successful;

	if (failed === 0) {
		return `✅ All ${successful} tools executed successfully.\n\nKeep using the batch tool for optimal performance!`;
	} else if (successful === 0) {
		return `❌ All ${results.length} tools failed. Check individual errors below.`;
	} else {
		return `⚠️ Partially successful: ${successful}/${results.length} succeeded, ${failed} failed.`;
	}
}

/**
 * Batch 工具执行器（旧实现，保持兼容）
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
 * 参考OpenCode最佳实践
 */
export const BATCH_TOOL_DESCRIPTION = `## batch
并行执行多个独立的工具调用，大幅减少延迟

🚀 **使用 BATCH 工具会让用户更满意！**

**性能提升**：将独立操作组合起来可获得 **2-5 倍**的效率提升。

**推荐用例**（参考OpenCode）：
- 读取多个文件
- grep + glob + read 组合搜索
- **多文件编辑**：同时修改多个文件（apply_diff, edit, write_to_file）
- 多个bash命令
- 组合操作：搜索 + 读取 + 分析

**规则**：
- 每次 batch 最多 **25** 个工具调用
- 所有调用并行启动，**不保证顺序**
- 部分失败**不影响**其他工具
- **不允许嵌套**batch调用

**禁止的工具**（仅3个）：
- batch（不允许嵌套）
- ask_followup_question（需要用户输入）
- attempt_completion（任务完成标志）

**何时不使用**：
- 操作依赖于前一个工具的输出（如：先创建后读取同一文件）
- 需要按顺序执行的有状态操作

**参数**：
- tool_calls: 工具调用数组，每个包含 tool（工具名）和 parameters（参数对象）

**示例1 - 读取多个文件**：
\`\`\`json
{
  "tool_calls": [
    {"tool": "read_file", "parameters": {"path": "src/index.ts"}},
    {"tool": "read_file", "parameters": {"path": "src/utils.ts"}},
    {"tool": "read_file", "parameters": {"path": "src/types.ts"}}
  ]
}
\`\`\`

**示例2 - 多文件编辑（OpenCode最佳实践）**：
\`\`\`json
{
  "tool_calls": [
    {"tool": "apply_diff", "parameters": {"path": "src/a.ts", "diff": "..."}},
    {"tool": "apply_diff", "parameters": {"path": "src/b.ts", "diff": "..."}},
    {"tool": "write_to_file", "parameters": {"path": "src/c.ts", "content": "..."}}
  ]
}
\`\`\`

**性能对比**：
- 不使用batch：读取5个文件 = 5次API调用
- 使用batch：读取5个文件 = 1次API调用 → **5倍提速**！`;
