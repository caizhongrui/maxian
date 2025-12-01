/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IAIService } from '../../../../platform/ai/common/ai.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IMultiLanguageService } from '../../multilang/browser/multilang.contribution.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { ConversationManager } from '../common/conversationManager.js';
import { ContextExtractor } from '../common/contextExtractor.js';
import { IAIChatService } from '../common/aiChatService.js';
import {
	ChatRequest,
	ChatResponse,
	ChatMessage,
	Conversation,
	ChatRequestType,
	ConversationContext
} from '../common/chatTypes.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { ICodeEditor } from '../../../../editor/browser/editorBrowser.js';
import { EditorContextKeys } from '../../../../editor/common/editorContextKeys.js';
import { localize2 } from '../../../../nls.js';
import { MenuId } from '../../../../platform/actions/common/actions.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { ViewPaneContainer } from '../../../browser/parts/views/viewPaneContainer.js';
import { IViewContainersRegistry, IViewsRegistry, Extensions as ViewExtensions, ViewContainerLocation } from '../../../common/views.js';
import { AIChatView } from './aiChatView.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { IViewsService } from '../../../services/views/common/viewsService.js';
import '../../../services/projectAnalyzer/browser/projectAnalyzerService.js';

/**
 * AI 聊天服务实现
 */
class AIChatService extends Disposable implements IAIChatService {
	readonly _serviceBrand: undefined;

	private conversationManager: ConversationManager;
	private contextExtractor: ContextExtractor;

	constructor(
		@IAIService aiService: IAIService,
		@IEditorService editorService: IEditorService,
		@IWorkspaceContextService workspaceService: IWorkspaceContextService,
		@IMultiLanguageService multiLanguageService: IMultiLanguageService
	) {
		super();

		this.conversationManager = this._register(new ConversationManager(aiService));
		this.contextExtractor = new ContextExtractor(editorService, workspaceService, multiLanguageService);
	}

	// 暴露ConversationManager的事件
	get onMessageAdded() {
		return this.conversationManager.onMessageAdded;
	}

	get onConversationCleared() {
		return this.conversationManager.onConversationCleared;
	}

	get onMessageUpdated() {
		return this.conversationManager.onMessageUpdated;
	}

	async sendMessage(message: string, includeContext: boolean, token?: CancellationToken): Promise<ChatResponse> {
		const request: ChatRequest = {
			message: message,
			includeContext: includeContext
		};

		if (includeContext) {
			request.context = await this.contextExtractor.extractContext(token);
		}

		return this.conversationManager.sendMessage(request, token);
	}

	async sendRequest(request: ChatRequest, token?: CancellationToken): Promise<ChatResponse> {
		// 如果请求需要上下文但未提供，自动提取
		if (request.includeContext && !request.context) {
			request.context = await this.contextExtractor.extractContext(token);
		}

		return this.conversationManager.sendMessage(request, token);
	}

	getHistory(limit?: number): ChatMessage[] {
		return this.conversationManager.getHistory(limit);
	}

	clearHistory(): void {
		this.conversationManager.clearHistory();
		// 不显示通知消息
	}

	getCurrentConversation(): Conversation {
		return this.conversationManager.getCurrentConversation();
	}

	async extractContext(token?: CancellationToken): Promise<ConversationContext> {
		return this.contextExtractor.extractContext(token);
	}

	async explainCode(code: string, language: string, token?: CancellationToken): Promise<ChatResponse> {
		const request: ChatRequest = {
			message: `请解释以下${language}代码：\n\`\`\`${language}\n${code}\n\`\`\``,
			includeContext: false,
			type: ChatRequestType.ExplainCode
		};

		return this.conversationManager.sendMessage(request, token);
	}

	async optimizeCode(code: string, language: string, token?: CancellationToken): Promise<ChatResponse> {
		const request: ChatRequest = {
			message: `请分析并优化以下${language}代码：\n\`\`\`${language}\n${code}\n\`\`\``,
			includeContext: false,
			type: ChatRequestType.OptimizeCode
		};

		return this.conversationManager.sendMessage(request, token);
	}

	async findBugs(code: string, language: string, token?: CancellationToken): Promise<ChatResponse> {
		const request: ChatRequest = {
			message: `请检查以下${language}代码中的错误和潜在问题：\n\`\`\`${language}\n${code}\n\`\`\``,
			includeContext: false,
			type: ChatRequestType.FindBugs
		};

		return this.conversationManager.sendMessage(request, token);
	}

	async generateDocs(code: string, language: string, token?: CancellationToken): Promise<ChatResponse> {
		const request: ChatRequest = {
			message: `请为以下${language}代码生成文档注释：\n\`\`\`${language}\n${code}\n\`\`\``,
			includeContext: false,
			type: ChatRequestType.GenerateDocs
		};

		return this.conversationManager.sendMessage(request, token);
	}
}

// 注册AI聊天服务
registerSingleton(IAIChatService, AIChatService, InstantiationType.Delayed);

// ====== 快捷操作命令 ======

/**
 * 解释代码命令
 */
registerAction2(class ExplainCodeAction extends Action2 {
	constructor() {
		super({
			id: 'zhikai.explainCode',
			title: localize2('explainCode.title', 'AI 解释代码'),
			category: localize2('zhikai.category', '天和·码弦'),
			f1: true,
			precondition: EditorContextKeys.hasNonEmptySelection,
			menu: [
				{
					id: MenuId.EditorContext,
					group: 'zhikai@1',
					order: 1,
					when: EditorContextKeys.hasNonEmptySelection
				}
			]
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const aiChatService = accessor.get(IAIChatService);
		const editorService = accessor.get(IEditorService);
		const notificationService = accessor.get(INotificationService);
		const viewsService = accessor.get(IViewsService);

		const editor = editorService.activeTextEditorControl as ICodeEditor;
		if (!editor || !editor.hasModel()) {
			return;
		}

		const selection = editor.getSelection();
		if (!selection || selection.isEmpty()) {
			notificationService.warn('请先选中要解释的代码');
			return;
		}

		const model = editor.getModel();
		const selectedCode = model!.getValueInRange(selection);
		const language = model!.getLanguageId();

		try {
			// 先打开AI聊天面板
			await viewsService.openView(AI_CHAT_VIEW_ID, true);
			// 发送请求
			await aiChatService.explainCode(selectedCode, language);
		} catch (error) {
			notificationService.error('代码解释失败: ' + error);
		}
	}
});

/**
 * 优化代码命令
 */
registerAction2(class OptimizeCodeAction extends Action2 {
	constructor() {
		super({
			id: 'zhikai.optimizeCode',
			title: localize2('optimizeCode.title', 'AI 优化代码'),
			category: localize2('zhikai.category', '天和·码弦'),
			f1: true,
			precondition: EditorContextKeys.hasNonEmptySelection,
			menu: [
				{
					id: MenuId.EditorContext,
					group: 'zhikai@2',
					order: 2,
					when: EditorContextKeys.hasNonEmptySelection
				}
			]
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const aiChatService = accessor.get(IAIChatService);
		const editorService = accessor.get(IEditorService);
		const notificationService = accessor.get(INotificationService);
		const viewsService = accessor.get(IViewsService);

		const editor = editorService.activeTextEditorControl as ICodeEditor;
		if (!editor || !editor.hasModel()) {
			return;
		}

		const selection = editor.getSelection();
		if (!selection || selection.isEmpty()) {
			notificationService.warn('请先选中要优化的代码');
			return;
		}

		const model = editor.getModel();
		const selectedCode = model!.getValueInRange(selection);
		const language = model!.getLanguageId();

		try {
			// 先打开AI聊天面板
			await viewsService.openView(AI_CHAT_VIEW_ID, true);
			// 发送请求
			await aiChatService.optimizeCode(selectedCode, language);
		} catch (error) {
			notificationService.error('代码优化失败: ' + error);
		}
	}
});

/**
 * 查找错误命令
 */
registerAction2(class FindBugsAction extends Action2 {
	constructor() {
		super({
			id: 'zhikai.findBugs',
			title: localize2('findBugs.title', 'AI 查找错误'),
			category: localize2('zhikai.category', '天和·码弦'),
			f1: true,
			precondition: EditorContextKeys.hasNonEmptySelection,
			menu: [
				{
					id: MenuId.EditorContext,
					group: 'zhikai@3',
					order: 3,
					when: EditorContextKeys.hasNonEmptySelection
				}
			]
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const aiChatService = accessor.get(IAIChatService);
		const editorService = accessor.get(IEditorService);
		const notificationService = accessor.get(INotificationService);
		const viewsService = accessor.get(IViewsService);

		const editor = editorService.activeTextEditorControl as ICodeEditor;
		if (!editor || !editor.hasModel()) {
			return;
		}

		const selection = editor.getSelection();
		if (!selection || selection.isEmpty()) {
			notificationService.warn('请先选中要检查的代码');
			return;
		}

		const model = editor.getModel();
		const selectedCode = model!.getValueInRange(selection);
		const language = model!.getLanguageId();

		try {
			// 先打开AI聊天面板
			await viewsService.openView(AI_CHAT_VIEW_ID, true);
			// 发送请求
			await aiChatService.findBugs(selectedCode, language);
		} catch (error) {
			notificationService.error('错误检查失败: ' + error);
		}
	}
});

/**
 * 生成文档命令
 */
registerAction2(class GenerateDocsAction extends Action2 {
	constructor() {
		super({
			id: 'zhikai.generateDocs',
			title: localize2('generateDocs.title', 'AI 生成文档'),
			category: localize2('zhikai.category', '天和·码弦'),
			f1: true,
			precondition: EditorContextKeys.hasNonEmptySelection,
			menu: [
				{
					id: MenuId.EditorContext,
					group: 'zhikai@4',
					order: 4,
					when: EditorContextKeys.hasNonEmptySelection
				}
			]
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const aiChatService = accessor.get(IAIChatService);
		const editorService = accessor.get(IEditorService);
		const notificationService = accessor.get(INotificationService);
		const viewsService = accessor.get(IViewsService);

		const editor = editorService.activeTextEditorControl as ICodeEditor;
		if (!editor || !editor.hasModel()) {
			return;
		}

		const selection = editor.getSelection();
		if (!selection || selection.isEmpty()) {
			notificationService.warn('请先选中要生成文档的代码');
			return;
		}

		const model = editor.getModel();
		const selectedCode = model!.getValueInRange(selection);
		const language = model!.getLanguageId();

		try {
			// 先打开AI聊天面板
			await viewsService.openView(AI_CHAT_VIEW_ID, true);
			// 发送请求
			await aiChatService.generateDocs(selectedCode, language);
		} catch (error) {
			notificationService.error('文档生成失败: ' + error);
		}
	}
});

/**
 * 清除聊天历史命令
 */
registerAction2(class ClearChatHistoryAction extends Action2 {
	constructor() {
		super({
			id: 'zhikai.clearChatHistory',
			title: localize2('clearChatHistory.title', '清除聊天历史'),
			category: localize2('zhikai.category', '天和·码弦'),
			f1: true
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const aiChatService = accessor.get(IAIChatService);
		aiChatService.clearHistory();
	}
});

// ====== 注册视图容器和视图 ======

// 定义视图容器ID和视图ID
const AI_CHAT_VIEW_CONTAINER_ID = 'workbench.view.aiChat';
const AI_CHAT_VIEW_ID = 'workbench.view.aiChat.chatView';

// 注册视图容器到右侧辅助栏（AuxiliaryBar）
const viewContainerRegistry = Registry.as<IViewContainersRegistry>(ViewExtensions.ViewContainersRegistry);
const aiChatViewContainer = viewContainerRegistry.registerViewContainer({
	id: AI_CHAT_VIEW_CONTAINER_ID,
	title: localize2('aiChat.viewContainer.title', 'AI 助手'),
	icon: Codicon.comment,
	order: 10,
	ctorDescriptor: new SyncDescriptor(ViewPaneContainer, [AI_CHAT_VIEW_CONTAINER_ID, { mergeViewWithContainerWhenSingleView: true }]),
	storageId: AI_CHAT_VIEW_CONTAINER_ID,
	hideIfEmpty: false // Always show container
}, ViewContainerLocation.AuxiliaryBar); // Changed back to AuxiliaryBar (right sidebar)

// 创建视图描述符 - 使用简化的方式
class AIChatViewDescriptor {
	readonly id = AI_CHAT_VIEW_ID;
	readonly name = localize2('aiChat.view.name', 'AI 对话');
	readonly containerIcon = aiChatViewContainer.icon;
	readonly ctorDescriptor = new SyncDescriptor(AIChatView);
	readonly order = 1;
	readonly weight = 100;
	readonly collapsed = false;
	readonly canToggleVisibility = true;
	readonly hideByDefault = false;
	readonly canMoveView = true;
	readonly focusCommand = { id: 'zhikai.focusAIChat' };
}

// 注册视图
const viewsRegistry = Registry.as<IViewsRegistry>(ViewExtensions.ViewsRegistry);
viewsRegistry.registerViews([new AIChatViewDescriptor()], aiChatViewContainer);

// ====== 自动打开AI对话视图 ======

/**
 * Workbench contribution to automatically open the AI Chat view on startup
 */
class AIChatViewContribution implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.aiChatView';

	constructor(
		@IViewsService private readonly viewsService: IViewsService
	) {
		// 在启动时自动打开AI对话视图容器
		this.openAIChatView();
	}

	private async openAIChatView(): Promise<void> {
		try {
			// 打开AI对话视图容器，这会同时显示右侧边栏
			await this.viewsService.openViewContainer(AI_CHAT_VIEW_CONTAINER_ID, true);
		} catch (error) {
			// Failed to open AI Chat view container
		}
	}
}

// 注册workbench contribution，在AfterRestored阶段打开（workbench已经恢复状态后）
registerWorkbenchContribution2(
	AIChatViewContribution.ID,
	AIChatViewContribution,
	WorkbenchPhase.AfterRestored
);
