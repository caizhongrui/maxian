/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { Position } from '../../../../editor/common/core/position.js';
import { ITextModel } from '../../../../editor/common/model.js';
import { IMultiLanguageService } from '../../multilang/browser/multilang.contribution.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';

/**
 * 代码补全的上下文信息
 */
export interface CompletionContext {
	/**
	 * 文件URI
	 */
	fileUri: URI;

	/**
	 * 语言ID
	 */
	languageId: string;

	/**
	 * 光标前的代码
	 */
	prefix: string;

	/**
	 * 光标后的代码
	 */
	suffix: string;

	/**
	 * 前面的代码行
	 */
	beforeLines: string[];

	/**
	 * 后面的代码行
	 */
	afterLines: string[];

	/**
	 * 当前所在的类名(如果有)
	 */
	currentClass?: string;

	/**
	 * 当前所在的方法名(如果有)
	 */
	currentMethod?: string;

	/**
	 * 文件中的导入信息
	 */
	imports?: Array<{
		modulePath: string;
		importedNames?: string[];
	}>;

	/**
	 * 检测到的框架
	 */
	frameworks?: string[];

	/**
	 * 文件中的类列表
	 */
	classes?: Array<{
		name: string;
		methods: string[];
	}>;

	/**
	 * 文件级别的函数列表
	 */
	functions?: string[];
}

/**
 * 代码补全上下文提取器
 * 负责为AI代码补全提供丰富的上下文信息
 */
export class CompletionContextExtractor {

	constructor(
		private readonly multiLanguageService: IMultiLanguageService
	) { }

	/**
	 * 提取代码补全的完整上下文
	 */
	async extractContext(
		model: ITextModel,
		position: Position,
		token?: CancellationToken
	): Promise<CompletionContext> {

		const uri = model.uri;
		const languageId = model.getLanguageId();

		// 基础上下文：光标周围的代码
		const lineContent = model.getLineContent(position.lineNumber);
		const prefix = lineContent.substring(0, position.column - 1);
		const suffix = lineContent.substring(position.column - 1);

		// 前后代码行
		const beforeLines = this.getBeforeLines(model, position);
		const afterLines = this.getAfterLines(model, position);

		// 创建基础上下文
		const context: CompletionContext = {
			fileUri: uri,
			languageId,
			prefix,
			suffix,
			beforeLines,
			afterLines
		};

		// 尝试提取结构化代码信息
		try {
			const fileContent = model.getValue();

			// 提取代码元素
			const elements = await this.multiLanguageService.extractElements(uri, fileContent);

			if (elements) {
				// 提取导入信息
				if (elements.imports && elements.imports.length > 0) {
					context.imports = elements.imports.map(imp => ({
						modulePath: imp.modulePath,
						importedNames: imp.importedNames
					}));
				}

				// 检测框架
				const frameworks = await this.multiLanguageService.detectFrameworkFromCode(uri, fileContent);
				if (frameworks && frameworks.length > 0) {
					context.frameworks = frameworks;
				}

				// 提取类信息
				if (elements.classes && elements.classes.length > 0) {
					context.classes = elements.classes.map(cls => ({
						name: cls.name,
						methods: cls.methods.map(m => m.name)
					}));

					// 确定当前所在的类和方法
					const currentLocation = this.getCurrentLocation(
						position.lineNumber,
						elements.classes
					);
					if (currentLocation) {
						context.currentClass = currentLocation.className;
						context.currentMethod = currentLocation.methodName;
					}
				}

				// 提取函数信息
				if (elements.functions && elements.functions.length > 0) {
					context.functions = elements.functions.map(func => func.name);
				}
			}
		} catch (error) {
			console.warn('[Completion Context] Failed to extract structured info:', error);
		}

		return context;
	}

	/**
	 * 获取光标前的代码行
	 */
	private getBeforeLines(model: ITextModel, position: Position): string[] {
		const startLine = Math.max(1, position.lineNumber - 30);
		const lines: string[] = [];

		for (let i = startLine; i < position.lineNumber; i++) {
			lines.push(model.getLineContent(i));
		}

		return lines;
	}

	/**
	 * 获取光标后的代码行
	 */
	private getAfterLines(model: ITextModel, position: Position): string[] {
		const totalLines = model.getLineCount();
		const endLine = Math.min(totalLines, position.lineNumber + 30);
		const lines: string[] = [];

		for (let i = position.lineNumber + 1; i <= endLine; i++) {
			lines.push(model.getLineContent(i));
		}

		return lines;
	}

	/**
	 * 确定当前光标所在的类和方法
	 */
	private getCurrentLocation(
		lineNumber: number,
		classes: any[]
	): { className: string; methodName?: string; } | undefined {

		for (const cls of classes) {
			// 检查是否在类的范围内
			if (lineNumber >= cls.startLine && lineNumber <= cls.endLine) {
				// 查找当前所在的方法
				for (const method of cls.methods) {
					if (lineNumber >= method.startLine && lineNumber <= method.endLine) {
						return {
							className: cls.name,
							methodName: method.name
						};
					}
				}

				// 在类中但不在任何方法中
				return {
					className: cls.name
				};
			}
		}

		return undefined;
	}
}
