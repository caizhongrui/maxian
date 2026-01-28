/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IViewPaneOptions, ViewPane } from '../../../browser/parts/views/viewPane.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IViewDescriptorService } from '../../../common/views.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { IAIChatService } from '../common/aiChatService.js';
import { ChatMessage, ChatRole } from '../common/chatTypes.js';
import { IAIService } from '../../../../platform/ai/common/ai.js';
import { $, append, clearNode, addDisposableListener } from '../../../../base/browser/dom.js';
import { MarkdownString } from '../../../../base/common/htmlContent.js';
import { MarkdownRenderer } from '../../../../editor/browser/widget/markdownRenderer/browser/markdownRenderer.js';
import { IStorageService, StorageScope } from '../../../../platform/storage/common/storage.js';
import { IProjectAnalyzerService } from '../../../services/projectAnalyzer/common/projectAnalyzer.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { ITextFileService } from '../../../services/textfile/common/textfiles.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { ToolExecutor } from '../../../services/aiTools/browser/toolExecutor.js';
import { getToolsForMode } from '../../../services/aiTools/common/toolDefinitions.js';
import { ToolRepetitionDetector } from '../../../services/ai/common/ToolRepetitionDetector.js';
import { truncateConversation } from '../../../services/ai/common/slidingWindow.js';

/**
 * AI 聊天视图面板 - 美化版
 */
export class AIChatView extends ViewPane {
	private messageContainer!: HTMLElement;
	private messagesContentArea!: HTMLElement; // 单独的消息内容区域
	private contextContainer!: HTMLElement; // 上下文显示容器
	private contextContent!: HTMLElement; // 上下文内容区域
	private inputContainer!: HTMLElement;
	private inputBox!: HTMLTextAreaElement;
	private sendButton!: HTMLElement;
	private stopButton!: HTMLElement;
	private knowledgeBaseSelect!: HTMLSelectElement; // 知识库选择器
	private currentMode: 'chat' | 'agent' | 'architect' = 'chat';
	private modeToggle!: HTMLButtonElement;
	private messages: ChatMessage[] = [];
	private streamingMessageElement: HTMLElement | null = null;
	private streamingContentElement: HTMLElement | null = null;
	private isStreaming: boolean = false;
	private abortController: AbortController | null = null; // 用于取消请求
	private markdownRenderer: MarkdownRenderer; // Markdown 渲染器
	private shouldAutoScroll: boolean = true; // 是否应该自动滚动
	private attachedFiles: string[] = []; // 用户手动添加的上下文文件
	private currentContext: any = null; // 当前提取的上下文信息

	constructor(
		options: IViewPaneOptions,
		@IKeybindingService keybindingService: IKeybindingService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IConfigurationService configurationService: IConfigurationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IOpenerService openerService: IOpenerService,
		@IThemeService themeService: IThemeService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IHoverService hoverService: IHoverService,
		@IAIChatService private readonly aiChatService: IAIChatService,
		@IAIService private readonly aiService: IAIService,
		@IProjectAnalyzerService private readonly projectAnalyzer: IProjectAnalyzerService,
		@IWorkspaceContextService private readonly workspaceService: IWorkspaceContextService,
		@IFileService private readonly fileService: IFileService,
		@ITextFileService private readonly textFileService: ITextFileService,
		@IEditorService private readonly editorService: IEditorService,
		@IStorageService private readonly storageService: IStorageService
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, telemetryService, hoverService);

		// 创建 Markdown 渲染器实例,支持语法高亮 (通过依赖注入自动获取ILanguageService和IOpenerService)
		this.markdownRenderer = this._register(instantiationService.createInstance(MarkdownRenderer, {}));
		// 加载历史消息
		this.loadHistory();

		// 监听新消息事件
		this._register(this.aiChatService.onMessageAdded(message => {
			// 添加消息到本地列表
			this.messages.push(message);
			// 如果视图已经渲染，更新UI
			if (this.messagesContentArea) {
				// 清除欢迎消息
				const welcome = this.messagesContentArea.querySelector('.welcome-message');
				if (welcome) {
					welcome.remove();
				}
				// 渲染新消息
				this.createMessageElement(message, false);
				// 只在用户处于底部时滚动
				this.scrollToBottomIfNeeded();
			}
		}));

		// 监听对话清除事件
		this._register(this.aiChatService.onConversationCleared(() => {
			this.messages = [];
			if (this.messagesContentArea) {
				clearNode(this.messagesContentArea);
				this.showWelcomeMessage();
			}
		}));

		// 监听消息更新事件（流式响应）
		this._register(this.aiChatService.onMessageUpdated(message => {
			// 更新本地消息列表中的对应消息
			const index = this.messages.findIndex(m => m.id === message.id);
			if (index >= 0) {
				this.messages[index] = message;
			}
			// 如果视图已经渲染，更新UI中的流式消息
			if (this.messagesContentArea) {
				// 查找对应的消息元素
				const messageElements = this.messagesContentArea.querySelectorAll('.ai-chat-message');
				// 查找最后一个AI消息元素（通常流式消息是最后一个）
				for (let i = messageElements.length - 1; i >= 0; i--) {
					const messageElement = messageElements[i] as HTMLElement;
					const contentElement = messageElement.querySelector('.message-content');
					if (contentElement && messageElement.querySelector('.message-avatar')?.textContent === '') {
						// 这是一个AI消息，更新其内容
						clearNode(contentElement as HTMLElement);
						this.renderMessageContent(contentElement as HTMLElement, message.content);
						// 只在用户处于底部时滚动
						this.scrollToBottomIfNeeded();
						break;
					}
				}
			}
		}));
	}

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);

		// 如果已经有DOM结构，不再重复创建（但允许更新）
		if (this.messageContainer) {
			return;
		}

		// 添加CSS动画
		this.addStyles();

		// 添加类名用于CSS选择器
		container.classList.add('ai-chat-view');

		// 设置主容器样式
		container.style.display = 'flex';
		container.style.flexDirection = 'column';
		container.style.height = '100%';
		container.style.backgroundColor = 'var(--vscode-sideBar-background)';

		// 消息列表容器（外层容器，负责滚动）
		this.messageContainer = append(container, $('.ai-chat-messages'));
		this.messageContainer.style.flex = '1';
		this.messageContainer.style.overflowY = 'auto';
		this.messageContainer.style.overflowX = 'hidden';
		this.messageContainer.style.padding = '16px';
		this.messageContainer.style.scrollBehavior = 'smooth';

		// 监听滚动事件，检测用户是否手动滚动到非底部位置
		this._register(addDisposableListener(this.messageContainer, 'scroll', () => {
			this.updateAutoScrollState();
		}));

		// 消息内容区域（内层容器，只存放消息，清空时只清空这个）
		this.messagesContentArea = append(this.messageContainer, $('.messages-content'));
		this.messagesContentArea.style.display = 'flex';
		this.messagesContentArea.style.flexDirection = 'column';

		// 上下文显示容器（在消息和输入框之间）
		this.contextContainer = append(container, $('.ai-chat-context-container'));
		this.renderContextArea(this.contextContainer);

		// 输入区域容器
		this.inputContainer = append(container, $('.ai-chat-input-container'));
		this.renderInputArea(this.inputContainer);

		// 渲染历史消息
		this.renderMessages();

		// 添加欢迎消息
		if (this.messages.length === 0) {
			this.showWelcomeMessage();
		}

		// 初始化时提取并显示上下文
		this.refreshContext();
	}

	/**
	 * 刷新上下文显示（立即提取并显示当前上下文）
	 */
	private async refreshContext(): Promise<void> {
		try {
			const context = await this.aiChatService.extractContext();
			this.currentContext = context;
			this.updateContextDisplay();
		} catch (error) {
		}
	}

	/**
	 * 渲染标题栏 - Copilot风格
	 */
	protected override renderHeaderTitle(header: HTMLElement): void {
		// 不调用 super.renderHeaderTitle,我们完全自定义

		// 禁用header的默认点击事件，防止折叠面板
		this._register(addDisposableListener(header, 'click', (e: MouseEvent) => {
			e.preventDefault();
			e.stopPropagation();
		}));

		header.style.padding = '14px 16px';
		header.style.borderBottom = '1px solid var(--vscode-panel-border)';
		header.style.display = 'flex';
		header.style.alignItems = 'center';
		header.style.justifyContent = 'space-between';
		header.style.backgroundColor = 'var(--vscode-sideBar-background)';
		header.style.minHeight = '48px';
		header.style.cursor = 'default';

		const titleContainer = append(header, $('.header-title'));
		titleContainer.style.display = 'flex';
		titleContainer.style.alignItems = 'center';
		titleContainer.style.gap = '8px';
		titleContainer.style.flex = '1';

		const title = append(titleContainer, $('.header-text'));
		title.textContent = '码弦';
		title.style.fontSize = '14px';
		title.style.fontWeight = '600';
		title.style.color = 'var(--vscode-foreground)';

		// 清空对话按钮
		const clearChatButton = append(header, $('button.clear-chat-btn'));
		clearChatButton.textContent = '🧹';
		clearChatButton.title = '清空对话';
		clearChatButton.style.width = '28px';
		clearChatButton.style.height = '28px';
		clearChatButton.style.border = '1px solid var(--vscode-button-border)';
		clearChatButton.style.borderRadius = '4px';
		clearChatButton.style.backgroundColor = 'transparent';
		clearChatButton.style.color = 'var(--vscode-foreground)';
		clearChatButton.style.cursor = 'pointer';
		clearChatButton.style.fontSize = '16px';
		clearChatButton.style.display = 'flex';
		clearChatButton.style.alignItems = 'center';
		clearChatButton.style.justifyContent = 'center';
		clearChatButton.style.transition = 'background-color 0.2s ease';

		this._register(addDisposableListener(clearChatButton, 'mouseover', () => {
			clearChatButton.style.backgroundColor = 'var(--vscode-toolbar-hoverBackground)';
		}));
		this._register(addDisposableListener(clearChatButton, 'mouseout', () => {
			clearChatButton.style.backgroundColor = 'transparent';
		}));
		this._register(addDisposableListener(clearChatButton, 'click', (e: MouseEvent) => {
			e.preventDefault();
			e.stopPropagation();
			this.clearChat();
		}));
	}

	/**
	 * 加载知识库列表 - 从后端API获取
	 */
	private async loadKnowledgeBases(): Promise<void> {
		// 默认选项
		const defaultOption = append(this.knowledgeBaseSelect, $('option')) as HTMLOptionElement;
		defaultOption.value = '';
		defaultOption.textContent = '不使用知识库';

		try {
			// 从配置获取API地址和用户凭证
			const apiUrl = this.configurationService.getValue<string>('zhikai.auth.apiUrl');
			const username = this.configurationService.getValue<string>('zhikai.auth.username');

			if (!apiUrl || !username) {
				return;
			}

			// 从加密存储读取密码
			const password = await this.getPassword();
			if (!password) {
				return;
			}

			// 调用后端API获取知识库列表
			const baseUrl = apiUrl.replace(/\/$/, '');
			const url = `${baseUrl}/knowledge/knowledgeApplication/listByUser?applicationStatus=0`;

			// Base64 编码用户名和密码
			const encodedUsername = btoa(username);
			const encodedPassword = btoa(password);

			const requestBody = JSON.stringify({
				username: encodedUsername,
				password: encodedPassword
			});

			const response = await fetch(url, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json; charset=utf-8',
					'Accept': 'application/json'
				},
				body: requestBody,
				signal: AbortSignal.timeout(30000)
			});

			if (!response.ok) {
				return;
			}

			const data: any = await response.json();

			// 处理响应：{data: [{id, applicationName}]}
			if (data && Array.isArray(data.data)) {
				for (const kb of data.data) {
					const option = append(this.knowledgeBaseSelect, $('option')) as HTMLOptionElement;
					option.value = kb.id;
					option.textContent = kb.applicationName;
				}

				// 默认选中第一个知识库
				if (data.data.length > 0) {
					this.knowledgeBaseSelect.selectedIndex = 1; // 选中第一个知识库（跳过"不使用知识库"）
					// TODO: Store selected knowledge base ID for future use
				}
			}
		} catch (error) {
		}
	}

	/**
	 * 从存储获取密码
	 * ⚠️ 架构修复：从 StorageService 读取凭据（与 authService 一致）
	 */
	private async getPassword(): Promise<string | undefined> {
		const storedCredentials = this.storageService.get('zhikai.auth.credentials', StorageScope.APPLICATION);
		if (!storedCredentials) {
			return undefined;
		}
		try {
			const credentials = JSON.parse(storedCredentials);
			return credentials.password;
		} catch {
			return undefined;
		}
	}

	/**
	 * 渲染输入区域 - Copilot风格，知识库选择器在输入框内底部
	 */
	private renderInputArea(container: HTMLElement): void {
		container.style.padding = '16px';
		container.style.borderTop = '1px solid var(--vscode-panel-border)';
		container.style.backgroundColor = 'var(--vscode-sideBar-background)';

		// 输入框容器 - Copilot风格，包含输入框和知识库选择器
		const inputWrapper = append(container, $('.input-wrapper'));
		inputWrapper.style.position = 'relative';
		inputWrapper.style.display = 'flex';
		inputWrapper.style.flexDirection = 'column';
		inputWrapper.style.backgroundColor = 'var(--vscode-input-background)';
		inputWrapper.style.border = '1px solid var(--vscode-input-border)';
		inputWrapper.style.borderRadius = '12px';
		inputWrapper.style.padding = '12px';
		inputWrapper.style.transition = 'all 0.2s ease';
		inputWrapper.style.gap = '8px';

		// 第一行：输入框和发送按钮
		const inputRow = append(inputWrapper, $('.input-row'));
		inputRow.style.display = 'flex';
		inputRow.style.alignItems = 'flex-end';
		inputRow.style.gap = '8px';

		// 输入框
		this.inputBox = append(inputRow, $('textarea.ai-chat-input')) as HTMLTextAreaElement;
		this.inputBox.placeholder = '输入您的问题';
		this.inputBox.rows = 1;
		this.inputBox.style.flex = '1';
		this.inputBox.style.resize = 'none';
		this.inputBox.style.border = 'none';
		this.inputBox.style.outline = 'none';
		this.inputBox.style.fontFamily = 'var(--vscode-font-family)';
		this.inputBox.style.fontSize = '13px';
		this.inputBox.style.lineHeight = '20px';
		this.inputBox.style.backgroundColor = 'transparent';
		this.inputBox.style.color = 'var(--vscode-input-foreground)';
		this.inputBox.style.maxHeight = '200px';
		this.inputBox.style.overflowY = 'auto';

		// 自动调整高度
		this._register(addDisposableListener(this.inputBox, 'input', () => {
			this.inputBox.style.height = 'auto';
			this.inputBox.style.height = Math.min(this.inputBox.scrollHeight, 200) + 'px';
		}));

		// 发送按钮 - 圆形按钮设计（在第一行）
		this.sendButton = append(inputRow, $('button.send-btn'));
		this.sendButton.textContent = '→';
		this.sendButton.title = '发送 (Enter)';
		this.sendButton.style.width = '32px';
		this.sendButton.style.height = '32px';
		this.sendButton.style.border = 'none';
		this.sendButton.style.borderRadius = '6px';
		this.sendButton.style.backgroundColor = 'var(--vscode-button-background)';
		this.sendButton.style.color = 'var(--vscode-button-foreground)';
		this.sendButton.style.cursor = 'pointer';
		this.sendButton.style.fontSize = '18px';
		this.sendButton.style.fontWeight = 'bold';
		this.sendButton.style.display = 'flex';
		this.sendButton.style.alignItems = 'center';
		this.sendButton.style.justifyContent = 'center';
		this.sendButton.style.flexShrink = '0';
		this.sendButton.style.transition = 'all 0.2s ease';

		this._register(addDisposableListener(this.sendButton, 'mouseover', () => {
			this.sendButton.style.backgroundColor = 'var(--vscode-button-hoverBackground)';
		}));
		this._register(addDisposableListener(this.sendButton, 'mouseout', () => {
			this.sendButton.style.backgroundColor = 'var(--vscode-button-background)';
		}));

		// 停止按钮 - 初始隐藏（在第一行）
		this.stopButton = append(inputRow, $('button.stop-btn'));
		this.stopButton.textContent = '⬛';
		this.stopButton.title = '停止生成';
		this.stopButton.style.width = '32px';
		this.stopButton.style.height = '32px';
		this.stopButton.style.border = 'none';
		this.stopButton.style.borderRadius = '6px';
		this.stopButton.style.backgroundColor = 'var(--vscode-button-background)';
		this.stopButton.style.color = 'var(--vscode-button-foreground)';
		this.stopButton.style.cursor = 'pointer';
		this.stopButton.style.fontSize = '12px';
		this.stopButton.style.fontWeight = 'bold';
		this.stopButton.style.display = 'none'; // 初始隐藏
		this.stopButton.style.alignItems = 'center';
		this.stopButton.style.justifyContent = 'center';
		this.stopButton.style.flexShrink = '0';
		this.stopButton.style.transition = 'all 0.2s ease';

		this._register(addDisposableListener(this.stopButton, 'mouseover', () => {
			this.stopButton.style.backgroundColor = 'var(--vscode-button-hoverBackground)';
		}));
		this._register(addDisposableListener(this.stopButton, 'mouseout', () => {
			this.stopButton.style.backgroundColor = 'var(--vscode-button-background)';
		}));

		// 停止按钮事件处理
		this._register(addDisposableListener(this.stopButton, 'click', () => {
			if (this.abortController) {
				this.abortController.abort();
			}
		}));

		// 第二行：知识库选择器
		const kbRow = append(inputWrapper, $('.kb-row'));
		kbRow.style.display = 'flex';
		kbRow.style.alignItems = 'center';
		kbRow.style.gap = '8px';
		kbRow.style.paddingTop = '8px';
		kbRow.style.borderTop = '1px solid var(--vscode-input-border)';

		const kbLabel = append(kbRow, $('.kb-label'));
		kbLabel.textContent = '知识库';
		kbLabel.style.fontSize = '11px';
		kbLabel.style.color = 'var(--vscode-descriptionForeground)';
		kbLabel.style.whiteSpace = 'nowrap';

		// 知识库选择器
		this.knowledgeBaseSelect = append(kbRow, $('select.kb-select')) as HTMLSelectElement;
		this.knowledgeBaseSelect.style.flex = '1';
		this.knowledgeBaseSelect.style.height = '24px';
		this.knowledgeBaseSelect.style.fontSize = '11px';
		this.knowledgeBaseSelect.style.backgroundColor = 'transparent';
		this.knowledgeBaseSelect.style.color = 'var(--vscode-foreground)';
		this.knowledgeBaseSelect.style.border = 'none';
		this.knowledgeBaseSelect.style.padding = '2px 4px';
		this.knowledgeBaseSelect.style.cursor = 'pointer';
		this.knowledgeBaseSelect.style.outline = 'none';

		// 添加知识库选项
		this.loadKnowledgeBases();

		// 监听选择变化 (reserved for future knowledge base integration)
		this._register(addDisposableListener(this.knowledgeBaseSelect, 'change', () => {
			// TODO: Implement knowledge base selection
		}));

		// Mode toggle button (Chat/Agent)
		const modeLabel = append(kbRow, $('.mode-label'));
		modeLabel.textContent = 'Mode:';
		modeLabel.style.fontSize = '11px';
		modeLabel.style.color = 'var(--vscode-descriptionForeground)';
		modeLabel.style.marginLeft = '12px';
		modeLabel.style.whiteSpace = 'nowrap';

		this.modeToggle = append(kbRow, $('button.mode-toggle')) as HTMLButtonElement;
		this.modeToggle.textContent = this.getModeLabel();
		this.modeToggle.style.fontSize = '11px';
		this.modeToggle.style.padding = '2px 8px';
		this.modeToggle.style.border = '1px solid var(--vscode-button-border)';
		this.modeToggle.style.borderRadius = '4px';
		this.modeToggle.style.backgroundColor = 'var(--vscode-button-background)';
		this.modeToggle.style.color = 'var(--vscode-button-foreground)';
		this.modeToggle.style.cursor = 'pointer';
		this.modeToggle.style.whiteSpace = 'nowrap';

		this._register(addDisposableListener(this.modeToggle, 'click', () => {
			this.toggleMode();
		}));
		this._register(addDisposableListener(this.modeToggle, 'mouseover', () => {
			this.modeToggle.style.backgroundColor = 'var(--vscode-button-hoverBackground)';
		}));
		this._register(addDisposableListener(this.modeToggle, 'mouseout', () => {
			this.modeToggle.style.backgroundColor = 'var(--vscode-button-background)';
		}));

		// 输入框焦点效果
		this._register(addDisposableListener(this.inputBox, 'focus', () => {
			inputWrapper.style.borderColor = 'var(--vscode-focusBorder)';
			inputWrapper.style.boxShadow = '0 0 0 1px var(--vscode-focusBorder)';
		}));
		this._register(addDisposableListener(this.inputBox, 'blur', () => {
			inputWrapper.style.borderColor = 'var(--vscode-input-border)';
			inputWrapper.style.boxShadow = 'none';
		}));

		// 发送按钮事件处理
		this._register(addDisposableListener(this.sendButton, 'click', () => {
			this.sendMessage(true); // 默认包含上下文
		}));

		this._register(addDisposableListener(this.inputBox, 'keydown', (e: KeyboardEvent) => {
			if (e.key === 'Enter' && !e.shiftKey) {
				e.preventDefault();
				this.sendMessage(true);
			}
		}));
	}

	/**
	 * 渲染上下文显示区域
	 */
	private renderContextArea(container: HTMLElement): void {
		container.style.borderTop = '1px solid var(--vscode-panel-border)';
		container.style.backgroundColor = 'var(--vscode-sideBar-background)';
		container.style.maxHeight = '200px';
		container.style.overflowY = 'auto';
		container.style.display = 'none'; // 初始隐藏，有内容时显示

		// 上下文标题栏
		const header = append(container, $('.context-header'));
		header.style.display = 'flex';
		header.style.alignItems = 'center';
		header.style.justifyContent = 'space-between';
		header.style.padding = '8px 16px';
		header.style.borderBottom = '1px solid var(--vscode-panel-border)';

		const title = append(header, $('.context-title'));
		title.textContent = '📎 上下文';
		title.style.fontSize = '12px';
		title.style.fontWeight = '600';
		title.style.color = 'var(--vscode-foreground)';

		// 添加文件按钮
		const addFileBtn = append(header, $('button.add-file-btn'));
		addFileBtn.textContent = '+ 添加文件';
		addFileBtn.title = '添加上下文文件';
		addFileBtn.style.fontSize = '11px';
		addFileBtn.style.padding = '4px 8px';
		addFileBtn.style.border = '1px solid var(--vscode-button-border)';
		addFileBtn.style.borderRadius = '4px';
		addFileBtn.style.backgroundColor = 'var(--vscode-button-background)';
		addFileBtn.style.color = 'var(--vscode-button-foreground)';
		addFileBtn.style.cursor = 'pointer';
		addFileBtn.style.transition = 'background-color 0.2s ease';

		this._register(addDisposableListener(addFileBtn, 'mouseover', () => {
			addFileBtn.style.backgroundColor = 'var(--vscode-button-hoverBackground)';
		}));
		this._register(addDisposableListener(addFileBtn, 'mouseout', () => {
			addFileBtn.style.backgroundColor = 'var(--vscode-button-background)';
		}));
		this._register(addDisposableListener(addFileBtn, 'click', () => {
			this.addContextFile();
		}));

		// 上下文内容区域
		this.contextContent = append(container, $('.context-content'));
		this.contextContent.style.padding = '8px 16px';
		this.contextContent.style.fontSize = '12px';
		this.contextContent.style.color = 'var(--vscode-descriptionForeground)';
	}

	/**
	 * 添加上下文文件（使用 VS Code 文件选择器）
	 */
	private async addContextFile(): Promise<void> {
		// TODO: 使用 VS Code 的文件选择器 API
		// 这里先用一个简单的提示，后续实现完整的文件选择功能

		// 临时实现：显示当前打开的文件
		try {
			const context = await this.aiChatService.extractContext();
			if (context?.currentFile?.fileName) {
				// 添加当前文件到附件列表
				const filePath = context.currentFile.fileName;
				if (!this.attachedFiles.includes(filePath)) {
					this.attachedFiles.push(filePath);
					this.updateContextDisplay();
				}
			}
		} catch (error) {
		}
	}

	/**
	 * 移除上下文文件
	 */
	private removeContextFile(filePath: string): void {
		const index = this.attachedFiles.indexOf(filePath);
		if (index >= 0) {
			this.attachedFiles.splice(index, 1);
			this.updateContextDisplay();
		}
	}

	/**
	 * 更新上下文显示
	 */
	private updateContextDisplay(): void {
		if (!this.contextContent) {
			return;
		}

		clearNode(this.contextContent);

		// 如果没有任何上下文，显示提示信息而不是隐藏
		if (!this.currentContext && this.attachedFiles.length === 0) {
			this.contextContainer.style.display = 'block';
			const emptyMessage = append(this.contextContent, $('.context-empty-message'));
			emptyMessage.textContent = '暂无上下文。请打开一个文件或点击「添加文件」按钮。';
			emptyMessage.style.padding = '12px 0';
			emptyMessage.style.color = 'var(--vscode-descriptionForeground)';
			emptyMessage.style.fontStyle = 'italic';
			emptyMessage.style.textAlign = 'center';
			return;
		}

		// 显示容器
		this.contextContainer.style.display = 'block';

		// 显示当前文件信息
		if (this.currentContext?.currentFile) {
			const fileItem = append(this.contextContent, $('.context-item'));
			fileItem.style.display = 'flex';
			fileItem.style.alignItems = 'center';
			fileItem.style.padding = '6px 0';
			fileItem.style.borderBottom = '1px solid var(--vscode-panel-border)';

			const icon = append(fileItem, $('.context-icon'));
			icon.textContent = '📄';
			icon.style.marginRight = '8px';

			const text = append(fileItem, $('.context-text'));
			text.style.flex = '1';
			const fileName = this.currentContext.currentFile.fileName;
			const language = this.currentContext.currentFile.language || '';

			// 使用 DOM 方法而不是 innerHTML
			const label = append(text, $('strong'));
			label.textContent = '当前文件: ';
			const fileNameSpan = append(text, $('span'));
			fileNameSpan.textContent = fileName + ' ';
			const langSpan = append(text, $('span'));
			langSpan.textContent = `(${language})`;
			langSpan.style.color = 'var(--vscode-descriptionForeground)';
		}

		// 显示选中代码
		if (this.currentContext?.selectedCode) {
			const codeItem = append(this.contextContent, $('.context-item'));
			codeItem.style.display = 'flex';
			codeItem.style.alignItems = 'center';
			codeItem.style.padding = '6px 0';
			codeItem.style.borderBottom = '1px solid var(--vscode-panel-border)';

			const icon = append(codeItem, $('.context-icon'));
			icon.textContent = '📝';
			icon.style.marginRight = '8px';

			const text = append(codeItem, $('.context-text'));
			text.style.flex = '1';
			const lines = this.currentContext.selectedCode.code.split('\n').length;

			// 使用 DOM 方法
			const label = append(text, $('strong'));
			label.textContent = '选中代码: ';
			const linesSpan = append(text, $('span'));
			linesSpan.textContent = `${lines} 行`;
		}

		// 显示附加文件
		for (const filePath of this.attachedFiles) {
			const fileItem = append(this.contextContent, $('.context-item'));
			fileItem.style.display = 'flex';
			fileItem.style.alignItems = 'center';
			fileItem.style.padding = '6px 0';
			fileItem.style.borderBottom = '1px solid var(--vscode-panel-border)';

			const icon = append(fileItem, $('.context-icon'));
			icon.textContent = '📎';
			icon.style.marginRight = '8px';

			const text = append(fileItem, $('.context-text'));
			text.style.flex = '1';

			// 使用 DOM 方法
			const label = append(text, $('strong'));
			label.textContent = '附加文件: ';
			const pathSpan = append(text, $('span'));
			pathSpan.textContent = filePath;

			// 移除按钮
			const removeBtn = append(fileItem, $('button.remove-btn'));
			removeBtn.textContent = '×';
			removeBtn.title = '移除';
			removeBtn.style.width = '20px';
			removeBtn.style.height = '20px';
			removeBtn.style.border = 'none';
			removeBtn.style.borderRadius = '3px';
			removeBtn.style.backgroundColor = 'transparent';
			removeBtn.style.color = 'var(--vscode-foreground)';
			removeBtn.style.cursor = 'pointer';
			removeBtn.style.fontSize = '18px';
			removeBtn.style.fontWeight = 'bold';
			removeBtn.style.display = 'flex';
			removeBtn.style.alignItems = 'center';
			removeBtn.style.justifyContent = 'center';

			this._register(addDisposableListener(removeBtn, 'mouseover', () => {
				removeBtn.style.backgroundColor = 'var(--vscode-toolbar-hoverBackground)';
			}));
			this._register(addDisposableListener(removeBtn, 'mouseout', () => {
				removeBtn.style.backgroundColor = 'transparent';
			}));
			this._register(addDisposableListener(removeBtn, 'click', () => {
				this.removeContextFile(filePath);
			}));
		}

		// 显示项目信息
		if (this.currentContext?.projectLanguage || this.currentContext?.projectFrameworks) {
			const projectItem = append(this.contextContent, $('.context-item'));
			projectItem.style.padding = '6px 0';
			projectItem.style.borderBottom = '1px solid var(--vscode-panel-border)';

			const icon = append(projectItem, $('.context-icon'));
			icon.textContent = '🏗️';
			icon.style.marginRight = '8px';
			icon.style.display = 'inline-block';

			const text = append(projectItem, $('.context-text'));
			text.style.display = 'inline';

			// 使用 DOM 方法
			const label = append(text, $('strong'));
			label.textContent = '项目信息: ';

			const parts: string[] = [];
			if (this.currentContext.projectLanguage) {
				parts.push(`语言: ${this.currentContext.projectLanguage}`);
			}
			if (this.currentContext.projectFrameworks && this.currentContext.projectFrameworks.length > 0) {
				parts.push(`框架: ${this.currentContext.projectFrameworks.join(', ')}`);
			}

			const infoSpan = append(text, $('span'));
			infoSpan.textContent = parts.join(', ');
		}
	}

	/**
	 * 显示欢迎消息
	 */
	private showWelcomeMessage(): void {
		const welcome = append(this.messagesContentArea, $('.welcome-message'));
		welcome.style.textAlign = 'center';
		welcome.style.padding = '40px 20px';
		welcome.style.color = 'var(--vscode-descriptionForeground)';

		const icon = append(welcome, $('.welcome-icon'));
		icon.textContent = '👋';
		icon.style.fontSize = '48px';
		icon.style.marginBottom = '16px';

		const title = append(welcome, $('.welcome-title'));
		title.textContent = '你好！我是AI智能助手';
		title.style.fontSize = '16px';
		title.style.fontWeight = 'bold';
		title.style.marginBottom = '8px';
		title.style.color = 'var(--vscode-foreground)';

		const desc = append(welcome, $('.welcome-description'));
		desc.textContent = '我可以帮您解释代码、优化代码、查找错误和生成文档';
		desc.style.fontSize = '13px';
		desc.style.lineHeight = '1.6';
	}

	/**
	 * 加载历史消息
	 */
	private loadHistory(): void {
		this.messages = this.aiChatService.getHistory();
	}

	/**
	 * Get mode label with icon
	 */
	private getModeLabel(): string {
		switch (this.currentMode) {
			case 'chat':
				return '💬 Chat';
			case 'agent':
				return '🤖 Agent';
			case 'architect':
				return '📐 Architect';
			default:
				return '💬 Chat';
		}
	}

	/**
	 * Get mode placeholder
	 */
	private getModePlaceholder(): string {
		switch (this.currentMode) {
			case 'chat':
				return '输入您的问题';
			case 'agent':
				return '描述您要实现的功能（Agent 会生成或修改代码文件）';
			case 'architect':
				return '描述您的需求，Architect 会帮您规划任务';
			default:
				return '输入您的问题';
		}
	}

	/**
	 * Toggle between Chat, Agent, and Architect modes
	 */
	private toggleMode(): void {
		// Cycle through modes: chat -> agent -> architect -> chat
		if (this.currentMode === 'chat') {
			this.currentMode = 'agent';
		} else if (this.currentMode === 'agent') {
			this.currentMode = 'architect';
		} else {
			this.currentMode = 'chat';
		}

		this.modeToggle.textContent = this.getModeLabel();
		this.inputBox.placeholder = this.getModePlaceholder();
	}

	/**
	 * 发送消息（流式）或执行 Agent/Architect 任务
	 */
	private async sendMessage(includeContext: boolean): Promise<void> {
		if (this.currentMode === 'agent') {
			return this.executeAgentTask();
		}
		if (this.currentMode === 'architect') {
			return this.executeArchitectTask();
		}
		// Chat mode - original implementation
		const message = this.inputBox.value.trim();
		if (!message || this.isStreaming) {
			return;
		}

		// 清空输入框
		this.inputBox.value = '';
		this.inputBox.disabled = true;
		this.isStreaming = true;

		// 创建新的AbortController用于取消请求
		this.abortController = new AbortController();

		// 切换按钮显示：隐藏发送按钮，显示停止按钮
		this.sendButton.style.display = 'none';
		this.stopButton.style.display = 'flex';

		// 清除欢迎消息
		const welcome = this.messagesContentArea.querySelector('.welcome-message');
		if (welcome) {
			welcome.remove();
		}

		try {
			// 添加用户消息到UI
			const userMessage: ChatMessage = {
				id: Date.now().toString(),
				role: ChatRole.User,
				content: message,
				timestamp: Date.now()
			};
			this.messages.push(userMessage);
			this.renderUserMessage(userMessage);

			// 创建AI消息占位符
			const aiMessage: ChatMessage = {
				id: (Date.now() + 1).toString(),
				role: ChatRole.Assistant,
				content: '',
				timestamp: Date.now()
			};
			this.messages.push(aiMessage);
			this.streamingMessageElement = this.createMessageElement(aiMessage, true);

			// 只在用户处于底部时滚动
			if (this.streamingMessageElement) {
				this.scrollToBottomIfNeeded();
			}

			// 提取上下文（如果需要）
			let context;
			if (includeContext) {
				try {
					context = await this.aiChatService.extractContext();

					// 保存当前上下文并更新显示
					this.currentContext = context;
					this.updateContextDisplay();
				} catch (error) {
				}
			}

			// Build Ask mode prompt (based on Kilocode Ask mode)
			let prompt = `You are 码弦 AI, a knowledgeable technical assistant focused on answering questions and providing information about software development, technology, and related topics.

**User's Question:**
${message}`;

			// Add context if available
			if (context) {
				let contextParts: string[] = [];

				// Add current file info
				if (context.currentFile) {
					contextParts.push(`\n**当前文件:**`);
					contextParts.push(`文件名: ${context.currentFile.fileName}`);
					contextParts.push(`语言: ${context.currentFile.language}`);
					if (context.currentFile.content) {
						contextParts.push(`\n\`\`\`${context.currentFile.language}\n${context.currentFile.content}\n\`\`\``);
					}
				}

				// Add selected code
				if (context.selectedCode) {
					contextParts.push(`\n**选中代码:**`);
					contextParts.push(`\`\`\`${context.selectedCode.language}\n${context.selectedCode.code}\n\`\`\``);
				}

				// Add project info
				if (context.projectLanguage) {
					contextParts.push(`\n**项目信息:**`);
					contextParts.push(`语言: ${context.projectLanguage}`);
					if (context.projectFrameworks && context.projectFrameworks.length > 0) {
						contextParts.push(`框架: ${context.projectFrameworks.join(', ')}`);
					}
				}

				if (contextParts.length > 0) {
					prompt += contextParts.join('\n');
				}
			}

			// Add instructions
			prompt += `

**Instructions:**
You can analyze code, explain concepts, and access external resources. Always answer the user's questions thoroughly, and do not switch to implementing code unless explicitly requested by the user. Include Mermaid diagrams when they clarify your response.

Please respond in Chinese and use Markdown formatting.`;

			// 使用流式API发送（带上下文的提示词），传入abortSignal用于取消
			await this.aiService.completeStream(prompt, (chunk) => {
				// 实时更新UI
				this.updateStreamingMessage(chunk.content);

				// 如果完成，结束流式状态
				if (chunk.isComplete) {
					this.isStreaming = false;
				}
			}, this.abortController.signal);

		} catch (error) {
			if (this.streamingContentElement) {
				this.streamingContentElement.textContent = '抱歉，发送消息失败：' + error;
			}
		} finally {
			this.isStreaming = false;
			this.streamingMessageElement = null;
			this.streamingContentElement = null;
			this.inputBox.disabled = false;
			this.inputBox.focus();
			this.abortController = null; // 清理abortController

			// 恢复按钮显示：显示发送按钮，隐藏停止按钮
			this.sendButton.style.display = 'flex';
			this.stopButton.style.display = 'none';
		}
	}

	/**
	 * 渲染用户消息
	 */
	private renderUserMessage(message: ChatMessage): void {
		this.createMessageElement(message, false);
		// 用户发送消息后总是滚动到底部
		this.messageContainer.scrollTop = this.messageContainer.scrollHeight;
	}

	/**
	 * 创建消息元素 - 完全按照Copilot风格
	 */
	private createMessageElement(message: ChatMessage, isStreaming: boolean): HTMLElement {
		const messageElement = append(this.messagesContentArea, $('.ai-chat-message'));
		messageElement.style.marginBottom = '16px';
		messageElement.style.display = 'flex';
		messageElement.style.gap = '12px';
		messageElement.style.alignItems = 'flex-start';

		// 圆形头像
		const avatar = append(messageElement, $('.message-avatar'));
		avatar.style.width = '32px';
		avatar.style.height = '32px';
		avatar.style.borderRadius = '50%'; // 完全圆形
		avatar.style.display = 'flex';
		avatar.style.alignItems = 'center';
		avatar.style.justifyContent = 'center';
		avatar.style.fontSize = '16px';
		avatar.style.flexShrink = '0';
		avatar.style.marginTop = '0';

		// 根据角色设置头像样式 - 按照Copilot配色
		if (message.role === ChatRole.User) {
			// 用户: 深蓝色圆形
			avatar.textContent = '';
			avatar.style.background = '#0078D4';
			avatar.style.color = '#FFFFFF';
		} else {
			// AI: 渐变紫蓝色
			avatar.textContent = '';
			avatar.style.background = 'linear-gradient(135deg, #8B5CF6 0%, #3B82F6 100%)';
			avatar.style.color = '#FFFFFF';
		}

		// 消息内容区域 - 添加边框和背景
		const contentArea = append(messageElement, $('.message-content-area'));
		contentArea.style.flex = '1';
		contentArea.style.minWidth = '0';
		contentArea.style.maxWidth = '100%';
		contentArea.style.border = '1px solid var(--vscode-panel-border)';
		contentArea.style.borderRadius = '12px';
		contentArea.style.padding = '12px 16px';
		contentArea.style.backgroundColor = 'var(--vscode-editor-background)';

		// 消息内容
		const contentElement = append(contentArea, $('.message-content'));
		contentElement.style.fontSize = '14px';
		// contentElement.style.lineHeight = '1.4';
		contentElement.style.color = 'var(--vscode-foreground)';
		contentElement.style.wordWrap = 'break-word';
		contentElement.style.whiteSpace = 'pre-wrap';

		if (isStreaming) {
			this.streamingContentElement = contentElement;
			contentElement.textContent = '';
			// 流式传输时不显示光标
		} else {
			this.renderMessageContent(contentElement, message.content);
		}

		return messageElement;
	}

	/**
	 * 渲染消息内容 - 使用专业的 MarkdownRenderer,支持代码语法高亮
	 */
	private renderMessageContent(container: HTMLElement, content: string): void {
		// 清理内容：去除开头和结尾的多余空行，并将多个连续空行替换为单个换行
		let cleanedContent = content.trim();
		// 将3个及以上连续换行符替换为2个（保留段落间隔但去除多余空行）
		cleanedContent = cleanedContent.replace(/\n{3,}/g, '\n\n');

		// 所有内容都作为 Markdown 渲染，以获得更好的格式化效果
		const markdown = new MarkdownString(cleanedContent);
		markdown.isTrusted = true;
		markdown.supportHtml = true;
		markdown.supportThemeIcons = true;

		// 使用 MarkdownRenderer 渲染,它支持代码语法高亮
		const rendered = this.markdownRenderer.render(markdown);
		container.appendChild(rendered.element);

		// 为所有代码块添加复制按钮 - 使用 setTimeout 确保 DOM 已渲染
		// MarkdownRenderer 生成 <div data-code> 而不是 <pre>
		setTimeout(() => {
			const codeBlocks = container.querySelectorAll('div[data-code]');
			codeBlocks.forEach((codeBlock) => {
				this.addCopyButtonToCodeBlock(codeBlock as HTMLElement);
			});
		}, 0);
	}

	/**
	 * 为代码块添加复制按钮
	 * MarkdownRenderer 生成的代码块结构: <div data-code><div class="monaco-tokenized-source">...</div></div>
	 */
	private addCopyButtonToCodeBlock(codeBlock: HTMLElement): void {
		// 创建包装容器
		const wrapper = document.createElement('div');
		wrapper.style.position = 'relative';
		wrapper.style.margin = '12px 0';

		// 替换 codeBlock 元素
		codeBlock.parentNode?.replaceChild(wrapper, codeBlock);
		wrapper.appendChild(codeBlock);

		// 移除 codeBlock 的外边距（由 wrapper 控制）
		codeBlock.style.margin = '0';

		// 创建复制按钮
		const copyButton = document.createElement('button');
		copyButton.textContent = '📋';
		copyButton.title = '复制代码';
		copyButton.style.position = 'absolute';
		copyButton.style.top = '8px';
		copyButton.style.right = '8px';
		copyButton.style.width = '32px';
		copyButton.style.height = '32px';
		copyButton.style.border = '1px solid var(--vscode-button-border)';
		copyButton.style.borderRadius = '4px';
		copyButton.style.backgroundColor = 'var(--vscode-button-background)';
		copyButton.style.color = 'var(--vscode-button-foreground)';
		copyButton.style.cursor = 'pointer';
		copyButton.style.fontSize = '16px';
		copyButton.style.display = 'flex';
		copyButton.style.alignItems = 'center';
		copyButton.style.justifyContent = 'center';
		copyButton.style.opacity = '0.7';
		copyButton.style.transition = 'opacity 0.2s ease, background-color 0.2s ease';
		copyButton.style.zIndex = '10'; // 确保按钮在最上层

		// 鼠标悬停效果
		copyButton.addEventListener('mouseover', () => {
			copyButton.style.opacity = '1';
			copyButton.style.backgroundColor = 'var(--vscode-button-hoverBackground)';
		});
		copyButton.addEventListener('mouseout', () => {
			copyButton.style.opacity = '0.7';
			copyButton.style.backgroundColor = 'var(--vscode-button-background)';
		});

		// 点击复制
		copyButton.addEventListener('click', async () => {
			// 从 Monaco tokenized source 中提取文本内容
			// 结构: <div data-code><span><div class="monaco-tokenized-source">...</div></span></div>
			const monacoSource = codeBlock.querySelector('.monaco-tokenized-source');
			const code = monacoSource?.textContent || '';

			try {
				await navigator.clipboard.writeText(code);
				// 显示复制成功
				copyButton.textContent = '✓';
				copyButton.style.backgroundColor = 'var(--vscode-button-secondaryBackground)';
				setTimeout(() => {
					copyButton.textContent = '📋';
					copyButton.style.backgroundColor = 'var(--vscode-button-background)';
				}, 2000);
			} catch (err) {
				copyButton.textContent = '✗';
				setTimeout(() => {
					copyButton.textContent = '📋';
				}, 2000);
			}
		});

		wrapper.appendChild(copyButton);
	}

	/**
	 * 检测用户是否在底部（50px容差）
	 */
	private isNearBottom(): boolean {
		const threshold = 50;
		const scrollTop = this.messageContainer.scrollTop;
		const scrollHeight = this.messageContainer.scrollHeight;
		const clientHeight = this.messageContainer.clientHeight;
		return scrollHeight - scrollTop - clientHeight <= threshold;
	}

	/**
	 * 更新自动滚动状态
	 */
	private updateAutoScrollState(): void {
		this.shouldAutoScroll = this.isNearBottom();
	}

	/**
	 * 滚动到底部（如果应该自动滚动）
	 */
	private scrollToBottomIfNeeded(): void {
		if (this.shouldAutoScroll) {
			this.messageContainer.scrollTop = this.messageContainer.scrollHeight;
		}
	}

	/**
	 * 渲染消息列表
	 */
	private renderMessages(): void {
		if (!this.messagesContentArea) {
			return;
		}

		clearNode(this.messagesContentArea);

		for (const message of this.messages) {
			this.createMessageElement(message, false);
		}

		// 渲染完成后滚动到底部（初始加载时总是滚动）
		this.messageContainer.scrollTop = this.messageContainer.scrollHeight;
	}

	/**
	 * 更新流式消息内容
	 */
	updateStreamingMessage(content: string): void {
		if (this.streamingContentElement && this.messages.length > 0) {
			// 更新最后一条消息的内容
			const lastMessage = this.messages[this.messages.length - 1];
			lastMessage.content = content;

			// 清除容器
			clearNode(this.streamingContentElement);

			// 渲染内容（不添加光标）
			this.renderMessageContent(this.streamingContentElement, content);

			// 只在用户处于底部时滚动
			this.scrollToBottomIfNeeded();
		}
	}

	/**
	 * 添加CSS样式
	 */
	private addStyles(): void {
		const styleId = 'ai-chat-styles';
		if (document.getElementById(styleId)) {
			return; // 已经添加过了
		}

		const style = document.createElement('style');
		style.id = styleId;
		style.textContent = `
			@keyframes fadeIn {
				from {
					opacity: 0;
					transform: translateY(10px);
				}
				to {
					opacity: 1;
					transform: translateY(0);
				}
			}

			.ai-chat-message {
				animation: fadeIn 0.3s ease;
			}

			/* Markdown 基础排版 */
			.ai-chat-view .message-content {
				line-height: 1;
			}

			.ai-chat-view .message-content p {
				margin: 0.8em 0;
				line-height: 1;
			}

			.ai-chat-view .message-content p:first-child {
				margin-top: 0;
			}

			.ai-chat-view .message-content p:last-child {
				margin-bottom: 0;
			}

			/* 标题样式 */
			.ai-chat-view .message-content h1,
			.ai-chat-view .message-content h2,
			.ai-chat-view .message-content h3,
			.ai-chat-view .message-content h4,
			.ai-chat-view .message-content h5,
			.ai-chat-view .message-content h6 {
				margin: 1.2em 0 0.6em 0;
				font-weight: 600;
				line-height: 1;
			}

			.ai-chat-view .message-content h1 { font-size: 1.6em; }
			.ai-chat-view .message-content h2 { font-size: 1.4em; }
			.ai-chat-view .message-content h3 { font-size: 1.2em; }
			.ai-chat-view .message-content h4 { font-size: 1.1em; }

			/* 列表样式 */
			.ai-chat-view .message-content ul,
			.ai-chat-view .message-content ol {
				margin: 0.0em 0;
				padding-left: 2em;
			}

			.ai-chat-view .message-content li {
				margin: 0.0em 0;
				line-height: 1;
			}

			/* 引用块样式 */
			.ai-chat-view .message-content blockquote {
				margin: 1em 0;
				padding: 0.5em 1em;
				border-left: 3px solid var(--vscode-textBlockQuote-border);
				background-color: var(--vscode-textBlockQuote-background);
				color: var(--vscode-foreground);
			}

			/* 代码块样式 - 增强版 */
			.ai-chat-view .message-content pre {
				background-color: var(--vscode-textCodeBlock-background);
				border: 1px solid var(--vscode-panel-border);
				border-radius: 8px;
				padding: 14px 16px;
				margin: 12px 0;
				overflow-x: auto;
				overflow-y: auto;
				max-height: 500px;
				font-family: var(--vscode-editor-font-family);
				font-size: 13px;
				line-height: 1.5;
			}

			.ai-chat-view .message-content pre code {
				background: none;
				border: none;
				padding: 0;
				font-family: var(--vscode-editor-font-family);
				font-size: 13px;
				white-space: nowrap;
				display: inline-block;
				min-width: 100%;
			}

			/* 行内代码样式 - 不换行 */
			.ai-chat-view .message-content code {
				font-family: var(--vscode-editor-font-family);
				font-size: 0.9em;
				background-color: var(--vscode-textCodeBlock-background);
				border: 1px solid var(--vscode-panel-border);
				border-radius: 4px;
				padding: 2px 6px;
				white-space: nowrap;
			}

			.ai-chat-view .message-content :not(pre) > code {
				background-color: var(--vscode-textCodeBlock-background);
				border: 1px solid var(--vscode-panel-border);
				border-radius: 4px;
				padding: 2px 6px;
				white-space: nowrap;
			}

			/* 表格样式 */
			.ai-chat-view .message-content table {
				border-collapse: collapse;
				margin: 1em 0;
				width: 100%;
			}

			.ai-chat-view .message-content table th,
			.ai-chat-view .message-content table td {
				border: 1px solid var(--vscode-panel-border);
				padding: 8px 12px;
				text-align: left;
			}

			.ai-chat-view .message-content table th {
				background-color: var(--vscode-editor-background);
				font-weight: 600;
			}

			/* 分割线样式 */
			.ai-chat-view .message-content hr {
				border: none;
				border-top: 1px solid var(--vscode-panel-border);
				margin: 1.5em 0;
			}

			/* 链接样式 */
			.ai-chat-view .message-content a {
				color: var(--vscode-textLink-foreground);
				text-decoration: none;
			}

			.ai-chat-view .message-content a:hover {
				text-decoration: underline;
				color: var(--vscode-textLink-activeForeground);
			}

			/* 滚动条样式 */
			.ai-chat-messages::-webkit-scrollbar {
				width: 8px;
			}

			.ai-chat-messages::-webkit-scrollbar-track {
				background: transparent;
			}

			.ai-chat-messages::-webkit-scrollbar-thumb {
				background: var(--vscode-scrollbarSlider-background);
				border-radius: 4px;
			}

			.ai-chat-messages::-webkit-scrollbar-thumb:hover {
				background: var(--vscode-scrollbarSlider-hoverBackground);
			}

			/* 代码块滚动条样式 */
			.ai-chat-view .message-content pre::-webkit-scrollbar {
				height: 8px;
			}

			.ai-chat-view .message-content pre::-webkit-scrollbar-track {
				background: transparent;
			}

			.ai-chat-view .message-content pre::-webkit-scrollbar-thumb {
				background: var(--vscode-scrollbarSlider-background);
				border-radius: 4px;
			}

			.ai-chat-view .message-content pre::-webkit-scrollbar-thumb:hover {
				background: var(--vscode-scrollbarSlider-hoverBackground);
			}

			/* MarkdownRenderer 生成的代码块样式 (div[data-code]) */
			.ai-chat-view .message-content div[data-code] {
				background-color: var(--vscode-textCodeBlock-background);
				border: 1px solid var(--vscode-panel-border);
				border-radius: 8px;
				padding: 14px 16px;
				margin: 12px 0;
				overflow-x: auto;
				overflow-y: auto;
				max-height: 500px;
				font-family: var(--vscode-editor-font-family);
				font-size: 13px;
				line-height: 1.5;
				user-select: text;
				-webkit-user-select: text;
				-moz-user-select: text;
				-ms-user-select: text;
			}

			/* Monaco tokenized source - 不换行，支持文本选择 */
			.ai-chat-view .message-content .monaco-tokenized-source {
				white-space: nowrap;
				display: inline-block;
				min-width: 100%;
				user-select: text;
				-webkit-user-select: text;
				-moz-user-select: text;
				-ms-user-select: text;
			}

			/* 确保 Monaco tokenized source 的所有子元素都可以被选中 */
			.ai-chat-view .message-content .monaco-tokenized-source * {
				user-select: text;
				-webkit-user-select: text;
				-moz-user-select: text;
				-ms-user-select: text;
			}

			/* div[data-code] 滚动条样式 */
			.ai-chat-view .message-content div[data-code]::-webkit-scrollbar {
				height: 8px;
			}

			.ai-chat-view .message-content div[data-code]::-webkit-scrollbar-track {
				background: transparent;
			}

			.ai-chat-view .message-content div[data-code]::-webkit-scrollbar-thumb {
				background: var(--vscode-scrollbarSlider-background);
				border-radius: 4px;
			}

			.ai-chat-view .message-content div[data-code]::-webkit-scrollbar-thumb:hover {
				background: var(--vscode-scrollbarSlider-hoverBackground);
			}

			/* 上下文容器样式 */
			.ai-chat-context-container {
				transition: max-height 0.3s ease;
			}

			.ai-chat-context-container::-webkit-scrollbar {
				width: 8px;
			}

			.ai-chat-context-container::-webkit-scrollbar-track {
				background: transparent;
			}

			.ai-chat-context-container::-webkit-scrollbar-thumb {
				background: var(--vscode-scrollbarSlider-background);
				border-radius: 4px;
			}

			.ai-chat-context-container::-webkit-scrollbar-thumb:hover {
				background: var(--vscode-scrollbarSlider-hoverBackground);
			}

			/* 上下文项悬停效果 */
			.context-item {
				transition: background-color 0.2s ease;
			}

			.context-item:hover {
				background-color: var(--vscode-list-hoverBackground);
			}

			.context-item:last-child {
				border-bottom: none !important;
			}
		`;
		document.head.appendChild(style);
	}


	/**
	 * Execute Agent/Code task - With Full Tool Calling Support (Kilocode-style)
	 */
	private async executeAgentTask(): Promise<void> {
		const requirement = this.inputBox.value.trim();
		if (!requirement || this.isStreaming) {
			return;
		}

		this.inputBox.value = '';
		this.inputBox.disabled = true;
		this.isStreaming = true;

		// 创建新的AbortController用于取消请求
		this.abortController = new AbortController();

		// 切换按钮显示：隐藏发送按钮，显示停止按钮
		this.sendButton.style.display = 'none';
		this.stopButton.style.display = 'flex';

		try {
			// Add user message
			const userMessage: ChatMessage = {
				id: Date.now().toString(),
				role: ChatRole.User,
				content: requirement,
				timestamp: Date.now()
			};
			this.messages.push(userMessage);
			this.renderUserMessage(userMessage);

			// Create AI message placeholder for streaming
			const aiMessage: ChatMessage = {
				id: (Date.now() + 1).toString(),
				role: ChatRole.Assistant,
				content: '',
				timestamp: Date.now()
			};
			this.messages.push(aiMessage);
			this.streamingMessageElement = this.createMessageElement(aiMessage, true);

			// Initialize tool executor
			const workspace = this.workspaceService.getWorkspace().folders[0];
			if (!workspace) {
				throw new Error('未找到工作区');
			}

			const toolExecutor = new ToolExecutor(
				this.fileService,
				this.textFileService,
				workspace.uri,
				this.editorService
			);

			// Get project context
			const projectInfo = await this.projectAnalyzer.analyzeProject(workspace.uri);
			const contextInfo = `

**项目上下文:**
- 工作目录: ${workspace.uri.fsPath}
- 类型: ${projectInfo.type}
- 语言: ${projectInfo.language}
- 框架: ${projectInfo.framework}
`;

			// Build system prompt with VERY explicit tool usage requirements
			const systemPrompt = `You are 码弦 AI, a highly skilled software engineer.

**Project Context:**
${contextInfo}

**IMPORTANT - Multi-Module Project Structure:**
Many projects follow multi-module architecture (Maven/Gradle/Monorepo):
- Projects may have multiple submodules with different responsibilities
- Entity/domain classes are often in a shared "common" module
- Services, repositories, and mappers are usually in business logic modules
- Controllers/APIs are typically in web/api modules
- Resource files (XML, configs) are usually in the same module as related code

**Strategy for navigating projects:**
1. ALWAYS start with: list_files path="." recursive="false" to see the project structure
2. Use search_files with regex patterns to find classes across modules (e.g., search_files path="." regex="class.*Menu" file_pattern="**/*.java")
3. If a directory is not found, check other modules - files may be in different submodules
4. When you see an error "Directory not found", FIRST list the parent directory to understand the actual structure

**CRITICAL RULES:**
1. **USE TOOLS**: You MUST use tools to complete ALL tasks. DO NOT ask the user questions about file locations - use list_files to find them yourself.
2. **NO REPETITION**: DO NOT read the same file multiple times. Once you've read a file, remember its content and proceed to modify it.
3. **TAKE ACTION**: After reading 2-3 files, start making changes. Don't spend too long just reading - USE edit_file, apply_diff, or write_to_file to make actual modifications.
4. **BE EFFICIENT**: Read → Understand → Modify. Don't loop endlessly reading files.

**Tool Usage Format (REQUIRED):**
When you want to use a tool, output it in this EXACT XML format:

<TOOL_USE>
<tool_name>write_to_file</tool_name>
<path>example.txt</path>
<content>file content here</content>
</TOOL_USE>

**Available Tools:**

1. list_files - Find files in a directory (USE recursive=true for multi-module projects!)
   <TOOL_USE><tool_name>list_files</tool_name><path>.</path><recursive>true</recursive></TOOL_USE>
   Or list specific module: <TOOL_USE><tool_name>list_files</tool_name><path>backend</path><recursive>true</recursive></TOOL_USE>

2. read_file - Read file content
   <TOOL_USE><tool_name>read_file</tool_name><path>src/Example.java</path></TOOL_USE>

3. write_to_file - Create new file
   <TOOL_USE><tool_name>write_to_file</tool_name><path>test.txt</path><content>Hello World</content></TOOL_USE>

4. edit_file - Modify file (leave search empty to rewrite entire file)
   <TOOL_USE><tool_name>edit_file</tool_name><path>User.java</path><search></search><replace>new full content</replace></TOOL_USE>

5. attempt_completion - Finish task
   <TOOL_USE><tool_name>attempt_completion</tool_name><result>Task completed</result></TOOL_USE>

**WORKFLOW EXAMPLE 1 - Simple Edit:**
User: "在 KongServiceDTO 增加两个图片字段"

<TOOL_USE>
<tool_name>list_files</tool_name>
<path>src</path>
<recursive>true</recursive>
</TOOL_USE>

[After result: find KongServiceDTO.java]

<TOOL_USE>
<tool_name>read_file</tool_name>
<path>src/main/java/com/boyo/gateway/dto/KongServiceDTO.java</path>
</TOOL_USE>

[After result: see current code]

<TOOL_USE>
<tool_name>edit_file</tool_name>
<path>src/main/java/com/boyo/gateway/dto/KongServiceDTO.java</path>
<search></search>
<replace>...full content with new fields...</replace>
</TOOL_USE>

<TOOL_USE>
<tool_name>attempt_completion</tool_name>
<result>Added imageUrl1 and imageUrl2 fields</result>
</TOOL_USE>

**WORKFLOW EXAMPLE 2 - Full Business Layer (IMPORTANT):**
User: "创建用户管理功能，包括 User 的 DTO、Service、Mapper、Controller"

<TOOL_USE>
<tool_name>list_files</tool_name>
<path>src/main/java</path>
<recursive>true</recursive>
</TOOL_USE>

[After result: understand project structure and package names]

<TOOL_USE>
<tool_name>write_to_file</tool_name>
<path>src/main/java/com/boyo/gateway/dto/UserDTO.java</path>
<content>package com.boyo.gateway.dto;

import lombok.Data;

@Data
public class UserDTO {
    private Long id;
    private String username;
    private String email;
    private String phone;
}</content>
</TOOL_USE>

<TOOL_USE>
<tool_name>write_to_file</tool_name>
<path>src/main/java/com/boyo/gateway/mapper/UserMapper.java</path>
<content>package com.boyo.gateway.mapper;

import com.boyo.gateway.dto.UserDTO;
import org.apache.ibatis.annotations.Mapper;
import java.util.List;

@Mapper
public interface UserMapper {
    int insert(UserDTO user);
    int update(UserDTO user);
    int deleteById(Long id);
    UserDTO selectById(Long id);
    List<UserDTO> selectAll();
}</content>
</TOOL_USE>

<TOOL_USE>
<tool_name>write_to_file</tool_name>
<path>src/main/java/com/boyo/gateway/service/UserService.java</path>
<content>package com.boyo.gateway.service;

import com.boyo.gateway.dto.UserDTO;
import com.boyo.gateway.mapper.UserMapper;
import org.springframework.stereotype.Service;
import javax.annotation.Resource;
import java.util.List;

@Service
public class UserService {
    @Resource
    private UserMapper userMapper;

    public int createUser(UserDTO user) {
        return userMapper.insert(user);
    }

    public int updateUser(UserDTO user) {
        return userMapper.update(user);
    }

    public int deleteUser(Long id) {
        return userMapper.deleteById(id);
    }

    public UserDTO getUser(Long id) {
        return userMapper.selectById(id);
    }

    public List<UserDTO> getAllUsers() {
        return userMapper.selectAll();
    }
}</content>
</TOOL_USE>

<TOOL_USE>
<tool_name>write_to_file</tool_name>
<path>src/main/java/com/boyo/gateway/controller/UserController.java</path>
<content>package com.boyo.gateway.controller;

import com.boyo.gateway.dto.UserDTO;
import com.boyo.gateway.service.UserService;
import org.springframework.web.bind.annotation.*;
import javax.annotation.Resource;
import java.util.List;

@RestController
@RequestMapping("/api/users")
public class UserController {
    @Resource
    private UserService userService;

    @PostMapping
    public int createUser(@RequestBody UserDTO user) {
        return userService.createUser(user);
    }

    @PutMapping("/{id}")
    public int updateUser(@PathVariable Long id, @RequestBody UserDTO user) {
        user.setId(id);
        return userService.updateUser(user);
    }

    @DeleteMapping("/{id}")
    public int deleteUser(@PathVariable Long id) {
        return userService.deleteUser(id);
    }

    @GetMapping("/{id}")
    public UserDTO getUser(@PathVariable Long id) {
        return userService.getUser(id);
    }

    @GetMapping
    public List<UserDTO> getAllUsers() {
        return userService.getAllUsers();
    }
}</content>
</TOOL_USE>

<TOOL_USE>
<tool_name>attempt_completion</tool_name>
<result>完整的用户管理功能已创建：
- UserDTO (数据传输对象)
- UserMapper (数据访问层)
- UserService (业务逻辑层)
- UserController (控制层，提供 CRUD REST API)

所有文件已创建在正确的包路径下，遵循 Spring Boot 最佳实践。</result>
</TOOL_USE>

**IMPORTANT RULES:**
1. ALWAYS start by using list_files to understand the project structure
2. When creating new code, FIRST read similar existing files to learn the project's style:
   - Before creating XXXController, read an existing Controller to learn the style
   - Before creating XXXService, read an existing Service to learn patterns
   - Before creating XXXDTO, read an existing DTO to learn field naming
3. Follow the EXACT code style from existing files:
   - Same package naming convention
   - Same imports style
   - Same annotation usage (@Data, @Service, @RestController, etc.)
   - Same code structure and formatting
4. NEVER use fixed templates - always adapt to the project's actual style
5. NEVER ask the user where files are - use list_files and read_file to find them
6. ALWAYS use <TOOL_USE> XML format for EVERY action
7. Output tools one at a time, wait for result, then continue
8. Respond in Chinese but use English for XML tags

**CRITICAL WORKFLOW:**
Step 1: list_files with recursive=true (understand structure, find modules)
Step 2: For multi-module projects (backend/frontend), navigate into specific modules
Step 3: read_file (learn existing code style from similar files)
Step 4: Generate code matching the learned style
Step 5: write_to_file or edit_file (use full path including module name)
Step 6: attempt_completion

**MULTI-MODULE PROJECT TIPS:**
- If you see "backend/", "frontend/" or similar module directories, files are inside them
- Use recursive=true when listing files to see deep structure
- File paths should include module name: "backend/src/main/java/..."
- Always check existing files to understand the actual project structure

**COMPLETING BUSINESS LOGIC TASKS:**
When modifying business logic (e.g., "add a field and modify business logic"), you MUST update ALL relevant files:
1. Entity/Domain classes (add the field with getters/setters)
2. Mapper/DAO interfaces (add the field to SQL queries if needed)
3. Mapper XML files (update <result>, <insert>, <update> statements)
4. Service interface and implementation (update business methods)
5. Controller (update REST endpoints if the field should be exposed)
6. DTO classes (update data transfer objects if they exist)

DO NOT call attempt_completion until ALL these files have been modified. Use update_todo_list to track progress.

START USING TOOLS NOW!`;

			// Initialize conversation history with reinforced instructions
			const userPrompt = `${requirement}

IMPORTANT: You MUST use tools to complete this task. Start by using list_files to find relevant files. DO NOT ask me questions - use the tools to find information yourself.

Output your first tool call in XML format NOW:`;

			const messages: Array<{ role: string; content: string; tool_calls?: any[]; tool_call_id?: string; name?: string }> = [
				{ role: 'system', content: systemPrompt },
				{ role: 'user', content: userPrompt }
			];

			// Get available tools for Agent mode
			const tools = getToolsForMode('agent');

			// Tool calling loop (similar to Kilocode's recursivelyMakeClineRequests)
			let continueLoop = true;
			let consecutiveMistakeCount = 0; // Track consecutive mistakes (like Kilocode)
			const consecutiveMistakeLimit = 3; // Stop after 3 consecutive errors
			let fullConversation = ''; // 完整对话历史（用于最终显示）

			// Tool repetition detection (Kilocode's ToolRepetitionDetector)
			const toolRepetitionDetector = new ToolRepetitionDetector(3); // Limit to 3 consecutive identical tool calls

			while (continueLoop) {
				// Check consecutive mistake limit (like Kilocode)
				if (consecutiveMistakeCount >= consecutiveMistakeLimit) {
					fullConversation += `\n\n⚠️ **达到连续错误限制 (${consecutiveMistakeLimit} 次)**\n\n`;
					fullConversation += `AI 连续出现了 ${consecutiveMistakeLimit} 次错误（缺少参数、无效工具调用等）。请检查任务描述是否清晰，或尝试将任务分解为更小的步骤。\n`;
					this.updateStreamingMessage(fullConversation);
					break;
				}
				// 显示思考中...
				fullConversation += `\n\n🤔 **思考中...**\n`;
				this.updateStreamingMessage(fullConversation);

				// Message history truncation (Kilocode's truncateConversation)
				let limitedMessages = messages;
				const MAX_MESSAGES = 50;  // Truncate if more than 50 messages

				if (messages.length > MAX_MESSAGES) {
					// Use Kilocode's truncateConversation: remove first 50% of messages (excluding system prompt)
					limitedMessages = truncateConversation(messages, 0.5);
					console.log(`[Agent] Truncated conversation: ${messages.length} → ${limitedMessages.length} messages`);
				} else {
					console.log(`[Agent] No truncation needed: ${messages.length} messages (max: ${MAX_MESSAGES})`);
				}

				// Call AI (non-streaming)
				const response = await (this.aiService as any).completeWithTools(
					limitedMessages,
					tools,
					this.abortController?.signal
				);

				const responseText = response.content || '';
				let parsedToolCalls: Array<{ tool_call_id?: string; tool_name: string; params: any }> = [];

				// Check if response has tool_calls (Function Calling format from Qwen/OpenAI)
				if (response.tool_calls && Array.isArray(response.tool_calls) && response.tool_calls.length > 0) {
					console.log(`[Agent] Found ${response.tool_calls.length} tool calls in Function Calling format`);
					// Convert Function Calling format to our internal format
					parsedToolCalls = response.tool_calls.map((tc: any) => {
						let args = tc.function?.arguments || tc.arguments;

						// Parse arguments with JSON sanitization
						if (typeof args === 'string') {
							try {
								// First, try direct parsing
								args = JSON.parse(args);
							} catch (firstError) {
								// If direct parsing fails, try sanitizing the string
								console.warn('[Agent] Initial JSON parse failed, attempting sanitization...');
								console.warn('[Agent] Parse error:', firstError);
								try {
									// Sanitize: This is tricky because we need to distinguish between:
									// 1. Literal newlines in the JSON string itself (should be escaped)
									// 2. Escaped newlines in JSON values (should stay as \\n)
									// We'll attempt a conservative approach: only fix literal control chars
									let sanitized = args;
									// Only replace unescaped control characters
									// Check if there are literal newlines, tabs, etc that aren't already escaped
									sanitized = sanitized.replace(/([^\\])\n/g, '$1\\n');  // unescaped newline
									sanitized = sanitized.replace(/([^\\])\r/g, '$1\\r');  // unescaped carriage return
									sanitized = sanitized.replace(/([^\\])\t/g, '$1\\t');  // unescaped tab
									// Handle newline at start of string
									if (sanitized.startsWith('\n')) {
										sanitized = '\\n' + sanitized.substring(1);
									}
									if (sanitized.startsWith('\r')) {
										sanitized = '\\r' + sanitized.substring(1);
									}
									if (sanitized.startsWith('\t')) {
										sanitized = '\\t' + sanitized.substring(1);
									}

									args = JSON.parse(sanitized);
									console.log('[Agent] JSON sanitization successful');
								} catch (secondError) {
									console.error('[Agent] Failed to parse tool arguments even after sanitization');
									console.error('[Agent] Original arguments (first 500 chars):', args.substring(0, 500));
									console.error('[Agent] Sanitization error:', secondError);
									return null;  // Skip this tool call
								}
							}
						} else if (typeof args !== 'object') {
							// If args is not a string or object, use empty object
							args = {};
						}

						return {
							tool_call_id: tc.id,  // Preserve tool_call_id for proper response format
							tool_name: tc.function?.name || tc.name,
							params: args
						};
					}).filter((tc: { tool_call_id?: string; tool_name: string; params: any } | null): tc is { tool_call_id?: string; tool_name: string; params: any } => tc !== null);
				} else {
					// Fall back to XML parsing for models that return XML format
					parsedToolCalls = this.parseToolCallsFromXml(responseText);
				}

				console.log(`[Agent] Parsed ${parsedToolCalls.length} tool calls from response`);

				// Check if AI called any tools
				if (parsedToolCalls.length === 0) {
					// No tools called - this could be a mistake or task completion
					if (responseText && responseText.trim().length > 0) {
						// AI provided a response without using tools (might be trying to complete)
						fullConversation += `\n\n💬 **AI**: ${responseText}`;
						this.updateStreamingMessage(fullConversation);
						continueLoop = false;
						break;
					} else {
						// AI didn't call any tools and didn't provide a response - this is a mistake
						consecutiveMistakeCount++;
						console.log(`[Agent] No tools called and no response. Consecutive mistakes: ${consecutiveMistakeCount}`);
						fullConversation += `\n\n⚠️ AI 没有调用任何工具也没有提供回复。请尝试使用工具完成任务。\n`;
						this.updateStreamingMessage(fullConversation);
						// Add user message to prompt tool usage
						messages.push({
							role: 'user',
							content: 'You must use tools to complete this task. Please use list_files, read_file, search_files, or other available tools to gather information and make changes. Use attempt_completion when the task is fully done.'
						});
						continue;
					}
				}

				// Extract text before tool use (AI's explanation) - only for XML format
				const textBeforeTools = responseText.includes('<TOOL_USE>')
					? responseText.split('<TOOL_USE>')[0].trim()
					: responseText;
				if (textBeforeTools) {
					fullConversation += `\n\n💬 **AI**: ${textBeforeTools}`;
				}

				// Add assistant message
				messages.push({
					role: 'assistant',
					content: responseText,
					tool_calls: response.tool_calls // Preserve tool_calls for proper history
				});

				// Execute all tool calls
				for (const toolCall of parsedToolCalls) {
					const toolName = toolCall.tool_name;
					const toolArgs = toolCall.params;
					const toolCallId = toolCall.tool_call_id;  // Get tool_call_id for Function Calling format

					// Display tool execution
					const toolInfo = `\n\n🔧 **使用工具**: \`${toolName}\`\n📋 **参数**: \n\`\`\`json\n${JSON.stringify(toolArgs, null, 2)}\n\`\`\`\n`;
					fullConversation += toolInfo;
					this.updateStreamingMessage(fullConversation);

					// Tool repetition detection (Kilocode's ToolRepetitionDetector.check)
					const repetitionCheck = toolRepetitionDetector.check({ name: toolName, params: toolArgs });

					if (!repetitionCheck.allowExecution && repetitionCheck.askUser) {
						// Repetition limit reached, skip execution
						consecutiveMistakeCount++;

						const errorMessage = `⚠️ **工具重复调用限制已达到**\n\n${repetitionCheck.askUser.messageDetail.replace('{toolName}', toolName)}`;
						fullConversation += `\n\n${errorMessage}\n`;
						this.updateStreamingMessage(fullConversation);

						// Add error message to conversation history
						if (toolCallId) {
							messages.push({
								role: 'tool',
								tool_call_id: toolCallId,
								content: errorMessage
							});
						} else {
							messages.push({
								role: 'user',
								content: errorMessage
							});
						}

						console.log(`[Agent] Skipped tool execution due to repetition: ${toolName}`);
						continue; // Skip this tool call
					}

					// Execute tool
					let result: string;
					try {
						console.log(`[Agent] Executing tool: ${toolName}`, toolArgs);

						switch (toolName) {
							// File operation tools
							case 'read_file':
								result = await toolExecutor.executeReadFile(toolArgs);
								console.log(`[Agent] read_file result:`, result.substring(0, 100));
								break;
							case 'write_to_file':
								result = await toolExecutor.executeWriteToFile(toolArgs);
								console.log(`[Agent] write_to_file result:`, result);
								break;
							case 'edit_file':
								result = await toolExecutor.executeEditFile(toolArgs);
								break;
							case 'apply_diff':
								result = await toolExecutor.executeApplyDiff(toolArgs);
								break;
							case 'insert_content':
								result = await toolExecutor.executeInsertContent(toolArgs);
								break;
							case 'simple_read_file':
								result = await toolExecutor.executeSimpleReadFile(toolArgs);
								break;

							// File browsing tools
							case 'list_files':
								result = await toolExecutor.executeListFiles(toolArgs);
								break;
							case 'search_files':
								result = await toolExecutor.executeSearchFiles(toolArgs);
								break;
							case 'list_code_definition_names':
								result = await toolExecutor.executeListCodeDefinitions(toolArgs);
								break;
							case 'codebase_search':
								result = await toolExecutor.executeCodebaseSearch(toolArgs);
								break;

							// Command and execution tools
							case 'execute_command':
								result = await toolExecutor.executeCommand(toolArgs);
								break;

							// Interaction tools
							case 'attempt_completion':
								// Task complete
								result = `✅ 任务完成\n\n${toolArgs.result || ''}`;
								fullConversation += `\n\n${result}\n`;
								this.updateStreamingMessage(fullConversation);
								continueLoop = false;
								break;
							case 'ask_followup_question':
								result = `❓ AI 询问: ${toolArgs.question}`;
								// TODO: Actually ask user the question
								break;

							// Browser automation tools
							case 'browser_action':
								result = await toolExecutor.executeBrowserAction(toolArgs);
								break;

							// MCP tools
							case 'access_mcp_resource':
								result = await toolExecutor.executeAccessMcpResource(toolArgs);
								break;
							case 'use_mcp_tool':
								result = await toolExecutor.executeUseMcpTool(toolArgs);
								break;

							// Image generation
							case 'generate_image':
								result = await toolExecutor.executeGenerateImage(toolArgs);
								break;

							// Instructions and rules
							case 'fetch_instructions':
								result = await toolExecutor.executeFetchInstructions(toolArgs);
								break;
							case 'new_rule':
								result = await toolExecutor.executeNewRule(toolArgs);
								break;

							// Task management
							case 'new_task':
								result = await toolExecutor.executeNewTask(toolArgs);
								break;
							case 'update_todo_list':
								result = await toolExecutor.executeUpdateTodoList(toolArgs);
								break;
							case 'switch_mode':
								result = await toolExecutor.executeSwitchMode(toolArgs);
								break;

							// Bug reporting
							case 'report_bug':
								result = await toolExecutor.executeReportBug(toolArgs);
								break;

							// Slash commands
							case 'run_slash_command':
								result = await toolExecutor.executeRunSlashCommand(toolArgs);
								break;

							// Advanced tools
							case 'condense':
								result = await toolExecutor.executeCondense(toolArgs);
								break;
							case 'multi_apply_diff':
								result = await toolExecutor.executeMultiApplyDiff(toolArgs);
								break;

							default:
								result = `⚠️ 未知工具: ${toolName}`;
						}
					} catch (error) {
						result = `❌ 工具执行失败: ${error instanceof Error ? error.message : String(error)}`;
						consecutiveMistakeCount++;  // Tool execution failed
						console.log(`[Agent] Tool execution failed. Consecutive mistakes: ${consecutiveMistakeCount}`);
					}

					// Check if tool result indicates success or error
					if (result.startsWith('❌') || result.startsWith('Error:') || result.startsWith('⚠️')) {
						// Tool failed or returned error
						consecutiveMistakeCount++;
						console.log(`[Agent] Tool returned error. Consecutive mistakes: ${consecutiveMistakeCount}`);
					} else {
						// Tool succeeded
						consecutiveMistakeCount = 0;  // Reset on success (like Kilocode)
						console.log(`[Agent] Tool executed successfully. Reset consecutive mistakes to 0`);
					}

					// Display tool result
					if (toolName !== 'attempt_completion') {
						// For list_files and search_files, show more content in UI
						const displayLimit = (toolName === 'list_files' || toolName === 'search_files') ? 3000 : 500;
						const resultInfo = `\n✅ **结果**: \n\`\`\`\n${result.substring(0, displayLimit)}${result.length > displayLimit ? '...' : ''}\n\`\`\`\n`;
						fullConversation += resultInfo;
						this.updateStreamingMessage(fullConversation);
					}

					// Add tool result to conversation history (NO TRUNCATION)
					// Send full content to AI - let the model handle large files
					// If we have tool_call_id (Function Calling format), use role: 'tool'
					// Otherwise fall back to role: 'user' for XML format compatibility
					if (toolCallId) {
						messages.push({
							role: 'tool',
							tool_call_id: toolCallId,
							content: result
						});
					} else {
						messages.push({
							role: 'user',
							content: `Tool: ${toolName}\nResult:\n${result}`
						});
					}
				}

				// Check if we should stop
				if (!continueLoop) {
					break;
				}
			}

			// Loop ended - either task completed or mistake limit reached
			// The appropriate message was already shown in the loop

		} catch (error) {
			if (this.streamingContentElement) {
				this.streamingContentElement.textContent = '抱歉，Agent 执行失败：' + error;
			}
		} finally {
			this.isStreaming = false;
			this.streamingMessageElement = null;
			this.streamingContentElement = null;
			this.inputBox.disabled = false;
			this.inputBox.focus();
			this.abortController = null;

			// 恢复按钮显示：显示发送按钮，隐藏停止按钮
			this.sendButton.style.display = 'flex';
			this.stopButton.style.display = 'none';
		}
	}

	/**
	 * Execute Architect task (Planning mode) - Based on Kilocode Architect mode
	 */
	private async executeArchitectTask(): Promise<void> {
		const requirement = this.inputBox.value.trim();
		if (!requirement || this.isStreaming) {
			return;
		}

		this.inputBox.value = '';
		this.inputBox.disabled = true;
		this.isStreaming = true;

		// 创建新的AbortController用于取消请求
		this.abortController = new AbortController();

		// 切换按钮显示：隐藏发送按钮，显示停止按钮
		this.sendButton.style.display = 'none';
		this.stopButton.style.display = 'flex';

		try {
			// Add user message
			const userMessage: ChatMessage = {
				id: Date.now().toString(),
				role: ChatRole.User,
				content: requirement,
				timestamp: Date.now()
			};
			this.messages.push(userMessage);
			this.renderUserMessage(userMessage);

			// Create AI message placeholder for streaming
			const aiMessage: ChatMessage = {
				id: (Date.now() + 1).toString(),
				role: ChatRole.Assistant,
				content: '',
				timestamp: Date.now()
			};
			this.messages.push(aiMessage);
			this.streamingMessageElement = this.createMessageElement(aiMessage, true);

			// Get workspace and project info
			const workspace = this.workspaceService.getWorkspace().folders[0];
			let contextInfo = '';
			if (workspace) {
				const projectInfo = await this.projectAnalyzer.analyzeProject(workspace.uri);
				contextInfo = `

**项目上下文:**
- 类型: ${projectInfo.type}
- 语言: ${projectInfo.language}
- 框架: ${projectInfo.framework}
`;
			}

			// Architect mode prompt (based on Kilocode)
			const architectPrompt = `You are 码弦 AI, an experienced technical leader who is inquisitive and an excellent planner. Your goal is to gather information and get context to create a detailed plan for accomplishing the user's task, which the user will review and approve before they switch into another mode to implement the solution.

**User's Request:**
${requirement}
${contextInfo}

**Instructions:**
1. Do some information gathering to get more context about the task
2. You should also ask the user clarifying questions to get a better understanding of the task
3. Once you've gained more context, break down the task into clear, actionable steps. Each todo item should be:
   - Specific and actionable
   - Listed in logical execution order
   - Focused on a single, well-defined outcome
   - Clear enough that another mode could execute it independently
4. As you gather more information or discover new requirements, update your plan to reflect the current understanding
5. Ask the user if they are pleased with this plan, or if they would like to make any changes
6. Include Mermaid diagrams if they help clarify complex workflows or system architecture
7. Suggest switching to Code mode to implement the solution

**IMPORTANT:** Focus on creating clear, actionable plans. Use the plan as your primary planning tool to track and organize the work that needs to be done.

Please respond in Chinese and use Markdown formatting.`;

			// Use streaming API
			await this.aiService.completeStream(architectPrompt, (chunk) => {
				// 实时更新UI
				this.updateStreamingMessage(chunk.content);

				// 如果完成，结束流式状态
				if (chunk.isComplete) {
					this.isStreaming = false;
				}
			}, this.abortController.signal);

		} catch (error) {
			if (this.streamingContentElement) {
				this.streamingContentElement.textContent = '抱歉，Architect 规划失败：' + error;
			}
		} finally {
			this.isStreaming = false;
			this.streamingMessageElement = null;
			this.streamingContentElement = null;
			this.inputBox.disabled = false;
			this.inputBox.focus();
			this.abortController = null;

			// 恢复按钮显示：显示发送按钮，隐藏停止按钮
			this.sendButton.style.display = 'flex';
			this.stopButton.style.display = 'none';
		}
	}


	/**
	 * 清除聊天历史
	 */
	clearChat(): void {
		// 保存输入框的当前内容
		const currentInput = this.inputBox ? this.inputBox.value : '';

		this.messages = [];
		this.aiChatService.clearHistory();

		// 只清除消息内容区域，不影响输入框
		if (this.messagesContentArea) {
			clearNode(this.messagesContentArea);
			this.showWelcomeMessage();
		}

		// 恢复输入框的内容和焦点
		if (this.inputBox) {
			this.inputBox.value = currentInput;
			this.inputBox.focus();
		}
	}

	/**
	 * Parse tool calls from XML format in AI response
	 */
	private parseToolCallsFromXml(text: string): Array<{ tool_name: string; params: any }> {
		const toolCalls: Array<{ tool_name: string; params: any }> = [];
		const toolUseRegex = /<TOOL_USE>([\s\S]*?)<\/TOOL_USE>/g;
		let match;

		while ((match = toolUseRegex.exec(text)) !== null) {
			const toolContent = match[1];

			// Extract tool_name
			const toolNameMatch = toolContent.match(/<tool_name>(.*?)<\/tool_name>/);
			if (!toolNameMatch) {
				continue;
			}

			const toolName = toolNameMatch[1].trim();
			const params: any = {};

			// Extract all parameters
			const paramRegex = /<(\w+)>([\s\S]*?)<\/\1>/g;
			let paramMatch;

			while ((paramMatch = paramRegex.exec(toolContent)) !== null) {
				const paramName = paramMatch[1];
				const paramValue = paramMatch[2].trim();

				if (paramName !== 'tool_name') {
					params[paramName] = paramValue;
				}
			}

			toolCalls.push({ tool_name: toolName, params });
		}

		return toolCalls;
	}

	override focus(): void {
		super.focus();
		if (this.inputBox) {
			this.inputBox.focus();
		}
	}
}
