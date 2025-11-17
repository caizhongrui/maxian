/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ICodeEditor } from '../../../../editor/browser/editorBrowser.js';
import { IAIService } from '../../../../platform/ai/common/ai.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { URI } from '../../../../base/common/uri.js';
import { IModelService } from '../../../../editor/common/services/model.js';
import { ILanguageService } from '../../../../editor/common/languages/language.js';
import { ITextModel } from '../../../../editor/common/model.js';
import { Selection } from '../../../../editor/common/core/selection.js';
import { AIOptimizeContentProvider } from './aiOptimizeContentProvider.js';

/**
 * AI 代码优化 Diff 对比命令
 * 显示原始代码 vs 优化后代码的对比视图，类似 git diff
 */
export class OptimizeWithDiffCommand {
	private originalEditor: ICodeEditor | null = null;
	private originalSelection: Selection | null = null;
	private originalUri: URI | null = null;

	constructor(
		private readonly aiService: IAIService,
		private readonly editorService: IEditorService,
		private readonly notificationService: INotificationService,
		private readonly modelService: IModelService,
		private readonly languageService: ILanguageService
	) { }

	/**
	 * 执行优化并显示 diff
	 */
	async execute(editor: ICodeEditor, token: CancellationToken): Promise<void> {
		if (!editor.hasModel()) {
			return;
		}

		const model = editor.getModel();
		const selection = editor.getSelection();

		if (!selection || selection.isEmpty()) {
			this.notificationService.warn('请先选中需要优化的代码');
			return;
		}

		// 保存原始编辑器和选区信息，用于后续应用改动
		this.originalEditor = editor;
		this.originalSelection = selection;
		this.originalUri = model.uri;

		try {
			// 1. 获取选中的代码
			const originalCode = model.getValueInRange(selection);
			const languageId = model.getLanguageId();
			const uri = model.uri;

			// 2. 先打开 Diff Editor（这会替换当前编辑器标签）
			const { optimizedModel, optimizedUri } = await this.showDiffEditor(uri, originalCode, '', languageId);

			// 3. 使用流式更新优化后的代码
			await this.optimizeCodeWithStreaming(originalCode, languageId, optimizedModel, token);

			// 4. 显示应用提示
			this.showApplyPrompt(optimizedModel, optimizedUri);

		} catch (error) {
			this.notificationService.error('代码优化失败: ' + error);
			throw error;
		}
	}

	/**
	 * 使用流式更新优化代码
	 */
	private async optimizeCodeWithStreaming(
		code: string,
		languageId: string,
		targetModel: ITextModel,
		_token: CancellationToken
	): Promise<void> {
		const prompt = `你是一个专业的代码优化专家。请优化以下${languageId}代码。

代码：
\`\`\`${languageId}
${code}
\`\`\`

要求：
1. 提高代码性能和可读性
2. 遵循最佳实践和编码规范
3. 保持功能不变
4. 添加必要的注释
5. 【重要】只返回优化后的完整代码，不要添加解释或markdown标记

请直接返回优化后的代码：`;

		// 使用流式 API - chunk.content 已经是累积的完整内容
		await this.aiService.completeStream(prompt, (chunk) => {
			// chunk.content 是累积的完整内容，直接清理并设置
			let content = chunk.content;

			// 清理 markdown 代码块标记
			content = content.replace(/```(\w+)?\n?/g, '').trim();

			// 实时更新模型内容
			if (content) {
				targetModel.setValue(content);
			}
		});
	}

	/**
	 * 应用优化后的代码到原始编辑器
	 */
	async applyChanges(optimizedCode: string): Promise<void> {
		if (!this.originalEditor || !this.originalSelection || !this.originalUri) {
			this.notificationService.error('无法应用更改：原始编辑器信息丢失');
			return;
		}

		try {
			const model = this.originalEditor.getModel();
			if (!model) {
				this.notificationService.error('无法应用更改：编辑器模型不存在');
				return;
			}

			// 替换选中的代码
			this.originalEditor.executeEdits('optimize-code-diff', [{
				range: this.originalSelection,
				text: optimizedCode
			}]);

			// 关闭 diff 编辑器
			// TODO: 实现关闭 diff 编辑器的逻辑

			this.notificationService.info('✅ 代码优化已应用');
		} catch (error) {
			this.notificationService.error('应用更改失败: ' + error);
		}
	}

	/**
	 * 拒绝更改
	 */
	async rejectChanges(): Promise<void> {
		// 关闭 diff 编辑器即可
		this.notificationService.info('已取消代码优化');
	}

	/**
	 * 显示应用改动的提示
	 */
	private showApplyPrompt(optimizedModel: ITextModel, optimizedUri: URI): void {
		this.notificationService.info(
			'💡 代码优化完成！\n' +
			'• 左侧：AI 优化建议\n' +
			'• 右侧：原始文件（可编辑）\n' +
			'• 点击差异块中间的箭头（◀）可将左侧优化应用到右侧原文件\n' +
			'• 应用改动后记得保存文件（Cmd+S）'
		);
	}

	/**
	 * 打开 Diff Editor 显示对比
	 */
	private async showDiffEditor(
		originalUri: URI,
		originalCode: string,
		optimizedCode: string,
		languageId: string
	): Promise<{ optimizedModel: ITextModel; optimizedUri: URI }> {
		// 创建临时的 URI 用于左侧优化代码
		// 使用自定义 scheme 避免创建额外的编辑器标签
		const timestamp = Date.now();
		const optimizedDiffUri = URI.from({
			scheme: AIOptimizeContentProvider.scheme,
			path: `/ai-optimized-${timestamp}`,
			query: JSON.stringify({ languageId })
		});

		// 获取语言选择
		const languageSelection = this.languageService.createById(languageId);

		// 检查模型是否已存在，如果不存在则创建
		let optimizedModel = this.modelService.getModel(optimizedDiffUri);
		if (!optimizedModel) {
			optimizedModel = this.modelService.createModel(optimizedCode, languageSelection, optimizedDiffUri, false);
		}

		// 立即打开 diff editor，不等待模型加载
		// 左侧：临时文件（显示 AI 优化后的代码，流式生成）
		// 右侧：原始文件本身（可编辑，用户可以从左侧应用改动到这里）
		await this.editorService.openEditor({
			original: { resource: optimizedDiffUri },
			modified: { resource: originalUri },
			label: 'AI 代码优化',
			description: 'AI 优化 ↔ 原始（生成中...）',
			options: {
				preserveFocus: false,  // 聚焦到 diff editor
				revealIfOpened: true,
				pinned: true,         // 固定标签
				override: 'diff'      // 强制使用 diff editor
			}
		});

		// 返回优化后的模型和 URI，用于流式更新和后续清理
		return { optimizedModel, optimizedUri: optimizedDiffUri };
	}
}
