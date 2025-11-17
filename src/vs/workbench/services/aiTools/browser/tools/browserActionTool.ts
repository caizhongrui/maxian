/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Browser Action Tool - Controls browser automation actions
 */

export type BrowserAction =
	| 'launch'
	| 'click'
	| 'hover'
	| 'type'
	| 'scroll_down'
	| 'scroll_up'
	| 'resize'
	| 'close';

export const browserActions: readonly BrowserAction[] = [
	'launch',
	'click',
	'hover',
	'type',
	'scroll_down',
	'scroll_up',
	'resize',
	'close',
] as const;

export interface BrowserActionParams {
	action: BrowserAction;
	url?: string;
	coordinate?: string;
	text?: string;
	size?: string;
}

export interface BrowserActionResult {
	success: boolean;
	screenshot?: string;
	logs?: string;
	error?: string;
}

/**
 * Convert various input types to stringly typed values
 */
export function toStringlyTyped(value: string | number[] | object | null | undefined): string | undefined {
	if (typeof value === 'string') {
		return value;
	}
	if (Array.isArray(value)) {
		return value.join(',');
	}
	if (value && typeof value === 'object') {
		if ('x' in value && 'y' in value) {
			return `${(value as any).x},${(value as any).y}`;
		}
		if ('width' in value && 'height' in value) {
			return `${(value as any).width},${(value as any).height}`;
		}
	}
	return undefined;
}

/**
 * Validate browser action parameters
 */
export function validateBrowserActionParams(params: BrowserActionParams): { valid: boolean; error?: string } {
	if (!params.action || !browserActions.includes(params.action)) {
		return { valid: false, error: 'Missing or invalid action parameter' };
	}

	if (params.action === 'launch' && !params.url) {
		return { valid: false, error: 'URL required for launch action' };
	}

	if ((params.action === 'click' || params.action === 'hover') && !params.coordinate) {
		return { valid: false, error: 'Coordinate required for click/hover action' };
	}

	if (params.action === 'type' && !params.text) {
		return { valid: false, error: 'Text required for type action' };
	}

	if (params.action === 'resize' && !params.size) {
		return { valid: false, error: 'Size required for resize action' };
	}

	return { valid: true };
}
