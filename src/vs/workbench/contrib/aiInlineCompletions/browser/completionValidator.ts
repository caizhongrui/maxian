/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CompletionContext } from './completionContextExtractor.js';

/**
 * 验证结果
 */
export interface ValidationResult {
	/** 是否有效 */
	isValid: boolean;
	/** 问题列表 */
	issues: ValidationIssue[];
	/** 修复后的补全（如果可以自动修复） */
	fixedCompletion?: string;
	/** 置信度分数 (0-1) */
	confidenceScore: number;
}

/**
 * 验证问题
 */
export interface ValidationIssue {
	/** 问题类型 */
	type: 'non_existent_method' | 'non_existent_field' | 'undefined_variable' | 'syntax_error' | 'type_mismatch';
	/** 问题描述 */
	message: string;
	/** 问题位置（在补全文本中的位置） */
	position?: { start: number; end: number };
	/** 严重程度 */
	severity: 'error' | 'warning' | 'info';
}

/**
 * 补全验证器
 * 检查 AI 生成的代码是否有效
 */
export class CompletionValidator {

	/**
	 * 验证补全内容
	 */
	validate(completion: string, context: CompletionContext): ValidationResult {
		const issues: ValidationIssue[] = [];
		let confidenceScore = 1.0;

		// 1. 检查方法调用是否存在
		const methodIssues = this.validateMethodCalls(completion, context);
		issues.push(...methodIssues);
		if (methodIssues.some(i => i.severity === 'error')) {
			confidenceScore -= 0.3;
		}

		// 2. 检查字段访问是否存在
		const fieldIssues = this.validateFieldAccess(completion, context);
		issues.push(...fieldIssues);
		if (fieldIssues.some(i => i.severity === 'error')) {
			confidenceScore -= 0.2;
		}

		// 3. 检查变量引用
		const varIssues = this.validateVariableReferences(completion, context);
		issues.push(...varIssues);
		if (varIssues.some(i => i.severity === 'error')) {
			confidenceScore -= 0.2;
		}

		// 4. 基本语法检查
		const syntaxIssues = this.validateSyntax(completion, context.languageId);
		issues.push(...syntaxIssues);
		if (syntaxIssues.some(i => i.severity === 'error')) {
			confidenceScore -= 0.3;
		}

		// 确保分数在 0-1 范围内
		confidenceScore = Math.max(0, Math.min(1, confidenceScore));

		const hasErrors = issues.some(i => i.severity === 'error');

		return {
			isValid: !hasErrors,
			issues,
			confidenceScore
		};
	}

	/**
	 * 验证方法调用
	 */
	private validateMethodCalls(completion: string, context: CompletionContext): ValidationIssue[] {
		const issues: ValidationIssue[] = [];

		if (!context.typeDefinitions || context.typeDefinitions.length === 0) {
			return issues;
		}

		// 为每个类型创建方法集合
		const typeMethodsMap = new Map<string, Set<string>>();
		for (const typeDef of context.typeDefinitions) {
			const methods = new Set<string>(typeDef.methods);
			// 添加增强方法
			if (typeDef.enhancedMethods) {
				for (const em of typeDef.enhancedMethods) {
					methods.add(em.name);
				}
			}
			// 添加继承的方法
			if (typeDef.inheritedMethods) {
				for (const im of typeDef.inheritedMethods) {
					methods.add(im);
				}
			}
			typeMethodsMap.set(typeDef.typeName, methods);
		}

		// 检查方法引用模式 ClassName::methodName
		const methodRefPattern = /([A-Z][a-zA-Z0-9_]*)::(\w+)/g;
		let match;
		while ((match = methodRefPattern.exec(completion)) !== null) {
			const className = match[1];
			const methodName = match[2];
			const methods = typeMethodsMap.get(className);

			if (methods && !methods.has(methodName)) {
				issues.push({
					type: 'non_existent_method',
					message: `方法 ${className}::${methodName} 不存在`,
					position: { start: match.index, end: match.index + match[0].length },
					severity: 'error'
				});
			}
		}

		// 检查普通方法调用 variable.methodName()
		if (context.variableTypes && context.variableTypes.size > 0) {
			const methodCallPattern = /(\w+)\.(\w+)\s*\(/g;
			while ((match = methodCallPattern.exec(completion)) !== null) {
				const varName = match[1];
				const methodName = match[2];

				// 获取变量的类型
				const varType = context.variableTypes.get(varName);
				if (varType) {
					const baseType = varType.split('<')[0]; // 移除泛型
					const methods = typeMethodsMap.get(baseType);

					if (methods && !methods.has(methodName)) {
						// 检查是否是常见的 Java 方法（如 toString, equals 等）
						const commonMethods = ['toString', 'equals', 'hashCode', 'getClass', 'notify', 'notifyAll', 'wait'];
						if (!commonMethods.includes(methodName)) {
							issues.push({
								type: 'non_existent_method',
								message: `类型 ${baseType} 没有方法 ${methodName}()`,
								position: { start: match.index, end: match.index + match[0].length },
								severity: 'warning' // 可能是继承的方法，设为警告
							});
						}
					}
				}
			}
		}

		return issues;
	}

	/**
	 * 验证字段访问
	 */
	private validateFieldAccess(completion: string, context: CompletionContext): ValidationIssue[] {
		const issues: ValidationIssue[] = [];

		if (!context.typeDefinitions || context.typeDefinitions.length === 0) {
			return issues;
		}

		// 为每个类型创建字段集合
		const typeFieldsMap = new Map<string, Set<string>>();
		for (const typeDef of context.typeDefinitions) {
			const fields = new Set<string>(typeDef.fields);
			// 添加增强字段
			if (typeDef.enhancedFields) {
				for (const ef of typeDef.enhancedFields) {
					fields.add(ef.name);
				}
			}
			typeFieldsMap.set(typeDef.typeName, fields);
		}

		// 检查字段访问 variable.fieldName（后面不是括号）
		if (context.variableTypes && context.variableTypes.size > 0) {
			const fieldAccessPattern = /(\w+)\.(\w+)(?!\s*\()/g;
			let match;
			while ((match = fieldAccessPattern.exec(completion)) !== null) {
				const varName = match[1];
				const fieldName = match[2];

				// 跳过方法链中的调用
				if (/^\s*\(/.test(completion.substring(match.index + match[0].length))) {
					continue;
				}

				// 获取变量的类型
				const varType = context.variableTypes.get(varName);
				if (varType) {
					const baseType = varType.split('<')[0];
					const fields = typeFieldsMap.get(baseType);
					const methods = new Set<string>();

					// 也检查是否是 getter 方法的简写（某些语言支持）
					const typeDef = context.typeDefinitions.find(t => t.typeName === baseType);
					if (typeDef?.methods) {
						for (const m of typeDef.methods) {
							methods.add(m);
						}
					}

					// 如果既不是字段也不是方法
					if (fields && !fields.has(fieldName) && !methods.has(fieldName)) {
						issues.push({
							type: 'non_existent_field',
							message: `类型 ${baseType} 没有字段 ${fieldName}`,
							position: { start: match.index, end: match.index + match[0].length },
							severity: 'warning'
						});
					}
				}
			}
		}

		return issues;
	}

	/**
	 * 验证变量引用
	 */
	private validateVariableReferences(completion: string, context: CompletionContext): ValidationIssue[] {
		const issues: ValidationIssue[] = [];

		// 收集所有已知的变量名
		const knownVariables = new Set<string>();

		// 从变量类型映射
		if (context.variableTypes) {
			for (const varName of context.variableTypes.keys()) {
				knownVariables.add(varName);
			}
		}

		// 从方法参数
		if (context.methodParams) {
			for (const param of context.methodParams) {
				const paramMatch = param.match(/\w+\s+(\w+)$/);
				if (paramMatch) {
					knownVariables.add(paramMatch[1]);
				}
			}
		}

		// 从类字段
		if (context.currentClassFields) {
			for (const field of context.currentClassFields) {
				const fieldMatch = field.match(/\w+\s+(\w+)$/);
				if (fieldMatch) {
					knownVariables.add(fieldMatch[1]);
				}
			}
		}

		// 添加常见关键字和 this/super
		const keywords = ['this', 'super', 'null', 'true', 'false', 'new', 'return', 'if', 'else', 'for', 'while', 'switch', 'case', 'break', 'continue', 'try', 'catch', 'finally', 'throw', 'throws', 'class', 'interface', 'extends', 'implements', 'import', 'package', 'public', 'private', 'protected', 'static', 'final', 'void', 'int', 'long', 'float', 'double', 'boolean', 'char', 'byte', 'short', 'String'];
		for (const kw of keywords) {
			knownVariables.add(kw);
		}

		// 如果没有足够的上下文，跳过验证
		if (knownVariables.size < 5) {
			return issues;
		}

		// 检查补全中的变量引用
		// 注意：这是一个简化的检查，可能有误报
		const identifierPattern = /\b([a-z][a-zA-Z0-9_]*)\b(?!\s*[:(])/g;
		let match;
		while ((match = identifierPattern.exec(completion)) !== null) {
			const identifier = match[1];

			// 跳过已知变量和短标识符
			if (knownVariables.has(identifier) || identifier.length < 3) {
				continue;
			}

			// 跳过看起来像类型名的标识符
			if (/^[A-Z]/.test(identifier)) {
				continue;
			}

			// 检查是否在补全本身中定义
			const defPattern = new RegExp(`\\b(?:var|let|const|int|String|\\w+)\\s+${identifier}\\b`);
			if (defPattern.test(completion.substring(0, match.index))) {
				continue;
			}

			// 这可能是一个未定义的变量
			// 但由于可能有很多误报，只记录为 info 级别
			issues.push({
				type: 'undefined_variable',
				message: `变量 ${identifier} 可能未定义`,
				position: { start: match.index, end: match.index + identifier.length },
				severity: 'info'
			});
		}

		return issues;
	}

	/**
	 * 基本语法验证
	 */
	private validateSyntax(completion: string, languageId: string): ValidationIssue[] {
		const issues: ValidationIssue[] = [];

		// 检查括号匹配
		const bracketPairs: { [key: string]: string } = { '(': ')', '{': '}', '[': ']' };
		const stack: string[] = [];

		for (let i = 0; i < completion.length; i++) {
			const char = completion[i];
			if (char in bracketPairs) {
				stack.push(bracketPairs[char]);
			} else if (Object.values(bracketPairs).includes(char)) {
				if (stack.length === 0 || stack.pop() !== char) {
					issues.push({
						type: 'syntax_error',
						message: `括号不匹配: ${char}`,
						position: { start: i, end: i + 1 },
						severity: 'warning' // 可能是部分代码，设为警告
					});
				}
			}
		}

		// 未闭合的括号
		if (stack.length > 0) {
			issues.push({
				type: 'syntax_error',
				message: `括号未闭合: 缺少 ${stack.join(', ')}`,
				severity: 'info' // 部分补全可能正常
			});
		}

		// Java/TypeScript 特定检查
		if (['java', 'typescript', 'javascript'].includes(languageId)) {
			// 检查分号（对于完整语句）
			const lines = completion.split('\n');
			for (const line of lines) {
				const trimmed = line.trim();
				// 检查是否是完整语句但缺少分号
				if (trimmed && !trimmed.endsWith(';') && !trimmed.endsWith('{') &&
					!trimmed.endsWith('}') && !trimmed.endsWith(',') &&
					!trimmed.startsWith('//') && !trimmed.startsWith('/*') &&
					!trimmed.startsWith('*') && !trimmed.startsWith('if') &&
					!trimmed.startsWith('else') && !trimmed.startsWith('for') &&
					!trimmed.startsWith('while') && !trimmed.startsWith('switch') &&
					!trimmed.startsWith('try') && !trimmed.startsWith('catch') &&
					!trimmed.startsWith('finally') && !trimmed.startsWith('@') &&
					/^\w+.*\)$/.test(trimmed)) {
					// 可能是方法调用缺少分号，但不一定是错误
					// 因为可能是多行链式调用的一部分
				}
			}
		}

		return issues;
	}

	/**
	 * 检查补全是否应该被拒绝（有严重问题）
	 */
	shouldReject(result: ValidationResult): boolean {
		// 如果有多个严重错误，拒绝
		const errorCount = result.issues.filter(i => i.severity === 'error').length;
		if (errorCount >= 2) {
			return true;
		}

		// 如果置信度太低，拒绝
		if (result.confidenceScore < 0.5) {
			return true;
		}

		return false;
	}
}
