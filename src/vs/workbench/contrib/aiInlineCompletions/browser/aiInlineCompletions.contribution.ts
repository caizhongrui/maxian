/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { IWorkbenchContribution, WorkbenchPhase, registerWorkbenchContribution2 } from '../../../common/contributions.js';
import { ILanguageFeaturesService } from '../../../../editor/common/services/languageFeatures.js';
import { AIInlineCompletionsProvider } from './aiInlineCompletions.js';
import { IAIService } from '../../../../platform/ai/common/ai.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IMultiLanguageService } from '../../multilang/browser/multilang.contribution.js';
import './aiInlineCompletionsActions.js';  // Register actions

class AIInlineCompletionsContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.aiInlineCompletions';

	constructor(
		@ILanguageFeaturesService languageFeaturesService: ILanguageFeaturesService,
		@IAIService aiService: IAIService,
		@IConfigurationService configurationService: IConfigurationService,
		@IMultiLanguageService multiLanguageService: IMultiLanguageService
	) {
		super();

		const provider = new AIInlineCompletionsProvider(aiService, configurationService, multiLanguageService);

		// Register for all languages using '*' selector
		const registration = languageFeaturesService.inlineCompletionsProvider.register(
			'*',  // All languages
			provider
		);

		this._register(registration);
	}
}

registerWorkbenchContribution2(
	AIInlineCompletionsContribution.ID,
	AIInlineCompletionsContribution,
	WorkbenchPhase.BlockRestore
);
