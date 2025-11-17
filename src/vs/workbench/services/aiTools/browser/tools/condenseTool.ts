/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Condense Tool - Summarizes conversation history to reduce context size
 */

export interface CondenseParams {
	message: string;
}

export interface ConversationMessage {
	role: 'user' | 'assistant' | 'system';
	content: string;
}

export interface CondenseResult {
	success: boolean;
	summarizedMessages?: ConversationMessage[];
	originalTokens?: number;
	summarizedTokens?: number;
	error?: string;
}

/**
 * Estimate token count (rough approximation: ~4 chars per token)
 */
export function estimateTokens(text: string): number {
	return Math.ceil(text.length / 4);
}

/**
 * Calculate total tokens in conversation
 */
export function calculateConversationTokens(messages: ConversationMessage[]): number {
	let total = 0;
	for (const msg of messages) {
		total += estimateTokens(msg.content);
	}
	return total;
}

/**
 * Create a simple summary of conversation
 */
export function createConversationSummary(messages: ConversationMessage[]): string {
	const userMessages = messages.filter(m => m.role === 'user');
	const assistantMessages = messages.filter(m => m.role === 'assistant');

	const summary = [
		`Conversation Summary (${messages.length} messages):`,
		`- User messages: ${userMessages.length}`,
		`- Assistant messages: ${assistantMessages.length}`,
		'',
		'Key topics discussed:',
	];

	// Extract first few user messages as key topics
	const topics = userMessages.slice(0, 3).map((m, i) => {
		const preview = m.content.substring(0, 100);
		return `${i + 1}. ${preview}${m.content.length > 100 ? '...' : ''}`;
	});

	summary.push(...topics);

	if (userMessages.length > 3) {
		summary.push(`... and ${userMessages.length - 3} more topics`);
	}

	return summary.join('\n');
}

/**
 * Condense conversation by keeping system messages and creating a summary
 */
export function condenseConversation(messages: ConversationMessage[]): ConversationMessage[] {
	if (messages.length <= 2) {
		return messages;
	}

	const condensed: ConversationMessage[] = [];

	// Keep system messages
	const systemMessages = messages.filter(m => m.role === 'system');
	condensed.push(...systemMessages);

	// Create summary of the rest
	const nonSystemMessages = messages.filter(m => m.role !== 'system');
	if (nonSystemMessages.length > 0) {
		const summary = createConversationSummary(nonSystemMessages);
		condensed.push({
			role: 'assistant',
			content: summary,
		});
	}

	// Keep last few messages for context
	const recentMessages = messages.slice(-2);
	condensed.push(...recentMessages);

	return condensed;
}
