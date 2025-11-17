/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ICodeEditor } from '../../../../editor/browser/editorBrowser.js';
import { IAIService } from '../../../../platform/ai/common/ai.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { IProgressService, ProgressLocation } from '../../../../platform/progress/common/progress.js';
import { IProjectAnalyzerService } from '../../../services/projectAnalyzer/common/projectAnalyzer.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { ITextFileService } from '../../../services/textfile/common/textfiles.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { CodeAgent } from './codeAgent.js';

/**
 * Code Agent Command
 * Entry point for AI-powered code development agent
 */
export class AgentCommand {

	constructor(
		private readonly aiService: IAIService,
		private readonly quickInputService: IQuickInputService,
		private readonly progressService: IProgressService,
		private readonly projectAnalyzer: IProjectAnalyzerService,
		private readonly fileService: IFileService,
		private readonly textFileService: ITextFileService,
		private readonly workspaceService: IWorkspaceContextService
	) { }

	async execute(editor: ICodeEditor | null, token: CancellationToken): Promise<void> {
		// 1. Get requirement from user
		const requirement = await this.quickInputService.input({
			title: 'AI Code Agent',
			placeHolder: 'Describe what you want to build (e.g., "Create a user authentication module")',
			prompt: 'Enter your requirement and the AI agent will generate or modify code accordingly'
		});

		if (!requirement) {
			return;
		}

		// 2. Execute agent with progress indication
		await this.progressService.withProgress({
			location: ProgressLocation.Notification,
			title: 'AI Agent is working...',
			cancellable: true
		}, async (progress) => {
			progress.report({ message: 'Analyzing requirement...', increment: 20 });

			const agent = new CodeAgent(
				this.aiService,
				this.projectAnalyzer,
				this.fileService,
				this.textFileService,
				this.workspaceService,
				this.quickInputService
			);

			progress.report({ message: 'Generating code...', increment: 40 });
			await agent.execute(requirement, editor, token);

			progress.report({ message: 'Complete!', increment: 40 });
		});
	}
}
