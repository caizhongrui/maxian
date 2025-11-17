/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Levenshtein distance implementation
// Replacement for fastest-levenshtein package used in Kilocode

/**
 * Calculates the Levenshtein distance between two strings
 * The Levenshtein distance is the minimum number of single-character edits
 * (insertions, deletions, or substitutions) required to change one string into the other
 *
 * @param str1 First string
 * @param str2 Second string
 * @returns The Levenshtein distance
 */
export function distance(str1: string, str2: string): number {
	const len1 = str1.length;
	const len2 = str2.length;

	// If either string is empty, return the length of the other
	if (len1 === 0) {
		return len2;
	}
	if (len2 === 0) {
		return len1;
	}

	// Create a 2D array for dynamic programming
	// We only need two rows for optimization
	let prevRow = new Array(len2 + 1);
	let currRow = new Array(len2 + 1);

	// Initialize first row (distance from empty string to str2 prefixes)
	for (let j = 0; j <= len2; j++) {
		prevRow[j] = j;
	}

	// Fill the rest of the matrix
	for (let i = 1; i <= len1; i++) {
		currRow[0] = i; // Distance from str1 prefix to empty string

		for (let j = 1; j <= len2; j++) {
			// Calculate the cost of each operation
			const substitutionCost = str1[i - 1] === str2[j - 1] ? 0 : 1;
			const deletion = prevRow[j] + 1;          // Delete from str1
			const insertion = currRow[j - 1] + 1;     // Insert into str1
			const substitution = prevRow[j - 1] + substitutionCost;  // Replace in str1

			// Take minimum of the three operations
			currRow[j] = Math.min(deletion, insertion, substitution);
		}

		// Swap rows for next iteration
		[prevRow, currRow] = [currRow, prevRow];
	}

	// The result is in prevRow[len2] after the swap
	return prevRow[len2];
}

/**
 * Calculates the similarity ratio between two strings based on Levenshtein distance
 * Returns a value between 0 and 1, where 1 is an exact match
 *
 * @param str1 First string
 * @param str2 Second string
 * @returns The similarity ratio (0 to 1)
 */
export function similarity(str1: string, str2: string): number {
	const maxLength = Math.max(str1.length, str2.length);
	if (maxLength === 0) {
		return 1; // Both strings are empty, they are identical
	}

	const dist = distance(str1, str2);
	return 1 - dist / maxLength;
}
