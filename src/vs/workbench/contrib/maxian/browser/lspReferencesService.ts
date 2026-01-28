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
	ILspReferencesService,
	ReferencesResult,
	ReferenceLocation,
} from '../common/lsp/lspReferences.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { getReferencesAtPosition } from '../../../../editor/contrib/gotoSymbol/browser/goToSymbol.js';
import { LocationLink } from '../../../../editor/common/languages.js';

/**
 * LSP References 服务实现
 * 基于 VS Code 的 ReferenceProvider 系统
 */
export class LspReferencesService extends Disposable implements ILspReferencesService {

	declare readonly _serviceBrand: undefined;

	constructor(
		@IModelService private readonly modelService: IModelService,
		@ILanguageFeaturesService private readonly languageFeaturesService: ILanguageFeaturesService,
	) {
		super();
		console.log('[LspReferencesService] 服务已初始化');
	}

	/**
	 * 获取符号的所有引用
	 */
	async getReferences(filePath: string, line: number, column: number, includeDeclaration: boolean = true): Promise<ReferencesResult | null> {
		try {
			const uri = URI.file(filePath);
			const model = this.modelService.getModel(uri);

			if (!model) {
				console.warn(`[LspReferencesService] 文件未打开: ${filePath}`);
				return null;
			}

			// 创建位置
			const position = new Position(line, column);

			// 获取符号名
			const wordAtPosition = model.getWordAtPosition(position);
			const symbol = wordAtPosition ? wordAtPosition.word : '(未知符号)';

			// 使用helper函数调用References Provider
			const references = await getReferencesAtPosition(
				this.languageFeaturesService.referenceProvider,
				model,
				position,
				false, // compact
				false, // recursive
				CancellationToken.None
			);

			console.log(`[LspReferencesService] 获取引用: ${filePath}:${line}:${column}, 符号="${symbol}", 共 ${references.length} 个`);

			if (references.length === 0) {
				return {
					symbol,
					queryLocation: { filePath, line, column },
					references: [],
					referencesByFile: new Map(),
				};
			}

			// 转换为ReferenceLocation数组
			const locations: ReferenceLocation[] = references.map((ref: LocationLink) => ({
				uri: ref.uri.fsPath,
				range: {
					startLine: ref.range.startLineNumber,
					startColumn: ref.range.startColumn,
					endLine: ref.range.endLineNumber,
					endColumn: ref.range.endColumn,
				},
			}));

			// 按文件分组
			const referencesByFile = new Map<string, ReferenceLocation[]>();
			for (const loc of locations) {
				if (!referencesByFile.has(loc.uri)) {
					referencesByFile.set(loc.uri, []);
				}
				referencesByFile.get(loc.uri)!.push(loc);
			}

			return {
				symbol,
				queryLocation: { filePath, line, column },
				references: locations,
				referencesByFile,
			};
		} catch (error) {
			console.error(`[LspReferencesService] 获取引用失败: ${filePath}:${line}:${column}`, error);
			return null;
		}
	}
}
