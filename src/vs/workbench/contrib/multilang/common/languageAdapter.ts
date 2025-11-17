/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { UnifiedCodeElements, ClassInfo, FunctionInfo, ImportInfo, FileInfo } from './codeElements.js';

// FileInfo is re-exported for use by adapters
export type { FileInfo };

/**
 * 语言适配器接口
 * 用于抽象不同编程语言的代码分析和生成
 */
export interface ILanguageAdapter {
	/**
	 * 语言标识符 (java, typescript, python, go, rust, csharp, php, ruby)
	 */
	readonly language: string;

	/**
	 * 语言显示名称
	 */
	readonly displayName: string;

	/**
	 * 支持的文件扩展名
	 */
	readonly fileExtensions: string[];

	/**
	 * 解析代码为 AST
	 * @param code 源代码
	 * @param token 取消令牌
	 * @returns AST 对象
	 */
	parseAST(code: string, token?: CancellationToken): Promise<any>;

	/**
	 * 从 AST 提取代码元素
	 * @param ast AST 对象
	 * @param fileUri 文件 URI
	 * @param token 取消令牌
	 * @returns 统一的代码元素模型
	 */
	extractElements(ast: any, fileUri: URI, token?: CancellationToken): Promise<UnifiedCodeElements>;

	/**
	 * 从源代码直接提取元素（便捷方法）
	 * @param code 源代码
	 * @param fileUri 文件 URI
	 * @param token 取消令牌
	 * @returns 统一的代码元素模型
	 */
	extractElementsFromCode(code: string, fileUri: URI, token?: CancellationToken): Promise<UnifiedCodeElements>;

	/**
	 * 生成代码
	 * @param template 代码模板
	 * @param data 模板数据
	 * @param token 取消令牌
	 * @returns 生成的代码
	 */
	generateCode(template: CodeTemplate, data: any, token?: CancellationToken): Promise<string>;

	/**
	 * 格式化代码
	 * @param code 源代码
	 * @param options 格式化选项
	 * @param token 取消令牌
	 * @returns 格式化后的代码
	 */
	formatCode(code: string, options?: FormatOptions, token?: CancellationToken): Promise<string>;

	/**
	 * 验证代码语法
	 * @param code 源代码
	 * @param token 取消令牌
	 * @returns 语法错误列表
	 */
	validateSyntax(code: string, token?: CancellationToken): Promise<SyntaxError[]>;

	/**
	 * 提取方法/函数
	 * @param code 源代码
	 * @param methodName 方法名称
	 * @param token 取消令牌
	 * @returns 方法信息
	 */
	extractMethod(code: string, methodName: string, token?: CancellationToken): Promise<FunctionInfo | null>;

	/**
	 * 提取类/接口
	 * @param code 源代码
	 * @param className 类名
	 * @param token 取消令牌
	 * @returns 类信息
	 */
	extractClass(code: string, className: string, token?: CancellationToken): Promise<ClassInfo | null>;

	/**
	 * 提取导入语句
	 * @param code 源代码
	 * @param token 取消令牌
	 * @returns 导入信息列表
	 */
	extractImports(code: string, token?: CancellationToken): Promise<ImportInfo[]>;

	/**
	 * 检测框架
	 * @param code 源代码
	 * @param imports 导入语句
	 * @param token 取消令牌
	 * @returns 框架名称
	 */
	detectFramework(code: string, imports: ImportInfo[], token?: CancellationToken): Promise<string[]>;
}

/**
 * 代码模板
 */
export interface CodeTemplate {
	/**
	 * 模板类型 (class, method, interface, etc.)
	 */
	type: 'class' | 'method' | 'interface' | 'enum' | 'variable' | 'import' | 'custom';

	/**
	 * 模板内容
	 */
	template: string;

	/**
	 * 模板元数据
	 */
	metadata?: {
		name?: string;
		description?: string;
		tags?: string[];
	};
}

/**
 * 格式化选项
 */
export interface FormatOptions {
	/**
	 * 缩进大小
	 */
	indentSize?: number;

	/**
	 * 使用制表符
	 */
	useTabs?: boolean;

	/**
	 * 行尾字符
	 */
	endOfLine?: 'lf' | 'crlf' | 'auto';

	/**
	 * 最大行长度
	 */
	maxLineLength?: number;

	/**
	 * 是否在末尾添加新行
	 */
	insertFinalNewline?: boolean;

	/**
	 * 是否修剪尾随空格
	 */
	trimTrailingWhitespace?: boolean;
}

/**
 * 语法错误
 */
export interface SyntaxError {
	/**
	 * 错误消息
	 */
	message: string;

	/**
	 * 行号 (1-based)
	 */
	line: number;

	/**
	 * 列号 (1-based)
	 */
	column: number;

	/**
	 * 错误长度
	 */
	length?: number;

	/**
	 * 严重程度
	 */
	severity: 'error' | 'warning' | 'info';

	/**
	 * 错误代码
	 */
	code?: string;
}

/**
 * 语言适配器注册表
 */
export interface ILanguageAdapterRegistry {
	/**
	 * 注册语言适配器
	 */
	registerAdapter(adapter: ILanguageAdapter): void;

	/**
	 * 获取语言适配器
	 */
	getAdapter(language: string): ILanguageAdapter | undefined;

	/**
	 * 通过文件扩展名获取适配器
	 */
	getAdapterByExtension(extension: string): ILanguageAdapter | undefined;

	/**
	 * 获取所有支持的语言
	 */
	getSupportedLanguages(): string[];

	/**
	 * 检查是否支持某种语言
	 */
	isLanguageSupported(language: string): boolean;
}

/**
 * 语言适配器注册表实现
 */
export class LanguageAdapterRegistry implements ILanguageAdapterRegistry {
	private adapters: Map<string, ILanguageAdapter> = new Map();
	private extensionMap: Map<string, ILanguageAdapter> = new Map();

	registerAdapter(adapter: ILanguageAdapter): void {
		this.adapters.set(adapter.language, adapter);

		// 注册文件扩展名映射
		for (const ext of adapter.fileExtensions) {
			this.extensionMap.set(ext.toLowerCase(), adapter);
		}
	}

	getAdapter(language: string): ILanguageAdapter | undefined {
		return this.adapters.get(language.toLowerCase());
	}

	getAdapterByExtension(extension: string): ILanguageAdapter | undefined {
		const ext = extension.toLowerCase();
		// 移除前导点号（如果有）
		const normalizedExt = ext.startsWith('.') ? ext : `.${ext}`;
		return this.extensionMap.get(normalizedExt);
	}

	getSupportedLanguages(): string[] {
		return Array.from(this.adapters.keys());
	}

	isLanguageSupported(language: string): boolean {
		return this.adapters.has(language.toLowerCase());
	}
}

/**
 * 全局语言适配器注册表实例
 */
export const languageAdapterRegistry = new LanguageAdapterRegistry();
