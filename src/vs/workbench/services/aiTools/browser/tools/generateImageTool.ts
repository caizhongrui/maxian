/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Generate Image Tool - Generates images using AI models
 */

export interface GenerateImageParams {
	prompt: string;
	path: string;
	image?: string;
}

export interface GenerateImageResult {
	success: boolean;
	imageData?: string;
	error?: string;
}

export const IMAGE_GENERATION_MODELS = [
	'google/gemini-2.5-flash-image',
	'openai/gpt-5-image',
	'openai/gpt-5-image-mini',
] as const;

export const SUPPORTED_IMAGE_FORMATS = ['png', 'jpg', 'jpeg', 'gif', 'webp'] as const;

/**
 * Validate generate image parameters
 */
export function validateGenerateImageParams(
	params: GenerateImageParams
): { valid: boolean; error?: string } {
	if (!params.prompt) {
		return { valid: false, error: 'Missing required parameter: prompt' };
	}

	if (!params.path) {
		return { valid: false, error: 'Missing required parameter: path' };
	}

	return { valid: true };
}

/**
 * Validate image format
 */
export function validateImageFormat(filePath: string): { valid: boolean; extension?: string; error?: string } {
	const match = filePath.match(/\.([^.]+)$/);
	if (!match) {
		return { valid: false, error: 'No file extension found' };
	}

	const extension = match[1].toLowerCase();
	if (!SUPPORTED_IMAGE_FORMATS.includes(extension as any)) {
		return {
			valid: false,
			error: `Unsupported image format: ${extension}. Supported formats: ${SUPPORTED_IMAGE_FORMATS.join(', ')}`,
		};
	}

	return { valid: true, extension };
}

/**
 * Extract base64 data from data URL
 */
export function extractBase64FromDataUrl(dataUrl: string): {
	success: boolean;
	format?: string;
	base64Data?: string;
	error?: string;
} {
	const match = dataUrl.match(/^data:image\/(png|jpeg|jpg);base64,(.+)$/);
	if (!match) {
		return { success: false, error: 'Invalid image format received' };
	}

	return {
		success: true,
		format: match[1],
		base64Data: match[2],
	};
}

/**
 * Ensure file path has correct extension
 */
export function ensureImageExtension(filePath: string, imageFormat: string): string {
	if (!filePath.match(/\.(png|jpg|jpeg)$/i)) {
		return `${filePath}.${imageFormat === 'jpeg' ? 'jpg' : imageFormat}`;
	}
	return filePath;
}

/**
 * Read input image as base64 data URL
 */
export function readImageAsDataUrl(imageBuffer: Buffer, extension: string): string {
	const mimeType = extension === 'jpg' ? 'jpeg' : extension;
	return `data:image/${mimeType};base64,${imageBuffer.toString('base64')}`;
}
