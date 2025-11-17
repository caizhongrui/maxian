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
import * as path from '../../../../base/common/path.js';
import { URI } from '../../../../base/common/uri.js';
import { ITextFileService } from '../../../services/textfile/common/textfiles.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';

/**
 * 生成测试命令处理器
 * 为当前方法生成单元测试
 */
export class GenerateTestCommand {

	constructor(
		private readonly aiService: IAIService,
		private readonly textFileService: ITextFileService,
		private readonly editorService: IEditorService
	) { }

	/**
	 * 执行生成测试命令
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

		console.log('[Generate Test] Starting test generation...');

		try {
			// 1. 提取当前方法
			const method = await this.extractMethod(model, position);
			if (!method) {
				console.warn('[Generate Test] No method found at cursor position');
				return;
			}

			console.log('[Generate Test] Extracted method:', method.name);

			// 2. 检测测试框架
			const framework = this.detectTestFramework(model);
			console.log('[Generate Test] Detected framework:', framework);

			// 3. 生成测试代码
			const testCode = await this.aiService.generate({
				type: 'test',
				sourceCode: method.code,
				language: model.getLanguageId(),
				context: {
					className: method.className,
					methodName: method.name,
					framework: framework
				}
			}, token);

			console.log('[Generate Test] Test code generated, length:', testCode.code.length);

			// 4. 创建或更新测试文件
			await this.insertTest(model, testCode.code, method);

			console.log('[Generate Test] Test generation completed successfully');

		} catch (error) {
			console.error('[Generate Test] Error:', error);
			throw error;
		}
	}

	/**
	 * 提取当前光标位置的方法
	 */
	private async extractMethod(model: ITextModel, position: Position): Promise<MethodInfo | null> {
		const languageId = model.getLanguageId();

		// 简单实现：查找当前位置所在的方法
		// 向上查找方法开始（函数声明或方法签名）
		let methodStart = position.lineNumber;
		let methodEnd = position.lineNumber;

		// 向上查找方法开始
		for (let line = position.lineNumber; line >= 1; line--) {
			const lineContent = model.getLineContent(line);

			// 检测方法声明（支持 Java, TypeScript, Python）
			if (this.isMethodDeclaration(lineContent, languageId)) {
				methodStart = line;
				break;
			}

			// 如果遇到类声明或其他方法，停止
			if (line < position.lineNumber && this.isBlockStart(lineContent, languageId)) {
				break;
			}
		}

		// 向下查找方法结束
		const totalLines = model.getLineCount();
		let braceCount = 0;
		let foundStart = false;

		for (let line = methodStart; line <= totalLines; line++) {
			const lineContent = model.getLineContent(line);

			// 计算大括号（适用于 Java, TypeScript）
			if (languageId === 'java' || languageId === 'typescript' || languageId === 'javascript') {
				for (const char of lineContent) {
					if (char === '{') {
						braceCount++;
						foundStart = true;
					} else if (char === '}') {
						braceCount--;
						if (foundStart && braceCount === 0) {
							methodEnd = line;
							break;
						}
					}
				}
				if (foundStart && braceCount === 0) {
					break;
				}
			}

			// Python 使用缩进
			if (languageId === 'python') {
				// 简化：查找下一个相同缩进级别的 def
				if (line > methodStart && lineContent.trim().startsWith('def ')) {
					methodEnd = line - 1;
					break;
				}
			}

			methodEnd = line;
		}

		// 提取方法代码
		const methodCode = model.getValueInRange(new Range(
			methodStart,
			1,
			methodEnd,
			model.getLineMaxColumn(methodEnd)
		));

		// 提取方法名
		const methodName = this.extractMethodName(model.getLineContent(methodStart), languageId);

		// 提取类名（如果有）
		const className = this.extractClassName(model, methodStart);

		return {
			name: methodName || 'unknown',
			className: className,
			code: methodCode,
			startLine: methodStart,
			endLine: methodEnd
		};
	}

	/**
	 * 判断是否是方法声明
	 */
	private isMethodDeclaration(line: string, languageId: string): boolean {
		const trimmed = line.trim();

		if (languageId === 'java' || languageId === 'typescript' || languageId === 'javascript') {
			// 包含 public, private, function 等关键字
			return /^(public|private|protected|static|async|export)?\s*(static|async|export)?\s*\w+[\s\w<>,]*\s+\w+\s*\(/i.test(trimmed) ||
				/^(function|async function)\s+\w+\s*\(/i.test(trimmed);
		}

		if (languageId === 'python') {
			return /^def\s+\w+\s*\(/i.test(trimmed);
		}

		return false;
	}

	/**
	 * 判断是否是代码块开始
	 */
	private isBlockStart(line: string, languageId: string): boolean {
		const trimmed = line.trim();

		if (languageId === 'java' || languageId === 'typescript') {
			return /^(public|private|protected)?\s*(class|interface|enum)\s+/i.test(trimmed);
		}

		if (languageId === 'python') {
			return /^class\s+/i.test(trimmed);
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
	private extractClassName(model: ITextModel, methodLine: number): string | null {
		// 向上查找类声明
		for (let line = methodLine; line >= 1; line--) {
			const lineContent = model.getLineContent(line);
			const trimmed = lineContent.trim();

			const match = trimmed.match(/^(public|private|protected)?\s*class\s+(\w+)/i);
			if (match) {
				return match[2];
			}
		}

		return null;
	}

	/**
	 * 检测测试框架
	 */
	private detectTestFramework(model: ITextModel): string {
		const languageId = model.getLanguageId();
		const content = model.getValue();

		// Java
		if (languageId === 'java') {
			if (content.includes('import org.junit.jupiter') || content.includes('import org.junit.Test')) {
				return 'junit5';
			}
			return 'junit5'; // 默认
		}

		// TypeScript/JavaScript
		if (languageId === 'typescript' || languageId === 'javascript') {
			if (content.includes('jest') || content.includes("from 'jest'")) {
				return 'jest';
			}
			if (content.includes('mocha') || content.includes('describe(')) {
				return 'mocha';
			}
			return 'jest'; // 默认
		}

		// Python
		if (languageId === 'python') {
			if (content.includes('import pytest') || content.includes('from pytest')) {
				return 'pytest';
			}
			if (content.includes('import unittest') || content.includes('from unittest')) {
				return 'unittest';
			}
			return 'pytest'; // 默认
		}

		return 'unknown';
	}

	/**
	 * 插入测试代码到测试文件
	 */
	private async insertTest(model: ITextModel, testCode: string, method: MethodInfo): Promise<void> {
		const uri = model.uri;
		const testFileUri = this.getTestFileUri(uri, model.getLanguageId());

		console.log('[Generate Test] Test file URI:', testFileUri.toString());

		// 检查测试文件是否存在
		try {
			const testModel = await this.textFileService.read(testFileUri);

			// 文件存在，追加测试
			const existingContent = testModel.value;
			const newContent = existingContent + '\n\n' + testCode;

			await this.textFileService.write(testFileUri, newContent);

		} catch (error) {
			// 文件不存在，创建新文件
			console.log('[Generate Test] Creating new test file');

			const testFileContent = this.generateTestFileTemplate(model.getLanguageId(), method.className) + '\n\n' + testCode;

			await this.textFileService.create([{
				resource: testFileUri,
				value: testFileContent
			}]);
		}

		// 打开测试文件
		await this.editorService.openEditor({
			resource: testFileUri,
			options: { preserveFocus: false }
		});
	}

	/**
	 * 获取测试文件 URI
	 */
	private getTestFileUri(sourceUri: URI, languageId: string): URI {
		const sourcePath = sourceUri.fsPath;
		const dir = path.dirname(sourcePath);
		const fileName = path.basename(sourcePath);
		const nameWithoutExt = fileName.replace(/\.\w+$/, '');

		// Java: 同目录或 test 目录
		if (languageId === 'java') {
			const testFileName = nameWithoutExt + 'Test.java';
			// 简化：放在同目录
			return URI.file(path.join(dir, testFileName));
		}

		// TypeScript/JavaScript
		if (languageId === 'typescript') {
			const testFileName = nameWithoutExt + '.test.ts';
			return URI.file(path.join(dir, testFileName));
		}

		if (languageId === 'javascript') {
			const testFileName = nameWithoutExt + '.test.js';
			return URI.file(path.join(dir, testFileName));
		}

		// Python
		if (languageId === 'python') {
			const testFileName = 'test_' + fileName;
			return URI.file(path.join(dir, testFileName));
		}

		// 默认
		const testFileName = nameWithoutExt + '.test' + path.extname(fileName);
		return URI.file(path.join(dir, testFileName));
	}

	/**
	 * 生成测试文件模板
	 */
	private generateTestFileTemplate(languageId: string, className: string | null): string {
		if (languageId === 'java') {
			return `import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class ${className || 'Unknown'}Test {
	// Generated tests
`;
		}

		if (languageId === 'typescript' || languageId === 'javascript') {
			return `import { describe, it, expect } from 'jest';

describe('${className || 'Test Suite'}', () => {
	// Generated tests
`;
		}

		if (languageId === 'python') {
			return `import pytest

class Test${className || 'Unknown'}:
    # Generated tests
`;
		}

		return '// Generated tests\n';
	}
}

/**
 * 方法信息
 */
interface MethodInfo {
	name: string;
	className: string | null;
	code: string;
	startLine: number;
	endLine: number;
}
