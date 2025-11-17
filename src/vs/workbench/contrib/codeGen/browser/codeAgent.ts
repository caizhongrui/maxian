/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ICodeEditor } from '../../../../editor/browser/editorBrowser.js';
import { IAIService } from '../../../../platform/ai/common/ai.js';
import { IProjectAnalyzerService } from '../../../services/projectAnalyzer/common/projectAnalyzer.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { URI } from '../../../../base/common/uri.js';
import { IQuickInputService, IQuickPickItem } from '../../../../platform/quickinput/common/quickInput.js';
import { ITextFileService } from '../../../services/textfile/common/textfiles.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';

export interface GeneratedFile {
	readonly path: string;
	readonly content: string;
	readonly description: string;
}

export interface AgentTask {
	readonly type: 'modify' | 'create' | 'multi-file';
	readonly description: string;
	readonly files: GeneratedFile[];
}

/**
 * Code Development Agent
 * Intelligent agent that can modify existing files or generate new files
 */
export class CodeAgent {

	constructor(
		private readonly aiService: IAIService,
		private readonly projectAnalyzer: IProjectAnalyzerService,
		private readonly fileService: IFileService,
		private readonly textFileService: ITextFileService,
		private readonly workspaceService: IWorkspaceContextService,
		private readonly quickInputService: IQuickInputService
	) { }

	/**
	 * Execute agent task based on user requirement
	 */
	async execute(requirement: string, editor: ICodeEditor | null, token: CancellationToken, onProgress?: (message: string) => void): Promise<void> {
		try {
			if (onProgress) onProgress('Planning task...');

			// 1. Analyze requirement to determine task type
			const task = await this.planTask(requirement, editor);

			if (onProgress) onProgress('Task planned. Awaiting confirmation...');

			// 2. Show preview of planned changes
			const confirmed = await this.showTaskPreview(task);
			if (!confirmed) {
				if (onProgress) onProgress('Task cancelled');
				return;
			}

			if (onProgress) onProgress('Creating files...');

			// 3. Execute the task
			await this.executeTask(task, token);

			if (onProgress) onProgress('Complete!');

		} catch (error) {
			if (onProgress) onProgress(`Failed: ${error}`);
			throw error;
		}
	}

	/**
	 * Plan the task based on requirement
	 */
	private async planTask(requirement: string, editor: ICodeEditor | null): Promise<AgentTask> {
		const workspace = this.workspaceService.getWorkspace().folders[0];
		if (!workspace) {
			throw new Error('No workspace folder found');
		}

		// Analyze project structure
		const projectInfo = await this.projectAnalyzer.analyzeProject(workspace.uri);

		// Determine if it's a modification or new file creation
		const hasCurrentFile = editor && editor.hasModel();
		const currentFile = hasCurrentFile ? editor!.getModel()!.uri.fsPath : null;
		const currentCode = hasCurrentFile ? editor!.getModel()!.getValue() : null;

		// Ask AI to plan the task
		const planPrompt = `You are a code development agent. Analyze the following requirement and create a task plan.

Requirement: ${requirement}

Project Context:
- Type: ${projectInfo.type}
- Framework: ${projectInfo.framework}
- Language: ${projectInfo.language}
${currentFile ? `- Current File: ${currentFile}` : ''}
${currentCode ? `- Current Code Length: ${currentCode.length} characters` : ''}

Determine:
1. Task type: "modify" (modify current file), "create" (create new file), or "multi-file" (create multiple files)
2. Files to create/modify
3. Suggested file locations (IMPORTANT: use RELATIVE paths from workspace root)

Response format (JSON):
{
  "type": "modify" | "create" | "multi-file",
  "description": "brief task description",
  "files": [
    {
      "path": "src/services/example.ts",
      "description": "what this file does",
      "action": "create" | "modify"
    }
  ]
}

IMPORTANT:
- ALL paths must be RELATIVE to workspace root
- Do NOT use absolute paths
- Example: "src/dto/User.java" not "/Users/.../src/dto/User.java"`;

		const planResult = await this.aiService.complete(planPrompt);
		const plan = this.parsePlan(planResult);

		// Generate code for each file
		const files: GeneratedFile[] = [];
		for (const fileInfo of plan.files) {
			const code = await this.generateFileCode(requirement, fileInfo, projectInfo, currentCode);
			files.push({
				path: fileInfo.path,
				content: code,
				description: fileInfo.description
			});
		}

		return {
			type: plan.type,
			description: plan.description,
			files
		};
	}

	/**
	 * Generate code for a specific file
	 */
	private async generateFileCode(
		requirement: string,
		fileInfo: any,
		projectInfo: any,
		currentCode: string | null
	): Promise<string> {
		const prompt = `Generate ${fileInfo.action === 'modify' ? 'modified' : 'new'} code for this file.

Requirement: ${requirement}
File: ${fileInfo.path}
Purpose: ${fileInfo.description}

Project Context:
- Framework: ${projectInfo.framework}
- Language: ${projectInfo.language}

${currentCode && fileInfo.action === 'modify' ? `Current Code:\n${currentCode}\n` : ''}

Requirements:
1. Follow ${projectInfo.framework} best practices
2. Use appropriate design patterns
3. Include error handling
4. Add comments for complex logic IN CHINESE (中文注释)
5. All comments and documentation must be in Chinese
6. Match the existing code style in the project (indentation, naming conventions, etc.)
7. Return ONLY the code, no explanations

Generate the ${fileInfo.action === 'modify' ? 'modified' : 'new'} code:`;

		const result = await this.aiService.complete(prompt);
		return this.extractCode(result);
	}

	/**
	 * Show task preview and get user confirmation
	 */
	private async showTaskPreview(task: AgentTask): Promise<boolean> {
		const items: IQuickPickItem[] = task.files.map(file => ({
			label: file.path,
			description: file.description,
			detail: `${file.content.split('\n').length} lines`
		}));

		const result = await this.quickInputService.pick(items, {
			title: `Agent Task: ${task.description}`,
			placeHolder: 'Files to be created/modified. Press Enter to continue, Escape to cancel',
			canPickMany: false
		});

		return result !== undefined;
	}

	/**
	 * Execute the planned task
	 */
	private async executeTask(task: AgentTask, token: CancellationToken): Promise<void> {
		const workspace = this.workspaceService.getWorkspace().folders[0];
		if (!workspace) {
			throw new Error('No workspace folder found');
		}

		const workspacePath = workspace.uri.fsPath;
		const workspaceName = workspace.name;

		for (const file of task.files) {
			let filePath = file.path;

			// If path is absolute and within workspace, make it relative
			if (filePath.startsWith('/') || filePath.match(/^[a-zA-Z]:/)) {
				if (filePath.startsWith(workspacePath)) {
					// Extract relative path from workspace root
					filePath = filePath.substring(workspacePath.length);
					if (filePath.startsWith('/') || filePath.startsWith('\\')) {
						filePath = filePath.substring(1);
					}
				} else {
					// Path is outside workspace, use filename only
					filePath = filePath.split(/[/\\]/).pop() || 'generated.ts';
				}
			}

			// If path starts with workspace folder name (e.g., "backend/src/..."), remove it
			// This handles cases where AI returns "backend/src/..." but workspace is already "backend/"
			if (filePath.startsWith(workspaceName + '/') || filePath.startsWith(workspaceName + '\\')) {
				filePath = filePath.substring(workspaceName.length + 1);
			}

			// Create URI from relative path
			const fileUri = URI.joinPath(workspace.uri, filePath);

			// Create directories if needed
			const dirUri = URI.joinPath(fileUri, '..');
			await this.fileService.createFolder(dirUri);

			// Write file
			await this.textFileService.write(fileUri, file.content);
			// Don't show notification - progress is shown in chat
		}
	}

	/**
	 * Parse AI plan response
	 */
	private parsePlan(planResult: string): any {
		try {
			// Try to extract JSON from response
			const jsonMatch = planResult.match(/\{[\s\S]*\}/);
			if (jsonMatch) {
				return JSON.parse(jsonMatch[0]);
			}
		} catch (error) {
			console.error('[Code Agent] Failed to parse plan:', error);
		}

		// Fallback: single file creation
		return {
			type: 'create',
			description: 'Generate new file',
			files: [
				{
					path: 'generated.ts',
					description: 'Generated file',
					action: 'create'
				}
			]
		};
	}

	/**
	 * Extract code from AI response
	 */
	private extractCode(response: string): string {
		let code = response.trim();

		// Remove markdown code blocks
		const codeBlockMatch = code.match(/```(?:\w+)?\s*\n([\s\S]*?)```/);
		if (codeBlockMatch) {
			code = codeBlockMatch[1].trim();
		}

		code = code.replace(/```/g, '').trim();
		return code;
	}
}
