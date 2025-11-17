/*---------------------------------------------------------------------------------------------
 *  Copied from Kilocode - Sliding Window Implementation
 *  This truncates conversation history using a sliding window approach
 *--------------------------------------------------------------------------------------------*/

/**
 * Truncates a conversation by removing a fraction of the messages.
 *
 * The first message (system prompt) is always retained, and a specified fraction
 * (rounded to an even number) of messages from the beginning (excluding the first) is removed.
 *
 * Based on Kilocode's truncateConversation implementation.
 *
 * @param messages - The conversation messages
 * @param fracToRemove - The fraction (between 0 and 1) of messages (excluding the first) to remove
 * @returns The truncated conversation messages
 */
export function truncateConversation<T extends { role: string }>(
	messages: T[],
	fracToRemove: number
): T[] {
	if (messages.length <= 1) {
		return messages;
	}

	const truncatedMessages = [messages[0]]; // Always keep first message (system prompt)
	const rawMessagesToRemove = Math.floor((messages.length - 1) * fracToRemove);
	const messagesToRemove = rawMessagesToRemove - (rawMessagesToRemove % 2); // Round to even number
	const remainingMessages = messages.slice(messagesToRemove + 1);

	// IMPORTANT: Ensure the first remaining message is a 'user' message
	// Function Calling format requires: user -> assistant -> tool -> assistant -> ...
	// If we start with 'tool' or 'assistant', the API will reject it
	let validStartIndex = 0;
	for (let i = 0; i < remainingMessages.length; i++) {
		if (remainingMessages[i].role === 'user') {
			validStartIndex = i;
			break;
		}
	}

	// If we found a user message, start from there
	const finalRemainingMessages = remainingMessages.slice(validStartIndex);
	truncatedMessages.push(...finalRemainingMessages);

	return truncatedMessages;
}
