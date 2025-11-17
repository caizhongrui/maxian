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
	InterfaceInfo,
	FunctionInfo,
	PropertyInfo,
	ImportInfo,
	ParameterInfo,
	TypeAliasInfo,
	MethodSignatureInfo,
	PropertySignatureInfo
} from '../common/codeElements.js';

/**
 * TypeScript 语言适配器
 */
export class TypeScriptAdapter implements ILanguageAdapter {
	readonly language = 'typescript';
	readonly displayName = 'TypeScript';
	readonly fileExtensions = ['.ts', '.tsx'];

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

		// 提取接口
		elements.interfaces = await this.extractInterfaces(code, token);

		// 提取类型别名
		elements.typeAliases = await this.extractTypeAliases(code, token);

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
		const indentSize = options?.indentSize || 2;
		const useTabs = options?.useTabs || false;
		const indent = useTabs ? '\t' : ' '.repeat(indentSize);

		const lines = code.split('\n');
		const formatted: string[] = [];
		let indentLevel = 0;

		for (let line of lines) {
			line = line.trim();

			if (line.startsWith('}')) {
				indentLevel = Math.max(0, indentLevel - 1);
			}

			if (line.length > 0) {
				formatted.push(indent.repeat(indentLevel) + line);
			} else {
				formatted.push('');
			}

			if (line.endsWith('{')) {
				indentLevel++;
			}
		}

		return formatted.join('\n');
	}

	async validateSyntax(code: string, token?: CancellationToken): Promise<LangSyntaxError[]> {
		const errors: LangSyntaxError[] = [];

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

		if (parenCount !== 0) {
			errors.push({
				message: 'Unmatched parentheses',
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

			// import { A, B } from 'module'
			const namedImportMatch = trimmed.match(/^import\s+\{\s*([^}]+)\s*\}\s+from\s+['"]([^'"]+)['"]/);
			if (namedImportMatch) {
				const names = namedImportMatch[1].split(',').map(s => s.trim());
				imports.push({
					type: 'module',
					modulePath: namedImportMatch[2],
					importedNames: names,
					raw: trimmed,
					line: lineNumber
				});
				lineNumber++;
				continue;
			}

			// import A from 'module'
			const defaultImportMatch = trimmed.match(/^import\s+(\w+)\s+from\s+['"]([^'"]+)['"]/);
			if (defaultImportMatch) {
				imports.push({
					type: 'module',
					modulePath: defaultImportMatch[2],
					importedNames: [defaultImportMatch[1]],
					isDefault: true,
					raw: trimmed,
					line: lineNumber
				});
				lineNumber++;
				continue;
			}

			// import * as A from 'module'
			const namespaceImportMatch = trimmed.match(/^import\s+\*\s+as\s+(\w+)\s+from\s+['"]([^'"]+)['"]/);
			if (namespaceImportMatch) {
				imports.push({
					type: 'namespace',
					modulePath: namespaceImportMatch[2],
					importedNames: [],
					alias: namespaceImportMatch[1],
					isWildcard: true,
					raw: trimmed,
					line: lineNumber
				});
				lineNumber++;
				continue;
			}

			// import 'module'
			const sideEffectImportMatch = trimmed.match(/^import\s+['"]([^'"]+)['"]/);
			if (sideEffectImportMatch) {
				imports.push({
					type: 'module',
					modulePath: sideEffectImportMatch[1],
					importedNames: [],
					raw: trimmed,
					line: lineNumber
				});
			}

			lineNumber++;
		}

		return imports;
	}

	async detectFramework(code: string, imports: ImportInfo[], token?: CancellationToken): Promise<string[]> {
		const frameworks: string[] = [];

		for (const imp of imports) {
			const path = imp.modulePath.toLowerCase();

			if (path === 'react' || path.startsWith('react/')) {
				if (!frameworks.includes('React')) {
					frameworks.push('React');
				}
			}

			if (path === 'vue' || path.startsWith('vue/')) {
				if (!frameworks.includes('Vue')) {
					frameworks.push('Vue');
				}
			}

			if (path === '@angular/core' || path.startsWith('@angular/')) {
				if (!frameworks.includes('Angular')) {
					frameworks.push('Angular');
				}
			}

			if (path === 'express') {
				if (!frameworks.includes('Express')) {
					frameworks.push('Express');
				}
			}

			if (path.startsWith('@nestjs/')) {
				if (!frameworks.includes('NestJS')) {
					frameworks.push('NestJS');
				}
			}

			if (path === 'next' || path.startsWith('next/')) {
				if (!frameworks.includes('Next.js')) {
					frameworks.push('Next.js');
				}
			}
		}

		return frameworks;
	}

	// ====== 私有辅助方法 ======

	private async extractClasses(code: string, token?: CancellationToken): Promise<ClassInfo[]> {
		const classes: ClassInfo[] = [];
		const lines = code.split('\n');

		const classRegex = /^\s*(export\s+)?(abstract\s+)?class\s+(\w+)(\s+extends\s+(\w+))?(\s+implements\s+([\w\s,]+))?/;

		let currentClass: ClassInfo | null = null;
		let braceLevel = 0;
		let inClass = false;

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			const trimmed = line.trim();

			const classMatch = trimmed.match(classRegex);
			if (classMatch && !inClass) {
				const modifiers: string[] = [];
				if (classMatch[1]) modifiers.push('export');
				if (classMatch[2]) modifiers.push('abstract');

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
					visibility: modifiers.includes('export') ? 'public' : 'internal'
				};

				inClass = true;
			}

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

			if (inClass && currentClass && braceLevel === 1) {
				const property = this.tryExtractProperty(trimmed, i + 1);
				if (property) {
					currentClass.properties.push(property);
				}

				const method = this.tryExtractMethod(lines, i);
				if (method) {
					currentClass.methods.push(method);
				}
			}
		}

		return classes;
	}

	private async extractInterfaces(code: string, token?: CancellationToken): Promise<InterfaceInfo[]> {
		const interfaces: InterfaceInfo[] = [];
		const lines = code.split('\n');

		const interfaceRegex = /^\s*(export\s+)?interface\s+(\w+)(\s+extends\s+([\w\s,]+))?/;

		let currentInterface: InterfaceInfo | null = null;
		let braceLevel = 0;
		let inInterface = false;

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			const trimmed = line.trim();

			const interfaceMatch = trimmed.match(interfaceRegex);
			if (interfaceMatch && !inInterface) {
				const modifiers: string[] = [];
				if (interfaceMatch[1]) modifiers.push('export');

				currentInterface = {
					name: interfaceMatch[2],
					modifiers: modifiers,
					extends: interfaceMatch[4] ? interfaceMatch[4].split(',').map(s => s.trim()) : [],
					typeParameters: [],
					methods: [],
					properties: [],
					startLine: i + 1,
					endLine: i + 1
				};

				inInterface = true;
			}

			for (const char of line) {
				if (char === '{') braceLevel++;
				if (char === '}') {
					braceLevel--;
					if (braceLevel === 0 && inInterface && currentInterface) {
						currentInterface.endLine = i + 1;
						interfaces.push(currentInterface);
						currentInterface = null;
						inInterface = false;
					}
				}
			}

			if (inInterface && currentInterface && braceLevel === 1) {
				const propertySignature = this.tryExtractPropertySignature(trimmed);
				if (propertySignature) {
					currentInterface.properties.push(propertySignature);
				}

				const methodSignature = this.tryExtractMethodSignature(trimmed);
				if (methodSignature) {
					currentInterface.methods.push(methodSignature);
				}
			}
		}

		return interfaces;
	}

	private async extractTypeAliases(code: string, token?: CancellationToken): Promise<TypeAliasInfo[]> {
		const typeAliases: TypeAliasInfo[] = [];
		const lines = code.split('\n');

		const typeAliasRegex = /^\s*(export\s+)?type\s+(\w+)\s*=\s*(.+);?$/;

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i].trim();
			const match = line.match(typeAliasRegex);

			if (match) {
				typeAliases.push({
					name: match[2],
					typeDefinition: match[3].replace(/;$/, ''),
					typeParameters: [],
					line: i + 1
				});
			}
		}

		return typeAliases;
	}

	private async extractFunctions(code: string, token?: CancellationToken): Promise<FunctionInfo[]> {
		const functions: FunctionInfo[] = [];
		const lines = code.split('\n');

		const functionRegex = /^\s*(export\s+)?(async\s+)?function\s+(\w+)\s*\(([^)]*)\)(\s*:\s*(\w+))?/;

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i].trim();
			const match = line.match(functionRegex);

			if (match) {
				const modifiers: string[] = [];
				if (match[1]) modifiers.push('export');
				if (match[2]) modifiers.push('async');

				const params = this.parseParameters(match[4]);

				functions.push({
					name: match[3],
					modifiers: modifiers,
					parameters: params,
					returnType: match[6] || 'void',
					typeParameters: [],
					throws: [],
					annotations: [],
					startLine: i + 1,
					endLine: i + 1,
					visibility: modifiers.includes('export') ? 'public' : 'internal',
					isAsync: modifiers.includes('async'),
					isStatic: false,
					isAbstract: false
				});
			}
		}

		return functions;
	}

	private tryExtractProperty(line: string, lineNumber: number): PropertyInfo | null {
		// 匹配属性: private name: string = 'default';
		const propertyRegex = /^(private|public|protected|readonly)?\s*(static)?\s*(\w+)(\?)?:\s*(\w+)(\s*=\s*(.+))?;?$/;
		const match = line.match(propertyRegex);

		if (match && !line.includes('(')) {
			const modifiers: string[] = [];
			if (match[1]) modifiers.push(match[1]);
			if (match[2]) modifiers.push(match[2]);

			return {
				name: match[3],
				type: match[5],
				modifiers: modifiers,
				defaultValue: match[7],
				annotations: [],
				line: lineNumber,
				visibility: (match[1] as any) || 'public',
				isStatic: modifiers.includes('static'),
				isReadonly: modifiers.includes('readonly')
			};
		}

		return null;
	}

	private tryExtractMethod(lines: string[], startLine: number): FunctionInfo | null {
		const line = lines[startLine].trim();

		// 匹配方法: public async getName(): string {
		const methodRegex = /^(private|public|protected)?\s*(static)?\s*(async)?\s*(\w+)\s*\(([^)]*)\)(\s*:\s*(\w+))?/;
		const match = line.match(methodRegex);

		if (match && !line.includes('class ') && !line.includes('interface ') && !line.includes('function ')) {
			const modifiers: string[] = [];
			if (match[1]) modifiers.push(match[1]);
			if (match[2]) modifiers.push(match[2]);
			if (match[3]) modifiers.push(match[3]);

			const params = this.parseParameters(match[5]);

			return {
				name: match[4],
				modifiers: modifiers,
				parameters: params,
				returnType: match[7] || 'void',
				typeParameters: [],
				throws: [],
				annotations: [],
				startLine: startLine + 1,
				endLine: startLine + 1,
				visibility: (match[1] as any) || 'public',
				isAsync: modifiers.includes('async'),
				isStatic: modifiers.includes('static'),
				isAbstract: false
			};
		}

		return null;
	}

	private tryExtractPropertySignature(line: string): PropertySignatureInfo | null {
		// name?: string;
		const match = line.match(/^(\w+)(\?)?:\s*(\w+);?$/);

		if (match) {
			return {
				name: match[1],
				type: match[3],
				isOptional: !!match[2],
				isReadonly: false
			};
		}

		return null;
	}

	private tryExtractMethodSignature(line: string): MethodSignatureInfo | null {
		// getName(): string;
		const match = line.match(/^(\w+)\s*\(([^)]*)\)(\s*:\s*(\w+))?;?$/);

		if (match) {
			const params = this.parseParameters(match[2]);

			return {
				name: match[1],
				parameters: params,
				returnType: match[4] || 'void',
				typeParameters: [],
				isOptional: false
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
			// name?: string = 'default'
			const match = trimmed.match(/^(\w+)(\?)?:\s*(\w+)(\s*=\s*(.+))?$/);

			if (match) {
				params.push({
					name: match[1],
					type: match[3],
					defaultValue: match[5],
					isOptional: !!match[2] || !!match[5],
					isVariadic: false,
					annotations: []
				});
			}
		}

		return params;
	}
}
