/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { ITextModel } from '../../../../editor/common/model.js';
import { IModelService } from '../../../../editor/common/services/model.js';
import { ITextModelContentProvider, ITextModelService } from '../../../../editor/common/services/resolverService.js';
import { ILanguageService } from '../../../../editor/common/languages/language.js';

/**
 * AI 优化代码的内容提供者
 * 用于在 diff editor 中显示临时的 AI 优化代码，而不创建额外的编辑器标签页
 */
export class AIOptimizeContentProvider extends Disposable implements ITextModelContentProvider {

	// 自定义 scheme，用于 AI 优化的临时内容
	static readonly scheme = 'ai-optimize-temp';

	constructor(
		@ITextModelService textModelService: ITextModelService,
		@IModelService private readonly modelService: IModelService,
		@ILanguageService private readonly languageService: ILanguageService
	) {
		super();
		// 注册内容提供者
		this._register(textModelService.registerTextModelContentProvider(AIOptimizeContentProvider.scheme, this));
	}

	/**
	 * 提供文本模型内容
	 * 当 VS Code 需要显示某个 URI 的内容时会调用此方法
	 */
	async provideTextContent(resource: URI): Promise<ITextModel | null> {
		// 首先检查模型是否已存在
		const existing = this.modelService.getModel(resource);
		if (existing) {
			return existing;
		}

		// 如果不存在，创建一个新的空模型
		// 语言 ID 可以从 URI query 参数中获取
		const query = resource.query ? JSON.parse(resource.query) : {};
		const languageId = query.languageId || 'plaintext';

		return this.modelService.createModel('', this.languageService.createById(languageId), resource);
	}
}
