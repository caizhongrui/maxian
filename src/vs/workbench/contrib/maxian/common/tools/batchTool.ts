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
 * - 禁止 batch 嵌套和交互类工具（ask_followup_question、attempt_completion）
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
 */
export const BATCH_CONFIG = {
	/** 最大并行工具数 */
	MAX_PARALLEL_TOOLS: 25,

	/**
	 * 禁止在 batch 中执行的工具
	 */
	DISALLOWED_TOOLS: new Set([
		'batch',                    // 禁止嵌套batch（防止无限递归）
		'ask_followup_question',    // 需要用户输入，并行无意义
		'attempt_completion',       // 任务完成标志
	]),

	/**
	 * 写操作工具集合
	 * 同一文件的写操作必须串行执行，避免并发修改导致 diff 冲突
	 */
	WRITE_TOOLS: new Set([
		'write_to_file',
		'apply_diff',
		'edit',
		'multiedit',
		'patch',
		'delete_file',
		'create_directory',
		'insert_content', // 兼容旧别名
		'edit_file',      // 兼容旧别名
	]),

	/**
	 * 推荐在 batch 中执行的工具（以独立只读操作为主）
	 * 写工具虽然在运行时可被串行兜底处理，但不应作为推荐路径。
	 */
	RECOMMENDED_TOOLS: new Set([
		'read_file',
		'list_files',
		'search_files',
		'codebase_search',
		'glob',
		'lsp',
		'lsp_hover',
		'lsp_diagnostics',
		'lsp_definition',
		'lsp_references',
		'lsp_type_definition',
	]),
};

/**
 * Batch 工具常量（新接口）
 * 与BATCH_CONFIG保持一致，对齐 OpenCode：只禁止 batch 自身和交互类工具
 */
export const BatchToolConstants = {
	/** 最小工具调用数量 */
	MIN_CALLS: 1,
	/** 最大工具调用数量 */
	MAX_CALLS: 25,
	/** 禁止在batch中使用的工具（与BATCH_CONFIG.DISALLOWED_TOOLS保持一致） */
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
		// 限制最多 25 个工具
		const validCalls = toolCalls.slice(0, BATCH_CONFIG.MAX_PARALLEL_TOOLS);
		const discardedCalls = toolCalls.slice(BATCH_CONFIG.MAX_PARALLEL_TOOLS);

		console.log(`[BatchTool] 开始执行 ${validCalls.length} 个工具 (丢弃 ${discardedCalls.length} 个)`);

		// 同文件写操作串行，其他操作并行
		// 原因：apply_diff/edit 等写操作并发修改同一文件时，后续 diff 找不到已变更的原始内容，导致失败→AI重试→死循环
		const results = await this.executeMixed(validCalls);

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
	 * 混合执行策略：
	 * - 同一文件的写操作串行（保证顺序）
	 * - 不同文件的写操作、所有只读操作并行
	 */
	private async executeMixed(calls: BatchToolCall[]): Promise<BatchToolResult[]> {
		// 结果数组，按原始顺序填充
		const results: (BatchToolResult | null)[] = new Array(calls.length).fill(null);

		// 提取目标文件路径（写操作才需要串行保护）
		const getFilePath = (call: BatchToolCall): string | null => {
			if (!BATCH_CONFIG.WRITE_TOOLS.has(call.tool)) return null;
			return call.parameters?.path || call.parameters?.target_file || null;
		};

		// 按文件路径分组写操作，收集每个文件的调用索引（有序）
		const fileGroups = new Map<string, number[]>(); // filePath -> [index...]
		const parallelIndices: number[] = [];           // 可并行执行的索引

		for (let i = 0; i < calls.length; i++) {
			const filePath = getFilePath(calls[i]);
			if (filePath) {
				// 写操作：按文件分组
				if (!fileGroups.has(filePath)) {
					fileGroups.set(filePath, []);
				}
				fileGroups.get(filePath)!.push(i);
			} else {
				parallelIndices.push(i);
			}
		}

		// 1. 并行执行所有只读操作 + 单个文件只有一次写操作的情况
		const parallelPromises: Promise<void>[] = [];

		// 只读操作：全部并行
		for (const idx of parallelIndices) {
			parallelPromises.push(
				this.executeCall(calls[idx]).then(r => { results[idx] = r; })
			);
		}

		// 每个文件组：内部串行，不同文件组之间并行
		for (const [filePath, indices] of fileGroups) {
			if (indices.length === 1) {
				// 该文件只有一次写操作，可以并行
				const idx = indices[0];
				parallelPromises.push(
					this.executeCall(calls[idx]).then(r => { results[idx] = r; })
				);
			} else {
				// 该文件有多次写操作，必须串行
				console.log(`[BatchTool] 文件 "${filePath}" 有 ${indices.length} 次写操作，改为串行执行`);
				parallelPromises.push(
					(async () => {
						for (const idx of indices) {
							results[idx] = await this.executeCall(calls[idx]);
						}
					})()
				);
			}
		}

		await Promise.all(parallelPromises);

		// 确保所有结果都有值（防御性）
		const now = Date.now();
		return results.map((r, i) => r ?? {
			tool: calls[i].tool,
			success: false,
			error: '内部错误：未执行',
			startTime: now,
			endTime: now,
		});
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
 * Batch 工具描述 - 用于提示词（主要用于只读探索）
 */
export const BATCH_TOOL_DESCRIPTION = `## batch
并行执行多个独立工具调用，主要用于减少只读探索的往返次数

**性能提升**：将多个独立操作合并可获得 **2-10 倍**的效率提升。

**推荐用例**（以只读操作为主）：
- 读取多个文件（read_file × N）
- 多个搜索操作（search_files、glob、list_files、codebase_search）
- 搜索 + 读取组合
- LSP查询（lsp_hover、lsp_diagnostics、lsp_definition等）

**规则**：
- 每次 batch 最多 **25** 个工具调用
- 所有调用并行启动，**不保证顺序**
- 部分失败**不影响**其他工具
- **不允许嵌套**batch调用

**禁止在batch中使用的工具**：
- batch（禁止嵌套）
- ask_followup_question（需要用户输入，并行无意义）
- attempt_completion（任务完成信号）

**何时不使用**：
- 操作有依赖关系（如：先写入再读取**同一**文件，需要读取前一步的输出）
- 需要顺序执行的操作链
- 不要把多个写操作硬塞进 batch；写入应逐步提交并验证

**参数**：
- tool_calls: 工具调用数组，每个包含 tool（工具名）和 parameters（参数对象）

**示例 - 读取多个文件**：
\`\`\`json
{
  "tool_calls": [
    {"tool": "read_file", "parameters": {"path": "src/index.ts"}},
    {"tool": "read_file", "parameters": {"path": "src/utils.ts"}},
    {"tool": "search_files", "parameters": {"path": "src", "regex": "interface"}}
  ]
}
\`\`\`

**性能对比**：
- 不使用batch：读取5个文件 = 5次API调用
- 使用batch：读取5个文件 = 1次API调用 → **5倍提速**！
`;
