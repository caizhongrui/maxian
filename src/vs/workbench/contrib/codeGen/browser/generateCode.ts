/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ICodeEditor } from '../../../../editor/browser/editorBrowser.js';
import { ITextModel } from '../../../../editor/common/model.js';
import { Position } from '../../../../editor/common/core/position.js';
import { Range } from '../../../../editor/common/core/range.js';
import { IAIService } from '../../../../platform/ai/common/ai.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IProgressService, ProgressLocation } from '../../../../platform/progress/common/progress.js';
import { IStyleLearningService } from '../../stylelearning/browser/styleLearning.contribution.js';

/**
 * 生成业务代码命令处理器
 * 根据自然语言描述生成代码
 */
export class GenerateCodeCommand {

	constructor(
		private readonly aiService: IAIService,
		private readonly quickInputService: IQuickInputService,
		private readonly notificationService: INotificationService,
		private readonly progressService: IProgressService,
		private readonly styleLearningService?: IStyleLearningService
	) { }

	/**
	 * 执行生成代码命令
	 */
	async execute(editor: ICodeEditor, token: CancellationToken): Promise<void> {
		if (!editor.hasModel()) {
			return;
		}

		const model = editor.getModel();
		const position = editor.getPosition();
		if (!position) {
			return;
		}

		console.log('[Generate Code] Starting code generation...');

		try {
			// 1. 显示输入对话框
			const requirement = await this.showInputDialog();
			if (!requirement) {
				console.log('[Generate Code] User cancelled input');
				return;
			}

			console.log('[Generate Code] Requirement:', requirement);

			// 使用进度通知
			await this.progressService.withProgress({
				location: ProgressLocation.Notification,
				title: '正在生成代码...',
				cancellable: true
			}, async (progress) => {
				// 2. 获取项目上下文
				progress.report({ message: '正在分析上下文...', increment: 20 });
				const projectContext = await this.getProjectContext(model, position);

				// 3. 生成代码
				progress.report({ message: '正在调用AI生成代码...', increment: 50 });
				const generated = await this.aiService.generate({
					type: 'business',
					requirement: requirement,
					language: model.getLanguageId(),
					context: projectContext
				}, token);

				console.log('[Generate Code] Code generated, length:', generated.code.length);

				// 4. 显示预览并插入
				progress.report({ message: '正在插入代码...', increment: 30 });
				await this.insertCode(editor, generated.code, position);

				console.log('[Generate Code] Code generation completed successfully');
			});

		} catch (error) {
			console.error('[Generate Code] Error:', error);
			this.notificationService.error('代码生成失败: ' + error);
			throw error;
		}
	}

	/**
	 * 显示输入对话框
	 */
	private async showInputDialog(): Promise<string | undefined> {
		const input = this.quickInputService.createInputBox();

		input.title = 'AI 代码生成';
		input.placeholder = '请描述你想生成的代码功能...';
		input.prompt = '示例：\n- 查询用户列表，支持分页和关键字搜索\n- 保存订单信息，包含事务处理\n- 计算两个日期之间的工作日天数';
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
	 * 获取项目上下文
	 * 参考Java实现，根据光标位置判断生成目标
	 */
	private async getProjectContext(model: ITextModel, position: Position): Promise<any> {
		const languageId = model.getLanguageId();
		const fullText = model.getValue();

		// 提取导入语句
		const imports = this.extractImports(fullText, languageId);

		// 判断当前位置
		const location = this.detectLocation(model, position, languageId);

		// 提取当前类信息（如果在类内部）
		const currentClass = this.extractCurrentClass(model, position);

		// 提取当前方法信息（如果在方法内部）
		const currentMethod = this.extractCurrentMethod(model, position, languageId);

		// 提取周围代码上下文
		const surroundingCode = this.extractSurroundingCode(model, position);

		// 获取项目代码风格配置
		let codeStyle = '';
		if (this.styleLearningService) {
			try {
				codeStyle = await this.styleLearningService.getStylePromptContext();
				if (codeStyle) {
					console.log('[Generate Code] Using project code style');
				}
			} catch (error) {
				console.warn('[Generate Code] Failed to get code style:', error);
			}
		}

		return {
			language: languageId,
			imports: imports,
			currentClass: currentClass,
			currentMethod: currentMethod,
			surroundingCode: surroundingCode,
			fileName: model.uri.fsPath,
			location: location,  // 'class_level' | 'method_level' | 'file_level'
			generationType: this.determineGenerationType(location),  // 'full_class' | 'full_method' | 'code_snippet'
			codeStyle: codeStyle  // 项目代码风格配置
		};
	}

	/**
	 * 检测光标所在位置
	 */
	private detectLocation(model: ITextModel, position: Position, languageId: string): string {
		// 检查是否在方法内
		const inMethod = this.isInsideMethod(model, position, languageId);
		if (inMethod) {
			return 'method_level';
		}

		// 检查是否在类内
		const inClass = this.isInsideClass(model, position, languageId);
		if (inClass) {
			return 'class_level';
		}

		// 否则在文件级别
		return 'file_level';
	}

	/**
	 * 确定生成类型
	 */
	private determineGenerationType(location: string): string {
		switch (location) {
			case 'file_level':
				return 'full_class';  // 生成完整的类
			case 'class_level':
				return 'full_method';  // 生成完整的方法
			case 'method_level':
				return 'code_snippet';  // 生成代码片段
			default:
				return 'code_snippet';
		}
	}

	/**
	 * 判断是否在方法内
	 */
	private isInsideMethod(model: ITextModel, position: Position, languageId: string): boolean {
		// 向上查找方法声明
		for (let line = position.lineNumber; line >= Math.max(1, position.lineNumber - 50); line--) {
			const lineContent = model.getLineContent(line);
			if (this.isMethodDeclaration(lineContent, languageId)) {
				// 找到方法声明，检查是否在方法体内
				return this.isInsideMethodBody(model, line, position.lineNumber, languageId);
			}
		}
		return false;
	}

	/**
	 * 判断是否在方法体内
	 */
	private isInsideMethodBody(model: ITextModel, methodLine: number, currentLine: number, languageId: string): boolean {
		let braceCount = 0;
		let foundOpenBrace = false;

		for (let line = methodLine; line <= Math.min(model.getLineCount(), methodLine + 200); line++) {
			const lineContent = model.getLineContent(line);

			for (const char of lineContent) {
				if (char === '{') {
					braceCount++;
					foundOpenBrace = true;
				} else if (char === '}') {
					braceCount--;
					if (braceCount === 0 && foundOpenBrace) {
						// 方法结束
						return line >= currentLine;
					}
				}
			}

			// 如果当前行在开括号之后、闭括号之前
			if (line === currentLine && foundOpenBrace && braceCount > 0) {
				return true;
			}
		}

		return false;
	}

	/**
	 * 判断是否在类内
	 */
	private isInsideClass(model: ITextModel, position: Position, languageId: string): boolean {
		// 向上查找类声明
		for (let line = position.lineNumber; line >= 1; line--) {
			const lineContent = model.getLineContent(line);
			if (this.isClassDeclaration(lineContent, languageId)) {
				return true;
			}
		}
		return false;
	}

	/**
	 * 判断是否是方法声明
	 */
	private isMethodDeclaration(line: string, languageId: string): boolean {
		const trimmed = line.trim();

		if (languageId === 'java' || languageId === 'typescript' || languageId === 'javascript') {
			return /^(public|private|protected|static|async|export)?\s*(static|async|export)?\s*\w+[\s\w<>,]*\s+\w+\s*\(/i.test(trimmed) ||
				/^(function|async function)\s+\w+\s*\(/i.test(trimmed);
		}

		if (languageId === 'python') {
			return /^def\s+\w+\s*\(/i.test(trimmed);
		}

		return false;
	}

	/**
	 * 判断是否是类声明
	 */
	private isClassDeclaration(line: string, languageId: string): boolean {
		const trimmed = line.trim();

		if (languageId === 'java' || languageId === 'typescript' || languageId === 'javascript') {
			return /^(export\s+)?(public|private|protected)?\s*(abstract)?\s*class\s+\w+/i.test(trimmed);
		}

		if (languageId === 'python') {
			return /^class\s+\w+/i.test(trimmed);
		}

		return false;
	}

	/**
	 * 提取当前方法信息
	 */
	private extractCurrentMethod(model: ITextModel, position: Position, languageId: string): string | null {
		// 向上查找方法声明
		for (let line = position.lineNumber; line >= Math.max(1, position.lineNumber - 30); line--) {
			const lineContent = model.getLineContent(line);
			if (this.isMethodDeclaration(lineContent, languageId)) {
				// 提取方法签名（3-5行）
				const endLine = Math.min(model.getLineCount(), line + 5);
				return model.getValueInRange(new Range(line, 1, endLine, model.getLineMaxColumn(endLine)));
			}
		}
		return null;
	}

	/**
	 * 提取导入语句
	 */
	private extractImports(content: string, languageId: string): string[] {
		const imports: string[] = [];
		const lines = content.split('\n');

		for (const line of lines) {
			const trimmed = line.trim();

			// Java
			if (languageId === 'java' && trimmed.startsWith('import ')) {
				imports.push(trimmed);
			}

			// TypeScript/JavaScript
			if ((languageId === 'typescript' || languageId === 'javascript') &&
				(trimmed.startsWith('import ') || trimmed.startsWith('require('))) {
				imports.push(trimmed);
			}

			// Python
			if (languageId === 'python' &&
				(trimmed.startsWith('import ') || trimmed.startsWith('from '))) {
				imports.push(trimmed);
			}
		}

		return imports;
	}

	/**
	 * 提取当前类信息
	 */
	private extractCurrentClass(model: ITextModel, position: Position): string | null {
		const languageId = model.getLanguageId();

		// 向上查找类声明
		for (let line = position.lineNumber; line >= 1; line--) {
			const lineContent = model.getLineContent(line);
			const trimmed = lineContent.trim();

			if (languageId === 'java' || languageId === 'typescript' || languageId === 'javascript') {
				if (/^(export\s+)?(public|private|protected)?\s*(abstract)?\s*class\s+\w+/i.test(trimmed)) {
					// 提取类名和前几行
					const classStart = line;
					const classEnd = Math.min(model.getLineCount(), line + 20);

					return model.getValueInRange(new Range(
						classStart,
						1,
						classEnd,
						model.getLineMaxColumn(classEnd)
					));
				}
			}

			if (languageId === 'python' && /^class\s+\w+/i.test(trimmed)) {
				const classStart = line;
				const classEnd = Math.min(model.getLineCount(), line + 20);

				return model.getValueInRange(new Range(
					classStart,
					1,
					classEnd,
					model.getLineMaxColumn(classEnd)
				));
			}
		}

		return null;
	}

	/**
	 * 提取周围代码上下文
	 */
	private extractSurroundingCode(model: ITextModel, position: Position): string {
		// 提取光标前后各 10 行
		const startLine = Math.max(1, position.lineNumber - 10);
		const endLine = Math.min(model.getLineCount(), position.lineNumber + 10);

		return model.getValueInRange(new Range(
			startLine,
			1,
			endLine,
			model.getLineMaxColumn(endLine)
		));
	}

	/**
	 * 插入生成的代码
	 */
	private async insertCode(editor: ICodeEditor, code: string, position: Position): Promise<void> {
		const model = editor.getModel();
		if (!model) {
			return;
		}

		// 获取当前行的缩进
		const lineContent = model.getLineContent(position.lineNumber);
		const indentMatch = lineContent.match(/^(\s*)/);
		const indent = indentMatch ? indentMatch[1] : '';

		// 为生成的代码添加缩进
		const indentedCode = code.split('\n')
			.map((line, index) => {
				// 第一行不添加额外缩进（使用光标位置的缩进）
				if (index === 0) {
					return line;
				}
				// 后续行添加缩进
				return line.trim() ? indent + line : line;
			})
			.join('\n');

		// 在光标位置插入代码
		editor.executeEdits('ai-generate-code', [{
			range: new Range(position.lineNumber, position.column, position.lineNumber, position.column),
			text: '\n' + indentedCode + '\n'
		}]);

		// 移动光标到插入代码的开始位置
		editor.setPosition(new Position(position.lineNumber + 1, indent.length + 1));

		console.log('[Generate Code] Code inserted at line', position.lineNumber);
	}
}
