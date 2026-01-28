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
	ILspTypeDefinitionService,
	TypeDefinitionResult,
	TypeDefinitionLocation,
} from '../common/lsp/lspTypeDefinition.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { getTypeDefinitionsAtPosition } from '../../../../editor/contrib/gotoSymbol/browser/goToSymbol.js';

/**
 * LSP Type Definition 服务实现
 * 基于 VS Code 的 TypeDefinitionProvider 系统
 */
export class LspTypeDefinitionService extends Disposable implements ILspTypeDefinitionService {

	declare readonly _serviceBrand: undefined;

	constructor(
		@IModelService private readonly modelService: IModelService,
		@ILanguageFeaturesService private readonly languageFeaturesService: ILanguageFeaturesService,
	) {
		super();
		console.log('[LspTypeDefinitionService] 服务已初始化');
	}

	/**
	 * 获取类型定义位置
	 */
	async getTypeDefinition(filePath: string, line: number, column: number): Promise<TypeDefinitionResult | null> {
		try {
			const uri = URI.file(filePath);
			const model = this.modelService.getModel(uri);

			if (!model) {
				console.warn(`[LspTypeDefinitionService] 文件未打开: ${filePath}`);
				return null;
			}

			// 创建位置
			const position = new Position(line, column);

			// 获取符号名
			const wordAtPosition = model.getWordAtPosition(position);
			const symbol = wordAtPosition ? wordAtPosition.word : '(未知符号)';

			// 使用helper函数调用Type Definition Provider
			const definitions = await getTypeDefinitionsAtPosition(
				this.languageFeaturesService.typeDefinitionProvider,
				model,
				position,
				false,
				CancellationToken.None
			);

			console.log(`[LspTypeDefinitionService] 获取类型定义: ${filePath}:${line}:${column}, 符号="${symbol}", 共 ${definitions.length} 个`);

			if (definitions.length === 0) {
				return {
					symbol,
					queryLocation: { filePath, line, column },
					typeDefinitions: [],
				};
			}

			// 转换为TypeDefinitionLocation数组
			const locations: TypeDefinitionLocation[] = definitions.map(def => ({
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
				typeDefinitions: locations,
			};
		} catch (error) {
			console.error(`[LspTypeDefinitionService] 获取类型定义失败: ${filePath}:${line}:${column}`, error);
			return null;
		}
	}
}
