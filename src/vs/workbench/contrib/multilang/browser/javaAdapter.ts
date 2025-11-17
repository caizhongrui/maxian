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
	PropertyInfo,
	ImportInfo,
	ParameterInfo
	// AnnotationInfo - reserved for future use
} from '../common/codeElements.js';

/**
 * Java 语言适配器
 * 使用正则表达式进行基本解析
 */
export class JavaAdapter implements ILanguageAdapter {
	readonly language = 'java';
	readonly displayName = 'Java';
	readonly fileExtensions = ['.java'];

	async parseAST(code: string, token?: CancellationToken): Promise<any> {
		// 简化的AST解析，返回代码行数组
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

		// 提取文件行数和大小
		const lines = code.split('\n');
		elements.file.lineCount = lines.length;
		elements.file.size = code.length;

		// 提取包声明
		const packageMatch = code.match(/^\s*package\s+([\w.]+)\s*;/m);
		if (packageMatch) {
			elements.namespace = {
				name: packageMatch[1],
				fullPath: packageMatch[1],
				children: []
			};
		}

		// 提取导入语句
		elements.imports = await this.extractImports(code, token);

		// 提取类
		elements.classes = await this.extractClasses(code, token);

		// 提取接口
		elements.interfaces = await this.extractInterfaces(code, token);

		// 提取枚举
		elements.enums = await this.extractEnums(code, token);

		return elements;
	}

	async generateCode(template: CodeTemplate, data: any, token?: CancellationToken): Promise<string> {
		let code = template.template;

		// 简单的模板变量替换
		for (const [key, value] of Object.entries(data)) {
			const placeholder = `{{${key}}}`;
			code = code.replace(new RegExp(placeholder, 'g'), String(value));
		}

		return code;
	}

	async formatCode(code: string, options?: FormatOptions, token?: CancellationToken): Promise<string> {
		// 简单的格式化
		const indentSize = options?.indentSize || 4;
		const useTabs = options?.useTabs || false;
		const indent = useTabs ? '\t' : ' '.repeat(indentSize);

		const lines = code.split('\n');
		const formatted: string[] = [];
		let indentLevel = 0;

		for (let line of lines) {
			line = line.trim();

			// 减少缩进
			if (line.startsWith('}')) {
				indentLevel = Math.max(0, indentLevel - 1);
			}

			// 添加缩进
			if (line.length > 0) {
				formatted.push(indent.repeat(indentLevel) + line);
			} else {
				formatted.push('');
			}

			// 增加缩进
			if (line.endsWith('{')) {
				indentLevel++;
			}
		}

		return formatted.join('\n');
	}

	async validateSyntax(code: string, token?: CancellationToken): Promise<LangSyntaxError[]> {
		const errors: LangSyntaxError[] = [];

		// 检查大括号匹配
		let braceCount = 0;
		let parenCount = 0;
		let bracketCount = 0;

		const lines = code.split('\n');
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];

			for (const char of line) {
				if (char === '{') braceCount++;
				if (char === '}') braceCount--;
				if (char === '(') parenCount++;
				if (char === ')') parenCount--;
				if (char === '[') bracketCount++;
				if (char === ']') bracketCount--;

				if (braceCount < 0) {
					errors.push({
						message: 'Unmatched closing brace',
						line: i + 1,
						column: line.indexOf('}') + 1,
						severity: 'error'
					});
				}
			}
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
		let lineNumber = 1;

		const lines = code.split('\n');
		for (const line of lines) {
			const trimmed = line.trim();

			if (trimmed.startsWith('import')) {
				const importMatch = trimmed.match(/^import\s+(static\s+)?([\w.*]+)\s*;/);

				if (importMatch) {
					const path = importMatch[2];
					const isWildcard = path.endsWith('.*');

					imports.push({
						type: 'module',
						modulePath: path.replace(/\.\*$/, ''),
						importedNames: isWildcard ? ['*'] : [this.getLastSegment(path)],
						isWildcard: isWildcard,
						raw: trimmed,
						line: lineNumber
					});
				}
			}

			lineNumber++;
		}

		return imports;
	}

	async detectFramework(code: string, imports: ImportInfo[], token?: CancellationToken): Promise<string[]> {
		const frameworks: string[] = [];

		for (const imp of imports) {
			const path = imp.modulePath.toLowerCase();

			if (path.includes('springframework')) {
				if (!frameworks.includes('Spring')) {
					frameworks.push('Spring');
				}
			}

			if (path.includes('spring.boot')) {
				if (!frameworks.includes('Spring Boot')) {
					frameworks.push('Spring Boot');
				}
			}

			if (path.includes('hibernate')) {
				if (!frameworks.includes('Hibernate')) {
					frameworks.push('Hibernate');
				}
			}

			if (path.includes('mybatis')) {
				if (!frameworks.includes('MyBatis')) {
					frameworks.push('MyBatis');
				}
			}

			if (path.includes('lombok')) {
				if (!frameworks.includes('Lombok')) {
					frameworks.push('Lombok');
				}
			}
		}

		return frameworks;
	}

	// ====== 私有辅助方法 ======

	private async extractClasses(code: string, token?: CancellationToken): Promise<ClassInfo[]> {
		const classes: ClassInfo[] = [];
		const lines = code.split('\n');

		// 查找类定义
		const classRegex = /^\s*(public|private|protected)?\s*(abstract|final)?\s*class\s+(\w+)(\s+extends\s+(\w+))?(\s+implements\s+([\w\s,]+))?/;

		let currentClass: ClassInfo | null = null;
		let braceLevel = 0;
		let inClass = false;

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			const trimmed = line.trim();

			// 检测类定义
			const classMatch = trimmed.match(classRegex);
			if (classMatch && !inClass) {
				const modifiers: string[] = [];
				if (classMatch[1]) modifiers.push(classMatch[1]); // public/private/protected
				if (classMatch[2]) modifiers.push(classMatch[2]); // abstract/final

				currentClass = {
					name: classMatch[3],
					modifiers: modifiers,
					superClass: classMatch[5],
					interfaces: classMatch[7] ? classMatch[7].split(',').map(s => s.trim()) : [],
					typeParameters: [],
					properties: [],
					methods: [],
					constructors: [],
					innerClasses: [],
					annotations: [],
					startLine: i + 1,
					endLine: i + 1,
					visibility: (classMatch[1] as any) || 'package'
				};

				inClass = true;
			}

			// 追踪大括号级别
			for (const char of line) {
				if (char === '{') braceLevel++;
				if (char === '}') {
					braceLevel--;
					if (braceLevel === 0 && inClass && currentClass) {
						currentClass.endLine = i + 1;
						classes.push(currentClass);
						currentClass = null;
						inClass = false;
					}
				}
			}

			// 提取属性
			if (inClass && currentClass && braceLevel === 1) {
				const property = this.tryExtractProperty(trimmed, i + 1);
				if (property) {
					currentClass.properties.push(property);
				}
			}

			// 提取方法
			if (inClass && currentClass && braceLevel === 1) {
				const method = this.tryExtractMethod(lines, i);
				if (method) {
					currentClass.methods.push(method);
				}
			}
		}

		return classes;
	}

	private async extractInterfaces(code: string, token?: CancellationToken): Promise<any[]> {
		// 简化实现，暂时返回空数组
		return [];
	}

	private async extractEnums(code: string, token?: CancellationToken): Promise<any[]> {
		// 简化实现，暂时返回空数组
		return [];
	}

	private tryExtractProperty(line: string, lineNumber: number): PropertyInfo | null {
		// 匹配属性声明：private String name;
		const propertyRegex = /^(public|private|protected)?\s*(static)?\s*(final)?\s*(\w+)\s+(\w+)(\s*=\s*(.+))?;/;
		const match = line.match(propertyRegex);

		if (match) {
			const modifiers: string[] = [];
			if (match[1]) modifiers.push(match[1]);
			if (match[2]) modifiers.push(match[2]);
			if (match[3]) modifiers.push(match[3]);

			return {
				name: match[5],
				type: match[4],
				modifiers: modifiers,
				defaultValue: match[7],
				annotations: [],
				line: lineNumber,
				visibility: (match[1] as any) || 'package',
				isStatic: modifiers.includes('static'),
				isReadonly: modifiers.includes('final')
			};
		}

		return null;
	}

	private tryExtractMethod(lines: string[], startLine: number): FunctionInfo | null {
		const line = lines[startLine].trim();

		// 匹配方法声明
		const methodRegex = /^(public|private|protected)?\s*(static)?\s*(abstract|final)?\s*(\w+)\s+(\w+)\s*\(([^)]*)\)/;
		const match = line.match(methodRegex);

		if (match && !line.includes('class ') && !line.includes('interface ')) {
			const modifiers: string[] = [];
			if (match[1]) modifiers.push(match[1]);
			if (match[2]) modifiers.push(match[2]);
			if (match[3]) modifiers.push(match[3]);

			const params = this.parseParameters(match[6]);

			// 找到方法结束位置
			let endLine = startLine;
			let braceCount = 0;
			let foundBody = false;

			for (let i = startLine; i < lines.length; i++) {
				const l = lines[i];
				for (const char of l) {
					if (char === '{') {
						braceCount++;
						foundBody = true;
					}
					if (char === '}') {
						braceCount--;
						if (braceCount === 0 && foundBody) {
							endLine = i;
							break;
						}
					}
				}
				if (braceCount === 0 && foundBody) {
					break;
				}
			}

			return {
				name: match[5],
				modifiers: modifiers,
				parameters: params,
				returnType: match[4],
				typeParameters: [],
				throws: [],
				annotations: [],
				startLine: startLine + 1,
				endLine: endLine + 1,
				visibility: (match[1] as any) || 'package',
				isAsync: false,
				isStatic: modifiers.includes('static'),
				isAbstract: modifiers.includes('abstract')
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
			const parts = trimmed.split(/\s+/);

			if (parts.length >= 2) {
				const type = parts[0];
				const name = parts[1];

				params.push({
					name: name,
					type: type,
					isOptional: false,
					isVariadic: type.endsWith('...'),
					annotations: []
				});
			}
		}

		return params;
	}

	private getLastSegment(path: string): string {
		const segments = path.split('.');
		return segments[segments.length - 1];
	}
}
