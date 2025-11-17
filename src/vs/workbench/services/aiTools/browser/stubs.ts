/*---------------------------------------------------------------------------------------------
 *  Stub implementations for missing Kilocode modules
 *--------------------------------------------------------------------------------------------*/

// Stub for i18n
export function t(key: string, ...args: any[]): string {
	return key;
}

// Stub for countTokens
export function countTokens(text: string): number {
	// Rough estimation: 1 token ≈ 4 characters
	return Math.ceil(text.length / 4);
}

// Stub for pretty-bytes
export function prettyBytes(bytes: number): string {
	if (bytes < 1024) return bytes + ' B';
	if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
	return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// Stub for extract-text
export async function extractTextFromFile(filePath: string): Promise<string> {
	return '';
}

// Stub for line-counter
export async function countFileLines(filePath: string): Promise<number> {
	return 0;
}

// Stub for text-normalization
export function normalizeLineEndings(text: string): string {
	return text.replace(/\r\n/g, '\n');
}
