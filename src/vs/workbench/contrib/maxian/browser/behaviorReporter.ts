/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export const enum BehaviorEventType {
	SESSION_START = 'SESSION_START',
	SESSION_END = 'SESSION_END',
	TASK_START = 'TASK_START',
	TASK_END = 'TASK_END',
	TOOL_USE = 'TOOL_USE',
	FEATURE_VIEW = 'FEATURE_VIEW',
	FEATURE_LEAVE = 'FEATURE_LEAVE',
	AI_CALL = 'AI_CALL',
}

export interface BehaviorEventPayload {
	sessionId: string
	eventType: BehaviorEventType
	featureCode?: string
	clientTs: number
	extraData?: Record<string, unknown>
}

/**
 * 行为上报器 — 已停用
 * knowledge/behavior/event 接口已关闭，所有 report 方法均为空操作。
 * 保留类签名以避免调用方编译错误。
 */
export class BehaviorReporter {

	constructor(_baseUrl: string) { }

	setToken(_token: string): void { }

	reportSessionStart(): void { }

	reportSessionEnd(): void { }

	reportTaskStart(_taskId: string): void { }

	reportTaskEnd(_taskId: string, _status: 'success' | 'failed' | 'aborted'): void { }

	reportToolUse(_toolName: string): void { }

	reportFeatureView(_featureCode: string): void { }

	reportFeatureLeave(_featureCode: string): void { }

	reportAiCall(
		_model: string,
		_tokensIn: number,
		_tokensOut: number,
		_cost: number,
		_latencyMs: number,
		_success: boolean
	): void { }
}
