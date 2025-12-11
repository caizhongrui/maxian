/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ICodeEditor } from '../../../../editor/browser/editorBrowser.js';
import { IAIService } from '../../../../platform/ai/common/ai.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IProgressService, ProgressLocation } from '../../../../platform/progress/common/progress.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IRequestService, asJson } from '../../../../platform/request/common/request.js';

/**
 * 逐行注释命令处理器
 * AI为选中的代码生成逐行注释
 */
export class LineCommentCommand {

	constructor(
		private readonly aiService: IAIService,
		private readonly notificationService: INotificationService,
		private readonly progressService: IProgressService,
		private readonly configurationService: IConfigurationService,
		private readonly requestService: IRequestService
	) { }

	/**
	 * 执行逐行注释
	 */
	async execute(editor: ICodeEditor, token: CancellationToken): Promise<void> {
		if (!editor.hasModel()) {
			return;
		}

		const model = editor.getModel();
		const selection = editor.getSelection();

		if (!selection || selection.isEmpty()) {
			this.notificationService.warn('请先选中需要注释的代码');
			return;
		}

		console.log('[Line Comment] Starting line-by-line comment generation...');

		try {
			// 1. 获取选中的代码
			const selectedCode = model.getValueInRange(selection);
			const languageId = model.getLanguageId();

			console.log('[Line Comment] Selected code length:', selectedCode.length);

			// 使用进度通知
			await this.progressService.withProgress({
				location: ProgressLocation.Notification,
				title: '正在生成逐行注释...',
				cancellable: true
			}, async (progress) => {
				// 2. 调用AI生成逐行注释
				progress.report({ message: '正在分析代码...', increment: 30 });
				const commentedCode = await this.generateLineComments(selectedCode, languageId, token);

				console.log('[Line Comment] Commented code generated');

				// 3. 替换选中的代码
				progress.report({ message: '正在插入注释...', increment: 70 });
				editor.executeEdits('ai-line-comment', [{
					range: selection,
					text: commentedCode
				}]);

				console.log('[Line Comment] Line comments inserted successfully');
			});

		} catch (error) {
			console.error('[Line Comment] Error:', error);
			this.notificationService.error('逐行注释生成失败: ' + error);
			throw error;
		}
	}

	/**
	 * 生成逐行注释
	 */
	private async generateLineComments(code: string, languageId: string, token: CancellationToken): Promise<string> {
		const commentStyle = this.getCommentStyle(languageId);

		console.log('[Line Comment] 开始获取逐行注释提示词');

		// 尝试从后端获取提示词
		let prompt = await this.fetchLineCommentPromptFromBackend(code, languageId, commentStyle.line);

		// 如果后端获取失败，使用默认提示词
		if (!prompt) {
			console.log('[Line Comment] 后端获取提示词失败，使用本地默认提示词');
			prompt = this.getDefaultLineCommentPrompt(code, languageId, commentStyle.line);
		}

		const result = await this.aiService.complete(prompt);

		// 清理可能的markdown标记
		let cleanCode = result.trim();
		const codeBlockMatch = cleanCode.match(/\`\`\`(?:\w+)?\s*\n([\s\S]*?)\`\`\`/);
		if (codeBlockMatch) {
			cleanCode = codeBlockMatch[1].trim();
		}
		cleanCode = cleanCode.replace(/\`\`\`/g, '').trim();

		return cleanCode;
	}

	/**
	 * 从后端获取逐行注释提示词
	 */
	private async fetchLineCommentPromptFromBackend(code: string, languageId: string, commentStyle: string): Promise<string | null> {
		const apiUrl = this.configurationService.getValue<string>('zhikai.auth.apiUrl');
		console.log('[Line Comment] apiUrl:', apiUrl);

		if (!apiUrl) {
			console.log('[Line Comment] 未配置apiUrl，跳过后端请求');
			return null;
		}

		try {
			const url = `${apiUrl.replace(/\/$/, '')}/system/ai/prompt/comment/line`;
			console.log('[Line Comment] 请求后端提示词API:', url);

			const requestData = {
				languageId: languageId,
				code: code,
				commentStyle: commentStyle
			};

			const response = await this.requestService.request({
				type: 'POST',
				url: url,
				headers: { 'Content-Type': 'application/json' },
				data: JSON.stringify(requestData)
			}, CancellationToken.None);

			const data = await asJson<any>(response);
			console.log('[Line Comment] 后端响应:', { code: data?.code, hasData: !!data?.data });

			if (data && data.code === 200 && data.data) {
				console.log('[Line Comment] 成功从后端获取提示词，长度:', data.data.length);
				return data.data;
			}

			console.warn('[Line Comment] 后端返回数据格式错误或无数据');
			return null;
		} catch (error) {
			console.error('[Line Comment] 从后端获取提示词失败:', error);
			return null;
		}
	}

	/**
	 * 获取默认的逐行注释提示词
	 */
	private getDefaultLineCommentPrompt(code: string, languageId: string, commentStyle: string): string {
		return `你是一个专业的代码注释专家。请为以下${languageId}代码的每一行添加注释。

代码：
\`\`\`${languageId}
${code}
\`\`\`

要求：
1. 为每一行重要的代码在**上方添加一行注释**（使用 ${commentStyle} ）
2. 注释要简洁、准确，用中文描述该行代码的作用
3. 对于声明变量的行，说明变量的用途
4. 对于方法调用的行，说明调用的目的
5. 对于控制流（if/for/while等），说明条件或循环的目的
6. 【重要】注释必须在代码的上方单独一行，不要放在代码行尾
7. 【重要】保持原代码不变
8. 【重要】空行和简单的大括号不需要注释
9. 【重要】不要添加markdown代码块标记
10. 【重要】保持原有的缩进格式，注释的缩进与下方代码保持一致

示例：
输入代码：
\`\`\`java
int count = list.size();
System.out.println(count);
\`\`\`

输出代码：
\`\`\`java
// 获取列表大小
int count = list.size();
// 打印数量
System.out.println(count);
\`\`\`

请直接返回添加了注释的完整代码：`;
	}

	/**
	 * 获取语言的注释风格
	 */
	private getCommentStyle(languageId: string): { line: string; block: string } {
		switch (languageId) {
			case 'python':
				return { line: '#', block: '"""' };
			case 'java':
			case 'javascript':
			case 'typescript':
			case 'c':
			case 'cpp':
			case 'csharp':
			case 'go':
			case 'rust':
				return { line: '//', block: '/* */' };
			case 'html':
			case 'xml':
				return { line: '<!--', block: '<!-- -->' };
			case 'css':
			case 'scss':
			case 'less':
				return { line: '/*', block: '/* */' };
			case 'sql':
				return { line: '--', block: '/* */' };
			default:
				return { line: '//', block: '/* */' };
		}
	}
}
