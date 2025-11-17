/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import {
	ILanguageAdapter,
	CodeTemplate,
	FormatOptions,
	SyntaxError as LangSyntaxError
} from '../common/languageAdapter.js';
import {
	UnifiedCodeElements,
	CodeElementsFactory,
	ClassInfo,
	FunctionInfo,
	ImportInfo,
	ParameterInfo
	// PropertyInfo - reserved for future use
} from '../common/codeElements.js';

/**
 * Python 语言适配器
 */
export class PythonAdapter implements ILanguageAdapter {
	readonly language = 'python';
	readonly displayName = 'Python';
	readonly fileExtensions = ['.py', '.pyi'];

	async parseAST(code: string, token?: CancellationToken): Promise<any> {
		return {
			code: code,
			lines: code.split('\n')
		};
	}

	async extractElements(ast: any, fileUri: URI, token?: CancellationToken): Promise<UnifiedCodeElements> {
		const code = ast.code;
		return this.extractElementsFromCode(code, fileUri, token);
	}

	async extractElementsFromCode(code: string, fileUri: URI, token?: CancellationToken): Promise<UnifiedCodeElements> {
		const elements = CodeElementsFactory.createEmpty(fileUri, this.language);

		const lines = code.split('\n');
		elements.file.lineCount = lines.length;
		elements.file.size = code.length;

		// 提取导入语句
		elements.imports = await this.extractImports(code, token);

		// 提取类
		elements.classes = await this.extractClasses(code, token);

		// 提取函数（文件级别）
		elements.functions = await this.extractFunctions(code, token);

		return elements;
	}

	async generateCode(template: CodeTemplate, data: any, token?: CancellationToken): Promise<string> {
		let code = template.template;

		for (const [key, value] of Object.entries(data)) {
			const placeholder = `{{${key}}}`;
			code = code.replace(new RegExp(placeholder, 'g'), String(value));
		}

		return code;
	}

	async formatCode(code: string, options?: FormatOptions, token?: CancellationToken): Promise<string> {
		// Python 使用固定的 4 空格缩进（PEP 8 标准）
		const indentSize = options?.indentSize || 4;
		const useTabs = options?.useTabs || false;
		const indent = useTabs ? '\t' : ' '.repeat(indentSize);

		const lines = code.split('\n');
		const formatted: string[] = [];
		let indentLevel = 0;

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			const trimmed = line.trim();

			// 空行直接添加
			if (trimmed === '') {
				formatted.push('');
				continue;
			}

			// 减少缩进的情况
			if (this.isDeindentLine(trimmed)) {
				indentLevel = Math.max(0, indentLevel - 1);
			}

			// 添加缩进
			formatted.push(indent.repeat(indentLevel) + trimmed);

			// 增加缩进的情况（以冒号结尾）
			if (trimmed.endsWith(':')) {
				indentLevel++;
			}

			// 检查下一行是否需要减少缩进
			if (i + 1 < lines.length) {
				const nextTrimmed = lines[i + 1].trim();
				if (this.isDeindentLine(nextTrimmed)) {
					// 不需要做什么，会在下一次循环处理
				}
			}
		}

		return formatted.join('\n');
	}

	async validateSyntax(code: string, token?: CancellationToken): Promise<LangSyntaxError[]> {
		const errors: LangSyntaxError[] = [];

		let parenCount = 0;
		let bracketCount = 0;
		let braceCount = 0;

		const lines = code.split('\n');
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];

			for (const char of line) {
				if (char === '(') parenCount++;
				if (char === ')') parenCount--;
				if (char === '[') bracketCount++;
				if (char === ']') bracketCount--;
				if (char === '{') braceCount++;
				if (char === '}') braceCount--;
			}
		}

		if (parenCount !== 0) {
			errors.push({
				message: 'Unmatched parentheses',
				line: 1,
				column: 1,
				severity: 'error'
			});
		}

		if (bracketCount !== 0) {
			errors.push({
				message: 'Unmatched brackets',
				line: 1,
				column: 1,
				severity: 'error'
			});
		}

		if (braceCount !== 0) {
			errors.push({
				message: 'Unmatched braces',
				line: 1,
				column: 1,
				severity: 'error'
			});
		}

		return errors;
	}

	async extractMethod(code: string, methodName: string, token?: CancellationToken): Promise<FunctionInfo | null> {
		const functions = await this.extractFunctions(code, token);

		for (const func of functions) {
			if (func.name === methodName) {
				return func;
			}
		}

		const classes = await this.extractClasses(code, token);
		for (const cls of classes) {
			for (const method of cls.methods) {
				if (method.name === methodName) {
					return method;
				}
			}
		}

		return null;
	}

	async extractClass(code: string, className: string, token?: CancellationToken): Promise<ClassInfo | null> {
		const classes = await this.extractClasses(code, token);

		for (const cls of classes) {
			if (cls.name === className) {
				return cls;
			}
		}

		return null;
	}

	async extractImports(code: string, token?: CancellationToken): Promise<ImportInfo[]> {
		const imports: ImportInfo[] = [];
		const lines = code.split('\n');
		let lineNumber = 1;

		for (const line of lines) {
			const trimmed = line.trim();

			// from module import A, B
			const fromImportMatch = trimmed.match(/^from\s+([\w.]+)\s+import\s+(.+)$/);
			if (fromImportMatch) {
				const modulePath = fromImportMatch[1];
				const importedPart = fromImportMatch[2];

				// 处理 import *
				if (importedPart.trim() === '*') {
					imports.push({
						type: 'module',
						modulePath: modulePath,
						importedNames: ['*'],
						isWildcard: true,
						raw: trimmed,
						line: lineNumber
					});
				} else {
					// 处理多个导入
					const names = importedPart.split(',').map(s => {
						const asMatch = s.trim().match(/^(\w+)(\s+as\s+(\w+))?$/);
						return asMatch ? asMatch[1] : s.trim();
					});

					imports.push({
						type: 'module',
						modulePath: modulePath,
						importedNames: names,
						raw: trimmed,
						line: lineNumber
					});
				}

				lineNumber++;
				continue;
			}

			// import module
			const importMatch = trimmed.match(/^import\s+([\w.]+)(\s+as\s+(\w+))?$/);
			if (importMatch) {
				imports.push({
					type: 'module',
					modulePath: importMatch[1],
					importedNames: [importMatch[1]],
					alias: importMatch[3],
					raw: trimmed,
					line: lineNumber
				});

				lineNumber++;
				continue;
			}

			lineNumber++;
		}

		return imports;
	}

	async detectFramework(code: string, imports: ImportInfo[], token?: CancellationToken): Promise<string[]> {
		const frameworks: string[] = [];

		for (const imp of imports) {
			const path = imp.modulePath.toLowerCase();

			if (path === 'django' || path.startsWith('django.')) {
				if (!frameworks.includes('Django')) {
					frameworks.push('Django');
				}
			}

			if (path === 'flask' || path.startsWith('flask.')) {
				if (!frameworks.includes('Flask')) {
					frameworks.push('Flask');
				}
			}

			if (path === 'fastapi' || path.startsWith('fastapi.')) {
				if (!frameworks.includes('FastAPI')) {
					frameworks.push('FastAPI');
				}
			}

			if (path === 'numpy' || path === 'np') {
				if (!frameworks.includes('NumPy')) {
					frameworks.push('NumPy');
				}
			}

			if (path === 'pandas' || path === 'pd') {
				if (!frameworks.includes('Pandas')) {
					frameworks.push('Pandas');
				}
			}

			if (path === 'torch' || path.startsWith('torch.')) {
				if (!frameworks.includes('PyTorch')) {
					frameworks.push('PyTorch');
				}
			}

			if (path === 'tensorflow' || path === 'tf') {
				if (!frameworks.includes('TensorFlow')) {
					frameworks.push('TensorFlow');
				}
			}
		}

		return frameworks;
	}

	// ====== 私有辅助方法 ======

	private async extractClasses(code: string, token?: CancellationToken): Promise<ClassInfo[]> {
		const classes: ClassInfo[] = [];
		const lines = code.split('\n');

		// class MyClass(Base):
		const classRegex = /^class\s+(\w+)(\(([^)]*)\))?:/;

		let currentClass: ClassInfo | null = null;
		let classIndent = -1;

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			const trimmed = line.trim();
			const indent = this.getIndentLevel(line);

			// 检测类定义
			const classMatch = trimmed.match(classRegex);
			if (classMatch && indent === 0) {
				// 保存上一个类
				if (currentClass) {
					currentClass.endLine = i;
					classes.push(currentClass);
				}

				// 解析基类
				const baseClasses = classMatch[3] ? classMatch[3].split(',').map(s => s.trim()) : [];

				currentClass = {
					name: classMatch[1],
					modifiers: [],
					superClass: baseClasses.length > 0 ? baseClasses[0] : undefined,
					interfaces: baseClasses.slice(1),
					typeParameters: [],
					properties: [],
					methods: [],
					constructors: [],
					innerClasses: [],
					annotations: [],
					startLine: i + 1,
					endLine: i + 1,
					visibility: 'public'
				};

				classIndent = indent;
				continue;
			}

			// 在类内部
			if (currentClass && indent > classIndent) {
				// 提取方法
				const method = this.tryExtractMethod(lines, i, indent);
				if (method) {
					if (method.name === '__init__') {
						currentClass.constructors.push(method);
					} else {
						currentClass.methods.push(method);
					}
				}
			}

			// 类结束（遇到同级或更小的缩进）
			if (currentClass && indent <= classIndent && trimmed !== '' && !classMatch) {
				currentClass.endLine = i;
				classes.push(currentClass);
				currentClass = null;
				classIndent = -1;
			}
		}

		// 保存最后一个类
		if (currentClass) {
			currentClass.endLine = lines.length;
			classes.push(currentClass);
		}

		return classes;
	}

	private async extractFunctions(code: string, token?: CancellationToken): Promise<FunctionInfo[]> {
		const functions: FunctionInfo[] = [];
		const lines = code.split('\n');

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			const indent = this.getIndentLevel(line);

			// 只提取顶层函数（缩进为 0）
			if (indent === 0) {
				const func = this.tryExtractMethod(lines, i, indent);
				if (func) {
					functions.push(func);
				}
			}
		}

		return functions;
	}

	private tryExtractMethod(lines: string[], startLine: number, baseIndent: number): FunctionInfo | null {
		const line = lines[startLine].trim();

		// def method_name(param1, param2) -> return_type:
		const methodRegex = /^(async\s+)?def\s+(\w+)\s*\(([^)]*)\)(\s*->\s*(\w+))?:/;
		const match = line.match(methodRegex);

		if (match) {
			const modifiers: string[] = [];
			if (match[1]) modifiers.push('async');

			const params = this.parseParameters(match[3]);
			const methodName = match[2];

			// 确定可见性
			let visibility: 'public' | 'private' | 'protected' | 'internal' | 'package' = 'public';
			if (methodName.startsWith('__') && methodName.endsWith('__')) {
				visibility = 'public'; // 魔术方法是公开的
			} else if (methodName.startsWith('__')) {
				visibility = 'private'; // 双下划线开头是私有的
			} else if (methodName.startsWith('_')) {
				visibility = 'protected'; // 单下划线开头是受保护的
			}

			// 查找函数结束位置
			let endLine = startLine;
			for (let i = startLine + 1; i < lines.length; i++) {
				const nextLine = lines[i];
				const nextTrimmed = nextLine.trim();
				const nextIndent = this.getIndentLevel(nextLine);

				// 遇到同级或更小缩进的非空行，说明函数结束
				if (nextTrimmed !== '' && nextIndent <= baseIndent) {
					endLine = i - 1;
					break;
				}

				if (i === lines.length - 1) {
					endLine = i;
				}
			}

			return {
				name: methodName,
				modifiers: modifiers,
				parameters: params,
				returnType: match[5] || 'None',
				typeParameters: [],
				throws: [],
				annotations: [],
				startLine: startLine + 1,
				endLine: endLine + 1,
				visibility: visibility,
				isAsync: modifiers.includes('async'),
				isStatic: params.length > 0 && params[0].name !== 'self' && params[0].name !== 'cls',
				isAbstract: false
			};
		}

		return null;
	}

	private parseParameters(paramsStr: string): ParameterInfo[] {
		if (!paramsStr || paramsStr.trim() === '') {
			return [];
		}

		const params: ParameterInfo[] = [];
		const paramList = paramsStr.split(',');

		for (const param of paramList) {
			const trimmed = param.trim();

			// self 和 cls 是特殊参数
			if (trimmed === 'self' || trimmed === 'cls') {
				params.push({
					name: trimmed,
					type: 'Self',
					isOptional: false,
					isVariadic: false,
					annotations: []
				});
				continue;
			}

			// *args 和 **kwargs
			if (trimmed.startsWith('**')) {
				params.push({
					name: trimmed.substring(2),
					type: 'dict',
					isOptional: true,
					isVariadic: true,
					annotations: []
				});
				continue;
			}

			if (trimmed.startsWith('*')) {
				params.push({
					name: trimmed.substring(1),
					type: 'tuple',
					isOptional: true,
					isVariadic: true,
					annotations: []
				});
				continue;
			}

			// 带类型注解: name: str = 'default'
			const typedMatch = trimmed.match(/^(\w+):\s*(\w+)(\s*=\s*(.+))?$/);
			if (typedMatch) {
				params.push({
					name: typedMatch[1],
					type: typedMatch[2],
					defaultValue: typedMatch[4],
					isOptional: !!typedMatch[4],
					isVariadic: false,
					annotations: []
				});
				continue;
			}

			// 无类型注解: name = 'default'
			const untypedMatch = trimmed.match(/^(\w+)(\s*=\s*(.+))?$/);
			if (untypedMatch) {
				params.push({
					name: untypedMatch[1],
					type: 'Any',
					defaultValue: untypedMatch[3],
					isOptional: !!untypedMatch[3],
					isVariadic: false,
					annotations: []
				});
			}
		}

		return params;
	}

	private getIndentLevel(line: string): number {
		let indent = 0;
		for (const char of line) {
			if (char === ' ') {
				indent++;
			} else if (char === '\t') {
				indent += 4; // 制表符算 4 个空格
			} else {
				break;
			}
		}
		return Math.floor(indent / 4); // 返回缩进级别（每 4 个空格为一级）
	}

	private isDeindentLine(line: string): boolean {
		// Python 中需要减少缩进的关键字
		const deindentKeywords = ['else:', 'elif ', 'except:', 'except ', 'finally:', 'case ', 'case:'];

		for (const keyword of deindentKeywords) {
			if (line.startsWith(keyword)) {
				return true;
			}
		}

		return false;
	}
}
