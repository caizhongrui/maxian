/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface ModeInfo {
	slug: string;
	name: string;
	description?: string;
}

export const defaultModeSlug = 'code';

const builtInModes: ModeInfo[] = [
	{ slug: 'code', name: 'Code', description: 'Code editing and development' },
	{ slug: 'architect', name: 'Architect', description: 'System architecture and design' },
	{ slug: 'ask', name: 'Ask', description: 'Question and answer' },
];

export function getModeBySlug(slug: string, customModes?: ModeInfo[]): ModeInfo | undefined {
	if (customModes) {
		const customMode = customModes.find(m => m.slug === slug);
		if (customMode) {
			return customMode;
		}
	}
	return builtInModes.find(m => m.slug === slug);
}

export function getAllModes(customModes?: ModeInfo[]): ModeInfo[] {
	const modes = [...builtInModes];
	if (customModes) {
		modes.push(...customModes);
	}
	return modes;
}

export interface SwitchModeParams {
	mode_slug: string;
	reason?: string;
}

export interface SwitchModeResult {
	success: boolean;
	previousMode?: string;
	newMode?: string;
	error?: string;
}

export function validateModeSwitch(
	currentMode: string,
	targetMode: string,
	customModes?: ModeInfo[]
): SwitchModeResult {
	const targetModeInfo = getModeBySlug(targetMode, customModes);

	if (!targetModeInfo) {
		return {
			success: false,
			error: `Invalid mode: ${targetMode}`,
		};
	}

	if (currentMode === targetMode) {
		return {
			success: false,
			error: `Already in ${targetModeInfo.name} mode.`,
		};
	}

	return {
		success: true,
		previousMode: currentMode,
		newMode: targetMode,
	};
}
