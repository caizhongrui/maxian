/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { IModelService } from '../../../../editor/common/services/model.js';
import { ILanguageFeaturesService } from '../../../../editor/common/services/languageFeatures.js';
import { Position } from '../../../../editor/common/core/position.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { getHoversPromise } from '../../../../editor/contrib/hover/browser/getHover.js';
import {
	ILspHoverService,
	HoverInfo,
	HoverContent,
	HoverRange,
} from '../common/lsp/lspHover.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { IMarkdownString, isMarkdownString } from '../../../../base/common/htmlContent.js';

/**
 * LSP Hover 服务实现
 * 基于 VS Code 的 HoverProvider 系统
 *
 * 功能：
 * - 调用语言服务器获取Hover信息
 * - 转换为统一的 HoverInfo 格式
 * - 支持所有语言的Hover功能
 */
export class LspHoverService extends Disposable implements ILspHoverService {

	declare readonly _serviceBrand: undefined;

	constructor(
		@IModelService private readonly modelService: IModelService,
		@ILanguageFeaturesService private readonly languageFeaturesService: ILanguageFeaturesService,
	) {
		super();
		console.log('[LspHoverService] 服务已初始化');
	}

	/**
	 * 获取指定位置的Hover信息
	 * @param filePath 文件路径
	 * @param line 行号（从1开始）
	 * @param column 列号（从1开始）
	 */
	async getHover(filePath: string, line: number, column: number): Promise<HoverInfo | null> {
		try {
			const uri = URI.file(filePath);
			const model = this.modelService.getModel(uri);

			if (!model) {
				console.warn(`[LspHoverService] 文件未打开: ${filePath}`);
				return null;
			}

			// 创建位置（VS Code使用1-based行号和列号）
			const position = new Position(line, column);

			// 调用Hover Provider获取Hover信息
			const hovers = await getHoversPromise(
				this.languageFeaturesService.hoverProvider,
				model,
				position,
				CancellationToken.None
			);

			console.log(`[LspHoverService] 获取Hover信息: ${filePath}:${line}:${column}, 共 ${hovers.length} 个`);

			if (hovers.length === 0) {
				return null;
			}

			// 转换为HoverInfo格式（合并所有hovers）
			return this.convertHoversToHoverInfo(hovers);
		} catch (error) {
			console.error(`[LspHoverService] 获取Hover信息失败: ${filePath}:${line}:${column}`, error);
			return null;
		}
	}

	/**
	 * 将VS Code的Hover数组转换为统一的HoverInfo
	 */
	private convertHoversToHoverInfo(hovers: any[]): HoverInfo {
		const contents: HoverContent[] = [];
		let range: HoverRange | undefined;

		for (const hover of hovers) {
			// 提取内容
			if (hover.contents && Array.isArray(hover.contents)) {
				for (const content of hover.contents) {
					const converted = this.convertMarkdownString(content);
					if (converted) {
						contents.push(converted);
					}
				}
			}

			// 提取范围（使用第一个hover的范围）
			if (!range && hover.range) {
				range = {
					startLine: hover.range.startLineNumber,
					startColumn: hover.range.startColumn,
					endLine: hover.range.endLineNumber,
					endColumn: hover.range.endColumn,
				};
			}
		}

		return {
			contents,
			range,
		};
	}

	/**
	 * 转换MarkdownString为HoverContent
	 */
	private convertMarkdownString(content: string | IMarkdownString): HoverContent | null {
		if (!content) {
			return null;
		}

		if (typeof content === 'string') {
			return {
				value: content,
				isTrusted: false,
			};
		}

		if (isMarkdownString(content)) {
			return {
				value: content.value,
				// 将isTrusted转换为boolean（如果是对象，则视为true）
				isTrusted: typeof content.isTrusted === 'boolean' ? content.isTrusted : !!content.isTrusted,
				supportHtml: content.supportHtml,
			};
		}

		// 其他类型，尝试转换为字符串
		return {
			value: String(content),
			isTrusted: false,
		};
	}
}
