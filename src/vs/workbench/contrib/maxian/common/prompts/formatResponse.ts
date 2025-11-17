/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Response formatting utilities - based on Kilocode

/**
 * 格式化响应工具
 * 参照kilocode的formatResponse实现
 */
export const formatResponse = {
	/**
	 * 工具被拒绝
	 */
	toolDenied: (): string => {
		return '用户拒绝了此操作。';
	},

	/**
	 * 工具被拒绝并附带反馈
	 */
	toolDeniedWithFeedback: (feedback?: string): string => {
		return `用户拒绝了此操作并提供了以下反馈:\n<feedback>\n${feedback}\n</feedback>`;
	},

	/**
	 * 工具被批准并附带反馈
	 */
	toolApprovedWithFeedback: (feedback?: string): string => {
		return `用户批准了此操作并提供了以下上下文:\n<feedback>\n${feedback}\n</feedback>`;
	},

	/**
	 * 工具执行错误
	 */
	toolError: (error?: string): string => {
		return `工具执行失败，错误如下:\n<error>\n${error}\n</error>`;
	},

	/**
	 * 没有使用工具
	 */
	noToolsUsed: (): string => {
		return `[错误] 你在上一次响应中没有使用任何工具！请使用工具重试。

# 下一步

如果你已经完成了用户的任务，请使用 attempt_completion 工具。
如果你需要从用户那里获取更多信息，请使用 ask_followup_question 工具。
否则，如果你还没有完成任务并且不需要更多信息，请继续执行任务的下一步。
(这是一条自动消息，请不要对它进行对话式回复。)`;
	},

	/**
	 * 太多错误
	 */
	tooManyMistakes: (feedback?: string): string => {
		return `你似乎在继续执行时遇到了困难。用户提供了以下反馈来帮助指导你:\n<feedback>\n${feedback}\n</feedback>`;
	},

	/**
	 * 缺少工具参数错误
	 */
	missingToolParameterError: (paramName: string): string => {
		return `缺少必需参数 '${paramName}' 的值。请使用完整响应重试。`;
	},

	/**
	 * API请求失败
	 */
	apiRequestFailed: (error: string): string => {
		return `API请求失败: ${error}\n\n是否重试？`;
	},

	/**
	 * 任务完成反馈
	 */
	attemptCompletionFeedback: (feedback: string): string => {
		return `用户对结果提供了反馈。请考虑他们的意见继续任务，然后再次尝试完成。\n<feedback>\n${feedback}\n</feedback>`;
	},

	/**
	 * 上下文压缩通知
	 */
	contextCondenseNotice: (): string => {
		return `[注意] 为了保持最佳上下文窗口长度，部分先前的对话历史已被删除。初始用户任务和最近的交互已被保留以保持连续性，而中间的对话历史已被删除。请在继续协助用户时记住这一点。`;
	},

	/**
	 * 重复文件读取通知
	 */
	duplicateFileReadNotice: (): string => {
		return `[[注意] 此文件读取已被删除以节省上下文窗口空间。请参考最新的文件读取以获取此文件的最新版本。]`;
	},

	/**
	 * 格式化工具结果
	 */
	toolResult: (text: string, images?: string[]): string => {
		// 简化版本，暂不支持图片
		return text;
	},

	/**
	 * 格式化文件列表
	 */
	formatFilesList: (files: string[], didHitLimit: boolean): string => {
		if (files.length === 0) {
			return '未找到文件。';
		}

		const sorted = files.sort((a, b) => a.localeCompare(b));

		if (didHitLimit) {
			return `${sorted.join('\n')}\n\n(文件列表已截断。如果需要进一步探索，请在特定子目录上使用list_files。)`;
		}

		return sorted.join('\n');
	}
};
