/*---------------------------------------------------------------------------------------------
 *  Adapted from kilocode askFollowupQuestionTool.ts
 *  Task class dependency removed - now a standalone function
 *--------------------------------------------------------------------------------------------*/

export interface AskFollowupQuestionToolParams {
	question: string;
	follow_up?: string | Array<{ text?: string; mode?: string }>;
}

export interface AskFollowupQuestionToolResult {
	success: boolean;
	question: string;
	suggestions: Array<{ answer: string; mode?: string }>;
	error?: string;
}

/**
 * Parse XML format suggestions
 * This is a simplified XML parser for the follow_up parameter
 */
function parseXmlSuggestions(xmlString: string): Array<{ answer: string; mode?: string }> {
	const suggestions: Array<{ answer: string; mode?: string }> = [];

	// Simple regex-based XML parsing for <suggest> tags
	const suggestRegex = /<suggest(?:\s+mode="([^"]*)")?>([^<]*)<\/suggest>/g;
	let match;

	while ((match = suggestRegex.exec(xmlString)) !== null) {
		const mode = match[1];
		const text = match[2];

		suggestions.push({
			answer: text,
			...(mode ? { mode } : {})
		});
	}

	return suggestions;
}

/**
 * Ask a follow-up question with optional suggestions
 * This is a simplified version that returns the question and parsed suggestions
 * The actual UI interaction should be handled by the caller
 */
export async function askFollowupQuestionTool(
	params: AskFollowupQuestionToolParams
): Promise<AskFollowupQuestionToolResult> {
	try {
		if (!params.question) {
			return {
				success: false,
				question: '',
				suggestions: [],
				error: 'Missing required parameter: question'
			};
		}

		const suggestions: Array<{ answer: string; mode?: string }> = [];

		// Handle native tool call format (follow_up is already parsed as an array)
		if ('follow_up' in params && Array.isArray(params.follow_up)) {
			const followUpArray = params.follow_up as Array<{ text?: string; mode?: string }>;

			suggestions.push(...followUpArray.map((item) => ({
				answer: item.text || '',
				...(item.mode ? { mode: item.mode } : {})
			})));
		}
		// Handle XML format (legacy)
		else if (params.follow_up && typeof params.follow_up === 'string') {
			suggestions.push(...parseXmlSuggestions(params.follow_up));
		}

		return {
			success: true,
			question: params.question,
			suggestions
		};
	} catch (error) {
		return {
			success: false,
			question: params.question || '',
			suggestions: [],
			error: error instanceof Error ? error.message : String(error)
		};
	}
}
