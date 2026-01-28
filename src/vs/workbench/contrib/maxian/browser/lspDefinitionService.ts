/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { IModelService } from '../../../../editor/common/services/model.js';
import { ILanguageFeaturesService } from '../../../../editor/common/services/languageFeatures.js';
import { Position } from '../../../../editor/common/core/position.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import {
	ILspDefinitionService,
	DefinitionResult,
	DefinitionLocation,
} from '../common/lsp/lspDefinition.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { getDefinitionsAtPosition } from '../../../../editor/contrib/gotoSymbol/browser/goToSymbol.js';

/**
 * LSP Definition 服务实现
 * 基于 VS Code 的 DefinitionProvider 系统
 */
export class LspDefinitionService extends Disposable implements ILspDefinitionService {

	declare readonly _serviceBrand: undefined;

	constructor(
		@IModelService private readonly modelService: IModelService,
		@ILanguageFeaturesService private readonly languageFeaturesService: ILanguageFeaturesService,
	) {
		super();
		console.log('[LspDefinitionService] 服务已初始化');
	}

	/**
	 * 获取符号定义位置
	 */
	async getDefinition(filePath: string, line: number, column: number): Promise<DefinitionResult | null> {
		try {
			const uri = URI.file(filePath);
			const model = this.modelService.getModel(uri);

			if (!model) {
				console.warn(`[LspDefinitionService] 文件未打开: ${filePath}`);
				return null;
			}

			// 创建位置
			const position = new Position(line, column);

			// 获取光标位置的单词（作为符号名）
			const wordAtPosition = model.getWordAtPosition(position);
			const symbol = wordAtPosition ? wordAtPosition.word : '(未知符号)';

			// 使用helper函数调用Definition Provider
			const definitions = await getDefinitionsAtPosition(
				this.languageFeaturesService.definitionProvider,
				model,
				position,
				false,
				CancellationToken.None
			);

			console.log(`[LspDefinitionService] 获取定义: ${filePath}:${line}:${column}, 符号="${symbol}", 共 ${definitions.length} 个`);

			if (definitions.length === 0) {
				return {
					symbol,
					queryLocation: { filePath, line, column },
					definitions: [],
				};
			}

			// 转换为DefinitionLocation数组
			const locations: DefinitionLocation[] = definitions.map(def => ({
				uri: def.uri.fsPath,
				range: {
					startLine: def.range.startLineNumber,
					startColumn: def.range.startColumn,
					endLine: def.range.endLineNumber,
					endColumn: def.range.endColumn,
				},
			}));

			return {
				symbol,
				queryLocation: { filePath, line, column },
				definitions: locations,
			};
		} catch (error) {
			console.error(`[LspDefinitionService] 获取定义失败: ${filePath}:${line}:${column}`, error);
			return null;
		}
	}
}
