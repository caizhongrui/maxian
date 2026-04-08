/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * 统一 token 估算口径：
 * 对中文/代码混合文本，按 4 chars ≈ 1 token 估算更稳定。
 */
export const DEFAULT_CHARS_PER_TOKEN = 4;

export function estimateTokensFromChars(chars: number, charsPerToken: number = DEFAULT_CHARS_PER_TOKEN): number {
	const safeChars = Number.isFinite(chars) ? Math.max(0, chars) : 0;
	const safeDivisor = charsPerToken > 0 ? charsPerToken : DEFAULT_CHARS_PER_TOKEN;
	return Math.ceil(safeChars / safeDivisor);
}

export function estimateTokensFromText(text: string, charsPerToken: number = DEFAULT_CHARS_PER_TOKEN): number {
	return estimateTokensFromChars(text.length, charsPerToken);
}
