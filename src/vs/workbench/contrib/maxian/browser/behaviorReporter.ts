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

export class BehaviorReporter {
	private sessionId: string
	private featureViewTsMap: Map<string, number> = new Map()
	private baseUrl: string
	private token: string | undefined

	constructor(baseUrl: string) {
		this.baseUrl = baseUrl
		this.sessionId = `sess_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
	}

	setToken(token: string): void {
		this.token = token
	}

	private report(eventType: BehaviorEventType, featureCode?: string, extraData?: Record<string, unknown>): void {
		const payload: BehaviorEventPayload = {
			sessionId: this.sessionId,
			eventType,
			featureCode,
			clientTs: Date.now(),
			extraData,
		}
		this.postEvent(payload).catch(() => { /* 静默失败 */ })
	}

	private async postEvent(payload: BehaviorEventPayload): Promise<void> {
		if (!this.token) return
		try {
			await fetch(`${this.baseUrl}/knowledge/behavior/event`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Authorization': `Bearer ${this.token}`,
				},
				body: JSON.stringify(payload),
			})
		} catch {
			// 网络错误静默处理
		}
	}

	reportSessionStart(): void {
		this.report(BehaviorEventType.SESSION_START)
	}

	reportSessionEnd(): void {
		this.report(BehaviorEventType.SESSION_END)
	}

	reportTaskStart(taskId: string): void {
		this.report(BehaviorEventType.TASK_START, undefined, { taskId })
	}

	reportTaskEnd(taskId: string, status: 'success' | 'failed' | 'aborted'): void {
		this.report(BehaviorEventType.TASK_END, undefined, { taskId, status })
	}

	reportToolUse(toolName: string): void {
		this.report(BehaviorEventType.TOOL_USE, undefined, { toolName })
	}

	reportFeatureView(featureCode: string): void {
		this.featureViewTsMap.set(featureCode, Date.now())
		this.report(BehaviorEventType.FEATURE_VIEW, featureCode)
	}

	reportFeatureLeave(featureCode: string): void {
		const enterTs = this.featureViewTsMap.get(featureCode)
		const duration = enterTs ? Math.round((Date.now() - enterTs) / 1000) : undefined
		this.featureViewTsMap.delete(featureCode)
		this.report(BehaviorEventType.FEATURE_LEAVE, featureCode, { duration })
	}

	reportAiCall(
		model: string,
		tokensIn: number,
		tokensOut: number,
		cost: number,
		latencyMs: number,
		success: boolean
	): void {
		this.report(BehaviorEventType.AI_CALL, undefined, {
			model, tokensIn, tokensOut, cost, latencyMs, success
		})
	}
}
