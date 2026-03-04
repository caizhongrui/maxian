/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ICodeEditor } from '../../../../editor/browser/editorBrowser.js';
import { ServicesAccessor } from '../../../../editor/browser/editorExtensions.js';
import { EditorContextKeys } from '../../../../editor/common/editorContextKeys.js';
import * as nls from '../../../../nls.js';
import { localize2 } from '../../../../nls.js';
import { IAIService } from '../../../../platform/ai/common/ai.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { IProgressService } from '../../../../platform/progress/common/progress.js';
import { ITextFileService } from '../../../services/textfile/common/textfiles.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { KeyMod, KeyCode } from '../../../../base/common/keyCodes.js';
import { GenerateTestCommand } from './generateTest.js';
import { GenerateCommentCommand } from './generateComment.js';
import { GenerateCodeCommand } from './generateCode.js';
import { ModifyCodeCommand } from './modifyCode.js';
import { LineCommentCommand } from './lineComment.js';
import { OptimizeWithDiffCommand } from './optimizeWithDiff.js';
import { AIOptimizeContentProvider } from './aiOptimizeContentProvider.js';
import { IStyleLearningService } from '../../stylelearning/browser/styleLearning.contribution.js';
import { IModelService } from '../../../../editor/common/services/model.js';
import { ILanguageService } from '../../../../editor/common/languages/language.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { IWorkbenchContributionsRegistry, Extensions as WorkbenchExtensions } from '../../../common/contributions.js';
import { LifecyclePhase } from '../../../services/lifecycle/common/lifecycle.js';
import { Action2, registerAction2, MenuId } from '../../../../platform/actions/common/actions.js';
import { ICodeEditorService } from '../../../../editor/browser/services/codeEditorService.js';

const ZHIKAI_CATEGORY = localize2('zhikai.category', '天和·码弦');

/**
 * 生成单元测试（Alt+T）
 */
registerAction2(class GenerateTestAction extends Action2 {

	constructor() {
		super({
			id: 'zhikai.generateTest',
			title: {
				value: nls.localize('generateTest.label', "生成单元测试"),
				original: 'Generate Unit Test'
			},
			category: ZHIKAI_CATEGORY,
			f1: true,
			precondition: EditorContextKeys.writable,
			keybinding: {
				primary: KeyMod.Alt | KeyCode.KeyT,
				when: EditorContextKeys.textInputFocus,
				weight: 100
			},
			menu: [
				{
					id: MenuId.EditorContext,
					group: '1_modification',
					order: 2
				}
			]
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const codeEditorService = accessor.get(ICodeEditorService);
		const editor = codeEditorService.getActiveCodeEditor() as ICodeEditor | null;

		if (!editor || !editor.hasModel()) {
			return;
		}

		const aiService = accessor.get(IAIService);
		const textFileService = accessor.get(ITextFileService);
		const editorService = accessor.get(IEditorService);

		const command = new GenerateTestCommand(aiService, textFileService, editorService);
		const tokenSource = new CancellationTokenSource();

		try {
			await command.execute(editor, tokenSource.token);
		} catch (error) {
			console.error('[Generate Test Action] Error:', error);
		} finally {
			tokenSource.dispose();
		}
	}
});

/**
 * 生成方法注释（Alt+C）
 */
registerAction2(class GenerateMethodCommentAction extends Action2 {

	constructor() {
		super({
			id: 'zhikai.generateMethodComment',
			title: {
				value: nls.localize('generateMethodComment.label', "生成方法注释"),
				original: 'Generate Method Comment'
			},
			category: ZHIKAI_CATEGORY,
			f1: true,
			precondition: EditorContextKeys.writable,
			keybinding: {
				primary: KeyMod.Alt | KeyCode.KeyC,
				when: EditorContextKeys.textInputFocus,
				weight: 100
			},
			menu: [
				{
					id: MenuId.EditorContext,
					group: '1_modification',
					order: 3
				}
			]
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const codeEditorService = accessor.get(ICodeEditorService);
		const editor = codeEditorService.getActiveCodeEditor() as ICodeEditor | null;

		if (!editor || !editor.hasModel()) {
			return;
		}

		const aiService = accessor.get(IAIService);
		const progressService = accessor.get(IProgressService);

		const command = new GenerateCommentCommand(aiService, progressService);
		const tokenSource = new CancellationTokenSource();

		try {
			await command.executeMethodComment(editor, tokenSource.token);
		} catch (error) {
			console.error('[Generate Method Comment Action] Error:', error);
		} finally {
			tokenSource.dispose();
		}
	}
});

/**
 * 生成类注释（Alt+Shift+C）
 */
registerAction2(class GenerateClassCommentAction extends Action2 {

	constructor() {
		super({
			id: 'zhikai.generateClassComment',
			title: {
				value: nls.localize('generateClassComment.label', "生成类注释"),
				original: 'Generate Class Comment'
			},
			category: ZHIKAI_CATEGORY,
			f1: true,
			precondition: EditorContextKeys.writable,
			keybinding: {
				primary: KeyMod.Alt | KeyMod.Shift | KeyCode.KeyC,
				when: EditorContextKeys.textInputFocus,
				weight: 100
			},
			menu: [
				{
					id: MenuId.EditorContext,
					group: '1_modification',
					order: 4
				}
			]
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const codeEditorService = accessor.get(ICodeEditorService);
		const editor = codeEditorService.getActiveCodeEditor() as ICodeEditor | null;

		if (!editor || !editor.hasModel()) {
			return;
		}

		const aiService = accessor.get(IAIService);
		const progressService = accessor.get(IProgressService);

		const command = new GenerateCommentCommand(aiService, progressService);
		const tokenSource = new CancellationTokenSource();

		try {
			await command.executeClassComment(editor, tokenSource.token);
		} catch (error) {
			console.error('[Generate Class Comment Action] Error:', error);
		} finally {
			tokenSource.dispose();
		}
	}
});

/**
 * 生成业务代码（Alt+G）
 */
registerAction2(class GenerateCodeAction extends Action2 {

	constructor() {
		super({
			id: 'zhikai.generateCode',
			title: {
				value: nls.localize('generateCode.label', "生成业务代码"),
				original: 'Generate Code from Description'
			},
			category: ZHIKAI_CATEGORY,
			f1: true,
			precondition: EditorContextKeys.writable,
			keybinding: {
				primary: KeyMod.Alt | KeyCode.KeyG,
				when: EditorContextKeys.textInputFocus,
				weight: 100
			},
			menu: [
				{
					id: MenuId.EditorContext,
					group: '1_modification',
					order: 5
				}
			]
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const codeEditorService = accessor.get(ICodeEditorService);
		const editor = codeEditorService.getActiveCodeEditor() as ICodeEditor | null;

		if (!editor || !editor.hasModel()) {
			return;
		}

		const aiService = accessor.get(IAIService);
		const quickInputService = accessor.get(IQuickInputService);
		const notificationService = accessor.get(INotificationService);
		const progressService = accessor.get(IProgressService);
		const styleLearningService = accessor.get(IStyleLearningService);

		const command = new GenerateCodeCommand(aiService, quickInputService, notificationService, progressService, styleLearningService);
		const tokenSource = new CancellationTokenSource();

		try {
			await command.execute(editor, tokenSource.token);
		} catch (error) {
			console.error('[Generate Code Action] Error:', error);
		} finally {
			tokenSource.dispose();
		}
	}
});

/**
 * 修改代码（Alt+M）
 */
registerAction2(class ModifyCodeAction extends Action2 {

	constructor() {
		super({
			id: 'zhikai.modifyCode',
			title: {
				value: nls.localize('modifyCode.label', "AI 修改代码"),
				original: 'Modify Code with AI'
			},
			category: ZHIKAI_CATEGORY,
			f1: true,
			precondition: EditorContextKeys.writable,
			keybinding: {
				primary: KeyMod.Alt | KeyCode.KeyM,
				when: EditorContextKeys.textInputFocus,
				weight: 100
			},
			menu: [
				{
					id: MenuId.EditorContext,
					group: '1_modification',
					order: 6
				}
			]
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const codeEditorService = accessor.get(ICodeEditorService);
		const editor = codeEditorService.getActiveCodeEditor() as ICodeEditor | null;

		if (!editor || !editor.hasModel()) {
			return;
		}

		const aiService = accessor.get(IAIService);
		const quickInputService = accessor.get(IQuickInputService);
		const notificationService = accessor.get(INotificationService);
		const dialogService = accessor.get(IDialogService);
		const progressService = accessor.get(IProgressService);

		const command = new ModifyCodeCommand(aiService, quickInputService, notificationService, dialogService, progressService);
		const tokenSource = new CancellationTokenSource();

		try {
			await command.execute(editor, tokenSource.token);
		} catch (error) {
			console.error('[Modify Code Action] Error:', error);
		} finally {
			tokenSource.dispose();
		}
	}
});

/**
 * 逐行注释（Alt+L）
 */
registerAction2(class LineCommentAction extends Action2 {

	constructor() {
		super({
			id: 'zhikai.lineComment',
			title: {
				value: nls.localize('lineComment.label', "AI 逐行注释"),
				original: 'AI Line-by-Line Comment'
			},
			category: ZHIKAI_CATEGORY,
			f1: true,
			precondition: EditorContextKeys.writable,
			keybinding: {
				primary: KeyMod.Alt | KeyCode.KeyL,
				when: EditorContextKeys.textInputFocus,
				weight: 100
			},
			menu: [
				{
					id: MenuId.EditorContext,
					group: '1_modification',
					order: 7
				}
			]
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const codeEditorService = accessor.get(ICodeEditorService);
		const editor = codeEditorService.getActiveCodeEditor() as ICodeEditor | null;

		if (!editor || !editor.hasModel()) {
			return;
		}

		const aiService = accessor.get(IAIService);
		const notificationService = accessor.get(INotificationService);
		const progressService = accessor.get(IProgressService);

		const command = new LineCommentCommand(aiService, notificationService, progressService);
		const tokenSource = new CancellationTokenSource();

		try {
			await command.execute(editor, tokenSource.token);
		} catch (error) {
			console.error('[Line Comment Action] Error:', error);
		} finally {
			tokenSource.dispose();
		}
	}
});

/**
 * AI 优化代码（带 Diff 对比）（Alt+O）
 */
registerAction2(class OptimizeCodeWithDiffAction extends Action2 {

	constructor() {
		super({
			id: 'zhikai.optimizeCodeWithDiff',
			title: {
				value: nls.localize('optimizeCodeWithDiff.label', "AI 优化代码"),
				original: 'Optimize Code with AI (Show Diff)'
			},
			category: ZHIKAI_CATEGORY,
			f1: true,
			precondition: EditorContextKeys.writable,
			keybinding: {
				primary: KeyMod.Alt | KeyCode.KeyO,
				when: EditorContextKeys.textInputFocus,
				weight: 100
			},
			menu: [
				{
					id: MenuId.EditorContext,
					group: '1_modification',
					order: 8
				}
			]
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const codeEditorService = accessor.get(ICodeEditorService);
		const editor = codeEditorService.getActiveCodeEditor() as ICodeEditor | null;

		if (!editor || !editor.hasModel()) {
			return;
		}

		const aiService = accessor.get(IAIService);
		const editorService = accessor.get(IEditorService);
		const notificationService = accessor.get(INotificationService);
		const modelService = accessor.get(IModelService);
		const languageService = accessor.get(ILanguageService);

		const command = new OptimizeWithDiffCommand(
			aiService,
			editorService,
			notificationService,
			modelService,
			languageService
		);
		const tokenSource = new CancellationTokenSource();

		try {
			await command.execute(editor, tokenSource.token);
		} catch (error) {
			console.error('[Optimize Code With Diff Action] Error:', error);
		} finally {
			tokenSource.dispose();
		}
	}
});

// 注册 AI 优化内容提供者（解决 diff editor 打开额外标签的问题）
Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench)
	.registerWorkbenchContribution(AIOptimizeContentProvider, LifecyclePhase.Restored);
