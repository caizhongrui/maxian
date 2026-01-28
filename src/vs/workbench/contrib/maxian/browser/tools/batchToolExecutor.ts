/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../base/common/lifecycle.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { IBatchToolExecutor, IBatchToolParams, IBatchToolResult, validateBatchParams, formatBatchResult, BatchToolConstants } from '../../common/tools/batchTool.js';
import { ToolName, ToolResult } from '../../common/tools/toolTypes.js';
import { IToolExecutor } from '../../common/tools/toolExecutor.js';

/**
 * Batch工具执行器实现
 */
export class BatchToolExecutor extends Disposable implements IBatchToolExecutor {

	constructor(
		private readonly toolExecutor: IToolExecutor,
		@ILogService private readonly logService: ILogService
	) {
		super();
	}

	/**
	 * 并行执行多个工具调用
	 */
	async executeBatch(params: IBatchToolParams): Promise<IBatchToolResult> {
		this.logService.info('[BatchTool] Starting batch execution', { count: params.tool_calls.length });

		// 1. 验证参数
		const validation = validateBatchParams(params);
		if (!validation.valid) {
			throw new Error(validation.error);
		}

		// 2. 限制最大数量
		const toolCalls = params.tool_calls.slice(0, BatchToolConstants.MAX_CALLS);
		const discardedCalls = params.tool_calls.slice(BatchToolConstants.MAX_CALLS);

		if (discardedCalls.length > 0) {
			this.logService.warn('[BatchTool] Discarded tool calls exceeding max limit', {
				discarded: discardedCalls.length,
				max: BatchToolConstants.MAX_CALLS
			});
		}

		// 3. 并行执行所有工具调用
		const startTime = Date.now();
		const results = await Promise.all(
			toolCalls.map(call => this.executeSingleCall(call.tool, call.parameters))
		);

		// 4. 添加被丢弃的调用作为错误
		for (const call of discardedCalls) {
			results.push({
				tool: call.tool,
				success: false,
				error: `Maximum of ${BatchToolConstants.MAX_CALLS} tools allowed in batch`
			});
		}

		const duration = Date.now() - startTime;
		const successful = results.filter(r => r.success).length;
		const failed = results.length - successful;

		this.logService.info('[BatchTool] Batch execution completed', {
			total: results.length,
			successful,
			failed,
			duration: `${duration}ms`
		});

		// 5. 返回结果
		return {
			content: formatBatchResult(results),
			successful,
			failed,
			total: results.length,
			results,
			metadata: {
				duration,
				tools: toolCalls.map(c => c.tool),
				parallelExecution: true
			}
		};
	}

	/**
	 * 执行单个工具调用（带错误处理）
	 */
	private async executeSingleCall(tool: ToolName, parameters: any): Promise<{
		tool: ToolName;
		success: boolean;
		result?: ToolResult;
		error?: string;
	}> {
		const callStartTime = Date.now();

		try {
			this.logService.debug('[BatchTool] Executing tool', { tool, parameters });

			// 执行工具
			const result = await this.toolExecutor.executeTool(tool, parameters);

			const callDuration = Date.now() - callStartTime;
			this.logService.debug('[BatchTool] Tool execution succeeded', {
				tool,
				duration: `${callDuration}ms`
			});

			return {
				tool,
				success: true,
				result
			};

		} catch (error) {
			const callDuration = Date.now() - callStartTime;
			const errorMessage = error instanceof Error ? error.message : String(error);

			this.logService.error('[BatchTool] Tool execution failed', {
				tool,
				error: errorMessage,
				duration: `${callDuration}ms`
			});

			return {
				tool,
				success: false,
				error: errorMessage
			};
		}
	}
}
