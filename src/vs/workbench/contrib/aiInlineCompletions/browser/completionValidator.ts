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
 * 验证问题类型（扩展到12种）
 */
export type ValidationIssueType =
	// 原有的5种
	| 'non_existent_method'      // 不存在的方法
	| 'non_existent_field'       // 不存在的字段
	| 'undefined_variable'       // 未定义的变量
	| 'syntax_error'             // 语法错误
	| 'type_mismatch'            // 类型不匹配
	// 新增的7种
	| 'framework_violation'      // 框架规则违反
	| 'access_modifier_violation'// 访问修饰符违反
	| 'exception_handling_missing'// 异常处理缺失
	| 'resource_leak'            // 资源泄漏风险
	| 'deprecated_api'           // 废弃API使用
	| 'performance_antipattern'  // 性能反模式
	| 'null_safety_issue';       // 空值安全问题

/**
 * 验证问题
 */
export interface ValidationIssue {
	/** 问题类型 */
	type: ValidationIssueType;
	/** 问题描述 */
	message: string;
	/** 问题位置（在补全文本中的位置） */
	position?: { start: number; end: number };
	/** 严重程度 */
	severity: 'error' | 'warning' | 'info';
	/** 修复建议 */
	suggestion?: string;
}

/**
 * 补全验证器
 * 检查 AI 生成的代码是否有效
 */
export class CompletionValidator {

	/**
	 * 验证补全内容（12种规则）
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

		// 5. 框架规则检查（新增）
		const frameworkIssues = this.validateFrameworkRules(completion, context);
		issues.push(...frameworkIssues);
		if (frameworkIssues.some(i => i.severity === 'error')) {
			confidenceScore -= 0.2;
		}

		// 6. 访问修饰符检查（新增）
		const accessIssues = this.validateAccessModifiers(completion, context);
		issues.push(...accessIssues);
		if (accessIssues.some(i => i.severity === 'error')) {
			confidenceScore -= 0.15;
		}

		// 7. 异常处理检查（新增）
		const exceptionIssues = this.validateExceptionHandling(completion, context);
		issues.push(...exceptionIssues);
		if (exceptionIssues.some(i => i.severity === 'warning')) {
			confidenceScore -= 0.1;
		}

		// 8. 资源泄漏检查（新增）
		const resourceIssues = this.validateResourceLeak(completion, context);
		issues.push(...resourceIssues);
		if (resourceIssues.some(i => i.severity === 'warning')) {
			confidenceScore -= 0.1;
		}

		// 9. 废弃API检查（新增）
		const deprecatedIssues = this.validateDeprecatedAPI(completion, context);
		issues.push(...deprecatedIssues);
		if (deprecatedIssues.some(i => i.severity === 'warning')) {
			confidenceScore -= 0.05;
		}

		// 10. 性能反模式检查（新增）
		const perfIssues = this.validatePerformanceAntipatterns(completion, context);
		issues.push(...perfIssues);
		if (perfIssues.some(i => i.severity === 'warning')) {
			confidenceScore -= 0.1;
		}

		// 11. 空值安全检查（新增）
		const nullIssues = this.validateNullSafety(completion, context);
		issues.push(...nullIssues);
		if (nullIssues.some(i => i.severity === 'warning')) {
			confidenceScore -= 0.1;
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

	// ========== 新增的验证方法 ==========

	/**
	 * 5. 框架规则验证
	 */
	private validateFrameworkRules(completion: string, context: CompletionContext): ValidationIssue[] {
		const issues: ValidationIssue[] = [];

		if (!context.frameworkContext) {
			return issues;
		}

		const framework = context.frameworkContext.name;

		// Spring 框架规则
		if (framework === 'Spring') {
			// 检查 Controller 中直接使用 Repository
			if (context.frameworkContext.contextType === 'Controller') {
				if (/@Autowired\s+.*Repository\b/.test(completion)) {
					issues.push({
						type: 'framework_violation',
						message: 'Controller 不应直接注入 Repository，应通过 Service 层',
						severity: 'warning',
						suggestion: '请注入对应的 Service 而非直接使用 Repository'
					});
				}
			}

			// 检查字段注入（应使用构造函数注入）
			if (/@Autowired\s+private\s+\w+/.test(completion)) {
				issues.push({
					type: 'framework_violation',
					message: '推荐使用构造函数注入而非字段注入',
					severity: 'info',
					suggestion: '使用 @RequiredArgsConstructor 或构造函数注入'
				});
			}

			// 检查事务注解在 private 方法上
			if (/@Transactional[\s\S]*?private\s+\w+/.test(completion)) {
				issues.push({
					type: 'framework_violation',
					message: '@Transactional 注解在 private 方法上无效',
					severity: 'error',
					suggestion: '将方法改为 public 或通过其他 public 方法调用'
				});
			}
		}

		// Vue 框架规则
		if (framework === 'Vue') {
			// 检查直接修改 props
			if (/props\.\w+\s*=/.test(completion)) {
				issues.push({
					type: 'framework_violation',
					message: '不应直接修改 props',
					severity: 'error',
					suggestion: '使用 emit 事件通知父组件修改'
				});
			}

			// 检查 ref 值未使用 .value
			if (/const\s+\w+\s*=\s*ref\(/.test(completion)) {
				const refMatch = completion.match(/const\s+(\w+)\s*=\s*ref\(/);
				if (refMatch) {
					const refName = refMatch[1];
					// 检查后续是否直接使用了 refName 而非 refName.value
					const usagePattern = new RegExp(`\\b${refName}\\b(?!\\.value)`, 'g');
					const valuePattern = new RegExp(`\\b${refName}\\.value\\b`, 'g');
					const directUsages = (completion.match(usagePattern) || []).length;
					const valueUsages = (completion.match(valuePattern) || []).length;

					// 减去定义处的使用
					if (directUsages > 1 && valueUsages === 0) {
						issues.push({
							type: 'framework_violation',
							message: `ref 变量 ${refName} 应使用 .value 访问`,
							severity: 'warning',
							suggestion: `使用 ${refName}.value 访问响应式数据`
						});
					}
				}
			}
		}

		// React 框架规则
		if (framework === 'React') {
			// 检查直接修改 state
			if (/this\.state\.\w+\s*=/.test(completion)) {
				issues.push({
					type: 'framework_violation',
					message: '不应直接修改 state',
					severity: 'error',
					suggestion: '使用 this.setState() 或 useState hook'
				});
			}

			// 检查 hooks 在条件语句中使用
			if (/if\s*\([^)]*\)\s*\{[^}]*use[A-Z]\w*\(/.test(completion)) {
				issues.push({
					type: 'framework_violation',
					message: 'Hooks 不能在条件语句中使用',
					severity: 'error',
					suggestion: '将 Hook 调用移到组件顶层'
				});
			}
		}

		return issues;
	}

	/**
	 * 6. 访问修饰符验证
	 */
	private validateAccessModifiers(completion: string, context: CompletionContext): ValidationIssue[] {
		const issues: ValidationIssue[] = [];

		if (!context.typeDefinitions || context.languageId !== 'java') {
			return issues;
		}

		// 检查是否访问了 private 成员
		for (const typeDef of context.typeDefinitions) {
			if (typeDef.enhancedFields) {
				for (const field of typeDef.enhancedFields) {
					if (field.accessModifier === 'private') {
						// 检查是否直接访问了 private 字段
						const pattern = new RegExp(`\\b\\w+\\.${field.name}\\b(?!\\s*\\()`);
						if (pattern.test(completion)) {
							issues.push({
								type: 'access_modifier_violation',
								message: `字段 ${field.name} 是 private 的，不能直接访问`,
								severity: 'warning',
								suggestion: `使用 getter 方法 get${field.name.charAt(0).toUpperCase() + field.name.slice(1)}()`
							});
						}
					}
				}
			}
		}

		return issues;
	}

	/**
	 * 7. 异常处理验证
	 */
	private validateExceptionHandling(completion: string, context: CompletionContext): ValidationIssue[] {
		const issues: ValidationIssue[] = [];

		// 检查是否有 throws 声明但没有处理
		if (context.typeDefinitions) {
			for (const typeDef of context.typeDefinitions) {
				if (typeDef.enhancedMethods) {
					for (const method of typeDef.enhancedMethods) {
						if (method.exceptions && method.exceptions.length > 0) {
							// 检查是否调用了这个方法
							const callPattern = new RegExp(`\\b${method.name}\\s*\\(`);
							if (callPattern.test(completion)) {
								// 检查是否在 try-catch 中
								const hasTryCatch = /try\s*\{/.test(completion);
								if (!hasTryCatch) {
									issues.push({
										type: 'exception_handling_missing',
										message: `方法 ${method.name} 可能抛出 ${method.exceptions.join(', ')}，需要处理`,
										severity: 'info',
										suggestion: '添加 try-catch 块或在方法签名中声明 throws'
									});
								}
							}
						}
					}
				}
			}
		}

		// 检查空的 catch 块
		if (/catch\s*\([^)]*\)\s*\{\s*\}/.test(completion)) {
			issues.push({
				type: 'exception_handling_missing',
				message: '空的 catch 块会吞掉异常',
				severity: 'warning',
				suggestion: '至少添加日志记录或重新抛出异常'
			});
		}

		return issues;
	}

	/**
	 * 8. 资源泄漏验证
	 */
	private validateResourceLeak(completion: string, context: CompletionContext): ValidationIssue[] {
		const issues: ValidationIssue[] = [];

		// 检查是否创建了资源但未关闭
		const resourcePatterns = [
			{ pattern: /new\s+(?:File)?InputStream\s*\(/, name: 'InputStream' },
			{ pattern: /new\s+(?:File)?OutputStream\s*\(/, name: 'OutputStream' },
			{ pattern: /new\s+BufferedReader\s*\(/, name: 'BufferedReader' },
			{ pattern: /new\s+BufferedWriter\s*\(/, name: 'BufferedWriter' },
			{ pattern: /getConnection\s*\(/, name: 'Connection' },
			{ pattern: /prepareStatement\s*\(/, name: 'PreparedStatement' },
			{ pattern: /createStatement\s*\(/, name: 'Statement' }
		];

		for (const { pattern, name } of resourcePatterns) {
			if (pattern.test(completion)) {
				// 检查是否使用了 try-with-resources
				const hasTryWithResources = /try\s*\([^)]*\)/.test(completion);
				// 检查是否有 .close() 调用
				const hasClose = /\.close\s*\(/.test(completion);
				// 检查是否在 finally 块中
				const hasFinally = /finally\s*\{/.test(completion);

				if (!hasTryWithResources && !hasClose && !hasFinally) {
					issues.push({
						type: 'resource_leak',
						message: `${name} 资源可能未正确关闭`,
						severity: 'warning',
						suggestion: '使用 try-with-resources 语句自动关闭资源'
					});
				}
			}
		}

		return issues;
	}

	/**
	 * 9. 废弃API验证
	 */
	private validateDeprecatedAPI(completion: string, context: CompletionContext): ValidationIssue[] {
		const issues: ValidationIssue[] = [];

		// 常见的废弃 API 列表
		const deprecatedAPIs = [
			{ pattern: /new\s+Date\s*\(\s*\d+,\s*\d+,\s*\d+\)/, name: 'Date(int, int, int)', suggestion: '使用 LocalDate.of()' },
			{ pattern: /\.getYear\s*\(\s*\)/, name: 'getYear()', suggestion: '使用 Calendar 或 LocalDate' },
			{ pattern: /StringBuffer\b/, name: 'StringBuffer', suggestion: '单线程场景使用 StringBuilder' },
			{ pattern: /\.size\s*\(\s*\)\s*[><=]=?\s*0/, name: 'size() > 0', suggestion: '使用 isEmpty()' },
			{ pattern: /\.equals\s*\(\s*null\s*\)/, name: 'equals(null)', suggestion: '使用 == null' },
			{ pattern: /System\.out\.println/, name: 'System.out.println', suggestion: '使用日志框架（如 SLF4J）' }
		];

		for (const { pattern, name, suggestion } of deprecatedAPIs) {
			if (pattern.test(completion)) {
				issues.push({
					type: 'deprecated_api',
					message: `${name} 已不推荐使用`,
					severity: 'info',
					suggestion
				});
			}
		}

		return issues;
	}

	/**
	 * 10. 性能反模式验证
	 */
	private validatePerformanceAntipatterns(completion: string, context: CompletionContext): ValidationIssue[] {
		const issues: ValidationIssue[] = [];

		// 检查字符串拼接在循环中
		if (/for\s*\([^)]*\)\s*\{[^}]*\+\s*=\s*"/.test(completion) ||
			/while\s*\([^)]*\)\s*\{[^}]*\+\s*=\s*"/.test(completion)) {
			issues.push({
				type: 'performance_antipattern',
				message: '循环中使用字符串拼接会导致性能问题',
				severity: 'warning',
				suggestion: '使用 StringBuilder 替代字符串拼接'
			});
		}

		// 检查 N+1 查询模式
		if (/for\s*\([^)]*\)\s*\{[^}]*\.(find|get|select|query)\w*\s*\(/.test(completion)) {
			issues.push({
				type: 'performance_antipattern',
				message: '可能存在 N+1 查询问题',
				severity: 'warning',
				suggestion: '考虑使用批量查询或 JOIN'
			});
		}

		// 检查在循环中创建正则表达式
		if (/for\s*\([^)]*\)\s*\{[^}]*Pattern\.compile\s*\(/.test(completion) ||
			/while\s*\([^)]*\)\s*\{[^}]*Pattern\.compile\s*\(/.test(completion)) {
			issues.push({
				type: 'performance_antipattern',
				message: '正则表达式应在循环外编译',
				severity: 'warning',
				suggestion: '将 Pattern.compile() 移到循环外部'
			});
		}

		// 检查使用 + 连接多个字符串
		const stringConcats = completion.match(/"\s*\+\s*\w+\s*\+\s*"/g);
		if (stringConcats && stringConcats.length >= 3) {
			issues.push({
				type: 'performance_antipattern',
				message: '多个字符串连接建议使用 StringBuilder 或 String.format',
				severity: 'info',
				suggestion: '使用 String.format() 或 StringBuilder'
			});
		}

		return issues;
	}

	/**
	 * 11. 空值安全验证
	 */
	private validateNullSafety(completion: string, context: CompletionContext): ValidationIssue[] {
		const issues: ValidationIssue[] = [];

		// 检查可能的空指针解引用
		// 检查 .method() 调用链过长而没有空值检查
		const chainedCalls = completion.match(/\w+(?:\.\w+\([^)]*\)){3,}/g);
		if (chainedCalls) {
			for (const chain of chainedCalls) {
				if (!/Optional|\.orElse|\.ifPresent|\?\./i.test(chain)) {
					issues.push({
						type: 'null_safety_issue',
						message: '长调用链可能导致空指针异常',
						severity: 'info',
						suggestion: '考虑使用 Optional 或添加空值检查'
					});
					break;
				}
			}
		}

		// 检查直接调用可能返回 null 的方法后立即使用结果
		const nullableMethods = ['get', 'find', 'getProperty', 'getAttribute', 'getParameter'];
		for (const method of nullableMethods) {
			const pattern = new RegExp(`\\.${method}\\s*\\([^)]*\\)\\s*\\.\\w+\\s*\\(`);
			if (pattern.test(completion)) {
				issues.push({
					type: 'null_safety_issue',
					message: `${method}() 可能返回 null，直接调用其方法可能导致 NPE`,
					severity: 'warning',
					suggestion: '添加空值检查或使用 Optional'
				});
			}
		}

		// TypeScript/JavaScript 特定：检查未使用可选链
		if (['typescript', 'javascript', 'typescriptreact', 'javascriptreact'].includes(context.languageId)) {
			// 检查是否可以使用可选链
			if (/\w+\s*&&\s*\w+\.\w+/.test(completion)) {
				issues.push({
					type: 'null_safety_issue',
					message: '可以使用可选链操作符 (?.) 简化代码',
					severity: 'info',
					suggestion: '使用 obj?.property 替代 obj && obj.property'
				});
			}
		}

		return issues;
	}
}
