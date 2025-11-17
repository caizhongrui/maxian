/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Report Bug Tool - Creates bug reports for GitHub issues
 */

export interface ReportBugParams {
	title: string;
	description: string;
}

export interface SystemInfo {
	operatingSystem: string;
	vscodeVersion: string;
	nodeVersion: string;
	architecture: string;
	extensionVersion: string;
	providerAndModel?: string;
}

/**
 * Validate report bug parameters
 */
export function validateReportBugParams(params: ReportBugParams): { valid: boolean; error?: string } {
	if (!params.title) {
		return { valid: false, error: 'Missing required parameter: title' };
	}

	if (!params.description) {
		return { valid: false, error: 'Missing required parameter: description' };
	}

	return { valid: true };
}

/**
 * Gather system information
 */
export function gatherSystemInfo(): SystemInfo {
	// This would be implemented using VS Code APIs and Node.js APIs
	// For now, returning placeholder values
	return {
		operatingSystem: 'Unknown',
		vscodeVersion: 'Unknown',
		nodeVersion: process.version || 'Unknown',
		architecture: process.arch || 'Unknown',
		extensionVersion: 'Unknown',
	};
}

/**
 * Format bug report with system information
 */
export function formatBugReport(
	params: ReportBugParams,
	systemInfo: SystemInfo
): string {
	return `${params.description}

**System Information:**
- Operating System: ${systemInfo.operatingSystem}
- VS Code Version: ${systemInfo.vscodeVersion}
- Node.js Version: ${systemInfo.nodeVersion}
- Architecture: ${systemInfo.architecture}
- Extension Version: ${systemInfo.extensionVersion}
${systemInfo.providerAndModel ? `- Provider & Model: ${systemInfo.providerAndModel}` : ''}`;
}

/**
 * Create GitHub issue URL
 */
export function createGitHubIssueUrl(
	owner: string,
	repo: string,
	template: string,
	params: Map<string, string>
): string {
	const baseUrl = `https://github.com/${owner}/${repo}/issues/new`;
	const queryParams = new URLSearchParams();

	queryParams.set('template', template);

	for (const [key, value] of params.entries()) {
		queryParams.set(key, value);
	}

	return `${baseUrl}?${queryParams.toString()}`;
}
