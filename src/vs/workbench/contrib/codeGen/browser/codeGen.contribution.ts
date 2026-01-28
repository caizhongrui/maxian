/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ICodeEditor } from '../../../../editor/browser/editorBrowser.js';
import { EditorAction, registerEditorAction, ServicesAccessor } from '../../../../editor/browser/editorExtensions.js';
import { EditorContextKeys } from '../../../../editor/common/editorContextKeys.js';
import * as nls from '../../../../nls.js';
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

/**
 * 生成单元测试（Alt+T）
 */
registerEditorAction(class GenerateTestAction extends EditorAction {

	constructor() {
		super({
			id: 'zhikai.generateTest',
			label: nls.localize('generateTest.label', "生成单元测试"),
			alias: 'Generate Unit Test',
			precondition: EditorContextKeys.writable,
			kbOpts: {
				kbExpr: EditorContextKeys.textInputFocus,
				primary: KeyMod.Alt | KeyCode.KeyT,
				weight: 100
			},
			contextMenuOpts: {
				group: '1_modification',
				order: 2
			}
		});
	}

	async run(accessor: ServicesAccessor, editor: ICodeEditor): Promise<void> {
		if (!editor.hasModel()) {
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
registerEditorAction(class GenerateMethodCommentAction extends EditorAction {

	constructor() {
		super({
			id: 'zhikai.generateMethodComment',
			label: nls.localize('generateMethodComment.label', "生成方法注释"),
			alias: 'Generate Method Comment',
			precondition: EditorContextKeys.writable,
			kbOpts: {
				kbExpr: EditorContextKeys.textInputFocus,
				primary: KeyMod.Alt | KeyCode.KeyC,
				weight: 100
			},
			contextMenuOpts: {
				group: '1_modification',
				order: 3
			}
		});
	}

	async run(accessor: ServicesAccessor, editor: ICodeEditor): Promise<void> {
		if (!editor.hasModel()) {
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
registerEditorAction(class GenerateClassCommentAction extends EditorAction {

	constructor() {
		super({
			id: 'zhikai.generateClassComment',
			label: nls.localize('generateClassComment.label', "生成类注释"),
			alias: 'Generate Class Comment',
			precondition: EditorContextKeys.writable,
			kbOpts: {
				kbExpr: EditorContextKeys.textInputFocus,
				primary: KeyMod.Alt | KeyMod.Shift | KeyCode.KeyC,
				weight: 100
			},
			contextMenuOpts: {
				group: '1_modification',
				order: 4
			}
		});
	}

	async run(accessor: ServicesAccessor, editor: ICodeEditor): Promise<void> {
		if (!editor.hasModel()) {
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
registerEditorAction(class GenerateCodeAction extends EditorAction {

	constructor() {
		super({
			id: 'zhikai.generateCode',
			label: nls.localize('generateCode.label', "生成业务代码"),
			alias: 'Generate Code from Description',
			precondition: EditorContextKeys.writable,
			kbOpts: {
				kbExpr: EditorContextKeys.textInputFocus,
				primary: KeyMod.Alt | KeyCode.KeyG,
				weight: 100
			},
			contextMenuOpts: {
				group: '1_modification',
				order: 5
			}
		});
	}

	async run(accessor: ServicesAccessor, editor: ICodeEditor): Promise<void> {
		if (!editor.hasModel()) {
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
registerEditorAction(class ModifyCodeAction extends EditorAction {

	constructor() {
		super({
			id: 'zhikai.modifyCode',
			label: nls.localize('modifyCode.label', "AI 修改代码"),
			alias: 'Modify Code with AI',
			precondition: EditorContextKeys.writable,
			kbOpts: {
				kbExpr: EditorContextKeys.textInputFocus,
				primary: KeyMod.Alt | KeyCode.KeyM,
				weight: 100
			},
			contextMenuOpts: {
				group: '1_modification',
				order: 6
			}
		});
	}

	async run(accessor: ServicesAccessor, editor: ICodeEditor): Promise<void> {
		if (!editor.hasModel()) {
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
registerEditorAction(class LineCommentAction extends EditorAction {

	constructor() {
		super({
			id: 'zhikai.lineComment',
			label: nls.localize('lineComment.label', "AI 逐行注释"),
			alias: 'AI Line-by-Line Comment',
			precondition: EditorContextKeys.writable,
			kbOpts: {
				kbExpr: EditorContextKeys.textInputFocus,
				primary: KeyMod.Alt | KeyCode.KeyL,
				weight: 100
			},
			contextMenuOpts: {
				group: '1_modification',
				order: 7
			}
		});
	}

	async run(accessor: ServicesAccessor, editor: ICodeEditor): Promise<void> {
		if (!editor.hasModel()) {
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
registerEditorAction(class OptimizeCodeWithDiffAction extends EditorAction {

	constructor() {
		super({
			id: 'zhikai.optimizeCodeWithDiff',
			label: nls.localize('optimizeCodeWithDiff.label', "AI 优化代码"),
			alias: 'Optimize Code with AI (Show Diff)',
			precondition: EditorContextKeys.writable,
			kbOpts: {
				kbExpr: EditorContextKeys.textInputFocus,
				primary: KeyMod.Alt | KeyCode.KeyO,
				weight: 100
			},
			contextMenuOpts: {
				group: '1_modification',
				order: 8
			}
		});
	}

	async run(accessor: ServicesAccessor, editor: ICodeEditor): Promise<void> {
		if (!editor.hasModel()) {
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
