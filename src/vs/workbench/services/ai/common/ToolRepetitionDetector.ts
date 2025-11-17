/*---------------------------------------------------------------------------------------------
 *  Copied from Kilocode - Tool Repetition Detection
 *  This detects when the AI repeatedly calls the same tool with identical parameters
 *--------------------------------------------------------------------------------------------*/

export interface ToolRepetitionCheckResult {
	allowExecution: boolean;
	askUser?: {
		messageKey: string;
		messageDetail: string;
	};
}

export interface ToolUse {
	name: string;
	params: any;
}

/**
 * Detects and prevents repeated identical tool calls.
 * Based on Kilocode's ToolRepetitionDetector implementation.
 */
export class ToolRepetitionDetector {
	private consecutiveIdenticalToolCallLimit: number;
	private consecutiveIdenticalToolCallCount: number = 0;
	private previousToolCallJson: string | null = null;

	constructor(consecutiveIdenticalToolCallLimit: number) {
		this.consecutiveIdenticalToolCallLimit = consecutiveIdenticalToolCallLimit;
	}

	/**
	 * Check if a tool use should be allowed or blocked due to repetition.
	 * @param toolUse The tool use block to check
	 * @returns Result indicating whether execution should proceed
	 */
	check(toolUse: ToolUse): ToolRepetitionCheckResult {
		// Serialize the current tool call for comparison
		const currentToolCallJson = this.serializeToolUse(toolUse);

		// Check if this matches the previous tool call
		if (this.previousToolCallJson === currentToolCallJson) {
			this.consecutiveIdenticalToolCallCount++;
		} else {
			// Different tool call, reset counter
			this.consecutiveIdenticalToolCallCount = 0;
			this.previousToolCallJson = currentToolCallJson;
		}

		// Check if we've hit the limit
		// Special case: browser scroll actions are exempt from the limit
		const isBrowserScroll =
			toolUse.name === 'browser_action' &&
			(toolUse.params.action === 'scroll_down' || toolUse.params.action === 'scroll_up');

		if (
			!isBrowserScroll &&
			this.consecutiveIdenticalToolCallLimit > 0 &&
			this.consecutiveIdenticalToolCallCount >= this.consecutiveIdenticalToolCallLimit
		) {
			// Reset counters
			this.consecutiveIdenticalToolCallCount = 0;
			this.previousToolCallJson = null;

			return {
				allowExecution: false,
				askUser: {
					messageKey: 'mistake_limit_reached',
					messageDetail: `工具 {toolName} 已连续调用 ${this.consecutiveIdenticalToolCallLimit} 次且参数完全相同。这通常意味着该方法无法获取所需信息，需要尝试其他工具或方法。`
				}
			};
		}

		// Allow execution
		return {
			allowExecution: true
		};
	}

	/**
	 * Serialize a tool use block to JSON for comparison.
	 * @param toolUse The tool use block
	 * @returns JSON string representation
	 */
	private serializeToolUse(toolUse: ToolUse): string {
		return JSON.stringify({
			name: toolUse.name,
			input: toolUse.params
		});
	}
}
