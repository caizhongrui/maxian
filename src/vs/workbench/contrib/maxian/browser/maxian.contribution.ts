/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize2 } from '../../../../nls.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { ViewPaneContainer } from '../../../browser/parts/views/viewPaneContainer.js';
import { IViewContainersRegistry, IViewsRegistry, Extensions as ViewExtensions, ViewContainerLocation } from '../../../common/views.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { IViewsService } from '../../../services/views/common/viewsService.js';
import { IMaxianService, MaxianService } from './maxianService.js';
import { MaxianView } from './maxianView.js';
import { ITextModelService, ITextModelContentProvider } from '../../../../editor/common/services/resolverService.js';
import { IModelService } from '../../../../editor/common/services/model.js';
import { ITextModel } from '../../../../editor/common/model.js';
import { URI } from '../../../../base/common/uri.js';
import { MAXIAN_DIFF_VIEW_URI_SCHEME } from './diffViewProvider.js';
import { CommandsRegistry } from '../../../../platform/commands/common/commands.js';
import { IAIService } from '../../../../platform/ai/common/ai.js';

// 确保ripgrep服务被注册（导入副作用）
import '../../../services/ripgrep/browser/ripgrep.contribution.js';

// 注册码弦服务
registerSingleton(IMaxianService, MaxianService, InstantiationType.Delayed);

// ====== 注册视图容器和视图 ======

// 定义视图容器ID和视图ID
const MAXIAN_VIEW_CONTAINER_ID = 'workbench.view.maxian';
const MAXIAN_VIEW_ID = 'workbench.view.maxian.mainView';

// 注册视图容器到右侧辅助栏（AuxiliaryBar）
const viewContainerRegistry = Registry.as<IViewContainersRegistry>(ViewExtensions.ViewContainersRegistry);
const maxianViewContainer = viewContainerRegistry.registerViewContainer({
	id: MAXIAN_VIEW_CONTAINER_ID,
	title: localize2('maxian.viewContainer.title', '码弦 Agent'),
	icon: Codicon.robot,
	order: 11,
	ctorDescriptor: new SyncDescriptor(ViewPaneContainer, [MAXIAN_VIEW_CONTAINER_ID, { mergeViewWithContainerWhenSingleView: true }]),
	storageId: MAXIAN_VIEW_CONTAINER_ID,
	hideIfEmpty: false
}, ViewContainerLocation.AuxiliaryBar); // 右侧边栏

// 创建视图描述符
class MaxianViewDescriptor {
	readonly id = MAXIAN_VIEW_ID;
	readonly name = localize2('maxian.view.name', '码弦');
	readonly containerIcon = maxianViewContainer.icon;
	readonly ctorDescriptor = new SyncDescriptor(MaxianView);
	readonly order = 1;
	readonly weight = 100;
	readonly collapsed = false;
	readonly canToggleVisibility = true;
	readonly hideByDefault = false;
	readonly canMoveView = true;
}

// 注册视图
const viewsRegistry = Registry.as<IViewsRegistry>(ViewExtensions.ViewsRegistry);
viewsRegistry.registerViews([new MaxianViewDescriptor()], maxianViewContainer);

// ====== 自动打开码弦视图 ======

/**
 * Workbench contribution to automatically open the Maxian view on startup
 */
class MaxianViewContribution implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.maxianView';

	constructor(
		@IViewsService private readonly viewsService: IViewsService
	) {
		// 在启动时自动打开码弦视图容器
		this.openMaxianView();
	}

	private async openMaxianView(): Promise<void> {
		try {
			// 打开码弦视图容器，这会同时显示右侧边栏
			await this.viewsService.openViewContainer(MAXIAN_VIEW_CONTAINER_ID, true);
		} catch (error) {
			// Failed to open Maxian view container
		}
	}
}

/**
 * Maxian Diff内容提供者
 * 用于为maxian-diff和maxian-modified URI scheme提供文本内容
 */
class MaxianDiffContentProvider implements IWorkbenchContribution, ITextModelContentProvider {
	static readonly ID = 'workbench.contrib.maxianDiffContentProvider';

	constructor(
		@ITextModelService textModelResolverService: ITextModelService,
		@IModelService private readonly modelService: IModelService
	) {
		// 注册maxian-diff scheme的内容提供者（用于原始内容）
		textModelResolverService.registerTextModelContentProvider(MAXIAN_DIFF_VIEW_URI_SCHEME, this);
		// 注册maxian-modified scheme的内容提供者（用于修改后的内容）
		textModelResolverService.registerTextModelContentProvider('maxian-modified', this);
	}

	provideTextContent(resource: URI): Promise<ITextModel> | null {
		if (resource.scheme === MAXIAN_DIFF_VIEW_URI_SCHEME) {
			// 从query参数中解码原始内容（使用decodeURIComponent，浏览器环境兼容）
			const content = resource.query ? decodeURIComponent(resource.query) : '';
			const model = this.modelService.createModel(content, null, resource);
			return Promise.resolve(model);
		} else if (resource.scheme === 'maxian-modified') {
			// 修改后的内容模型应该已经在DiffViewProvider中创建
			const existingModel = this.modelService.getModel(resource);
			if (existingModel) {
				return Promise.resolve(existingModel);
			}
			// 如果没有找到，创建一个空模型
			const model = this.modelService.createModel('', null, resource);
			return Promise.resolve(model);
		}
		return null;
	}
}

// 注册workbench contribution，在AfterRestored阶段打开
registerWorkbenchContribution2(
	MaxianViewContribution.ID,
	MaxianViewContribution,
	WorkbenchPhase.AfterRestored
);

// 注册diff内容提供者
registerWorkbenchContribution2(
	MaxianDiffContentProvider.ID,
	MaxianDiffContentProvider,
	WorkbenchPhase.BlockStartup
);

// ====== 注册 AI 生成提交信息命令 ======
CommandsRegistry.registerCommand('zhikai.ai.generateCommitMessage', async (accessor, prompt: string) => {
	console.log('[Git] AI 生成提交信息请求, prompt length:', prompt.length);

	try {
		// 获取 AI 服务
		const aiService = accessor.get(IAIService);

		// 调用 AI 服务生成提交信息
		// 使用 'business' 类型,因为生成提交信息是一个业务场景的代码生成任务
		const result = await aiService.generate({
			type: 'business',         // 使用业务类型
			requirement: prompt,      // 将 git diff 和提示作为需求传入
			language: 'text',         // 语言类型设置为 text (提交信息是纯文本)
			context: {
				task: 'generate-commit-message',
				description: '根据 git diff 生成简洁的中文提交信息'
			}
		});

		console.log('[Git] AI 生成提交信息成功, length:', result.code?.length || 0);

		// 返回生成的提交信息
		return result.code || '';

	} catch (error) {
		console.error('[Git] AI 生成提交信息失败:', error);
		// 失败时返回空字符串,让 Git 扩展使用简单版本的生成
		return '';
	}
});
