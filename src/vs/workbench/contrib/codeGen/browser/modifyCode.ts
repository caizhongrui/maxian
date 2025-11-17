/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ICodeEditor } from '../../../../editor/browser/editorBrowser.js';
import { IAIService } from '../../../../platform/ai/common/ai.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { IProgressService, ProgressLocation } from '../../../../platform/progress/common/progress.js';

/**
 * 修改代码命令处理器
 * 根据用户指令修改选中的代码
 */
export class ModifyCodeCommand {

	constructor(
		private readonly aiService: IAIService,
		private readonly quickInputService: IQuickInputService,
		private readonly notificationService: INotificationService,
		private readonly dialogService: IDialogService,
		private readonly progressService: IProgressService
	) { }

	/**
	 * 执行代码修改命令
	 */
	async execute(editor: ICodeEditor, token: CancellationToken): Promise<void> {
		if (!editor.hasModel()) {
			return;
		}

		const model = editor.getModel();
		const selection = editor.getSelection();
		if (!selection || selection.isEmpty()) {
			this.notificationService.warn('请先选中要修改的代码');
			return;
		}

		console.log('[Modify Code] Starting code modification...');

		try {
			// 1. 获取选中代码
			const selectedCode = model.getValueInRange(selection);
			console.log('[Modify Code] Selected code length:', selectedCode.length);

			// 2. 显示修改指令输入框
			const instruction = await this.showInputDialog();
			if (!instruction) {
				console.log('[Modify Code] User cancelled input');
				return;
			}

			console.log('[Modify Code] Instruction:', instruction);

			// 使用进度通知
			let modified: any;
			await this.progressService.withProgress({
				location: ProgressLocation.Notification,
				title: '正在修改代码...',
				cancellable: true
			}, async (progress) => {
				// 3. AI 修改代码
				progress.report({ message: '正在调用AI修改代码...', increment: 70 });
				modified = await this.aiService.modify(
					selectedCode,
					instruction,
					token
				);

				console.log('[Modify Code] Modified code length:', modified.modifiedCode.length);

				// 4. 准备预览
				progress.report({ message: '正在生成预览...', increment: 30 });
			});

			// 5. 显示 Diff 预览并确认
			const confirmed = await this.showDiffPreview(selectedCode, modified.modifiedCode, modified.summary);

			if (confirmed) {
				// 6. 应用修改
				editor.executeEdits('ai-modify-code', [{
					range: selection,
					text: modified.modifiedCode
				}]);

				this.notificationService.info('代码修改成功！');
				console.log('[Modify Code] Code modification applied successfully');
			} else {
				console.log('[Modify Code] User cancelled modification');
				this.notificationService.info('已取消修改');
			}

		} catch (error) {
			console.error('[Modify Code] Error:', error);
			this.notificationService.error('代码修改失败: ' + error);
			throw error;
		}
	}

	/**
	 * 显示修改指令输入框
	 */
	private async showInputDialog(): Promise<string | undefined> {
		const input = this.quickInputService.createInputBox();

		input.title = 'AI 代码修改';
		input.placeholder = '请描述你想如何修改选中的代码...';
		input.prompt = '示例：\n- 添加空值检查和异常处理\n- 改用 Stream API 优化性能\n- 添加详细的日志输出';
		input.ignoreFocusOut = true;

		return new Promise<string | undefined>((resolve) => {
			let isAccepted = false;

			input.onDidAccept(() => {
				const value = input.value.trim();
				if (value) {
					isAccepted = true;
					input.hide();
					resolve(value);
				}
			});

			input.onDidHide(() => {
				if (!isAccepted) {
					resolve(undefined);
				}
				input.dispose();
			});

			input.show();
		});
	}

	/**
	 * 显示 Diff 预览对话框
	 */
	private async showDiffPreview(original: string, modified: string, summary: string): Promise<boolean> {
		// 简化实现：显示确认对话框
		// TODO: 将来可以集成 VS Code 的 Diff 编辑器

		const previewText = this.generateDiffPreview(original, modified);

		const result = await this.dialogService.confirm({
			title: 'AI 代码修改预览',
			message: summary || '确认应用以下修改？',
			detail: previewText,
			primaryButton: '应用修改',
			cancelButton: '取消'
		});

		return result.confirmed;
	}

	/**
	 * 生成简单的 Diff 预览文本
	 */
	private generateDiffPreview(original: string, modified: string): string {
		const originalLines = original.split('\n');
		const modifiedLines = modified.split('\n');

		let preview = '===== 原始代码 =====\n';
		preview += originalLines.slice(0, 10).join('\n');
		if (originalLines.length > 10) {
			preview += '\n... (' + (originalLines.length - 10) + ' more lines)';
		}

		preview += '\n\n===== 修改后的代码 =====\n';
		preview += modifiedLines.slice(0, 10).join('\n');
		if (modifiedLines.length > 10) {
			preview += '\n... (' + (modifiedLines.length - 10) + ' more lines)';
		}

		return preview;
	}
}
