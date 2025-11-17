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
import { IProgressService, ProgressLocation } from '../../../../platform/progress/common/progress.js';

/**
 * 生成注释命令处理器
 * 为方法或类生成文档注释
 */
export class GenerateCommentCommand {

	constructor(
		private readonly aiService: IAIService,
		private readonly progressService: IProgressService
	) { }

	/**
	 * 执行生成方法注释
	 */
	async executeMethodComment(editor: ICodeEditor, token: CancellationToken): Promise<void> {
		await this.generateComment(editor, 'method', token);
	}

	/**
	 * 执行生成类注释
	 */
	async executeClassComment(editor: ICodeEditor, token: CancellationToken): Promise<void> {
		await this.generateComment(editor, 'class', token);
	}

	/**
	 * 生成注释
	 */
	private async generateComment(
		editor: ICodeEditor,
		type: 'method' | 'class',
		token: CancellationToken
	): Promise<void> {
		if (!editor.hasModel()) {
			return;
		}

		const model = editor.getModel();
		const position = editor.getPosition();
		if (!position) {
			return;
		}

		const typeLabel = type === 'method' ? '方法' : '类';

		await this.progressService.withProgress({
			location: ProgressLocation.Notification,
			title: `正在生成${typeLabel}注释...`,
			cancellable: true
		}, async (progress) => {
			try {
				// 1. 提取代码
				progress.report({ message: '正在分析代码...', increment: 20 });
				const codeInfo = type === 'method'
					? await this.extractMethod(model, position)
					: await this.extractClass(model, position);

				if (!codeInfo) {
					return;
				}

				// 2. 生成注释
				progress.report({ message: '正在调用AI生成注释...', increment: 40 });
				const comment = await this.aiService.generate({
					type: 'comment',
					sourceCode: codeInfo.code,
					language: model.getLanguageId(),
					context: {
						elementType: type,
						elementName: codeInfo.name
					}
				}, token);

				// 3. 插入注释
				progress.report({ message: '正在插入注释...', increment: 40 });
				await this.insertComment(editor, comment.code, codeInfo.insertLine);

			} catch (error) {
				throw error;
			}
		});
	}

	/**
	 * 提取方法信息
	 */
	private async extractMethod(model: ITextModel, position: Position): Promise<CodeInfo | null> {
		const languageId = model.getLanguageId();

		// 查找方法声明行
		let methodLine = position.lineNumber;

		// 向上查找方法声明
		for (let line = position.lineNumber; line >= Math.max(1, position.lineNumber - 10); line--) {
			const lineContent = model.getLineContent(line);
			if (this.isMethodDeclaration(lineContent, languageId)) {
				methodLine = line;
				break;
			}
		}

		// 如果当前行就是方法声明
		const currentLine = model.getLineContent(methodLine);
		if (!this.isMethodDeclaration(currentLine, languageId)) {
			return null;
		}

		// 提取方法代码（包含签名和部分实现）
		let endLine = methodLine;
		let braceCount = 0;
		let foundBrace = false;

		for (let line = methodLine; line <= Math.min(model.getLineCount(), methodLine + 50); line++) {
			const lineContent = model.getLineContent(line);

			// 对于 Java/TypeScript，找到方法体的开始大括号后再往下几行
			if (languageId === 'java' || languageId === 'typescript' || languageId === 'javascript') {
				for (const char of lineContent) {
					if (char === '{') {
						braceCount++;
						foundBrace = true;
					} else if (char === '}') {
						braceCount--;
					}
				}

				// 找到开始大括号后，再读几行实现代码
				if (foundBrace && line - methodLine >= 3) {
					endLine = Math.min(line, methodLine + 10);
					break;
				}
			}

			// Python：读取方法签名和前几行
			if (languageId === 'python') {
				if (line > methodLine && lineContent.trim().startsWith('def ')) {
					endLine = line - 1;
					break;
				}
				if (line - methodLine >= 5) {
					endLine = line;
					break;
				}
			}

			endLine = line;
		}

		const methodCode = model.getValueInRange(new Range(
			methodLine,
			1,
			endLine,
			model.getLineMaxColumn(endLine)
		));

		const methodName = this.extractMethodName(currentLine, languageId);

		return {
			name: methodName || 'unknown',
			code: methodCode,
			insertLine: methodLine
		};
	}

	/**
	 * 提取类信息
	 * 参考Java实现：直接传递完整的类代码给AI
	 */
	private async extractClass(model: ITextModel, position: Position): Promise<CodeInfo | null> {
		const languageId = model.getLanguageId();

		// 向上查找类声明
		let classLine = position.lineNumber;

		for (let line = position.lineNumber; line >= 1; line--) {
			const lineContent = model.getLineContent(line);
			if (this.isClassDeclaration(lineContent, languageId)) {
				classLine = line;
				break;
			}
		}

		const classDeclaration = model.getLineContent(classLine);
		if (!this.isClassDeclaration(classDeclaration, languageId)) {
			return null;
		}

		// 提取完整的类代码（类似Java的 psiClass.getText()）
		const fullClassCode = this.extractFullClass(model, classLine, languageId);

		const className = this.extractClassName(classDeclaration, languageId);

		return {
			name: className || 'unknown',
			code: fullClassCode,
			insertLine: classLine
		};
	}

	/**
	 * 提取完整的类代码
	 * 类似Java的 psiClass.getText()，获取整个类的代码
	 */
	private extractFullClass(model: ITextModel, classLine: number, languageId: string): string {
		let braceCount = 0;
		let foundBrace = false;
		let endLine = classLine;
		const maxLines = Math.min(model.getLineCount(), classLine + 500); // 最多500行

		// 查找类的结束位置
		for (let line = classLine; line <= maxLines; line++) {
			const lineContent = model.getLineContent(line);

			for (const char of lineContent) {
				if (char === '{') {
					braceCount++;
					foundBrace = true;
				} else if (char === '}') {
					braceCount--;
					if (foundBrace && braceCount === 0) {
						endLine = line;
						// 找到类结束，返回完整代码
						return model.getValueInRange(new Range(
							classLine,
							1,
							endLine,
							model.getLineMaxColumn(endLine)
						));
					}
				}
			}
		}

		// 如果没找到结束，返回到当前位置
		endLine = Math.min(model.getLineCount(), classLine + 200);
		return model.getValueInRange(new Range(
			classLine,
			1,
			endLine,
			model.getLineMaxColumn(endLine)
		));
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
	 * 提取方法名
	 */
	private extractMethodName(line: string, languageId: string): string | null {
		if (languageId === 'java' || languageId === 'typescript' || languageId === 'javascript') {
			const match = line.match(/\b(\w+)\s*\(/);
			return match ? match[1] : null;
		}

		if (languageId === 'python') {
			const match = line.match(/def\s+(\w+)\s*\(/);
			return match ? match[1] : null;
		}

		return null;
	}

	/**
	 * 提取类名
	 */
	private extractClassName(line: string, languageId: string): string | null {
		if (languageId === 'java' || languageId === 'typescript' || languageId === 'javascript') {
			const match = line.match(/class\s+(\w+)/i);
			return match ? match[1] : null;
		}

		if (languageId === 'python') {
			const match = line.match(/class\s+(\w+)/i);
			return match ? match[1] : null;
		}

		return null;
	}

	/**
	 * 插入注释到代码上方
	 */
	private async insertComment(editor: ICodeEditor, comment: string, insertLine: number): Promise<void> {
		const model = editor.getModel();
		if (!model) {
			return;
		}

		// 检查上一行是否已经有注释
		if (insertLine > 1) {
			const previousLine = model.getLineContent(insertLine - 1).trim();
			if (previousLine.startsWith('/*') || previousLine.startsWith('//') || previousLine.startsWith('#')) {
				// 删除旧注释（简化处理，只删除上一行）
				const deleteRange = new Range(insertLine - 1, 1, insertLine - 1, model.getLineMaxColumn(insertLine - 1));
				editor.executeEdits('ai-generate-comment', [{
					range: deleteRange,
					text: ''
				}]);
			}
		}

		// 获取当前行的缩进
		const lineContent = model.getLineContent(insertLine);
		const indentMatch = lineContent.match(/^(\s*)/);
		const indent = indentMatch ? indentMatch[1] : '';

		// 为注释的每一行添加缩进
		const indentedComment = comment.split('\n')
			.map(line => indent + line)
			.join('\n');

		// 在方法/类声明行上方插入注释
		editor.executeEdits('ai-generate-comment', [{
			range: new Range(insertLine, 1, insertLine, 1),
			text: indentedComment + '\n'
		}]);

		// 移动光标到插入的注释上方
		editor.setPosition(new Position(insertLine, 1));
	}
}

/**
 * 代码信息
 */
interface CodeInfo {
	name: string;
	code: string;
	insertLine: number;
}
