/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { URI } from '../../../../base/common/uri.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import {
	ILanguageAdapter,
	languageAdapterRegistry,
	ILanguageAdapterRegistry
} from '../common/languageAdapter.js';
import {
	UnifiedCodeElements,
	ClassInfo,
	FunctionInfo,
	ImportInfo
} from '../common/codeElements.js';
import { LanguageDetector, FrameworkInfo, ProjectType } from '../common/languageDetector.js';
import { JavaAdapter } from './javaAdapter.js';
import { TypeScriptAdapter } from './typescriptAdapter.js';
import { PythonAdapter } from './pythonAdapter.js';

export const IMultiLanguageService = createDecorator<IMultiLanguageService>('multiLanguageService');

/**
 * 多语言服务接口
 */
export interface IMultiLanguageService {
	readonly _serviceBrand: undefined;

	/**
	 * 获取语言适配器注册表
	 */
	getRegistry(): ILanguageAdapterRegistry;

	/**
	 * 获取语言适配器
	 */
	getAdapter(language: string): ILanguageAdapter | undefined;

	/**
	 * 通过文件扩展名获取适配器
	 */
	getAdapterByExtension(extension: string): ILanguageAdapter | undefined;

	/**
	 * 检测文件语言
	 */
	detectLanguage(fileUri: URI): Promise<string | undefined>;

	/**
	 * 检测项目主要语言
	 */
	detectPrimaryLanguage(workspaceFolder: URI, token?: CancellationToken): Promise<string | undefined>;

	/**
	 * 检测项目框架
	 */
	detectFramework(workspaceFolder: URI, token?: CancellationToken): Promise<FrameworkInfo[]>;

	/**
	 * 检测项目类型
	 */
	detectProjectType(workspaceFolder: URI, token?: CancellationToken): Promise<ProjectType>;

	/**
	 * 提取代码元素
	 */
	extractElements(fileUri: URI, code: string, token?: CancellationToken): Promise<UnifiedCodeElements | null>;

	/**
	 * 提取方法/函数
	 */
	extractMethod(fileUri: URI, code: string, methodName: string, token?: CancellationToken): Promise<FunctionInfo | null>;

	/**
	 * 提取类
	 */
	extractClass(fileUri: URI, code: string, className: string, token?: CancellationToken): Promise<ClassInfo | null>;

	/**
	 * 提取导入语句
	 */
	extractImports(fileUri: URI, code: string, token?: CancellationToken): Promise<ImportInfo[]>;

	/**
	 * 检测框架（从代码）
	 */
	detectFrameworkFromCode(fileUri: URI, code: string, token?: CancellationToken): Promise<string[]>;

	/**
	 * 格式化代码
	 */
	formatCode(fileUri: URI, code: string, token?: CancellationToken): Promise<string>;

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
 * 多语言服务实现
 */
class MultiLanguageService extends Disposable implements IMultiLanguageService {
	readonly _serviceBrand: undefined;

	private languageDetector: LanguageDetector;

	constructor(
		@IFileService private readonly fileService: IFileService
	) {
		super();

		// 创建语言检测器
		this.languageDetector = new LanguageDetector(fileService);

		// 注册所有语言适配器
		this.registerAdapters();
	}

	/**
	 * 注册所有语言适配器
	 */
	private registerAdapters(): void {
		// 注册 Java 适配器
		languageAdapterRegistry.registerAdapter(new JavaAdapter());

		// 注册 TypeScript 适配器
		languageAdapterRegistry.registerAdapter(new TypeScriptAdapter());

		// 注册 Python 适配器
		languageAdapterRegistry.registerAdapter(new PythonAdapter());
	}

	getRegistry(): ILanguageAdapterRegistry {
		return languageAdapterRegistry;
	}

	getAdapter(language: string): ILanguageAdapter | undefined {
		return languageAdapterRegistry.getAdapter(language);
	}

	getAdapterByExtension(extension: string): ILanguageAdapter | undefined {
		return languageAdapterRegistry.getAdapterByExtension(extension);
	}

	async detectLanguage(fileUri: URI): Promise<string | undefined> {
		// 首先尝试通过扩展名检测
		const language = this.languageDetector.detectLanguageByExtension(fileUri);
		if (language) {
			return language;
		}

		// 如果扩展名检测失败，读取文件内容进行检测
		try {
			const fileContent = await this.fileService.readFile(fileUri);
			const content = fileContent.value.toString();
			return this.languageDetector.detectLanguageByContent(content);
		} catch (error) {
			console.warn('[Multi-Language Service] Failed to detect language:', error);
			return undefined;
		}
	}

	async detectPrimaryLanguage(workspaceFolder: URI, token?: CancellationToken): Promise<string | undefined> {
		return this.languageDetector.detectPrimaryLanguage(workspaceFolder, token);
	}

	async detectFramework(workspaceFolder: URI, token?: CancellationToken): Promise<FrameworkInfo[]> {
		return this.languageDetector.detectFramework(workspaceFolder, token);
	}

	async detectProjectType(workspaceFolder: URI, token?: CancellationToken): Promise<ProjectType> {
		return this.languageDetector.detectProjectType(workspaceFolder, token);
	}

	async extractElements(fileUri: URI, code: string, token?: CancellationToken): Promise<UnifiedCodeElements | null> {
		const language = await this.detectLanguage(fileUri);
		if (!language) {
			console.warn('[Multi-Language Service] Cannot detect language for file:', fileUri.toString());
			return null;
		}

		const adapter = this.getAdapter(language);
		if (!adapter) {
			console.warn('[Multi-Language Service] No adapter found for language:', language);
			return null;
		}

		try {
			return await adapter.extractElementsFromCode(code, fileUri, token);
		} catch (error) {
			console.error('[Multi-Language Service] Failed to extract elements:', error);
			return null;
		}
	}

	async extractMethod(fileUri: URI, code: string, methodName: string, token?: CancellationToken): Promise<FunctionInfo | null> {
		const language = await this.detectLanguage(fileUri);
		if (!language) {
			return null;
		}

		const adapter = this.getAdapter(language);
		if (!adapter) {
			return null;
		}

		try {
			return await adapter.extractMethod(code, methodName, token);
		} catch (error) {
			console.error('[Multi-Language Service] Failed to extract method:', error);
			return null;
		}
	}

	async extractClass(fileUri: URI, code: string, className: string, token?: CancellationToken): Promise<ClassInfo | null> {
		const language = await this.detectLanguage(fileUri);
		if (!language) {
			return null;
		}

		const adapter = this.getAdapter(language);
		if (!adapter) {
			return null;
		}

		try {
			return await adapter.extractClass(code, className, token);
		} catch (error) {
			console.error('[Multi-Language Service] Failed to extract class:', error);
			return null;
		}
	}

	async extractImports(fileUri: URI, code: string, token?: CancellationToken): Promise<ImportInfo[]> {
		const language = await this.detectLanguage(fileUri);
		if (!language) {
			return [];
		}

		const adapter = this.getAdapter(language);
		if (!adapter) {
			return [];
		}

		try {
			return await adapter.extractImports(code, token);
		} catch (error) {
			console.error('[Multi-Language Service] Failed to extract imports:', error);
			return [];
		}
	}

	async detectFrameworkFromCode(fileUri: URI, code: string, token?: CancellationToken): Promise<string[]> {
		const language = await this.detectLanguage(fileUri);
		if (!language) {
			return [];
		}

		const adapter = this.getAdapter(language);
		if (!adapter) {
			return [];
		}

		try {
			const imports = await adapter.extractImports(code, token);
			return await adapter.detectFramework(code, imports, token);
		} catch (error) {
			console.error('[Multi-Language Service] Failed to detect framework:', error);
			return [];
		}
	}

	async formatCode(fileUri: URI, code: string, token?: CancellationToken): Promise<string> {
		const language = await this.detectLanguage(fileUri);
		if (!language) {
			return code;
		}

		const adapter = this.getAdapter(language);
		if (!adapter) {
			return code;
		}

		try {
			return await adapter.formatCode(code, undefined, token);
		} catch (error) {
			console.error('[Multi-Language Service] Failed to format code:', error);
			return code;
		}
	}

	getSupportedLanguages(): string[] {
		return languageAdapterRegistry.getSupportedLanguages();
	}

	isLanguageSupported(language: string): boolean {
		return languageAdapterRegistry.isLanguageSupported(language);
	}
}

// 注册多语言服务
registerSingleton(IMultiLanguageService, MultiLanguageService, InstantiationType.Delayed);
