/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize, localize2 } from '../../../../nls.js';
import { Action2, registerAction2, MenuId } from '../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { ICodeEditorService } from '../../../../editor/browser/services/codeEditorService.js';
import { EditorContextKeys } from '../../../../editor/common/editorContextKeys.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';

/**
 * Action to trigger AI inline completions from context menu
 */
class TriggerAIInlineCompletionsAction extends Action2 {
	constructor() {
		super({
			id: 'editor.action.triggerAIInlineCompletions',
			title: {
				value: localize('triggerAIInlineCompletions', "AI代码补全"),
				mnemonicTitle: localize({ key: 'miTriggerAIInlineCompletions', comment: ['&& denotes a mnemonic'] }, "AI代码&&补全"),
				original: 'AI Code Completion'
			},
			category: localize2('zhikai.category', '天和·码弦'),
			precondition: ContextKeyExpr.and(
				EditorContextKeys.editorTextFocus,
				EditorContextKeys.writable
			),
			menu: [
				{
					id: MenuId.EditorContext,
					group: '1_modification',
					order: 10
				}
			],
			f1: true,  // Show in command palette
			keybinding: {
				primary: 2048 | 512 | 10,  // Ctrl+Alt+Enter
				weight: 100
			}
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const codeEditorService = accessor.get(ICodeEditorService);
		const editor = codeEditorService.getActiveCodeEditor();

		if (!editor) {
			console.warn('[AI Inline Completions] No active editor');
			return;
		}

		console.log('[AI Inline Completions] Manually triggering completion from context menu');

		// Trigger inline completions manually
		// This simulates the explicit trigger (triggerKind = 1)
		await editor.trigger('aiInlineCompletions', 'editor.action.inlineSuggest.trigger', {});
	}
}

// Register the action
registerAction2(TriggerAIInlineCompletionsAction);
