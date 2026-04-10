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
import { MAXIAN_DIFF_VIEW_URI_SCHEME, getStoredOriginalContent } from './diffViewProvider.js';
import { CommandsRegistry, ICommandService } from '../../../../platform/commands/common/commands.js';
import { IAIService } from '../../../../platform/ai/common/ai.js';
import { ILspDiagnosticsService } from '../common/lsp/lspDiagnostics.js';
import { LspDiagnosticsService } from './lspDiagnosticsService.js';
import { ILspHoverService } from '../common/lsp/lspHover.js';
import { LspHoverService } from './lspHoverService.js';
import { ILspDefinitionService } from '../common/lsp/lspDefinition.js';
import { LspDefinitionService } from './lspDefinitionService.js';
import { ILspReferencesService } from '../common/lsp/lspReferences.js';
import { LspReferencesService } from './lspReferencesService.js';
import { ILspTypeDefinitionService } from '../common/lsp/lspTypeDefinition.js';
import { LspTypeDefinitionService } from './lspTypeDefinitionService.js';
import { registerAction2, Action2, MenuId } from '../../../../platform/actions/common/actions.js';
import { KeybindingWeight } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import { KeyCode, KeyMod } from '../../../../base/common/keyCodes.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { MAXIAN_INPUT_FOCUSED, MAXIAN_MENTION_DROPDOWN_VISIBLE } from './maxianContextKeys.js';
import { ICommandExecutionService, ICommandExecutionResult, ICommandExecutionOptions } from '../common/services/commandExecutionService.js';
import { IVectorSearchService, ISemanticSearchResult, IIndexStats } from '../common/vector/IVectorSearchService.js';
import { ILanguageFeaturesService } from '../../../../editor/common/services/languageFeatures.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { FimCompletionProvider } from './fim/fimCompletionProvider.js';
import { VectorSearchStatusBarContribution } from './vectorSearchStatusBar.js';
import { VectorIndexFileWatcherContribution } from './vectorIndexFileWatcher.js';
import { IEditorPaneRegistry, EditorPaneDescriptor } from '../../../browser/editor.js';
import { EditorExtensions } from '../../../common/editor.js';
import { SoloEditorInput } from './soloEditorInput.js';
import { SoloEditorPane } from './soloEditorPane.js';
import { IEditorGroupsService } from '../../../services/editor/common/editorGroupsService.js';

// 确保ripgrep服务被注册（导入副作用）
import '../../../services/ripgrep/browser/ripgrep.contribution.js';

// 注册命令执行服务浏览器降级实现
// 在 Electron desktop 环境中，此注册会被 electron-sandbox/commandExecutionService.ts 中的
// registerMainProcessRemoteService 覆盖，使用主进程 child_process.spawn 实现
class BrowserCommandExecutionService implements ICommandExecutionService {
	readonly _serviceBrand: undefined;
	async execute(_command: string, _options?: ICommandExecutionOptions): Promise<ICommandExecutionResult> {
		return { stdout: '', stderr: '命令执行服务在 web 环境中不可用', exitCode: -1, timedOut: false, aborted: false };
	}
	async cancel(_commandId: string): Promise<void> { }
}
registerSingleton(ICommandExecutionService, BrowserCommandExecutionService, InstantiationType.Delayed);

// 注册向量搜索服务浏览器降级实现
// 在 Electron desktop 环境中，此注册会被 electron-sandbox/vectorSearchService.ts 中的
// registerMainProcessRemoteService 覆盖，使用主进程 Node.js 实现
class BrowserVectorSearchService implements IVectorSearchService {
	readonly _serviceBrand: undefined;
	async semanticSearch(_query: string, _cwd: string, _maxResults: number): Promise<ISemanticSearchResult[]> {
		return []; // web 环境不支持向量搜索，返回空，由 toolExecutorImpl fallback 到 ripgrep
	}
	formatResults(_results: ISemanticSearchResult[], _query: string): string {
		return '';
	}
	async getIndexStats(_cwd: string): Promise<IIndexStats> {
		return { itemCount: 0, isIndexing: false, indexed: 0, total: 0, lastIndexedAt: 0, modelReady: false };
	}
	async triggerIndexing(_cwd: string): Promise<void> { }
	async indexFile(_filePath: string, _cwd: string): Promise<void> { }
	async deleteFileIndex(_filePath: string, _cwd: string): Promise<void> { }
}
registerSingleton(IVectorSearchService, BrowserVectorSearchService, InstantiationType.Delayed);

// 注册码弦服务
registerSingleton(IMaxianService, MaxianService, InstantiationType.Delayed);

// 注册LSP服务
registerSingleton(ILspDiagnosticsService, LspDiagnosticsService, InstantiationType.Delayed);
registerSingleton(ILspHoverService, LspHoverService, InstantiationType.Delayed);
registerSingleton(ILspDefinitionService, LspDefinitionService, InstantiationType.Delayed);
registerSingleton(ILspReferencesService, LspReferencesService, InstantiationType.Delayed);
registerSingleton(ILspTypeDefinitionService, LspTypeDefinitionService, InstantiationType.Delayed);

// ====== 注册视图容器和视图 ======

// 定义视图容器ID和视图ID
const MAXIAN_VIEW_CONTAINER_ID = 'workbench.view.maxian';
export const MAXIAN_VIEW_ID = 'workbench.view.maxian.mainView';

// 注册视图容器到右侧辅助栏（AuxiliaryBar）
const viewContainerRegistry = Registry.as<IViewContainersRegistry>(ViewExtensions.ViewContainersRegistry);
export const VIEW_CONTAINER = viewContainerRegistry.registerViewContainer({
	id: MAXIAN_VIEW_CONTAINER_ID,
	title: localize2('maxian.viewContainer.title', 'MAXIAN'),
	icon: Codicon.commentDiscussion,
	order: 11,
	ctorDescriptor: new SyncDescriptor(ViewPaneContainer, [MAXIAN_VIEW_CONTAINER_ID, { mergeViewWithContainerWhenSingleView: true }]),
	storageId: MAXIAN_VIEW_CONTAINER_ID,
	hideIfEmpty: false
}, ViewContainerLocation.AuxiliaryBar); // 右侧边栏

// 创建视图描述符
class MaxianViewDescriptor {
	readonly id = MAXIAN_VIEW_ID;
	readonly name = localize2('maxian.view.name', '码弦');
	readonly containerIcon = VIEW_CONTAINER.icon;
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
viewsRegistry.registerViews([new MaxianViewDescriptor()], VIEW_CONTAINER);

// ====== 注册 Solo 模式 EditorPane ======
Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane).registerEditorPane(
	EditorPaneDescriptor.create(
		SoloEditorPane,
		SoloEditorInput.EditorID,
		'Solo 自主模式'
	),
	[new SyncDescriptor(SoloEditorInput)]
);

// ====== 打开 Solo 面板命令 ======
CommandsRegistry.registerCommand('maxian.openSoloPanel', async (accessor) => {
	const editorGroupsService = accessor.get(IEditorGroupsService);
	await editorGroupsService.activeGroup.openEditor(SoloEditorInput.instance, { pinned: true });
});

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
			// 先检查是否已有模型（避免重复创建引发 "Model already exists" 错误）
			const existing = this.modelService.getModel(resource);
			if (existing) {
				return Promise.resolve(existing);
			}
			// 从模块级 Map 中获取原始内容（DiffViewProvider 在打开 diff 时写入）
			const content = getStoredOriginalContent(resource.toString());
			const model = this.modelService.createModel(content, null, resource);
			return Promise.resolve(model);
		} else if (resource.scheme === 'maxian-modified') {
			// 修改后的内容模型已在 DiffViewProvider.openDiffEditor 中创建
			const existingModel = this.modelService.getModel(resource);
			if (existingModel) {
				return Promise.resolve(existingModel);
			}
			// 如果没有找到，创建一个空模型（不应发生，仅作保底）
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
	console.log('[Git AI] 生成提交信息请求, prompt length:', prompt.length);
	console.log('[Git AI] Prompt preview:', prompt.substring(0, 200));

	try {
		// 获取 AI 服务
		const aiService = accessor.get(IAIService);
		console.log('[Git AI] AI Service obtained:', !!aiService);

		// 调用 AI 服务生成提交信息
		// 使用 'business' 类型,因为生成提交信息是一个业务场景的代码生成任务
		console.log('[Git AI] Calling aiService.generate()...');
		const result = await aiService.generate({
			type: 'commit',           // 使用 commit 类型，对应 IDE_COMMIT_MESSAGE_GENERATION
			requirement: prompt,      // 将 git diff 和提示作为需求传入
			language: 'text',         // 语言类型设置为 text (提交信息是纯文本)
			context: {
				task: 'generate-commit-message',
				description: '根据 git diff 生成简洁的中文提交信息'
			}
		});

		console.log('[Git AI] AI 服务返回结果:', {
			hasCode: !!result.code,
			codeLength: result.code?.length || 0
		});

		if (result.code) {
			console.log('[Git AI] Generated commit message:', result.code.substring(0, 100));
			return result.code;
		} else {
			console.warn('[Git AI] AI service returned empty result');
			return '';
		}

	} catch (error) {
		console.error('[Git AI] AI 生成提交信息失败:', error);
		console.error('[Git AI] Error details:', {
			name: (error as Error).name,
			message: (error as Error).message,
			stack: (error as Error).stack?.substring(0, 200)
		});
		// 失败时返回空字符串,让 Git 扩展使用简单版本的生成
		return '';
	}
});

// ====== 码弦快捷键命令注册（支持用户自定义） ======
// 用户可通过 "首选项 > 键盘快捷方式" 搜索 "码弦" 来自定义这些快捷键

const MAXIAN_CATEGORY = { value: '码弦', original: 'Maxian' };

/**
 * 发送消息
 * 默认快捷键：Enter（仅在码弦输入框聚焦且 @mention 下拉列表未显示时生效）
 */
registerAction2(class SendMessageAction extends Action2 {
	constructor() {
		super({
			id: 'maxian.sendMessage',
			title: { value: '发送消息', original: 'Send Message' },
			category: MAXIAN_CATEGORY,
			f1: true,
			keybinding: {
				primary: KeyCode.Enter,
				when: ContextKeyExpr.and(
					MAXIAN_INPUT_FOCUSED,
					MAXIAN_MENTION_DROPDOWN_VISIBLE.negate()
				),
				weight: KeybindingWeight.WorkbenchContrib + 10
			}
		});
	}
	async run(accessor: ServicesAccessor): Promise<void> {
		accessor.get(IMaxianService).triggerSend();
	}
});

/**
 * 输入框换行
 * 默认快捷键：Shift+Enter（仅在码弦输入框聚焦且 @mention 下拉列表未显示时生效）
 */
registerAction2(class NewLineAction extends Action2 {
	constructor() {
		super({
			id: 'maxian.newLine',
			title: { value: '在输入框换行', original: 'New Line in Input' },
			category: MAXIAN_CATEGORY,
			f1: true,
			keybinding: {
				primary: KeyMod.Shift | KeyCode.Enter,
				when: ContextKeyExpr.and(
					MAXIAN_INPUT_FOCUSED,
					MAXIAN_MENTION_DROPDOWN_VISIBLE.negate()
				),
				weight: KeybindingWeight.WorkbenchContrib + 10
			}
		});
	}
	async run(accessor: ServicesAccessor): Promise<void> {
		accessor.get(IMaxianService).triggerNewLine();
	}
});

/**
 * 打开/聚焦码弦面板
 * 默认无快捷键，用户可自行绑定
 */
registerAction2(class OpenViewAction extends Action2 {
	constructor() {
		super({
			id: 'maxian.openView',
			title: { value: '打开码弦面板', original: 'Open Maxian Panel' },
			category: MAXIAN_CATEGORY,
			f1: true
		});
	}
	async run(accessor: ServicesAccessor): Promise<void> {
		accessor.get(IMaxianService).triggerOpenView();
	}
});

/**
 * 停止当前 AI 生成
 * 默认无快捷键，用户可自行绑定（例如 Escape）
 */
registerAction2(class StopGenerationAction extends Action2 {
	constructor() {
		super({
			id: 'maxian.stopGeneration',
			title: { value: '停止 AI 生成', original: 'Stop AI Generation' },
			category: MAXIAN_CATEGORY,
			f1: true
		});
	}
	async run(accessor: ServicesAccessor): Promise<void> {
		accessor.get(IMaxianService).triggerStopGeneration();
	}
});

/**
 * 清空对话历史
 * 默认无快捷键，用户可自行绑定
 */
registerAction2(class ClearConversationAction extends Action2 {
	constructor() {
		super({
			id: 'maxian.clearConversation',
			title: { value: '清空对话历史', original: 'Clear Conversation' },
			category: MAXIAN_CATEGORY,
			f1: true
		});
	}
	async run(accessor: ServicesAccessor): Promise<void> {
		accessor.get(IMaxianService).triggerClearConversation();
	}
});

/**
 * 回滚到最后一个 Checkpoint
 * 功能1: Checkpoint 完善 - 在每次写文件操作前自动创建 checkpoint，用户可通过此命令回滚
 * 默认无快捷键，用户可自行绑定
 */
registerAction2(class RollbackCheckpointAction extends Action2 {
	constructor() {
		super({
			id: 'maxian.rollbackCheckpoint',
			title: { value: '回滚到上一个 Checkpoint', original: 'Rollback to Last Checkpoint' },
			category: MAXIAN_CATEGORY,
			f1: true
		});
	}
	async run(accessor: ServicesAccessor): Promise<void> {
		const maxianService = accessor.get(IMaxianService);
		const result = await maxianService.rollbackToLastCheckpoint();
		if (result.success) {
			console.log('[maxian.rollbackCheckpoint]', result.message);
		} else {
			console.warn('[maxian.rollbackCheckpoint] 回滚失败:', result.message);
		}
	}
});

// ====== 标题栏快捷按钮 ======

/**
 * 问答历史 - 显示在标题栏（关闭按钮左侧）
 */
registerAction2(class ToggleHistoryAction extends Action2 {
	constructor() {
		super({
			id: 'maxian.toggleHistory',
			title: localize2('maxian.history', 'History'),
			icon: Codicon.history,
			menu: [{
				id: MenuId.ViewTitle,
				group: 'navigation',
				order: 2,
				when: ContextKeyExpr.equals('view', MAXIAN_VIEW_ID)
			}]
		});
	}
	async run(accessor: ServicesAccessor): Promise<void> {
		const view = accessor.get(IViewsService).getActiveViewWithId<MaxianView>(MAXIAN_VIEW_ID);
		if (view) {
			await view.toggleAskHistoryPanel();
		}
	}
});

/**
 * 配置快捷键 - 显示在标题栏（关闭按钮左侧）
 */
registerAction2(class OpenKeybindingsAction extends Action2 {
	constructor() {
		super({
			id: 'maxian.openKeybindings',
			title: localize2('maxian.keybindings', 'Configure Keybindings'),
			icon: Codicon.keyboard,
			menu: [{
				id: MenuId.ViewTitle,
				group: 'navigation',
				order: 1,
				when: ContextKeyExpr.equals('view', MAXIAN_VIEW_ID)
			}]
		});
	}
	async run(accessor: ServicesAccessor): Promise<void> {
		accessor.get(ICommandService).executeCommand('workbench.action.openGlobalKeybindings', '天和·码弦');
	}
});

// ====== 码弦 FIM 内联代码补全注册 ======

/**
 * 码弦 FIM 内联代码补全 Workbench Contribution
 *
 * 在 BlockRestore 阶段注册，此时 languageFeaturesService 已可用。
 * 使用 InlineCompletionsProvider 内部 API，与 aiInlineCompletions 使用相同机制。
 * FIM provider 注册为所有语言（通过 isFimSupportedLanguage 在运行时过滤），
 * 确保 VS Code 内部引擎能正确分发给 FIM provider。
 */
class MaxianFimCompletionContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.maxianFimCompletion';

	constructor(
		@ILanguageFeaturesService languageFeaturesService: ILanguageFeaturesService,
		@IConfigurationService configurationService: IConfigurationService,
		@IStorageService storageService: IStorageService,
		@IWorkspaceContextService workspaceContextService: IWorkspaceContextService,
	) {
		super();

		const provider = new FimCompletionProvider(configurationService, storageService, workspaceContextService);

		// 注册到所有语言（provider 内部通过 isFimSupportedLanguage 过滤不支持的语言）
		const registration = languageFeaturesService.inlineCompletionsProvider.register('*', provider);
		this._register(registration);
	}
}

registerWorkbenchContribution2(
	MaxianFimCompletionContribution.ID,
	MaxianFimCompletionContribution,
	WorkbenchPhase.BlockRestore,
);

// 注册语义搜索状态栏（在工作区恢复后启动轮询）
registerWorkbenchContribution2(
	VectorSearchStatusBarContribution.ID,
	VectorSearchStatusBarContribution,
	WorkbenchPhase.AfterRestored,
);

// 注册向量索引文件监听器（文件保存/删除时自动更新索引）
registerWorkbenchContribution2(
	VectorIndexFileWatcherContribution.ID,
	VectorIndexFileWatcherContribution,
	WorkbenchPhase.AfterRestored,
);
