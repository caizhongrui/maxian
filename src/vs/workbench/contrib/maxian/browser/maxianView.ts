/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IViewPaneOptions, ViewPane } from '../../../browser/parts/views/viewPane.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IContextKeyService, IContextKey } from '../../../../platform/contextkey/common/contextkey.js';
import { MAXIAN_INPUT_FOCUSED, MAXIAN_MENTION_DROPDOWN_VISIBLE } from './maxianContextKeys.js';
import { IViewDescriptorService } from '../../../common/views.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { IMaxianService, type ITokenUsageEvent, type ITaskProgressEvent, type IToolInputStreamingEvent, type IToolCompletedEvent, type ITodoListEvent, type ITodoItem } from './maxianService.js';
import { type McpServerConfig, type McpServerInfo } from '../common/mcp/McpTypes.js';
import { type AskHistoryItem } from '../../../../platform/aiLog/common/aiLog.js';
import { $, append, clearNode } from '../../../../base/browser/dom.js';
import { IStorageService, StorageScope } from '../../../../platform/storage/common/storage.js';
import { getAllModes, DEFAULT_MODE, type Mode } from '../common/modes/modeTypes.js';
import { MarkdownRendererDom } from './markdownRendererDom.js';
import { FileAccess } from '../../../../base/common/network.js';
import { URI } from '../../../../base/common/uri.js';
import { ClineMessage } from '../common/task/taskTypes.js';
import { IAuthService } from '../../auth/common/authService.js';
import {
	renderDiffStats,
	calculateSearchReplaceDiffStats,
	calculateDiffStats,
	renderFilePath,
	renderTokenStats,
	getToolIcon,
	formatTime,
	createCopyButton,
	createErrorCard,
	createRetryStatus,
	createCollapsible,
	createCompactionStatus,
	createDiagnosticsSummary,
	parseDiagnosticsFromToolResult,
	type DiffStats,
	type ToolStatus,
	TOOL_STATUS_TEXT,
	// TOOL_STATUS_COLOR 已通过 CSS 类名替代
	// 以下导入保留用于后续功能
	// createProgressBar,
	// type TokenStats,
} from './uiUtils.js';
import { ensureFollowupOptions } from '../common/tools/toolExecutionProtocol.js';

/**
 * 码弦 Agent 视图面板
 * 基于Kilocode的功能设计，用VSCode内部API重新实现
 */
export class MaxianView extends ViewPane {
	private container!: HTMLElement;
	private messageArea!: HTMLElement;
	private inputBox!: HTMLDivElement; // contenteditable，支持内嵌文件 chip
	private inputPlaceholderEl!: HTMLElement; // placeholder 覆盖层
	private sendButton!: HTMLButtonElement;
	private currentAiMessageElement: HTMLElement | null = null;
	private currentAiMessageText: string = ''; // 累积的原始文本
	private currentStreamingMessageElement: HTMLElement | null = null; // 流式消息的外层容器（用于complete时替换）
	private pendingTextStreamBuffer: string = ''; // 文本流缓冲区（用于节流渲染）
	private pendingTextStreamPartial = false; // 缓冲区内是否包含 partial 片段
	private pendingTextStreamFinalize = false; // 是否收到流结束信号
	private textStreamFlushTimer: number | null = null; // 文本流节流定时器
	private currentMode: Mode = DEFAULT_MODE;
	private modeSelector!: HTMLDivElement; // 模式选择器显示框
	private modeDropdown!: HTMLDivElement; // 模式下拉列表
	private modeDropdownList!: HTMLUListElement; // 模式下拉列表ul
	private modeSelectorIcon!: HTMLSpanElement; // 模式选择器图标
	private modeSelectorArrow!: HTMLSpanElement; // 模式选择器箭头
	private isModeDropdownOpeningUpward: boolean = false; // 模式下拉列表是否向上展开
	private isModeDropdownOpen: boolean = false; // 模式下拉列表是否打开
	private awaitingUserResponse: boolean = false; // 是否正在等待用户回答AI的问题
	private currentToolStatusElement: HTMLElement | null = null; // 当前工具状态元素（更新而非新建）
	private toolStatusElements: Map<string, HTMLElement> = new Map(); // 工具ID到状态元素的映射（支持并行工具）
	private thinkingMessageElement: HTMLElement | null = null; // "正在思考"消息元素（避免重复显示）
	private apiRequestStartAt: number | null = null; // 当前 API 请求开始时间
	private apiRequestProgressTimer: number | null = null; // API 请求进度刷新定时器
	private apiRequestRetryCount = 0; // 当前请求重试次数
	private apiRequestBackendHint: string | null = null; // 后端心跳提示
	private waitingIndicatorElement: HTMLElement | null = null; // 发送后"等待中"三点动画气泡
	private codeContextBar: HTMLElement | null = null; // 代码片段预览卡片容器
	private codeContextCards: Map<string, HTMLElement> = new Map(); // relativePath → 卡片元素
	private codePreviewPopup: HTMLElement | null = null; // 粘贴代码 chip 点击后的浮层预览
	private tokenStatsElement: HTMLElement | null = null; // token统计元素（唯一，更新而非累加）
	private cancelButton!: HTMLButtonElement; // 取消任务按钮
	private clearButton!: HTMLButtonElement; // 清空对话按钮
	// @ts-ignore used in handleConversationCleared
	private welcomeElement: HTMLElement | null = null; // 欢迎消息元素引用
	private knowledgeBaseSelector!: HTMLDivElement; // 知识库选择器显示框
	private knowledgeBaseDropdown!: HTMLDivElement; // 知识库下拉列表
	private knowledgeBaseDropdownList!: HTMLUListElement; // 知识库下拉列表ul
	private knowledgeBaseSelectorArrow!: HTMLSpanElement; // 知识库选择器箭头
	private selectedKnowledgeBaseId: string | null = null; // 当前选中的知识库ID
	private isDropdownOpeningUpward: boolean = false; // 下拉列表是否向上展开
	private isKnowledgeBaseDropdownOpen: boolean = false; // 知识库下拉列表是否打开
	private knowledgeBases: Array<{
		id: string;
		applicationName: string;
		applicationUrl: string;
		applicationKey: string;
	}> = []; // 知识库列表
	private isContinuousConversation: boolean = false; // 是否启用连续对话（ask模式专用）
	private continuousConversationCheckbox!: HTMLInputElement; // 连续对话复选框
	private continuousConversationWrapper!: HTMLLabelElement; // 连续对话复选框容器
	private knowledgeBaseSelectorWrapper!: HTMLDivElement; // 知识库选择器包装容器（仅ask模式显示）
	private historyPanel: HTMLElement | null = null; // 问答历史面板
	// Reasoning 思考过程相关
	private currentReasoningElement: HTMLElement | null = null; // 当前思考过程元素
	private currentReasoningText: string = ''; // 累积的思考文本
	// 任务进度条相关
	private taskProgressContainer: HTMLElement | null = null; // 进度条容器
	private taskProgressBar: HTMLElement | null = null; // 进度条填充元素
	private taskProgressText: HTMLElement | null = null; // 进度条文字
	private taskProgressStep: HTMLElement | null = null; // 当前步骤描述
	// 工具输入流式显示相关
	private toolInputStreamingElements: Map<string, HTMLElement> = new Map(); // 工具ID到显示元素的映射
	private toolInputThrottleTimers: Map<string, number> = new Map(); // 节流定时器
	private toolInputPendingEvents: Map<string, IToolInputStreamingEvent> = new Map(); // 待渲染的最新事件
	// 任务列表相关
	private todoListContainer: HTMLElement | null = null; // 任务列表容器
	private todoListContent: HTMLElement | null = null; // 任务列表内容区域
	// @文件引用 自动完成相关
	private mentionDropdown: HTMLElement | null = null; // @mention 下拉列表容器（用于部分输入时的过滤）
	private mentionDropdownItems: string[] = []; // 当前下拉列表中的文件路径
	private mentionDropdownIndex: number = -1; // 当前高亮项索引
	// @mention 特殊选项（@git:diff、@web:）
	private mentionDropdownSpecialItems: Array<{ type: 'special'; key: string; label: string; icon: string; description: string }> = [];
	// @mention 相关（contenteditable 光标跟踪）
	private mentionAtNode: Text | null = null; // 包含 @ 的文本节点
	private mentionAtOffset: number = -1;      // @ 在文本节点中的 offset
	private mentionCursorOffset: number = -1;  // 光标在文本节点中的 offset
	// #mcp 相关（同 mentionDropdown 复用，通过 mentionDropdownMode 区分）
	private mentionDropdownMode: '@' | '#' = '@'; // 当前下拉是 @ 还是 # 触发
	// 快捷键上下文键
	private maxianInputFocusedCtx!: IContextKey<boolean>;
	private maxianMentionDropdownVisibleCtx!: IContextKey<boolean>;
	// MCP 设置面板
	private mcpPanel: HTMLElement | null = null;

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
		@IMaxianService private readonly maxianService: IMaxianService,
		@IAuthService private readonly authService: IAuthService,
		@IStorageService private readonly storageService: IStorageService
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, telemetryService, hoverService);
	}

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);

		this.container = container;
		this.container.style.display = 'flex';
		this.container.style.flexDirection = 'column';
		this.container.style.height = '100%';
		this.container.style.padding = '0';
		this.container.style.overflow = 'hidden';

		// 添加样式
		this.addStyles();

		// 初始化快捷键上下文键
		this.maxianInputFocusedCtx = MAXIAN_INPUT_FOCUSED.bindTo(this.contextKeyService);
		this.maxianMentionDropdownVisibleCtx = MAXIAN_MENTION_DROPDOWN_VISIBLE.bindTo(this.contextKeyService);

		// 订阅快捷键触发事件
		this._register(this.maxianService.onTriggerSend(() => {
			this.sendButton.click();
		}));
		this._register(this.maxianService.onTriggerNewLine(() => {
			this.handleNewLineInInput();
		}));
		this._register(this.maxianService.onTriggerOpenView(() => {
			// 聚焦输入框即可
			this.inputBox?.focus();
		}));
		this._register(this.maxianService.onTriggerStopGeneration(() => {
			this.cancelButton?.click();
		}));
		this._register(this.maxianService.onTriggerClearConversation(() => {
			this.clearButton?.click();
		}));

		// 当快捷键绑定发生变化时，更新输入框 placeholder 文字
		this._register(this.keybindingService.onDidUpdateKeybindings(() => {
			this.refreshInputPlaceholderText();
		}));

		// 监听旧版消息事件（向后兼容）
		this._register(this.maxianService.onMessage(event => {
			this.handleMessageEvent(event);
		}));

		// 监听新版Cline消息事件
		this._register(this.maxianService.onClineMessage(event => {
			this.renderClineMessage(event.message);
		}));

		// 监听AI提问事件（向后兼容）
		this._register(this.maxianService.onQuestionAsked(event => {
			this.handleQuestionAsked(event);
		}));

		// 监听任务取消事件
		this._register(this.maxianService.onTaskCancelled(() => {
			this.handleTaskCancelled();
		}));

		// 监听对话清空事件
		this._register(this.maxianService.onConversationCleared(() => {
			this.handleConversationCleared();
		}));

		// 监听用户登录状态变化,更新可用模式和知识库
		this._register(this.authService.onDidChangeUser(() => {
			this.updateAvailableModes();
			this.loadKnowledgeBases(); // 重新加载知识库列表
		}));

		// 监听Token使用量事件
		this._register(this.maxianService.onTokenUsage(event => {
			this.handleTokenUsage(event);
		}));

		// 监听任务进度事件
		this._register(this.maxianService.onTaskProgress(event => {
			this.handleTaskProgress(event);
		}));

		// 监听工具输入流式事件
		this._register(this.maxianService.onToolInputStreaming(event => {
			this.handleToolInputStreaming(event);
		}));

		// 监听工具完成事件
		this._register(this.maxianService.onToolCompleted(event => {
			this.handleToolCompleted(event);
		}));

		// 监听任务列表更新事件
		this._register(this.maxianService.onTodoListUpdate(event => {
			this.handleTodoListUpdate(event);
		}));

		// ========== 创建消息区域 ==========
		this.messageArea = append(this.container, $('div.maxian-messages'));

		// ========== 创建任务进度条区域（消息区域上方） ==========
		this.createTaskProgressBar();

		// ========== 创建任务列表区域（进度条下方） ==========
		this.createTodoListContainer();

		this.messageArea.style.flex = '1';
		this.messageArea.style.overflowY = 'auto';
		this.messageArea.style.padding = '8px 12px';
		this.messageArea.style.backgroundColor = 'var(--vscode-editor-background)';

		// 欢迎消息
		const welcome = append(this.messageArea, $('div'));
		this.welcomeElement = welcome; // 保存引用
		welcome.style.display = 'flex';
		welcome.style.flexDirection = 'column';
		welcome.style.alignItems = 'center';
		welcome.style.justifyContent = 'center';
		welcome.style.height = '100%';
		welcome.style.padding = '0 24px';
		welcome.style.userSelect = 'none';
		welcome.style.gap = '16px';

		// 头像
		const avatarRing = append(welcome, $('div'));
		avatarRing.style.width = '72px';
		avatarRing.style.height = '72px';
		avatarRing.style.borderRadius = '20px';
		avatarRing.style.padding = '2px';
		avatarRing.style.background = 'var(--vscode-focusBorder, #007acc)';
		avatarRing.style.boxShadow = '0 4px 20px rgba(0,0,0,0.15)';
		avatarRing.style.flexShrink = '0';

		const avatarInner = append(avatarRing, $('div'));
		avatarInner.style.width = '100%';
		avatarInner.style.height = '100%';
		avatarInner.style.borderRadius = '18px';
		avatarInner.style.overflow = 'hidden';
		avatarInner.style.background = 'var(--vscode-editor-background)';

		const welcomeIcon = append(avatarInner, $('img')) as HTMLImageElement;
		welcomeIcon.src = FileAccess.asBrowserUri('vs/workbench/contrib/maxian/browser/media/icons/maxian-avatar.png').toString(true);
		welcomeIcon.style.width = '100%';
		welcomeIcon.style.height = '100%';
		welcomeIcon.style.objectFit = 'cover';
		welcomeIcon.style.display = 'block';

		// 标题
		const welcomeTitle = append(welcome, $('div'));
		welcomeTitle.textContent = '码弦';
		welcomeTitle.style.fontSize = '22px';
		welcomeTitle.style.fontWeight = '600';
		welcomeTitle.style.letterSpacing = '3px';
		welcomeTitle.style.color = 'var(--vscode-foreground)';
		welcomeTitle.style.textAlign = 'center';

		// 副标题
		const welcomeSubtitle = append(welcome, $('div'));
		welcomeSubtitle.textContent = 'AI 编程助手';
		welcomeSubtitle.style.fontSize = '12px';
		welcomeSubtitle.style.color = 'var(--vscode-descriptionForeground)';
		welcomeSubtitle.style.opacity = '0.5';
		welcomeSubtitle.style.letterSpacing = '1px';
		welcomeSubtitle.style.textAlign = 'center';


		// ========== 创建输入区域容器（类似 kilocode 的 ChatTextArea） ==========
		const inputContainer = append(this.container, $('div.maxian-input-container'));
		inputContainer.style.display = 'flex';
		inputContainer.style.flexDirection = 'column';
		inputContainer.style.gap = '4px';
		inputContainer.style.borderTop = '1px solid var(--vscode-widget-border, rgba(128,128,128,0.2))';
		inputContainer.style.backgroundColor = 'var(--vscode-editor-background)';
		inputContainer.style.padding = '10px 12px 8px 12px';
		inputContainer.style.position = 'relative';

		// ========== 拖拽把手（在输入区顶部，拖动调整输入区高度） ==========
		const resizeHandle = append(inputContainer, $('div.maxian-resize-handle'));

		// 拖拽逻辑：向上拖增大，向下拖缩小
		let _isDragging = false;
		let _dragStartY = 0;
		let _dragStartHeight = 0;

		resizeHandle.addEventListener('mousedown', (e: MouseEvent) => {
			_isDragging = true;
			_dragStartY = e.clientY;
			_dragStartHeight = this.inputBox ? this.inputBox.offsetHeight : 90;
			resizeHandle.classList.add('dragging');
			document.body.style.userSelect = 'none';
			e.preventDefault();
		});

		document.addEventListener('mousemove', (e: MouseEvent) => {
			if (!_isDragging) return;
			const delta = _dragStartY - e.clientY; // 向上拖 => delta > 0 => height 增加
			const newHeight = Math.max(60, Math.min(500, _dragStartHeight + delta));
			if (this.inputBox) {
				// contenteditable 忽略 height，必须用 minHeight+maxHeight 共同固定高度
				this.inputBox.style.minHeight = newHeight + 'px';
				this.inputBox.style.maxHeight = newHeight + 'px';
			}
		});

		document.addEventListener('mouseup', () => {
			if (!_isDragging) return;
			_isDragging = false;
			resizeHandle.classList.remove('dragging');
			document.body.style.userSelect = '';
		});

		// ========== @mention 文件引用下拉列表（定位在输入框上方） ==========
		this.mentionDropdown = append(inputContainer, $('div.maxian-mention-dropdown'));
		this.mentionDropdown.style.display = 'none';
		this.mentionDropdown.style.position = 'absolute';
		this.mentionDropdown.style.bottom = '100%';
		this.mentionDropdown.style.left = '12px';
		this.mentionDropdown.style.right = '12px';
		this.mentionDropdown.style.maxHeight = '280px';
		this.mentionDropdown.style.overflowY = 'auto';
		this.mentionDropdown.style.backgroundColor = 'var(--vscode-editorWidget-background)';
		this.mentionDropdown.style.border = '1px solid var(--vscode-widget-border)';
		this.mentionDropdown.style.borderRadius = '8px';
		this.mentionDropdown.style.boxShadow = '0 -8px 24px rgba(0, 0, 0, 0.2), 0 -2px 8px rgba(0, 0, 0, 0.12)';
		this.mentionDropdown.style.zIndex = '1000';
		this.mentionDropdown.style.marginBottom = '6px';
		this.mentionDropdown.style.padding = '4px';

		// 输入框容器（相对定位，为负边距控制区提供基准）
		const textAreaWrapper = append(inputContainer, $('div'));
		textAreaWrapper.style.position = 'relative';
		textAreaWrapper.style.display = 'flex';
		textAreaWrapper.style.flexDirection = 'column';
		textAreaWrapper.style.minHeight = '0';
		textAreaWrapper.style.overflow = 'hidden';
		textAreaWrapper.style.borderRadius = '4px';

		// 代码片段预览卡片区（@mention 文件时在此展示来源代码，默认隐藏）
		this.codeContextBar = append(textAreaWrapper, $('div.maxian-code-context-bar'));
		this.codeContextBar.style.display = 'none';
		this.codeContextBar.style.flexDirection = 'column';
		this.codeContextBar.style.gap = '4px';
		this.codeContextBar.style.padding = '4px 0 2px 0';

		// 输入框（contenteditable div，支持内嵌文件 chip）
		this.inputBox = append(textAreaWrapper, $('div.maxian-input-box')) as HTMLDivElement;
		this.inputBox.contentEditable = 'true';
		this.inputBox.style.width = '100%';
		this.inputBox.style.minHeight = '80px';
		this.inputBox.style.padding = '10px 12px';
		this.inputBox.style.backgroundColor = 'var(--vscode-input-background)';
		this.inputBox.style.color = 'var(--vscode-input-foreground)';
		this.inputBox.style.border = '1px solid var(--vscode-widget-border, rgba(128,128,128,0.35))';
		this.inputBox.style.borderRadius = '6px';
		this.inputBox.style.fontFamily = 'var(--vscode-font-family)';
		this.inputBox.style.fontSize = '13px';
		this.inputBox.style.outline = 'none';
		this.inputBox.style.lineHeight = '1.6';
		this.inputBox.style.boxSizing = 'border-box';
		this.inputBox.style.overflowX = 'hidden';
		this.inputBox.style.overflowY = 'auto';
		this.inputBox.style.maxHeight = '200px'; // 防止 contenteditable 无限增长
		this.inputBox.style.whiteSpace = 'pre-wrap';
		this.inputBox.style.wordBreak = 'break-word';
		this.inputBox.style.zIndex = '1';
		this.inputBox.style.position = 'relative';
		this.inputBox.setAttribute('role', 'textbox');
		this.inputBox.setAttribute('aria-multiline', 'true');
		this.inputBox.setAttribute('spellcheck', 'false');

		// placeholder 覆盖层（contenteditable 不支持原生 placeholder）
		this.inputPlaceholderEl = append(textAreaWrapper, $('div'));
		this.inputPlaceholderEl.style.position = 'absolute';
		this.inputPlaceholderEl.style.top = '8px';
		this.inputPlaceholderEl.style.left = '12px';
		this.inputPlaceholderEl.style.right = '12px';
		this.inputPlaceholderEl.style.color = 'var(--vscode-input-placeholderForeground)';
		this.inputPlaceholderEl.style.pointerEvents = 'none';
		this.inputPlaceholderEl.style.fontSize = '13px';
		this.inputPlaceholderEl.style.lineHeight = '1.5';
		this.inputPlaceholderEl.style.fontFamily = 'var(--vscode-font-family)';
		this.inputPlaceholderEl.textContent = this.getInputPlaceholder('normal');

		// 禁止粘贴富文本，只保留纯文本（用 Selection/Range API 替代废弃的 execCommand）
		// 若粘贴内容 ≥3 行，则以代码卡片形式展示而非直接插入
		this.inputBox.addEventListener('paste', (e) => {
			e.preventDefault();
			const text = e.clipboardData?.getData('text/plain') ?? '';
			if (!text) return;

			const lines = text.split('\n');
			// 去掉末尾空行再判断行数
			const trimmedLines = lines[lines.length - 1].trim() === '' ? lines.slice(0, -1) : lines;

			if (trimmedLines.length >= 3) {
				// 多行代码 → 显示为代码卡片
				this.addPastedCodeCard(text);
				return;
			}

			const selection = window.getSelection();
			if (!selection || selection.rangeCount === 0) return;

			const range = selection.getRangeAt(0);
			range.deleteContents();

			// 将纯文本按换行符分段插入，保留换行结构
			const frag = document.createDocumentFragment();
			lines.forEach((line, i) => {
				if (i > 0) frag.appendChild(document.createElement('br'));
				if (line) frag.appendChild(document.createTextNode(line));
			});

			// 记录最后一个节点，用于定位光标
			const lastNode = frag.lastChild;
			range.insertNode(frag);

			// 将光标移到插入内容末尾
			if (lastNode) {
				const r = document.createRange();
				r.setStartAfter(lastNode);
				r.collapse(true);
				selection.removeAllRanges();
				selection.addRange(r);
			}

			this.updateInputPlaceholder();
		});

		// 输入框聚焦效果
		this.inputBox.onfocus = () => {
			this.inputBox.style.borderColor = 'var(--vscode-focusBorder)';
			this.inputBox.style.outline = 'none';
			this.inputBox.style.boxShadow = '0 0 0 1px var(--vscode-focusBorder)';
			this.maxianInputFocusedCtx?.set(true);
		};
		this.inputBox.onblur = (e) => {
			this.inputBox.style.borderColor = 'var(--vscode-widget-border, rgba(128,128,128,0.35))';
			this.inputBox.style.outline = 'none';
			this.inputBox.style.boxShadow = 'none';
			this.maxianInputFocusedCtx?.set(false);
			const related = (e as FocusEvent).relatedTarget as HTMLElement | null;
			if (!related || !this.mentionDropdown?.contains(related)) {
				setTimeout(() => this.hideMentionDropdown(), 150);
			}
		};

		// ========== 底部控制栏（位于输入框下方，不遮挡文本内容） ==========
		const bottomControls = append(textAreaWrapper, $('div'));
		bottomControls.style.paddingLeft = '8px';
		bottomControls.style.paddingRight = '8px';
		bottomControls.style.paddingTop = '4px';
		bottomControls.style.paddingBottom = '4px';
		bottomControls.style.display = 'flex';
		bottomControls.style.justifyContent = 'space-between';
		bottomControls.style.alignItems = 'center';
		bottomControls.style.gap = '4px'; // 减小间距

		// 左侧：模式选择器和知识库选择器
		const leftControls = append(bottomControls, $('div'));
		leftControls.style.display = 'flex';
		leftControls.style.alignItems = 'center';
		leftControls.style.gap = '4px'; // 减小间距
		leftControls.style.flex = '1';
		leftControls.style.minWidth = '0';
		leftControls.style.overflow = 'visible'; // 允许下拉列表溢出显示

		// 模式选择器包装器
		const modeSelectorWrapper = append(leftControls, $('div'));
		modeSelectorWrapper.style.flex = '0 1 130px';
		modeSelectorWrapper.style.minWidth = '96px';
		modeSelectorWrapper.style.maxWidth = '200px';
		modeSelectorWrapper.style.position = 'relative';
		modeSelectorWrapper.style.display = 'flex';
		modeSelectorWrapper.style.alignItems = 'center';
		modeSelectorWrapper.style.zIndex = '100';

		// 模式选择器显示框（自定义div）
		this.modeSelector = append(modeSelectorWrapper, $('div')) as HTMLDivElement;
		this.modeSelector.style.position = 'relative';
		this.modeSelector.style.display = 'inline-flex';
		this.modeSelector.style.alignItems = 'center';
		this.modeSelector.style.width = '100%';
		this.modeSelector.style.height = '26px';
		this.modeSelector.style.padding = '0 24px 0 10px';
		this.modeSelector.style.fontSize = '12px';
		this.modeSelector.style.fontWeight = '500';
		this.modeSelector.style.borderRadius = '14px';
		this.modeSelector.style.backgroundColor = 'var(--vscode-input-background, rgba(128, 128, 128, 0.08))';
		this.modeSelector.style.color = 'var(--vscode-descriptionForeground)';
		this.modeSelector.style.border = '1px solid var(--vscode-input-border, rgba(128, 128, 128, 0.35))';
		this.modeSelector.style.cursor = 'pointer';
		this.modeSelector.style.userSelect = 'none';
		this.modeSelector.style.boxSizing = 'border-box';
		this.modeSelector.style.transition = 'all 0.15s ease';
		this.modeSelector.title = '选择模式';

		this.modeSelectorIcon = append(this.modeSelector, $('span.codicon')) as HTMLSpanElement;
		this.modeSelectorIcon.style.fontSize = '13px';
		this.modeSelectorIcon.style.flexShrink = '0';
		this.modeSelectorIcon.style.marginRight = '0';
		this.modeSelectorIcon.style.color = 'var(--vscode-descriptionForeground)';
		this.modeSelectorIcon.style.transition = 'color 0.15s ease';
		this.modeSelectorIcon.style.display = 'none';

		// 文本显示span
		const modeTextSpan = append(this.modeSelector, $('span')) as HTMLSpanElement;
		modeTextSpan.textContent = '加载中...';
		modeTextSpan.style.flex = '1';
		modeTextSpan.style.minWidth = '0';
		modeTextSpan.style.overflow = 'hidden';
		modeTextSpan.style.textOverflow = 'ellipsis';
		modeTextSpan.style.whiteSpace = 'nowrap';
		modeTextSpan.setAttribute('data-role', 'mode-text');

		// 下拉箭头
		this.modeSelectorArrow = append(this.modeSelector, $('span.codicon.codicon-chevron-down')) as HTMLSpanElement;
		this.modeSelectorArrow.style.position = 'absolute';
		this.modeSelectorArrow.style.right = '7px';
		this.modeSelectorArrow.style.fontSize = '10px';
		this.modeSelectorArrow.style.transition = 'transform 0.2s ease';
		this.modeSelectorArrow.style.color = 'var(--vscode-descriptionForeground)';
		this.modeSelectorArrow.style.pointerEvents = 'none';

		// 下拉列表容器（使用fixed定位）
		this.modeDropdown = append(modeSelectorWrapper, $('div')) as HTMLDivElement;
		this.modeDropdown.style.position = 'fixed';
		this.modeDropdown.style.maxHeight = '280px';
		this.modeDropdown.style.backgroundColor = 'var(--vscode-dropdown-background)';
		this.modeDropdown.style.border = '1px solid var(--vscode-dropdown-border, rgba(128, 128, 128, 0.4))';
		this.modeDropdown.style.borderRadius = '8px';
		this.modeDropdown.style.boxShadow = '0 8px 24px rgba(0, 0, 0, 0.25), 0 0 0 1px rgba(0, 0, 0, 0.08)';
		this.modeDropdown.style.zIndex = '10000';
		this.modeDropdown.style.display = 'none';
		this.modeDropdown.style.opacity = '0';
		this.modeDropdown.style.transition = 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)';
		this.modeDropdown.style.overflowY = 'auto';
		this.modeDropdown.style.overflowX = 'hidden';

		// 下拉列表ul
		this.modeDropdownList = append(this.modeDropdown, $('ul')) as HTMLUListElement;
		this.modeDropdownList.style.listStyle = 'none';
		this.modeDropdownList.style.margin = '4px 0';
		this.modeDropdownList.style.padding = '0';

		// 点击显示框切换下拉列表
		this.modeSelector.onclick = (e) => {
			e.stopPropagation();
			this.isModeDropdownOpen = !this.isModeDropdownOpen;

			if (this.isModeDropdownOpen) {
				const anchorRect = this.modeSelector.getBoundingClientRect();
				const dropdownWidth = this.computeModeDropdownWidth(anchorRect.width);
				this.isModeDropdownOpeningUpward = this.openFloatingDropdown(this.modeSelector, this.modeDropdown, {
					maxHeight: 280,
					width: dropdownWidth,
				});
				this.modeSelectorArrow.style.transform = 'rotate(180deg)';
				this.modeSelector.style.backgroundColor = 'var(--vscode-input-background, rgba(128, 128, 128, 0.12))';
				this.modeSelector.style.color = 'var(--vscode-foreground)';
				this.modeSelector.style.borderColor = 'var(--vscode-focusBorder, #007acc)';
				this.modeSelector.style.boxShadow = '0 0 0 1px var(--vscode-focusBorder, #007acc)';
				this.modeSelectorArrow.style.color = 'var(--vscode-focusBorder, #007acc)';
				this.modeSelectorIcon.style.color = 'var(--vscode-focusBorder, #007acc)';
			} else {
				this.closeModeDropdown();
			}
		};

		// 点击外部关闭下拉列表
		document.addEventListener('click', (e) => {
			if (this.isModeDropdownOpen && !modeSelectorWrapper.contains(e.target as Node)) {
				this.isModeDropdownOpen = false;
				this.closeModeDropdown();
			}
		});

		// Hover效果
		this.modeSelector.onmouseenter = () => {
			if (!this.isModeDropdownOpen) {
				this.modeSelector.style.backgroundColor = 'var(--vscode-list-hoverBackground, rgba(128, 128, 128, 0.12))';
				this.modeSelector.style.color = 'var(--vscode-foreground)';
				this.modeSelectorIcon.style.color = 'var(--vscode-foreground)';
			}
		};
		this.modeSelector.onmouseleave = () => {
			if (!this.isModeDropdownOpen) {
				this.modeSelector.style.backgroundColor = 'var(--vscode-input-background, rgba(128, 128, 128, 0.08))';
				this.modeSelector.style.color = 'var(--vscode-descriptionForeground)';
				this.modeSelector.style.borderColor = 'var(--vscode-input-border, rgba(128, 128, 128, 0.35))';
				this.modeSelector.style.boxShadow = 'none';
				this.modeSelectorArrow.style.color = 'var(--vscode-descriptionForeground)';
				this.modeSelectorIcon.style.color = 'var(--vscode-descriptionForeground)';
			}
		};

		// 模式列表将在 updateAvailableModes 方法中填充

		// 自定义知识库选择器
		this.knowledgeBaseSelectorWrapper = append(leftControls, $('div')) as HTMLDivElement;
		this.knowledgeBaseSelectorWrapper.style.flex = '1 1 220px';
		this.knowledgeBaseSelectorWrapper.style.minWidth = '140px';
		this.knowledgeBaseSelectorWrapper.style.maxWidth = '340px';
		this.knowledgeBaseSelectorWrapper.style.position = 'relative';
		this.knowledgeBaseSelectorWrapper.style.zIndex = '100'; // 确保高于其他元素

		// 知识库选择器显示框
		this.knowledgeBaseSelector = append(this.knowledgeBaseSelectorWrapper, $('div')) as HTMLDivElement;
		this.knowledgeBaseSelector.style.position = 'relative';
		this.knowledgeBaseSelector.style.display = 'inline-flex';
		this.knowledgeBaseSelector.style.alignItems = 'center';
		this.knowledgeBaseSelector.style.width = '100%';
		this.knowledgeBaseSelector.style.height = '26px';
		this.knowledgeBaseSelector.style.padding = '0 26px 0 10px';
		this.knowledgeBaseSelector.style.backgroundColor = 'var(--vscode-input-background, rgba(128, 128, 128, 0.08))';
		this.knowledgeBaseSelector.style.color = 'var(--vscode-descriptionForeground)';
		this.knowledgeBaseSelector.style.border = '1px solid var(--vscode-input-border, rgba(128, 128, 128, 0.35))';
		this.knowledgeBaseSelector.style.borderRadius = '14px';
		this.knowledgeBaseSelector.style.fontFamily = 'var(--vscode-font-family)';
		this.knowledgeBaseSelector.style.fontSize = '12px';
		this.knowledgeBaseSelector.style.fontWeight = '500';
		this.knowledgeBaseSelector.style.cursor = 'pointer';
		this.knowledgeBaseSelector.style.transition = 'all 0.15s ease';
		this.knowledgeBaseSelector.style.userSelect = 'none';
		this.knowledgeBaseSelector.style.boxSizing = 'border-box';
		this.knowledgeBaseSelector.title = '点击选择知识库';

		// 文本显示span
		const kbTextSpan = append(this.knowledgeBaseSelector, $('span')) as HTMLSpanElement;
		kbTextSpan.textContent = '加载中...';
		kbTextSpan.title = '加载中...';
		kbTextSpan.style.flex = '1';
		kbTextSpan.style.overflow = 'hidden';
		kbTextSpan.style.textOverflow = 'ellipsis';
		kbTextSpan.style.whiteSpace = 'nowrap';
		kbTextSpan.setAttribute('data-role', 'kb-text');

		// 下拉箭头
		this.knowledgeBaseSelectorArrow = append(this.knowledgeBaseSelector, $('span.codicon.codicon-chevron-down')) as HTMLSpanElement;
		this.knowledgeBaseSelectorArrow.style.position = 'absolute';
		this.knowledgeBaseSelectorArrow.style.right = '8px';
		this.knowledgeBaseSelectorArrow.style.fontSize = '10px';
		this.knowledgeBaseSelectorArrow.style.color = 'var(--vscode-descriptionForeground)';
		this.knowledgeBaseSelectorArrow.style.transition = 'transform 0.2s ease';
		this.knowledgeBaseSelectorArrow.style.pointerEvents = 'none';

		// 下拉列表容器（使用fixed定位，脱离文档流，不受父容器限制）
		this.knowledgeBaseDropdown = append(this.knowledgeBaseSelectorWrapper, $('div')) as HTMLDivElement;
		this.knowledgeBaseDropdown.style.position = 'fixed'; // 改为fixed定位
		// 注意：不在这里设置top/bottom/left/right，在点击时动态计算绝对位置
		this.knowledgeBaseDropdown.style.maxHeight = '280px';
		this.knowledgeBaseDropdown.style.backgroundColor = 'var(--vscode-dropdown-background)';
		this.knowledgeBaseDropdown.style.border = '1px solid var(--vscode-dropdown-border, rgba(128, 128, 128, 0.4))';
		this.knowledgeBaseDropdown.style.borderRadius = '10px';
		this.knowledgeBaseDropdown.style.boxShadow = '0 10px 28px rgba(0, 0, 0, 0.28), 0 0 0 1px rgba(0, 0, 0, 0.1)';
		this.knowledgeBaseDropdown.style.overflowY = 'auto';
		this.knowledgeBaseDropdown.style.overflowX = 'hidden';
		this.knowledgeBaseDropdown.style.zIndex = '10000'; // 提高z-index确保在最顶层
		this.knowledgeBaseDropdown.style.display = 'none';
		this.knowledgeBaseDropdown.style.opacity = '0';
		this.knowledgeBaseDropdown.style.transition = 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)';

		// 下拉列表ul
		this.knowledgeBaseDropdownList = append(this.knowledgeBaseDropdown, $('ul')) as HTMLUListElement;
		this.knowledgeBaseDropdownList.style.listStyle = 'none';
		this.knowledgeBaseDropdownList.style.margin = '4px 0';
		this.knowledgeBaseDropdownList.style.padding = '0';


		// 点击显示框切换下拉列表
		this.knowledgeBaseSelector.onclick = (e) => {
			e.stopPropagation();
			this.isKnowledgeBaseDropdownOpen = !this.isKnowledgeBaseDropdownOpen;

			if (this.isKnowledgeBaseDropdownOpen) {
				const anchorRect = this.knowledgeBaseSelector.getBoundingClientRect();
				const dropdownWidth = this.computeKnowledgeBaseDropdownWidth(anchorRect.width);
				this.isDropdownOpeningUpward = this.openFloatingDropdown(this.knowledgeBaseSelector, this.knowledgeBaseDropdown, {
					maxHeight: 280,
					width: dropdownWidth,
				});
				this.knowledgeBaseSelectorArrow.style.transform = 'rotate(180deg)';
				this.applyKnowledgeBaseSelectorVisualState('open');
			} else {
				this.closeKnowledgeBaseDropdown();
			}
		};

		// 点击外部关闭下拉列表
		document.addEventListener('click', (e) => {
			if (this.isKnowledgeBaseDropdownOpen && !this.knowledgeBaseSelectorWrapper.contains(e.target as Node)) {
				this.isKnowledgeBaseDropdownOpen = false;
				this.closeKnowledgeBaseDropdown();
			}
		});

		// Hover效果
		this.knowledgeBaseSelector.onmouseenter = () => {
			if (!this.isKnowledgeBaseDropdownOpen) {
				this.applyKnowledgeBaseSelectorVisualState('hover');
			}
		};
		this.knowledgeBaseSelector.onmouseleave = () => {
			if (!this.isKnowledgeBaseDropdownOpen) {
				this.applyKnowledgeBaseSelectorVisualState('default');
			}
		};
		this.applyKnowledgeBaseSelectorVisualState('default');

		// 加载知识库列表
		this.loadKnowledgeBases();

		// MCP 设置按钮（暂时隐藏）
		const mcpButton = append(leftControls, $('button.codicon.codicon-plug')) as HTMLButtonElement;
		mcpButton.title = 'MCP 服务器设置';
		mcpButton.style.padding = '6px';
		mcpButton.style.minWidth = '28px';
		mcpButton.style.minHeight = '28px';
		mcpButton.style.backgroundColor = 'transparent';
		mcpButton.style.color = 'var(--vscode-descriptionForeground)';
		mcpButton.style.border = 'none';
		mcpButton.style.borderRadius = '4px';
		mcpButton.style.cursor = 'pointer';
		mcpButton.style.fontSize = '16px';
		mcpButton.style.display = 'inline-flex';
		mcpButton.style.alignItems = 'center';
		mcpButton.style.justifyContent = 'center';
		mcpButton.style.transition = 'all 0.15s';
		mcpButton.style.opacity = '0.6';
		mcpButton.style.flexShrink = '0';
		mcpButton.style.marginLeft = '4px';
		mcpButton.onmouseenter = () => {
			mcpButton.style.opacity = '1';
			mcpButton.style.color = 'var(--vscode-foreground)';
			mcpButton.style.backgroundColor = 'rgba(255, 255, 255, 0.03)';
		};
		mcpButton.onmouseleave = () => {
			mcpButton.style.opacity = '0.6';
			mcpButton.style.color = 'var(--vscode-descriptionForeground)';
			mcpButton.style.backgroundColor = 'transparent';
		};
		mcpButton.onclick = () => this.toggleMcpPanel();
		mcpButton.style.display = 'none'; // 暂时隐藏 MCP 按钮

		// 刷新按钮
		const refreshButton = append(leftControls, $('button.codicon.codicon-refresh')) as HTMLButtonElement;
		refreshButton.title = '刷新操作类型和知识库';
		refreshButton.style.padding = '6px';
		refreshButton.style.minWidth = '28px';
		refreshButton.style.minHeight = '28px';
		refreshButton.style.backgroundColor = 'transparent';
		refreshButton.style.color = 'var(--vscode-descriptionForeground)';
		refreshButton.style.border = 'none';
		refreshButton.style.borderRadius = '4px';
		refreshButton.style.cursor = 'pointer';
		refreshButton.style.fontSize = '16px';
		refreshButton.style.display = 'inline-flex';
		refreshButton.style.alignItems = 'center';
		refreshButton.style.justifyContent = 'center';
		refreshButton.style.transition = 'all 0.15s';
		refreshButton.style.opacity = '0.6';
		refreshButton.style.flexShrink = '0';
		refreshButton.style.marginLeft = '4px';

		refreshButton.onmouseenter = () => {
			refreshButton.style.opacity = '1';
			refreshButton.style.color = 'var(--vscode-focusBorder, #007ACC)';
			refreshButton.style.backgroundColor = 'rgba(0, 122, 204, 0.1)';
		};
		refreshButton.onmouseleave = () => {
			refreshButton.style.opacity = '0.6';
			refreshButton.style.color = 'var(--vscode-descriptionForeground)';
			refreshButton.style.backgroundColor = 'transparent';
		};
		refreshButton.onclick = async () => {
			// 添加旋转动画
			refreshButton.style.transform = 'rotate(360deg)';
			refreshButton.style.transition = 'transform 0.5s ease';

			// 刷新操作类型和知识库
			this.updateAvailableModes();
			await this.loadKnowledgeBases();

			// 重置旋转
			setTimeout(() => {
				refreshButton.style.transform = 'rotate(0deg)';
				refreshButton.style.transition = 'all 0.15s';
			}, 500);
		};

		// 连续对话复选框（仅在ask模式下显示）
		this.continuousConversationWrapper = append(leftControls, $('label')) as HTMLLabelElement;
		this.continuousConversationWrapper.style.display = 'none'; // 默认隐藏，只在ask模式显示
		this.continuousConversationWrapper.style.alignItems = 'center';
		this.continuousConversationWrapper.style.gap = '6px';
		this.continuousConversationWrapper.style.cursor = 'pointer';
		this.continuousConversationWrapper.style.userSelect = 'none';
		this.continuousConversationWrapper.style.marginLeft = '8px';
		this.continuousConversationWrapper.style.padding = '4px 8px';
		this.continuousConversationWrapper.style.borderRadius = '4px';
		this.continuousConversationWrapper.style.transition = 'background-color 0.15s';
		this.continuousConversationWrapper.title = '启用后，对话将保持上下文连贯性';

		this.continuousConversationCheckbox = append(this.continuousConversationWrapper, $('input')) as HTMLInputElement;
		this.continuousConversationCheckbox.type = 'checkbox';
		this.continuousConversationCheckbox.checked = false;
		this.continuousConversationCheckbox.style.cursor = 'pointer';
		this.continuousConversationCheckbox.style.margin = '0';
		this.continuousConversationCheckbox.onchange = () => {
			this.isContinuousConversation = this.continuousConversationCheckbox.checked;
		};

		const checkboxLabel = append(this.continuousConversationWrapper, $('span'));
		checkboxLabel.textContent = '连续对话';
		checkboxLabel.style.fontSize = '12px';
		checkboxLabel.style.color = 'var(--vscode-foreground)';
		checkboxLabel.style.whiteSpace = 'nowrap';

		// Hover效果
		this.continuousConversationWrapper.onmouseenter = () => {
			this.continuousConversationWrapper.style.backgroundColor = 'var(--vscode-list-hoverBackground, rgba(90, 93, 94, 0.31))';
		};
		this.continuousConversationWrapper.onmouseleave = () => {
			this.continuousConversationWrapper.style.backgroundColor = 'transparent';
		};

		// 根据当前模式设置初始显示状态
		if (this.currentMode === 'ask') {
			this.continuousConversationWrapper.style.display = 'flex';
		}
		// 知识库选择器仅在ask模式下显示
		this.knowledgeBaseSelectorWrapper.style.display = this.currentMode === 'ask' ? '' : 'none';

		// 右侧：取消、清空、发送按钮
		const rightControls = append(bottomControls, $('div'));
		rightControls.style.display = 'flex';
		rightControls.style.alignItems = 'center';
		rightControls.style.gap = '4px';
		rightControls.style.flexShrink = '0';

		// 取消任务按钮
		this.cancelButton = append(rightControls, $('button.codicon.codicon-debug-stop')) as HTMLButtonElement;
		this.cancelButton.title = '中止对话';
		this.cancelButton.style.padding = '6px';
		this.cancelButton.style.minWidth = '28px';
		this.cancelButton.style.minHeight = '28px';
		this.cancelButton.style.backgroundColor = 'transparent';
		this.cancelButton.style.color = 'var(--vscode-descriptionForeground)';
		this.cancelButton.style.border = 'none';
		this.cancelButton.style.borderRadius = '4px';
		this.cancelButton.style.cursor = 'pointer';
		this.cancelButton.style.fontSize = '16px';
		this.cancelButton.style.display = 'inline-flex';
		this.cancelButton.style.alignItems = 'center';
		this.cancelButton.style.justifyContent = 'center';
		this.cancelButton.style.transition = 'all 0.15s';
		this.cancelButton.style.opacity = '0.6';

		this.cancelButton.onmouseenter = () => {
			this.cancelButton.style.opacity = '1';
			this.cancelButton.style.color = 'var(--vscode-errorForeground)';
			this.cancelButton.style.backgroundColor = 'rgba(255, 255, 255, 0.03)';
		};
		this.cancelButton.onmouseleave = () => {
			this.cancelButton.style.opacity = '0.6';
			this.cancelButton.style.color = 'var(--vscode-descriptionForeground)';
			this.cancelButton.style.backgroundColor = 'transparent';
		};

		this.cancelButton.onclick = () => {
			this.maxianService.cancelTask();
		};

		// 清空对话按钮
		this.clearButton = append(rightControls, $('button.codicon.codicon-clear-all')) as HTMLButtonElement;
		this.clearButton.title = '清空对话';
		this.clearButton.style.padding = '6px';
		this.clearButton.style.minWidth = '28px';
		this.clearButton.style.minHeight = '28px';
		this.clearButton.style.backgroundColor = 'transparent';
		this.clearButton.style.color = 'var(--vscode-descriptionForeground)';
		this.clearButton.style.border = 'none';
		this.clearButton.style.borderRadius = '4px';
		this.clearButton.style.cursor = 'pointer';
		this.clearButton.style.fontSize = '16px';
		this.clearButton.style.display = 'inline-flex';
		this.clearButton.style.alignItems = 'center';
		this.clearButton.style.justifyContent = 'center';
		this.clearButton.style.transition = 'all 0.15s';
		this.clearButton.style.opacity = '0.6';

		this.clearButton.onmouseenter = () => {
			this.clearButton.style.opacity = '1';
			this.clearButton.style.color = 'var(--vscode-foreground)';
			this.clearButton.style.backgroundColor = 'rgba(255, 255, 255, 0.03)';
		};
		this.clearButton.onmouseleave = () => {
			this.clearButton.style.opacity = '0.6';
			this.clearButton.style.color = 'var(--vscode-descriptionForeground)';
			this.clearButton.style.backgroundColor = 'transparent';
		};

		this.clearButton.onclick = () => {
			this.maxianService.clearConversation();
		};

		this.sendButton = append(rightControls, $('button.codicon.codicon-send')) as HTMLButtonElement;
		this.sendButton.title = '发送消息';
		this.sendButton.style.padding = '6px';
		this.sendButton.style.minWidth = '28px';
		this.sendButton.style.minHeight = '28px';
		this.sendButton.style.backgroundColor = 'transparent';
		this.sendButton.style.color = 'var(--vscode-descriptionForeground)';
		this.sendButton.style.border = 'none';
		this.sendButton.style.borderRadius = '4px';
		this.sendButton.style.cursor = 'pointer';
		this.sendButton.style.fontSize = '16px';
		this.sendButton.style.display = 'inline-flex';
		this.sendButton.style.alignItems = 'center';
		this.sendButton.style.justifyContent = 'center';
		this.sendButton.style.transition = 'all 0.15s';
		this.sendButton.style.opacity = '0.6';

		// 按钮悬停效果（类似kilocode的样式）
		this.sendButton.onmouseenter = () => {
			this.sendButton.style.opacity = '1';
			this.sendButton.style.color = 'var(--vscode-foreground)';
			this.sendButton.style.backgroundColor = 'rgba(255, 255, 255, 0.03)';
		};
		this.sendButton.onmouseleave = () => {
			this.sendButton.style.opacity = '0.6';
			this.sendButton.style.color = 'var(--vscode-descriptionForeground)';
			this.sendButton.style.backgroundColor = 'transparent';
		};

		// 发送按钮点击事件
		this.sendButton.onclick = () => {
			const message = this.getInputText().trim();
			if (message) {
				// 清除欢迎消息（使用成员变量，支持清空对话后重新创建的欢迎界面）
				if (this.welcomeElement && this.welcomeElement.parentElement) {
					this.welcomeElement.remove();
					this.welcomeElement = null;
				}

				// 检查是否在等待用户回答AI的问题
				if (this.awaitingUserResponse) {
					// 显示用户的回答 - 右侧布局
					const userReplyRow = append(this.messageArea, $('div.maxian-message-row.row-user'));

					const userReplyAvatarWrap = append(userReplyRow, $('div.maxian-message-avatar-wrap'));
					userReplyAvatarWrap.style.background = 'var(--vscode-inputOption-activeBackground, rgba(0,122,204,0.3))';
					const userReplyIcon = append(userReplyAvatarWrap, $('span.codicon.codicon-account'));
					userReplyIcon.style.color = 'var(--vscode-foreground)';
					userReplyIcon.style.fontSize = '14px';

					const userMsg = append(userReplyRow, $('div.maxian-message.maxian-message-user'));

					const userReplyHeader = append(userMsg, $('div.maxian-message-header'));
					const userReplyTime = append(userReplyHeader, $('span.maxian-message-time'));
					userReplyTime.textContent = formatTime(Date.now());
					const userReplyLabel = append(userReplyHeader, $('span.maxian-message-sender'));
					const currentUserReply = this.authService.currentUser;
					userReplyLabel.textContent = currentUserReply?.displayName || currentUserReply?.username || '你';

					const userContent = append(userMsg, $('div.maxian-message-text'));
					userContent.style.whiteSpace = 'pre-wrap';
					userContent.style.wordBreak = 'break-word';
					userContent.style.color = 'var(--vscode-foreground)';
					userContent.style.lineHeight = '1.5';
					userContent.textContent = message;

					this.messageArea.scrollTop = this.messageArea.scrollHeight;

					// 提交用户回复
					this.maxianService.submitUserResponse(message);
					this.showWaitingIndicator();
					// 恢复正常状态
					this.awaitingUserResponse = false;
					this.setInputPlaceholder(this.getInputPlaceholder('normal'));
				} else {
					// 正常发送消息：display 文本用于显示，expanded 文本发给 AI（含完整路径）
					const expanded = this.getInputTextExpanded();
					this.sendMessage(message, expanded);
				}

				this.clearInput();
			}
		};

		// 输入框按键事件：
		// - @mention 下拉列表导航键（硬编码，不可自定义，属于 UI 内部导航）
		// - 发送消息和换行由 VSCode 快捷键系统（maxian.sendMessage / maxian.newLine 命令）处理
		this.inputBox.onkeydown = (e) => {
			// Ctrl+A / Cmd+A：选中输入框内所有内容，不让 VS Code 抢走焦点
			if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
				e.preventDefault();
				e.stopPropagation();
				const range = document.createRange();
				range.selectNodeContents(this.inputBox);
				const sel = window.getSelection();
				if (sel) { sel.removeAllRanges(); sel.addRange(range); }
				return;
			}

			// 如果 @mention 下拉列表已打开，拦截导航键（优先于快捷键命令）
			if (this.mentionDropdown && this.mentionDropdown.style.display !== 'none') {
				if (e.key === 'ArrowDown') {
					e.preventDefault();
					e.stopPropagation();
					const maxIdx = this.mentionDropdownSpecialItems.length > 0
						? this.mentionDropdownSpecialItems.length - 1
						: this.mentionDropdownItems.length - 1;
					this.mentionDropdownIndex = Math.min(this.mentionDropdownIndex + 1, maxIdx);
					this.updateMentionDropdownHighlight();
					return;
				}
				if (e.key === 'ArrowUp') {
					e.preventDefault();
					e.stopPropagation();
					this.mentionDropdownIndex = Math.max(this.mentionDropdownIndex - 1, 0);
					this.updateMentionDropdownHighlight();
					return;
				}
				if (e.key === 'Enter' || e.key === 'Tab') {
					e.preventDefault();
					e.stopPropagation();
					if (this.mentionDropdownSpecialItems.length > 0) {
						if (this.mentionDropdownIndex >= 0 && this.mentionDropdownIndex < this.mentionDropdownSpecialItems.length) {
							const item = this.mentionDropdownSpecialItems[this.mentionDropdownIndex];
							if (this.mentionDropdownMode === '#') {
								// #mcp 工具选择
								this._insertMcpTool(item.key);
							} else {
								// @特殊选项（@git:diff、@web:）
								this.insertMentionSpecial(item.key);
							}
						}
					} else if (this.mentionDropdownIndex >= 0 && this.mentionDropdownIndex < this.mentionDropdownItems.length) {
						this.insertMentionFile(this.mentionDropdownItems[this.mentionDropdownIndex]);
					}
					return;
				}
				if (e.key === 'Escape') {
					e.preventDefault();
					e.stopPropagation();
					this.hideMentionDropdown();
					return;
				}
			}
			// 注意：发送消息（Enter）和换行（Shift+Enter）由 VSCode 快捷键命令系统处理：
			// maxian.sendMessage（默认 Enter）和 maxian.newLine（默认 Shift+Enter）
			// 用户可在 "首选项 > 键盘快捷方式" 中自定义这些快捷键
		};

		// 自动调整输入框高度 + @mention 检测 + placeholder
		this.inputBox.oninput = () => {
			this.inputBox.style.height = 'auto';
			this.inputBox.style.height = this.inputBox.scrollHeight + 'px';
			this.updateInputPlaceholder();
			this.handleMentionInput();
		};
	}

	/**
	 * 添加Markdown和代码高亮样式
	 */
	private addStyles(): void {
		// 全局样式注入到 document.head，确保能覆盖 pane 标题栏（在 renderBody container 之外）
		const globalStyle = document.createElement('style');
		globalStyle.setAttribute('data-maxian-global', '1');
		globalStyle.textContent = `
			/* Replace robot codicon with MAXIAN text in auxiliary bar composite-bar tab */
			.part.auxiliarybar .composite-bar .action-item .action-label.codicon-robot {
				width: auto !important;
				min-width: 58px !important;
				padding: 0 6px !important;
			}
			.part.auxiliarybar .composite-bar .action-item .action-label.codicon-robot::before {
				content: 'MAXIAN' !important;
				font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif !important;
				font-size: 11px !important;
				font-weight: 700 !important;
				letter-spacing: 1.5px !important;
				position: static !important;
				left: auto !important;
			}
		`;
		if (!document.head.querySelector('[data-maxian-global]')) {
			document.head.appendChild(globalStyle);
		}

		const style = document.createElement('style');
		style.textContent = `
			/* 允许选择和复制 */
			.markdown-content,
			.markdown-content * {
				user-select: text !important;
				-webkit-user-select: text !important;
				cursor: text;
			}

			/* Markdown内容样式 */
			.markdown-content {
				font-size: 13px;
				line-height: 1.6;
			}

			.markdown-content h1 {
				font-size: 20px;
				font-weight: 700;
				margin: 16px 0 10px 0;
				padding-bottom: 8px;
				border-bottom: 1px solid var(--vscode-widget-border);
				color: var(--vscode-editor-foreground);
			}

			.markdown-content h2 {
				font-size: 18px;
				font-weight: 600;
				margin: 14px 0 8px 0;
				padding-bottom: 6px;
				border-bottom: 1px solid var(--vscode-widget-border);
				color: var(--vscode-editor-foreground);
			}

			.markdown-content h3 {
				font-size: 16px;
				font-weight: 600;
				margin: 12px 0 6px 0;
				color: var(--vscode-editor-foreground);
			}

			.markdown-content p {
				margin: 8px 0;
				line-height: 1.7;
			}

			.markdown-content ul, .markdown-content ol {
				margin: 10px 0;
				padding-left: 28px;
			}

			.markdown-content li {
				margin: 6px 0;
				line-height: 1.6;
			}

			.markdown-content a {
				color: var(--vscode-textLink-foreground);
				text-decoration: none;
				cursor: pointer;
			}

			.markdown-content a:hover {
				text-decoration: underline;
			}

			.markdown-content code.inline-code {
				background-color: var(--vscode-textCodeBlock-background);
				color: var(--vscode-textPreformat-foreground);
				padding: 3px 7px;
				border-radius: 4px;
				font-family: var(--vscode-editor-font-family);
				font-size: 13px;
				border: 1px solid var(--vscode-widget-border);
			}

			.markdown-content pre.code-block {
				background-color: var(--vscode-textCodeBlock-background);
				border: 1px solid var(--vscode-widget-border);
				border-radius: 6px;
				padding: 14px 16px;
				margin: 12px 0;
				overflow-x: auto;
				box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
			}

			.markdown-content pre.code-block code {
				font-family: var(--vscode-editor-font-family);
				font-size: 13px;
				line-height: 1.6;
				color: var(--vscode-editor-foreground);
				display: block;
			}

			/* 代码高亮样式 - VSCode Dark+ 主题风格 */
			.markdown-content .keyword {
				color: #569cd6;
				font-weight: 600;
			}

			.markdown-content .string {
				color: #ce9178;
			}

			.markdown-content .template-string {
				color: #ce9178;
			}

			.markdown-content .template-expr {
				color: #9cdcfe;
			}

			.markdown-content .comment {
				color: #6a9955;
				font-style: italic;
				opacity: 0.9;
			}

			.markdown-content .number {
				color: #b5cea8;
			}

			.markdown-content .function {
				color: #dcdcaa;
			}

			.markdown-content .method {
				color: #dcdcaa;
			}

			.markdown-content .class {
				color: #4ec9b0;
			}

			.markdown-content .type {
				color: #4ec9b0;
			}

			.markdown-content .interface {
				color: #4ec9b0;
				font-style: italic;
			}

			.markdown-content .variable {
				color: #9cdcfe;
			}

			.markdown-content .constant {
				color: #4fc1ff;
			}

			.markdown-content .parameter {
				color: #9cdcfe;
			}

			.markdown-content .property {
				color: #9cdcfe;
			}

			.markdown-content .decorator {
				color: #dcdcaa;
			}

			.markdown-content .operator {
				color: #d4d4d4;
			}

			.markdown-content .punctuation {
				color: #d4d4d4;
			}

			.markdown-content .regexp {
				color: #d16969;
			}

			.markdown-content .tag {
				color: #569cd6;
			}

			.markdown-content .attribute {
				color: #9cdcfe;
			}

			.markdown-content .builtin {
				color: #4fc1ff;
			}

			.markdown-content .boolean {
				color: #569cd6;
			}

			.markdown-content .null {
				color: #569cd6;
			}

			/* 行号样式（可选） */
			.markdown-content .line-number {
				color: var(--vscode-editorLineNumber-foreground);
				user-select: none;
				text-align: right;
				padding-right: 1em;
				opacity: 0.5;
			}

			.markdown-content strong {
				font-weight: 700;
				color: var(--vscode-editor-foreground);
			}

			.markdown-content em {
				font-style: italic;
				color: var(--vscode-descriptionForeground);
			}

			/* 表格样式 */
			.markdown-content table {
				border-collapse: collapse;
				width: 100%;
				margin: 12px 0;
			}

			.markdown-content th,
			.markdown-content td {
				border: 1px solid var(--vscode-widget-border);
				padding: 8px 12px;
				text-align: left;
			}

			.markdown-content th {
				background-color: var(--vscode-editor-inactiveSelectionBackground);
				font-weight: 600;
			}

			.markdown-content tr:nth-child(even) {
				background-color: var(--vscode-editor-inactiveSelectionBackground);
			}

			/* ========== 优化：消息气泡样式（左右布局） ========== */

			/* 消息行容器：控制左右对齐 */
			.maxian-message-row {
				display: flex;
				margin-bottom: 12px;
				gap: 8px;
				align-items: flex-start;
			}

			.maxian-message-row.row-user {
				flex-direction: row-reverse;
			}

			.maxian-message-row.row-ai {
				flex-direction: row;
			}

			/* 头像容器（在气泡外侧） */
			.maxian-message-avatar-wrap {
				flex-shrink: 0;
				width: 28px;
				height: 28px;
				border-radius: 50%;
				display: flex;
				align-items: center;
				justify-content: center;
				margin-top: 2px;
				overflow: hidden;
			}

			.maxian-message-avatar-wrap img {
				width: 28px;
				height: 28px;
				border-radius: 50%;
				object-fit: cover;
			}

			.maxian-message-avatar-wrap .codicon {
				font-size: 14px;
			}

			/* 气泡本体 */
			.maxian-message {
				max-width: 85%;
				padding: 10px 14px;
				border-radius: 12px;
				position: relative;
				transition: opacity 0.15s ease;
				min-width: 0;
			}

			/* AI消息：左侧，圆角偏左 */
			.maxian-message-ai {
				background: var(--vscode-editorWidget-background, var(--vscode-editor-inactiveSelectionBackground));
				border-top-left-radius: 4px;
				border: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.2));
			}

			/* 用户消息：右侧，圆角偏右，与主题融合的微蓝色 */
			.maxian-message-user {
				background: var(--vscode-inputOption-activeBackground, rgba(0,122,204,0.18));
				border-top-right-radius: 4px;
				border: 1px solid var(--vscode-inputOption-activeBorder, rgba(0,122,204,0.3));
			}

			.maxian-message-user .maxian-message-sender {
				color: var(--vscode-foreground);
				opacity: 0.9;
			}

			.maxian-message-user .maxian-message-time {
				color: var(--vscode-descriptionForeground);
				opacity: 0.6;
			}

			.maxian-message-user .markdown-content,
			.maxian-message-user .maxian-message-text {
				color: var(--vscode-foreground);
			}

			/* 消息头部（名称+时间+操作按钮） */
			.maxian-message-header {
				display: flex;
				align-items: center;
				gap: 6px;
				margin-bottom: 5px;
			}

			.row-user .maxian-message-header {
				flex-direction: row-reverse;
			}

			.maxian-message-avatar {
				width: 28px;
				height: 28px;
				border-radius: 50%;
				object-fit: contain;
				flex-shrink: 0;
			}

			.maxian-message-sender {
				font-weight: 600;
				font-size: 12px;
				color: var(--vscode-foreground);
				opacity: 0.85;
				white-space: nowrap;
			}

			.maxian-message-time {
				font-size: 11px;
				color: var(--vscode-descriptionForeground);
				opacity: 0.5;
				transition: opacity 0.2s ease;
				flex: 1;
			}

			.row-user .maxian-message-time {
				text-align: right;
			}

			.maxian-message:hover .maxian-message-time {
				opacity: 0.85;
			}

			.maxian-message-actions {
				display: flex;
				gap: 2px;
				opacity: 0;
				transition: opacity 0.15s ease;
			}

			.maxian-message:hover .maxian-message-actions {
				opacity: 1;
			}

			.maxian-action-btn {
				background: transparent;
				border: none;
				cursor: pointer;
				padding: 3px 5px;
				border-radius: 4px;
				color: var(--vscode-descriptionForeground);
				transition: all 0.15s ease;
				display: flex;
				align-items: center;
			}

			.maxian-action-btn:hover {
				background: var(--vscode-toolbar-hoverBackground);
				color: var(--vscode-foreground);
			}

			.maxian-message-user .maxian-action-btn {
				color: var(--vscode-button-foreground);
				opacity: 0.7;
			}

			.maxian-message-user .maxian-action-btn:hover {
				background: rgba(255,255,255,0.15);
				opacity: 1;
			}

			/* ========== 优化：工具状态卡片 ========== */
			.maxian-tool-card {
				margin-bottom: 10px;
				padding: 12px 16px;
				background: var(--vscode-editor-background);
				border: 1px solid var(--vscode-widget-border);
				border-radius: 10px;
				position: relative;
				overflow: hidden;
				transition: all 0.2s ease;
			}

			.maxian-tool-card::before {
				content: '';
				position: absolute;
				top: 0;
				left: 0;
				width: 4px;
				height: 100%;
				background: var(--vscode-charts-blue);
				transition: background 0.2s ease;
			}

			.maxian-tool-card.tool-running::before {
				background: var(--vscode-charts-blue);
				animation: tool-pulse 1.5s ease-in-out infinite;
			}

			.maxian-tool-card.tool-completed::before {
				background: var(--vscode-charts-green);
			}

			.maxian-tool-card.tool-error::before {
				background: var(--vscode-errorForeground);
			}

			.maxian-tool-card:hover {
				border-color: var(--vscode-focusBorder);
				box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
			}

			@keyframes tool-pulse {
				0%, 100% { opacity: 1; }
				50% { opacity: 0.5; }
			}

			.maxian-tool-header {
				display: flex;
				align-items: center;
				gap: 10px;
			}

			.maxian-tool-icon {
				width: 32px;
				height: 32px;
				display: flex;
				align-items: center;
				justify-content: center;
				background: var(--vscode-button-secondaryBackground);
				border-radius: 8px;
				flex-shrink: 0;
			}

			.maxian-tool-icon .codicon {
				font-size: 16px;
				color: var(--vscode-charts-blue);
			}

			.maxian-tool-info {
				flex: 1;
				min-width: 0;
			}

			.maxian-tool-title {
				font-weight: 600;
				font-size: 13px;
				color: var(--vscode-foreground);
				display: flex;
				align-items: center;
				gap: 6px;
			}

			.maxian-tool-detail {
				font-size: 12px;
				color: var(--vscode-descriptionForeground);
				font-family: var(--vscode-editor-font-family);
				margin-top: 2px;
				overflow: hidden;
				text-overflow: ellipsis;
				white-space: nowrap;
			}

			.maxian-tool-status-badge {
				font-size: 10px;
				padding: 2px 8px;
				border-radius: 12px;
				font-weight: 500;
				text-transform: uppercase;
				letter-spacing: 0.5px;
			}

			.maxian-tool-status-running {
				background: rgba(var(--vscode-charts-blue-rgb, 66, 133, 244), 0.2);
				color: var(--vscode-charts-blue);
			}

			.maxian-tool-status-completed {
				background: rgba(var(--vscode-charts-green-rgb, 52, 168, 83), 0.2);
				color: var(--vscode-charts-green);
			}

			.maxian-tool-status-error {
				background: rgba(var(--vscode-errorForeground-rgb, 244, 67, 54), 0.2);
				color: var(--vscode-errorForeground);
			}

			/* 工具结果预览 */
			.maxian-tool-result {
				margin-top: 10px;
				padding: 10px 12px;
				background: var(--vscode-textCodeBlock-background);
				border-radius: 6px;
				font-family: var(--vscode-editor-font-family);
				font-size: 12px;
				max-height: 150px;
				overflow: auto;
				white-space: pre-wrap;
				word-break: break-word;
			}

			.maxian-tool-result-toggle {
				display: flex;
				align-items: center;
				gap: 6px;
				margin-top: 8px;
				padding: 4px 8px;
				background: transparent;
				border: none;
				cursor: pointer;
				font-size: 11px;
				color: var(--vscode-textLink-foreground);
				border-radius: 4px;
				transition: background 0.15s ease;
			}

			.maxian-tool-result-toggle:hover {
				background: var(--vscode-toolbar-hoverBackground);
			}

			/* ========== 优化：工具确认卡片 ========== */
			.maxian-approval-card {
				margin-bottom: 12px;
				border-radius: 12px;
				overflow: hidden;
				border: 2px solid var(--vscode-widget-border);
				background: var(--vscode-editor-inactiveSelectionBackground);
				transition: all 0.2s ease;
			}

			.maxian-approval-card:hover {
				border-color: var(--vscode-focusBorder);
			}

			.maxian-approval-header {
				display: flex;
				align-items: center;
				gap: 10px;
				padding: 12px 16px;
				background: var(--vscode-editor-background);
				cursor: pointer;
				user-select: none;
			}

			.maxian-approval-header:hover {
				background: var(--vscode-list-hoverBackground);
			}

			.maxian-approval-content {
				padding: 12px 16px;
			}

			.maxian-approval-buttons {
				display: flex;
				gap: 10px;
				flex-wrap: wrap;
				margin-top: 12px;
			}

			.maxian-btn {
				padding: 8px 20px;
				border: none;
				border-radius: 6px;
				cursor: pointer;
				font-weight: 600;
				font-size: 13px;
				display: flex;
				align-items: center;
				gap: 6px;
				transition: all 0.15s ease;
			}

			.maxian-btn-primary {
				background: var(--vscode-button-background);
				color: var(--vscode-button-foreground);
			}

			.maxian-btn-primary:hover {
				background: var(--vscode-button-hoverBackground);
			}

			.maxian-btn-secondary {
				background: var(--vscode-button-secondaryBackground);
				color: var(--vscode-button-secondaryForeground);
			}

			.maxian-btn-secondary:hover {
				background: var(--vscode-button-secondaryHoverBackground);
			}

			.maxian-btn-outline {
				background: transparent;
				border: 1px solid var(--vscode-charts-green);
				color: var(--vscode-charts-green);
			}

			.maxian-btn-outline:hover {
				background: rgba(var(--vscode-charts-green-rgb, 52, 168, 83), 0.1);
			}

			.maxian-btn:disabled {
				opacity: 0.5;
				cursor: not-allowed;
			}

			/* ========== 加载动画 ========== */
			@keyframes blink {
				0%, 100% { opacity: 1; }
				50% { opacity: 0.3; }
			}

			@keyframes spin {
				from { transform: rotate(0deg); }
				to { transform: rotate(360deg); }
			}

			@keyframes todo-spin {
				from { transform: rotate(0deg); }
				to { transform: rotate(360deg); }
			}

			.codicon-modifier-spin {
				animation: spin 1s linear infinite;
			}

			/* ========== 任务列表样式 ========== */
			.todo-list-container {
				border-radius: 0;
			}

			.todo-list-header:hover {
				background: var(--vscode-list-hoverBackground) !important;
			}

			.todo-item:hover .todo-index {
				opacity: 1 !important;
			}

			.todo-spinner {
				animation: todo-spin 1s linear infinite !important;
			}

			/* ========== 统一细滚动条 ========== */
			.maxian-messages::-webkit-scrollbar,
			.maxian-input-box::-webkit-scrollbar,
			.maxian-mention-dropdown::-webkit-scrollbar {
				width: 4px;
				height: 4px;
			}
			.maxian-messages::-webkit-scrollbar-track,
			.maxian-input-box::-webkit-scrollbar-track,
			.maxian-mention-dropdown::-webkit-scrollbar-track {
				background: transparent;
			}
			.maxian-messages::-webkit-scrollbar-thumb,
			.maxian-input-box::-webkit-scrollbar-thumb,
			.maxian-mention-dropdown::-webkit-scrollbar-thumb {
				background: var(--vscode-scrollbarSlider-background);
				border-radius: 2px;
			}
			.maxian-messages::-webkit-scrollbar-thumb:hover,
			.maxian-input-box::-webkit-scrollbar-thumb:hover,
			.maxian-mention-dropdown::-webkit-scrollbar-thumb:hover {
				background: var(--vscode-scrollbarSlider-hoverBackground);
			}

			/* ========== @mention 下拉框（参照 Trae/OpenCode 风格） ========== */
			.maxian-mention-dropdown {
				font-family: var(--vscode-font-family);
				font-size: 12px;
				padding: 4px;
			}

			.maxian-mention-item {
				transition: background-color 0.1s;
				border-radius: 4px;
			}

			.maxian-mention-item:hover,
			.maxian-mention-item.active {
				background-color: var(--vscode-list-hoverBackground) !important;
			}

			.maxian-mention-item-dir {
				color: var(--vscode-descriptionForeground);
				font-size: 12px;
				white-space: nowrap;
				flex-shrink: 1;
				overflow: hidden;
				min-width: 0;
			}

			.maxian-mention-item-file {
				color: var(--vscode-foreground);
				font-size: 12px;
				font-weight: 500;
				white-space: nowrap;
				flex-shrink: 0;
			}

			/* ========== 输入区拖拽把手 ========== */
			.maxian-resize-handle {
				height: 4px;
				cursor: ns-resize;
				background: transparent;
				transition: background 0.15s;
				flex-shrink: 0;
			}
			.maxian-resize-handle:hover,
			.maxian-resize-handle.dragging {
				background: var(--vscode-focusBorder);
			}

			/* ========== 等待中三点动画 ========== */
			@keyframes maxian-thinking-bounce {
				0%, 60%, 100% { transform: translateY(0); opacity: 0.35; }
				30% { transform: translateY(-5px); opacity: 1; }
			}

			.maxian-thinking-dot {
				display: inline-block;
				width: 6px;
				height: 6px;
				border-radius: 50%;
				background: var(--vscode-charts-blue, #007acc);
				animation: maxian-thinking-bounce 1.2s ease-in-out infinite;
			}
			.maxian-thinking-dot:nth-child(2) { animation-delay: 0.2s; }
			.maxian-thinking-dot:nth-child(3) { animation-delay: 0.4s; }

			/* 输入框滚动条美化（Windows Chromium 支持 webkit 滚动条） */
			.maxian-input-box::-webkit-scrollbar {
				width: 4px;
			}
			.maxian-input-box::-webkit-scrollbar-track {
				background: transparent;
			}
			.maxian-input-box::-webkit-scrollbar-thumb {
				background: var(--vscode-scrollbarSlider-background, rgba(121, 121, 121, 0.4));
				border-radius: 2px;
			}
			.maxian-input-box::-webkit-scrollbar-thumb:hover {
				background: var(--vscode-scrollbarSlider-hoverBackground, rgba(100, 100, 100, 0.7));
			}
			.maxian-input-box::-webkit-scrollbar-thumb:active {
				background: var(--vscode-scrollbarSlider-activeBackground, rgba(191, 191, 191, 0.4));
			}

			/* 对话区域滚动条美化 */
			.maxian-messages::-webkit-scrollbar {
				width: 4px;
			}
			.maxian-messages::-webkit-scrollbar-track {
				background: transparent;
			}
			.maxian-messages::-webkit-scrollbar-thumb {
				background: var(--vscode-scrollbarSlider-background, rgba(121, 121, 121, 0.4));
				border-radius: 2px;
			}
			.maxian-messages::-webkit-scrollbar-thumb:hover {
				background: var(--vscode-scrollbarSlider-hoverBackground, rgba(100, 100, 100, 0.7));
			}
		`;
		this.container.appendChild(style);
	}

	// ========== @mention 文件引用自动完成 ==========

	/**
	 * 检测输入框中光标位置前是否有 @mention 触发词
	 * - 刚输入 @ 时（query 为空）：立即打开 VSCode QuickPick 文件选择器
	 * - 已输入 @git 时：显示 @git:diff 选项
	 * - 已输入 @web 时：显示 @web: 选项
	 * - 已输入 @部分路径 时：显示 inline 过滤下拉列表
	 */
	private handleMentionInput(): void {
		const selection = window.getSelection();
		if (!selection || selection.rangeCount === 0) {
			this.hideMentionDropdown();
			return;
		}
		const range = selection.getRangeAt(0);
		if (!range.collapsed) { this.hideMentionDropdown(); return; }

		const node = range.startContainer;
		if (node.nodeType !== Node.TEXT_NODE || !this.inputBox.contains(node)) {
			this.hideMentionDropdown();
			return;
		}

		const offset = range.startOffset;
		const text = (node.textContent ?? '').slice(0, offset);

		// 向左扫描找到最近的触发字符（# 或 @），遇到空格/换行停止
		let triggerIdx = -1;
		let triggerChar = '';
		for (let i = text.length - 1; i >= 0; i--) {
			const ch = text[i];
			if (ch === '#' || ch === '@') { triggerIdx = i; triggerChar = ch; break; }
			if (ch === ' ' || ch === '\n') break;
		}
		if (triggerIdx === -1) { this.hideMentionDropdown(); return; }

		const query = text.slice(triggerIdx + 1);
		if (query.includes(' ') || query.includes('\n')) { this.hideMentionDropdown(); return; }

		this.mentionAtNode = node as Text;
		this.mentionAtOffset = triggerIdx;
		this.mentionCursorOffset = offset;

		if (triggerChar === '#') {
			// # 触发 MCP 工具选择
			this.mentionDropdownMode = '#';
			this._showMcpToolDropdown(query);
			return;
		}

		// @ 触发文件选择
		this.mentionDropdownMode = '@';

		this.maxianService.getWorkspaceFiles(query).then(files => {
			if (!this.mentionAtNode) return;
			if (files.length === 0) { this.hideMentionDropdown(); return; }
			this.showMentionDropdown(files.slice(0, 50));
		}).catch(() => this.hideMentionDropdown());
	}

	/**
	 * 将选中的文件插入为 chip（inline 下拉列表调用）
	 */
	private insertMentionFile(file: string): void {
		const atNode = this.mentionAtNode;
		const atOffset = this.mentionAtOffset;
		const cursorOffset = this.mentionCursorOffset;

		if (!atNode) { this.hideMentionDropdown(); return; }

		const name = file.split('/').pop() ?? file;

		// 删除 @query 文本（从 atOffset 到 cursorOffset）
		const fullText = atNode.textContent ?? '';
		atNode.textContent = fullText.slice(0, atOffset) + fullText.slice(cursorOffset);

		// 创建 chip 并插入
		const chip = this.createMentionChip(name, file);
		const insertRange = document.createRange();
		insertRange.setStart(atNode, atOffset);
		insertRange.collapse(true);
		insertRange.insertNode(chip);

		// chip 后插入空格节点，让光标落在 chip 后
		const spaceNode = document.createTextNode('\u00A0');
		chip.after(spaceNode);

		// 移动光标到空格后
		const sel = window.getSelection();
		if (sel) {
			const r = document.createRange();
			r.setStart(spaceNode, 1);
			r.collapse(true);
			sel.removeAllRanges();
			sel.addRange(r);
		}

		this.mentionAtNode = null;
		this.inputBox.focus();
		this.hideMentionDropdown();
		this.inputBox.style.height = 'auto';
		this.inputBox.style.height = this.inputBox.scrollHeight + 'px';
		this.updateInputPlaceholder();

		// 异步加载代码预览卡片
		this.addCodeContextCard(file);
	}

	/**
	 * 加载文件内容并在 codeContextBar 里添加代码预览卡片
	 */
	private addCodeContextCard(relativePath: string): void {
		if (!this.codeContextBar) return;
		// 同一文件不重复添加
		if (this.codeContextCards.has(relativePath)) return;

		// 创建占位卡片（loading 状态）
		const card = append(this.codeContextBar, $('div.maxian-code-ctx-card'));
		card.style.border = '1px solid var(--vscode-widget-border)';
		card.style.borderRadius = '6px';
		card.style.overflow = 'hidden';
		card.style.fontSize = '12px';
		card.style.fontFamily = 'var(--vscode-editor-font-family)';

		// 卡片头部
		const cardHeader = append(card, $('div'));
		cardHeader.style.display = 'flex';
		cardHeader.style.alignItems = 'center';
		cardHeader.style.gap = '5px';
		cardHeader.style.padding = '4px 8px';
		cardHeader.style.backgroundColor = 'var(--vscode-textCodeBlock-background)';
		cardHeader.style.borderBottom = '1px solid var(--vscode-widget-border)';

		const fileIcon = append(cardHeader, $('span.codicon.codicon-file-code'));
		fileIcon.style.fontSize = '12px';
		fileIcon.style.color = 'var(--vscode-symbolIcon-fileForeground, var(--vscode-descriptionForeground))';
		fileIcon.style.flexShrink = '0';

		const fileInfoSpan = append(cardHeader, $('span'));
		fileInfoSpan.style.flex = '1';
		fileInfoSpan.style.overflow = 'hidden';
		fileInfoSpan.style.textOverflow = 'ellipsis';
		fileInfoSpan.style.whiteSpace = 'nowrap';
		fileInfoSpan.style.color = 'var(--vscode-foreground)';

		// 目录 + 文件名
		const lastSlash = relativePath.lastIndexOf('/');
		const dirPart = lastSlash >= 0 ? relativePath.slice(0, lastSlash + 1) : '';
		const namePart = lastSlash >= 0 ? relativePath.slice(lastSlash + 1) : relativePath;

		if (dirPart) {
			const d = append(fileInfoSpan, $('span'));
			d.style.color = 'var(--vscode-descriptionForeground)';
			d.textContent = dirPart;
		}
		const n = append(fileInfoSpan, $('span'));
		n.style.fontWeight = '500';
		n.textContent = namePart;

		// 行范围（加载后填充）
		const lineRangeSpan = append(cardHeader, $('span'));
		lineRangeSpan.style.fontSize = '11px';
		lineRangeSpan.style.color = 'var(--vscode-descriptionForeground)';
		lineRangeSpan.style.flexShrink = '0';
		lineRangeSpan.textContent = '加载中...';

		// 关闭按钮
		const closeBtn = append(cardHeader, $('span.codicon.codicon-close'));
		closeBtn.style.fontSize = '11px';
		closeBtn.style.cursor = 'pointer';
		closeBtn.style.opacity = '0.6';
		closeBtn.style.flexShrink = '0';
		closeBtn.onclick = () => this.removeCodeContextCard(relativePath);

		// 代码内容区（折叠，最多 8 行可见，可滚动）
		const codeWrap = append(card, $('div'));
		codeWrap.style.maxHeight = '160px';
		codeWrap.style.overflowY = 'auto';
		codeWrap.style.padding = '6px 10px';
		codeWrap.style.backgroundColor = 'var(--vscode-editor-background)';

		const codePre = append(codeWrap, $('pre'));
		codePre.style.margin = '0';
		codePre.style.fontSize = '12px';
		codePre.style.lineHeight = '1.5';
		codePre.style.color = 'var(--vscode-editor-foreground)';
		codePre.style.whiteSpace = 'pre';
		codePre.style.overflowX = 'auto';
		codePre.textContent = '...';

		this.codeContextCards.set(relativePath, card);

		// 显示 bar
		this.codeContextBar.style.display = 'flex';

		// 异步读取文件内容
		this.maxianService.readWorkspaceFile(relativePath, 100).then(result => {
			if (!result) {
				lineRangeSpan.textContent = '无法读取';
				codePre.textContent = '（文件读取失败）';
				return;
			}
			const displayedLines = result.content.split('\n').length;
			lineRangeSpan.textContent = `1-${displayedLines}${result.totalLines > displayedLines ? ` / 共 ${result.totalLines} 行` : ' 行'}`;
			codePre.textContent = result.content;
		}).catch(() => {
			lineRangeSpan.textContent = '读取失败';
		});
	}

	/**
	 * 移除代码预览卡片
	 */
	private removeCodeContextCard(relativePath: string): void {
		const card = this.codeContextCards.get(relativePath);
		if (card) {
			card.remove();
			this.codeContextCards.delete(relativePath);
		}
		// 若无卡片则隐藏 bar
		if (this.codeContextBar && this.codeContextCards.size === 0) {
			this.codeContextBar.style.display = 'none';
		}
	}

	/**
	 * 粘贴多行代码时，以内嵌 chip 形式展示（代码存在 dataset，点击弹出浮层预览）
	 */
	private addPastedCodeCard(code: string): void {
		const lineCount = code.split('\n').length;

		const chip = $('span') as HTMLSpanElement;
		chip.contentEditable = 'false';
		chip.dataset['pastedCode'] = code;
		chip.style.display = 'inline-flex';
		chip.style.alignItems = 'center';
		chip.style.gap = '3px';
		chip.style.padding = '1px 7px 1px 5px';
		chip.style.margin = '0 2px';
		chip.style.borderRadius = '4px';
		chip.style.fontSize = '12px';
		chip.style.fontFamily = 'var(--vscode-editor-font-family)';
		chip.style.backgroundColor = 'var(--vscode-badge-background)';
		chip.style.color = 'var(--vscode-badge-foreground)';
		chip.style.border = '1px solid var(--vscode-focusBorder)';
		chip.style.cursor = 'pointer';
		chip.style.verticalAlign = 'middle';
		chip.style.userSelect = 'none';
		chip.style.whiteSpace = 'nowrap';

		// 压缩图标
		const icon = $('span.codicon.codicon-file-zip') as HTMLSpanElement;
		icon.style.fontSize = '11px';
		icon.style.pointerEvents = 'none';
		chip.appendChild(icon);

		// 标签文本
		const label = $('span') as HTMLSpanElement;
		label.textContent = `代码片段 ${lineCount}行`;
		label.style.pointerEvents = 'none';
		chip.appendChild(label);

		// 删除按钮
		const delBtn = $('span.codicon.codicon-close') as HTMLSpanElement;
		delBtn.style.fontSize = '10px';
		delBtn.style.marginLeft = '3px';
		delBtn.style.cursor = 'pointer';
		delBtn.style.opacity = '0.7';
		delBtn.title = '移除代码片段';
		delBtn.onclick = (e) => {
			e.stopPropagation();
			this.hideCodePreviewPopup();
			const next = chip.nextSibling;
			if (next?.nodeType === Node.TEXT_NODE && next.textContent === '\u00A0') {
				next.remove();
			}
			chip.remove();
			this.updateInputPlaceholder();
		};
		chip.appendChild(delBtn);

		// 点击 chip 切换代码预览浮层
		chip.onclick = (e) => {
			if ((e.target as HTMLElement).classList.contains('codicon-close')) return;
			this.toggleCodePreviewPopup(chip, code);
		};

		chip.onmouseenter = () => { chip.style.opacity = '0.85'; };
		chip.onmouseleave = () => { chip.style.opacity = '1'; };

		// 在光标处插入 chip
		this.insertChipAtCursor(chip);

		// 聚焦回输入框
		setTimeout(() => this.inputBox.focus(), 0);
	}

	/** 在 inputBox 当前光标位置插入 chip，并在后面加一个空格节点 */
	private insertChipAtCursor(chip: HTMLElement): void {
		const selection = window.getSelection();
		if (selection && selection.rangeCount > 0 && this.inputBox.contains(selection.getRangeAt(0).commonAncestorContainer)) {
			const range = selection.getRangeAt(0);
			range.deleteContents();
			range.insertNode(chip);
			// 在 chip 后插入零宽空格占位，便于光标定位
			const space = document.createTextNode('\u00A0');
			chip.after(space);
			const r = document.createRange();
			r.setStartAfter(space);
			r.collapse(true);
			selection.removeAllRanges();
			selection.addRange(r);
		} else {
			this.inputBox.appendChild(chip);
			const space = document.createTextNode('\u00A0');
			this.inputBox.appendChild(space);
		}
		this.updateInputPlaceholder();
	}

	/** 显示/隐藏代码预览浮层 */
	private toggleCodePreviewPopup(anchor: HTMLElement, code: string): void {
		// 如果已有相同 anchor 的 popup，关闭它
		if (this.codePreviewPopup && this.codePreviewPopup.dataset['anchorCode'] === code) {
			this.hideCodePreviewPopup();
			return;
		}
		this.hideCodePreviewPopup();

		const popup = document.createElement('div');
		popup.dataset['anchorCode'] = code;
		popup.style.position = 'fixed';
		popup.style.zIndex = '99999';
		popup.style.border = '1px solid var(--vscode-widget-border)';
		popup.style.borderRadius = '6px';
		popup.style.overflow = 'hidden';
		popup.style.boxShadow = '0 4px 16px rgba(0,0,0,0.4)';
		popup.style.backgroundColor = 'var(--vscode-editorWidget-background, var(--vscode-editor-background, #1e1e1e))';
		popup.style.maxWidth = '500px';
		popup.style.minWidth = '200px';

		const pre = document.createElement('pre');
		pre.style.margin = '0';
		pre.style.padding = '10px 12px';
		pre.style.fontSize = '12px';
		pre.style.lineHeight = '1.5';
		pre.style.color = 'var(--vscode-editor-foreground, #d4d4d4)';
		pre.style.backgroundColor = 'var(--vscode-editorWidget-background, var(--vscode-editor-background, #1e1e1e))';
		pre.style.whiteSpace = 'pre';
		pre.style.overflowX = 'auto';
		pre.style.overflowY = 'auto';
		pre.style.maxHeight = '300px';
		pre.textContent = code;
		popup.appendChild(pre);

		// 挂到面板容器（确保能继承 VS Code CSS 变量）
		this.container.appendChild(popup);
		this.codePreviewPopup = popup;

		// 定位：在 anchor chip 正上方（使用 fixed 定位，基于视口坐标）
		const rect = anchor.getBoundingClientRect();
		// 先渲染再测高，fallback 估算 300px
		requestAnimationFrame(() => {
			if (!this.codePreviewPopup) return;
			const popupH = this.codePreviewPopup.getBoundingClientRect().height || 320;
			let top = rect.top - popupH - 8;
			if (top < 8) top = rect.bottom + 8;
			let left = rect.left;
			const popupW = 500;
			if (left + popupW > window.innerWidth - 8) left = window.innerWidth - popupW - 8;
			if (left < 8) left = 8;
			this.codePreviewPopup.style.top = `${top}px`;
			this.codePreviewPopup.style.left = `${left}px`;
		});

		// 点击外部关闭
		const onOutside = (e: MouseEvent) => {
			if (!popup.contains(e.target as Node) && e.target !== anchor) {
				this.hideCodePreviewPopup();
				document.removeEventListener('mousedown', onOutside, true);
			}
		};
		document.addEventListener('mousedown', onOutside, true);
	}

	private hideCodePreviewPopup(): void {
		if (this.codePreviewPopup) {
			this.codePreviewPopup.remove();
			this.codePreviewPopup = null;
		}
	}

	/**
	 * 创建文件引用 chip 元素
	 */
	private createMentionChip(displayName: string, relativePath: string): HTMLElement {
		const chip = $('span') as HTMLSpanElement;
		(chip as HTMLElement).contentEditable = 'false';
		(chip as HTMLElement).dataset['mentionKey'] = displayName;
		(chip as HTMLElement).dataset['mentionPath'] = relativePath;
		chip.style.display = 'inline-flex';
		chip.style.alignItems = 'center';
		chip.style.gap = '3px';
		chip.style.padding = '1px 7px 1px 5px';
		chip.style.margin = '0 2px';
		chip.style.borderRadius = '4px';
		chip.style.fontSize = '12px';
		chip.style.fontFamily = 'var(--vscode-editor-font-family)';
		chip.style.backgroundColor = 'var(--vscode-badge-background)';
		chip.style.color = 'var(--vscode-badge-foreground)';
		chip.style.border = '1px solid var(--vscode-focusBorder)';
		chip.style.cursor = 'pointer';
		chip.style.verticalAlign = 'middle';
		chip.style.userSelect = 'none';
		chip.style.whiteSpace = 'nowrap';
		chip.title = relativePath;

		// 文件图标
		const icon = $('span.codicon.codicon-file-code') as HTMLSpanElement;
		icon.style.fontSize = '11px';
		icon.style.pointerEvents = 'none';
		chip.appendChild(icon);

		// 文件名文本
		const label = $('span') as HTMLSpanElement;
		label.textContent = '@' + displayName;
		label.style.pointerEvents = 'none';
		chip.appendChild(label);

		// 删除按钮
		const delBtn = $('span.codicon.codicon-close') as HTMLSpanElement;
		delBtn.style.fontSize = '10px';
		delBtn.style.marginLeft = '3px';
		delBtn.style.cursor = 'pointer';
		delBtn.style.opacity = '0.7';
		delBtn.title = '移除引用';
		delBtn.onclick = (e) => {
			e.stopPropagation();
			const next = chip.nextSibling;
			if (next?.nodeType === Node.TEXT_NODE && next.textContent === '\u00A0') {
				next.remove();
			}
			chip.remove();
			// 同步移除对应的代码预览卡片
			this.removeCodeContextCard(relativePath);
			this.updateInputPlaceholder();
		};
		chip.appendChild(delBtn);

		// 点击 chip 打开文件
		chip.onclick = (e) => {
			if ((e.target as HTMLElement).classList.contains('codicon-close')) return;
			const workspaceRoot = this.maxianService.getWorkspaceRoot();
			if (workspaceRoot) {
				const uri = URI.file(workspaceRoot + '/' + relativePath);
				this.openerService.open(uri);
			}
		};

		chip.onmouseenter = () => { chip.style.opacity = '0.85'; };
		chip.onmouseleave = () => { chip.style.opacity = '1'; };

		return chip;
	}

	/**
	 * 将消息文本渲染到容器中，把 @filename 渲染为可点击的 chip 标签
	 * 点击 chip 可打开对应文件
	 */
	private renderMessageWithMentions(container: HTMLElement, text: string): void {
		const workspaceRoot = this.maxianService.getWorkspaceRoot();
		// 正则拆分：把 @xxx 和普通文本分开
		const parts = text.split(/(@[^\s@，。？！]+)/g);
		for (const part of parts) {
			if (part.startsWith('@') && part.length > 1) {
				const relativePath = part.slice(1); // @后面的内容（完整相对路径）
				const displayName = relativePath.split('/').pop() ?? relativePath; // 仅显示文件名

				const chip = append(container, $('span'));
				chip.style.display = 'inline-flex';
				chip.style.alignItems = 'center';
				chip.style.gap = '3px';
				chip.style.padding = '1px 7px 1px 5px';
				chip.style.margin = '0 2px';
				chip.style.borderRadius = '4px';
				chip.style.fontSize = '12px';
				chip.style.fontFamily = 'var(--vscode-editor-font-family)';
				chip.style.backgroundColor = 'var(--vscode-badge-background)';
				chip.style.color = 'var(--vscode-badge-foreground)';
				chip.style.border = '1px solid var(--vscode-focusBorder)';
				chip.style.cursor = workspaceRoot ? 'pointer' : 'default';
				chip.style.verticalAlign = 'middle';
				chip.title = relativePath; // 完整路径作为 tooltip

				const icon = append(chip, $('span.codicon.codicon-file-code'));
				icon.style.fontSize = '11px';
				icon.style.pointerEvents = 'none';

				const label = append(chip, $('span'));
				label.textContent = '@' + displayName; // 只显示文件名
				label.style.pointerEvents = 'none';

				if (workspaceRoot) {
					chip.onclick = () => {
						// 用完整相对路径直接打开
						const uri = URI.file(workspaceRoot + '/' + relativePath);
						this.openerService.open(uri);
					};
					chip.onmouseenter = () => { chip.style.opacity = '0.85'; };
					chip.onmouseleave = () => { chip.style.opacity = '1'; };
				}
			} else if (part) {
				// 普通文本节点
				container.appendChild(document.createTextNode(part));
			}
		}
	}

	/**
	 * 显示 @mention 下拉列表，填充文件条目
	 */
	private showMentionDropdown(files: string[]): void {
		if (!this.mentionDropdown) return;

		this.mentionDropdownItems = files;
		this.mentionDropdownSpecialItems = []; // 切换到文件模式，清空特殊选项
		this.mentionDropdownIndex = files.length > 0 ? 0 : -1;

		// 清空并重新渲染列表项（用 DOM API 避免 TrustedHTML CSP 限制）
		while (this.mentionDropdown.firstChild) {
			this.mentionDropdown.removeChild(this.mentionDropdown.firstChild);
		}

		files.forEach((file, index) => {
			const item = append(this.mentionDropdown!, $('div.maxian-mention-item'));
			item.style.padding = '4px 8px';
			item.style.cursor = 'pointer';
			item.style.display = 'flex';
			item.style.alignItems = 'center';
			item.style.gap = '6px';
			item.dataset['index'] = String(index);

			// 文件图标
			const icon = append(item, $('span.codicon.codicon-file-code'));
			icon.style.fontSize = '13px';
			icon.style.color = 'var(--vscode-symbolIcon-fileForeground, var(--vscode-descriptionForeground))';
			icon.style.flexShrink = '0';

			// 文字容器：目录（浅色）+ 文件名（主色）同一行，超出截断
			const textRow = append(item, $('span'));
			textRow.style.display = 'flex';
			textRow.style.alignItems = 'baseline';
			textRow.style.flex = '1';
			textRow.style.overflow = 'hidden';
			textRow.style.minWidth = '0';
			textRow.style.gap = '0';

			// 解析目录和文件名
			const slashIdx = file.lastIndexOf('/');
			const fileName = slashIdx >= 0 ? file.slice(slashIdx + 1) : file;
			const dirPath = slashIdx >= 0 ? file.slice(0, slashIdx + 1) : ''; // 含末尾 /

			// 目录部分（浅色，可被截断）
			if (dirPath) {
				const dirSpan = append(textRow, $('span.maxian-mention-item-dir'));
				dirSpan.textContent = dirPath;
			}

			// 文件名部分（主色加粗，不截断）
			const fileSpan = append(textRow, $('span.maxian-mention-item-file'));
			fileSpan.textContent = fileName;

			// 默认高亮第一项
			if (index === 0) {
				item.classList.add('active');
			}

			item.onmouseenter = () => {
				this.mentionDropdownIndex = index;
				this.updateMentionDropdownHighlight();
			};

			item.onclick = () => {
				this.insertMentionFile(file);
			};
		});

		this.mentionDropdown.style.display = 'block';
		// 设置上下文键：下拉列表可见（防止 Enter 快捷键误触发发送）
		this.maxianMentionDropdownVisibleCtx?.set(true);
	}

	/**
	 * 显示 #mcp 工具选择下拉菜单
	 * 列出所有已连接 MCP 服务器的工具，按服务器分组
	 */
	private _showMcpToolDropdown(query: string): void {
		if (!this.mentionDropdown) return;

		// 获取所有已连接 MCP 工具
		const allTools = this.maxianService.getConnectedMcpTools();
		if (allTools.length === 0) {
			this.hideMentionDropdown();
			return;
		}

		// 过滤匹配 query 的工具
		const lowerQuery = query.toLowerCase();
		const filtered = allTools.filter(t =>
			!lowerQuery ||
			t.serverName.toLowerCase().includes(lowerQuery) ||
			t.toolName.toLowerCase().includes(lowerQuery) ||
			t.description.toLowerCase().includes(lowerQuery)
		);

		if (filtered.length === 0) {
			this.hideMentionDropdown();
			return;
		}

		// 按 serverName 分组，每组只显示一个入口（选择后插入 #serverName ）
		const servers = new Map<string, { serverName: string; description: string; toolCount: number }>();
		for (const t of filtered) {
			if (!servers.has(t.serverName)) {
				// 找服务器描述：用第一个工具的描述或服务器名
				servers.set(t.serverName, { serverName: t.serverName, description: t.description, toolCount: 0 });
			}
			servers.get(t.serverName)!.toolCount++;
		}

		const items: Array<{ type: 'special'; key: string; label: string; icon: string; description: string }> = [];
		for (const [, srv] of servers) {
			items.push({
				type: 'special',
				key: `mcp:${srv.serverName}`,
				label: `#${srv.serverName}`,
				icon: 'codicon-plug',
				description: `MCP · ${srv.toolCount} 个工具可用`
			});
		}

		this.mentionDropdownSpecialItems = items;
		this.mentionDropdownItems = [];
		this.mentionDropdownIndex = items.length > 0 ? 0 : -1;

		// 清空并渲染下拉列表
		while (this.mentionDropdown.firstChild) {
			this.mentionDropdown.removeChild(this.mentionDropdown.firstChild);
		}

		// 标题行
		const titleRow = append(this.mentionDropdown, $('div'));
		titleRow.style.padding = '4px 10px 2px';
		titleRow.style.fontSize = '11px';
		titleRow.style.color = 'var(--vscode-descriptionForeground)';
		titleRow.style.fontWeight = '600';
		titleRow.style.letterSpacing = '0.5px';
		titleRow.style.textTransform = 'uppercase';
		titleRow.textContent = 'MCP 工具';

		items.forEach((item, index) => {
			const el = append(this.mentionDropdown!, $('div.maxian-mention-item'));
			el.style.padding = '6px 10px';
			el.style.cursor = 'pointer';
			el.style.display = 'flex';
			el.style.alignItems = 'center';
			el.style.gap = '8px';
			el.dataset['specialIndex'] = String(index);

			const iconEl = append(el, $(`span.codicon.${item.icon}`));
			iconEl.style.fontSize = '14px';
			iconEl.style.color = 'var(--vscode-charts-green, #4ec9b0)';
			iconEl.style.flexShrink = '0';

			const textCol = append(el, $('span'));
			textCol.style.display = 'flex';
			textCol.style.flexDirection = 'column';
			textCol.style.gap = '1px';

			const labelEl = append(textCol, $('span'));
			labelEl.textContent = item.label;
			labelEl.style.fontWeight = '600';
			labelEl.style.fontSize = '13px';
			labelEl.style.color = 'var(--vscode-foreground)';

			const descEl = append(textCol, $('span'));
			descEl.textContent = item.description;
			descEl.style.fontSize = '11px';
			descEl.style.color = 'var(--vscode-descriptionForeground)';

			if (index === 0) {
				el.classList.add('active');
			}

			el.onmouseenter = () => {
				this.mentionDropdownIndex = index;
				this.updateMentionDropdownHighlight();
			};
			el.onclick = () => {
				this._insertMcpTool(item.key);
			};
		});

		this.mentionDropdown.style.display = 'block';
		this.maxianMentionDropdownVisibleCtx?.set(true);
	}

	/**
	 * 插入 #mcp 工具引用到输入框
	 * 替换 #query 为 #serverName （等待用户输入 URL/参数）
	 */
	private _insertMcpTool(key: string): void {
		// key 格式: mcp:serverName
		const serverName = key.startsWith('mcp:') ? key.slice(4) : key;

		const atNode = this.mentionAtNode;
		const atOffset = this.mentionAtOffset;
		const cursorOffset = this.mentionCursorOffset;

		if (!atNode) { this.hideMentionDropdown(); return; }

		// 删除 #query 文本，替换为 #serverName + 空格
		const fullText = atNode.textContent ?? '';
		const insertText = `#${serverName} `;
		atNode.textContent = fullText.slice(0, atOffset) + insertText + fullText.slice(cursorOffset);

		// 移动光标到插入文本末尾
		const sel = window.getSelection();
		if (sel) {
			const r = document.createRange();
			r.setStart(atNode, atOffset + insertText.length);
			r.collapse(true);
			sel.removeAllRanges();
			sel.addRange(r);
		}

		this.mentionAtNode = null;
		this.inputBox.focus();
		this.hideMentionDropdown();
		this.inputBox.style.height = 'auto';
		this.inputBox.style.height = this.inputBox.scrollHeight + 'px';
		this.updateInputPlaceholder();
	}

	/**
	 * 隐藏 @mention 下拉列表
	 */
	private hideMentionDropdown(): void {
		if (this.mentionDropdown) {
			this.mentionDropdown.style.display = 'none';
		}
		this.mentionDropdownItems = [];
		this.mentionDropdownSpecialItems = [];
		this.mentionDropdownIndex = -1;
		this.mentionAtNode = null;
		// 清除上下文键：下拉列表隐藏
		this.maxianMentionDropdownVisibleCtx?.set(false);
	}

	/**
	 * 更新下拉列表中的高亮选中项
	 */
	private updateMentionDropdownHighlight(): void {
		if (!this.mentionDropdown) return;
		const items = this.mentionDropdown.querySelectorAll<HTMLElement>('.maxian-mention-item');
		items.forEach((item, idx) => {
			if (idx === this.mentionDropdownIndex) {
				item.classList.add('active');
				item.scrollIntoView({ block: 'nearest' });
			} else {
				item.classList.remove('active');
			}
		});
	}


	/**
	 * 插入特殊 mention chip（@git:diff 或 @web:URL）
	 */
	private insertMentionSpecial(key: string): void {
		const atNode = this.mentionAtNode;
		const atOffset = this.mentionAtOffset;
		const cursorOffset = this.mentionCursorOffset;

		if (!atNode) { this.hideMentionDropdown(); return; }

		if (key === 'web:') {
			// @web: 需要用户输入URL，弹出 prompt
			const url = window.prompt('@web: 请输入要获取内容的URL', 'https://');
			if (!url || !url.startsWith('http')) {
				this.hideMentionDropdown();
				return;
			}
			this._insertSpecialChipIntoInput(atNode, atOffset, cursorOffset, `web:${url}`, `@web:${url}`, 'codicon-globe');
		} else if (key === 'git:diff') {
			this._insertSpecialChipIntoInput(atNode, atOffset, cursorOffset, 'git:diff', '@git:diff', 'codicon-source-control');
		}
	}

	/**
	 * 在输入框中插入特殊 chip（内部辅助方法）
	 */
	private _insertSpecialChipIntoInput(
		atNode: Text,
		atOffset: number,
		cursorOffset: number,
		specialKey: string,
		displayLabel: string,
		iconClass: string
	): void {
		// 删除 @query 文本
		const fullText = atNode.textContent ?? '';
		atNode.textContent = fullText.slice(0, atOffset) + fullText.slice(cursorOffset);

		// 创建特殊 chip
		const chip = this._createSpecialMentionChip(specialKey, displayLabel, iconClass);
		const insertRange = document.createRange();
		insertRange.setStart(atNode, atOffset);
		insertRange.collapse(true);
		insertRange.insertNode(chip);

		// chip 后插入空格节点
		const spaceNode = document.createTextNode('\u00A0');
		chip.after(spaceNode);

		// 移动光标到空格后
		const sel = window.getSelection();
		if (sel) {
			const r = document.createRange();
			r.setStart(spaceNode, 1);
			r.collapse(true);
			sel.removeAllRanges();
			sel.addRange(r);
		}

		this.mentionAtNode = null;
		this.inputBox.focus();
		this.hideMentionDropdown();
		this.inputBox.style.height = 'auto';
		this.inputBox.style.height = this.inputBox.scrollHeight + 'px';
		this.updateInputPlaceholder();
	}

	/**
	 * 创建特殊 mention chip（@git:diff 或 @web:URL）
	 */
	private _createSpecialMentionChip(specialKey: string, displayLabel: string, iconClass: string): HTMLElement {
		const chip = $('span') as HTMLSpanElement;
		(chip as HTMLElement).contentEditable = 'false';
		(chip as HTMLElement).dataset['mentionSpecial'] = specialKey;
		chip.style.display = 'inline-flex';
		chip.style.alignItems = 'center';
		chip.style.gap = '3px';
		chip.style.padding = '1px 7px 1px 5px';
		chip.style.margin = '0 2px';
		chip.style.borderRadius = '4px';
		chip.style.fontSize = '12px';
		chip.style.fontFamily = 'var(--vscode-editor-font-family)';
		chip.style.backgroundColor = 'var(--vscode-charts-blue, rgba(0,122,204,0.2))';
		chip.style.color = 'var(--vscode-badge-foreground)';
		chip.style.border = '1px solid var(--vscode-charts-blue, #0078d4)';
		chip.style.cursor = 'default';
		chip.style.verticalAlign = 'middle';
		chip.style.userSelect = 'none';
		chip.style.whiteSpace = 'nowrap';
		chip.title = specialKey;

		const icon = $(`span.codicon.${iconClass}`) as HTMLSpanElement;
		icon.style.fontSize = '11px';
		icon.style.pointerEvents = 'none';
		chip.appendChild(icon);

		const label = $('span') as HTMLSpanElement;
		label.textContent = displayLabel;
		label.style.pointerEvents = 'none';
		chip.appendChild(label);

		// 删除按钮
		const delBtn = $('span.codicon.codicon-close') as HTMLSpanElement;
		delBtn.style.fontSize = '10px';
		delBtn.style.marginLeft = '3px';
		delBtn.style.cursor = 'pointer';
		delBtn.style.opacity = '0.7';
		delBtn.title = '移除引用';
		delBtn.onclick = (e) => {
			e.stopPropagation();
			const next = chip.nextSibling;
			if (next?.nodeType === Node.TEXT_NODE && next.textContent === '\u00A0') {
				next.remove();
			}
			chip.remove();
			this.updateInputPlaceholder();
		};
		chip.appendChild(delBtn);

		return chip;
	}


	// ========== 快捷键辅助方法 ==========

	/**
	 * 在输入框光标位置插入换行（由 maxian.newLine 命令触发）
	 */
	private handleNewLineInInput(): void {
		if (!this.inputBox) return;

		const selection = window.getSelection();
		if (!selection || selection.rangeCount === 0) return;

		const range = selection.getRangeAt(0);
		range.deleteContents();

		const br = document.createElement('br');
		range.insertNode(br);

		// contenteditable 末尾需要额外一个 <br> 才能让光标可见地落在下一行
		if (!br.nextSibling) {
			const trailingBr = document.createElement('br');
			br.after(trailingBr);
		}

		// 光标移到 br 之后
		const r = document.createRange();
		r.setStartAfter(br);
		r.collapse(true);
		selection.removeAllRanges();
		selection.addRange(r);

		this.inputBox.scrollTop = this.inputBox.scrollHeight;
		this.updateInputPlaceholder();
	}

	/**
	 * 根据当前快捷键绑定动态生成输入框 placeholder
	 * 让用户看到自定义后的快捷键提示
	 */
	private getInputPlaceholder(mode: 'normal' | 'awaiting' = 'normal'): string {
		if (mode === 'awaiting') {
			return '💬 正在回答码弦的问题... (Enter 发送, Shift+Enter 换行)';
		}
		const sendBinding = this.keybindingService.lookupKeybinding('maxian.sendMessage');
		const newLineBinding = this.keybindingService.lookupKeybinding('maxian.newLine');
		const sendLabel = sendBinding?.getLabel() ?? 'Enter';
		const newLineLabel = newLineBinding?.getLabel() ?? 'Shift+Enter';
		return `输入消息... (${sendLabel} 发送, ${newLineLabel} 换行, @文件名 引用文件)`;
	}

	/**
	 * 更新输入框 placeholder 文字（在快捷键变化时调用）
	 */
	private refreshInputPlaceholderText(): void {
		if (!this.inputBox) return;
		if (this.awaitingUserResponse) return;
		this.setInputPlaceholder(this.getInputPlaceholder('normal'));
	}

	// ========== contenteditable 输入框辅助方法 ==========

	/** 提取输入框纯文本（@文件名 短格式，用于显示在聊天气泡） */
	private getInputText(): string {
		return this.extractInputContent(false);
	}

	/** 提取输入框文本（@完整相对路径，用于发给 AI） */
	private getInputTextExpanded(): string {
		return this.extractInputContent(true);
	}

	private extractInputContent(expandPath: boolean): string {
		let text = '';
		for (const node of Array.from(this.inputBox.childNodes)) {
			if (node.nodeType === Node.TEXT_NODE) {
				text += node.textContent ?? '';
			} else if (node instanceof HTMLElement) {
				if (node.dataset['mentionSpecial']) {
					// 特殊 mention chip（@git:diff、@web:URL）
					// expandPath=true 时用特殊标记占位，sendMessage 中异步替换为实际内容
					// expandPath=false 时显示可读标签
					if (expandPath) {
						text += `\x00mention:${node.dataset['mentionSpecial']}\x00`;
					} else {
						const specialKey = node.dataset['mentionSpecial'];
						text += specialKey?.startsWith('web:') ? `@web:${specialKey.slice(4)}` : `@${specialKey}`;
					}
				} else if (node.dataset['mentionPath']) {
					// chip 节点
					text += expandPath
						? '@' + node.dataset['mentionPath']
						: '@' + (node.dataset['mentionKey'] ?? node.dataset['mentionPath']);
				} else if (node.dataset['pastedCode']) {
					// 粘贴代码 chip
					const code = node.dataset['pastedCode'];
					text += `\n\`\`\`\n${code}\n\`\`\``;
				} else if (node.tagName === 'BR') {
					text += '\n';
				} else if (node.tagName === 'DIV') {
					// contenteditable 换行时可能产生 div
					const inner = node.textContent ?? '';
					text += '\n' + inner;
				} else {
					text += node.textContent ?? '';
				}
			}
		}

		return text;
	}

	/** 清空输入框（同步清除所有代码预览卡片） */
	private clearInput(): void {
		this.inputBox.textContent = '';
		this.inputBox.style.height = 'auto';
		// 清除所有代码片段预览卡片（@mention 引用文件卡片）
		this.codeContextCards.forEach((_, path) => this.removeCodeContextCard(path));
		// 关闭粘贴代码预览浮层
		this.hideCodePreviewPopup();
		this.updateInputPlaceholder();
	}

	/** 更新 placeholder 显示/隐藏 */
	private updateInputPlaceholder(): void {
		const isEmpty = this.inputBox.textContent?.trim() === ''
			&& !this.inputBox.querySelector('[data-mention-path]')
			&& !this.inputBox.querySelector('[data-pasted-code]');
		if (this.inputPlaceholderEl) {
			this.inputPlaceholderEl.style.display = isEmpty ? 'block' : 'none';
		}
	}

	/** 设置 placeholder 文字 */
	private setInputPlaceholder(text: string): void {
		if (this.inputPlaceholderEl) {
			this.inputPlaceholderEl.textContent = text;
		}
	}

	// ========== 消息发送 ==========

	/**
	 * displayMessage: 显示给用户的文本（@文件名短格式）
	 * expandedMessage: 发给 AI 的文本（@完整相对路径）
	 */
	private async sendMessage(displayMessage: string, expandedMessage: string = displayMessage): Promise<void> {
		// 调用maxianService发送消息，传递当前模式
		// maxianService会通过onMessage事件通知UI更新

		// 处理特殊 mentions（@git:diff、@web:URL），异步获取内容替换到消息中
		let finalMessage = expandedMessage;
		if (expandedMessage.includes('\x00mention:')) {
			finalMessage = await this._resolveSpecialMentions(expandedMessage);
		}

		// 处理 #<serverName> <figmaUrl> 快捷引用，自动拉取 Figma 设计数据注入上下文（含截图）
		// 注意：MCP 服务器名可能不是 "figma"，需匹配任何 #word + figma.com URL
		let figmaImages: string[] | undefined;
		if (/#\w+\s+https?:\/\/(?:www\.)?figma\.com\//.test(finalMessage)) {
			const figmaResult = await this._resolveFigmaMentions(finalMessage);
			finalMessage = figmaResult.text;
			figmaImages = figmaResult.images.length > 0 ? figmaResult.images : undefined;
		}

		// 如果是 ask 模式，且选中了知识库，则传递知识库配置
		let knowledgeBaseConfig: import('./maxianService.js').IKnowledgeBaseConfig | undefined;
		if (this.currentMode === 'ask') {
			// 如果没有启用连续对话，重置conversation_id（开始新对话）
			if (!this.isContinuousConversation) {
				this.maxianService.resetAskConversation();
			}

			// 如果选中了知识库，传递知识库配置
			if (this.selectedKnowledgeBaseId) {
				const selectedKb = this.knowledgeBases.find(kb => kb.id === this.selectedKnowledgeBaseId);
				if (selectedKb) {
					knowledgeBaseConfig = {
						apiUrl: selectedKb.applicationUrl,
						apiKey: selectedKb.applicationKey,
						id: selectedKb.id,
						name: selectedKb.applicationName
					};
				}
			}
		}

		await this.maxianService.sendMessage(finalMessage, this.currentMode, knowledgeBaseConfig, figmaImages);
	}

	/**
	 * 异步解析消息中的特殊 mention 标记（\x00mention:key\x00）
	 * - @git:diff → 获取 git diff HEAD 内容
	 * - @web:URL → fetch URL 并截取前5000字符
	 */
	private async _resolveSpecialMentions(message: string): Promise<string> {
		const parts = message.split(/\x00mention:([^\x00]+)\x00/g);
		const resolved: string[] = [];

		for (let i = 0; i < parts.length; i++) {
			if (i % 2 === 0) {
				// 普通文本
				resolved.push(parts[i]);
			} else {
				// mention key
				const key = parts[i];
				if (key === 'git:diff') {
					try {
						const diff = await this.maxianService.getGitDiff();
						if (diff) {
							resolved.push(`\n<git_diff>\n${diff}\n</git_diff>\n`);
						} else {
							resolved.push('\n[git diff: 没有变更或不是 git 仓库]\n');
						}
					} catch {
						resolved.push('\n[git diff: 获取失败]\n');
					}
				} else if (key.startsWith('web:')) {
					const url = key.slice(4);
					try {
						const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
						if (response.ok) {
							const text = await response.text();
							// 简单去除 HTML 标签，截取前5000字符
							const plain = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 5000);
							resolved.push(`\n<web_content url="${url}">\n${plain}\n</web_content>\n`);
						} else {
							resolved.push(`\n[web fetch 失败: HTTP ${response.status}]\n`);
						}
					} catch (e) {
						resolved.push(`\n[web fetch 失败: ${String(e)}]\n`);
					}
				} else {
					// 未知 key，原样保留
					resolved.push(`@${key}`);
				}
			}
		}

		return resolved.join('');
	}

	/**
	 * 处理消息中的 #figma <url> 模式，自动调用 Figma MCP 工具获取设计数据
	 * 支持格式：#figma https://www.figma.com/design/... 后面跟描述
	 *
	 * 核心策略：
	 * 1. 限制请求深度（depth:5），从源头减少数据量
	 * 2. 预处理原始数据，提取精华摘要（颜色/字体/组件树），压缩到 ~10KB
	 * 3. 返回 { text, images } — images 仅官方 MCP 支持视觉模型时有值
	 */
	private async _resolveFigmaMentions(message: string): Promise<{ text: string; images: string[] }> {
		// 匹配 #任意serverName https://figma.com/... 格式（服务器名可能不是"figma"）
		const figmaPattern = /#\w+\s+(https?:\/\/(?:www\.)?figma\.com\/[^\s]+)/g;
		let resultText = message;
		const resultImages: string[] = [];
		const matches = [...message.matchAll(figmaPattern)];

		for (const match of matches) {
			const fullMatch = match[0];
			const figmaUrl = match[1];

			const fileKeyMatch = figmaUrl.match(/figma\.com\/(?:design|file)\/([a-zA-Z0-9]+)/);
			if (!fileKeyMatch) {
				resultText = resultText.replace(fullMatch, `[#figma: 无法从 URL 中提取文件 ID，请确认 URL 格式正确]`);
				continue;
			}
			const fileKey = fileKeyMatch[1];

			const nodeIdMatch = figmaUrl.match(/[?&]node-id=([^&]+)/);
			const nodeId = nodeIdMatch
				? decodeURIComponent(nodeIdMatch[1]).replace(/-/g, ':')
				: undefined;

			const allTools = this.maxianService.getConnectedMcpTools();
			const figmaTool = allTools.find(t =>
				t.toolName === 'get_figma_data' ||
				t.toolName.toLowerCase().includes('figma') ||
				t.serverName.toLowerCase().includes('figma')
			);

			if (!figmaTool) {
				resultText = resultText.replace(fullMatch, `[#figma: 未找到已连接的 Figma MCP 服务器，请先在 MCP 面板中添加并连接 Figma 服务器]`);
				continue;
			}

			const imageTool = allTools.find(t =>
				t.serverName === figmaTool.serverName &&
				(t.toolName === 'get_image' || t.toolName === 'get_images' || t.toolName === 'download_figma_images')
			);
			const imageToolName = imageTool?.toolName;

			try {
				// depth:8 保留更完整的节点树，复杂仪表盘通常有5-8层嵌套
				const args: Record<string, any> = { fileKey, depth: 8 };
				if (nodeId) args['nodeId'] = nodeId;

				// 用 timestamp 区分，避免并发冲突
				const timestamp = Date.now();
				const figmaRelPath = `.tmp/figma-ide-${timestamp}`;
				// 推断 MCP 服务器工作目录（即用户 home 目录）
				const workspaceRoot = this.maxianService.getWorkspaceRoot();
				const homeDirMatch = workspaceRoot.match(/^(\/(?:Users|home)\/[^/]+)/);
				const mcpBaseDir = homeDirMatch ? homeDirMatch[1] : '/tmp';
				const figmaAbsDir = `${mcpBaseDir}/${figmaRelPath}`;

				// Step 1: 先获取设计数据
				const rawDesignData = await this.maxianService.callMcpTool(figmaTool.serverName, figmaTool.toolName, args);

				// Step 2: 从 YAML/JSON 中提取含图片 fill 的节点 ID（最多8个）
				const imageNodeIds = imageToolName === 'download_figma_images'
					? this._extractImageFillNodeIds(rawDesignData).slice(0, 8)
					: [];

				// Step 3: 构造下载列表：主节点截图 + 各图片填充节点
				let imageData: string | null = null;
				// nodeId→本地文件名的映射，供 instruction 使用
				const imageNodeFileMap: Map<string, string> = new Map();

				if (imageToolName === 'download_figma_images' && nodeId) {
					const downloadNodes: Array<{ nodeId: string; fileName: string }> = [
						{ nodeId, fileName: 'design.png' },  // 主截图，用于多模态视觉参考
					];
					for (const imgNodeId of imageNodeIds) {
						const safeId = imgNodeId.replace(/:/g, '-');
						const fileName = `img-${safeId}.png`;
						downloadNodes.push({ nodeId: imgNodeId, fileName });
						imageNodeFileMap.set(imgNodeId, `${figmaAbsDir}/${fileName}`);
					}
					const imgArgs = {
						fileKey,
						nodes: downloadNodes,
						localPath: figmaRelPath,
						pngScale: 2,  // scale=2 提升截图分辨率，让多模态模型看清细节
					};
					imageData = await this.maxianService.callMcpTool(figmaTool.serverName, imageToolName, imgArgs).catch(() => null);
				} else if (imageToolName && imageToolName !== 'download_figma_images') {
					const imgArgs = {
						fileKey,
						...(nodeId ? { nodeId } : {}),
						format: 'png',
						scale: 2,
					};
					imageData = await this.maxianService.callMcpTool(figmaTool.serverName, imageToolName!, imgArgs).catch(() => null);
				}

				// Step 4: 提取主截图 base64 传给多模态模型
				let hasImage = false;
				if (imageData) {
					let imgBase64: string | null = null;
					if (imageToolName === 'download_figma_images') {
						imgBase64 = await this._extractBase64FromDownloadFigmaResponse(imageData, figmaAbsDir);
					} else {
						imgBase64 = this._extractBase64FromFigmaImageResponse(imageData);
					}
					if (imgBase64) {
						resultImages.push(imgBase64);
						hasImage = true;
						console.log(`[MaxianView] Figma截图已提取，将直接传给多模态模型；另下载图片节点 ${imageNodeIds.length} 个`);
					}
				}

				// Step 5: 构建图片节点路径说明（供 instruction 使用）
				let imageAssetsSection = '';
				if (imageNodeFileMap.size > 0) {
					const lines = ['', '设计中的图片资源已下载到本地，代码中直接使用以下路径（<img src="...">）：'];
					for (const [nid, path] of imageNodeFileMap.entries()) {
						lines.push(`  - 节点 ${nid} → ${path}`);
					}
					imageAssetsSection = lines.join('\n');
				}

				// 预处理 YAML：有截图时多模态模型直接看图，缩减 YAML 节省 token
				const designData = this._preprocessFigmaData(rawDesignData, hasImage);
				// 提取 globalVars.styles 快查表，帮助模型直接找到 CSS 值，禁止猜测
				const stylesRef = this._buildStylesQuickRef(rawDesignData);

				const screenshotNote = hasImage
					? '【重要】已附高清设计截图。截图是视觉还原的唯一标准——所有颜色、发光效果、边框、背景、阴影、布局必须与截图完全一致。禁止自行猜测任何样式。'
					: '';

				const figmaInstruction = `将以下 Figma 设计精确还原为前端代码。${screenshotNote}

<figma_design url="${figmaUrl}" fileKey="${fileKey}"${nodeId ? ` nodeId="${nodeId}"` : ''}>
${designData}
</figma_design>
${stylesRef ? '\n' + stylesRef + '\n' : ''}${imageAssetsSection}

还原要求（必须逐条遵守）：
- 生成单个 HTML 文件（HTML + CSS + JS 全部内联），100% 完整，禁止骨架/TODO/占位符
- 有截图时：截图中所有视觉效果（发光边框/内外阴影/渐变背景/毛玻璃）都必须实现，一个不漏
- CSS 值必须来自上方样式快查表（stylesRef），表中有的项直接复制，禁止自行创造数值
- 节点 fills 引用 → 查快查表 → CSS background；effects 引用 → 查快查表 → CSS box-shadow/backdrop-filter
- layout.mode row/column → flex；layout.gap/padding/width/height → 精确 px
- position: "absolute" → 绝对定位，使用节点精确坐标
- 数据可视化：SVG 或 ECharts CDN，禁止图片占位
- 图片元素：优先使用上方列出的本地路径；无则用 https://placehold.co/宽x高
- 写完整代码后立即调用 attempt_completion`;

				resultText = resultText.replace(fullMatch, figmaInstruction);
			} catch (e) {
				resultText = resultText.replace(fullMatch, `[#figma 获取失败: ${String(e)}]`);
			}
		}

		return { text: resultText, images: resultImages };
	}

	/**
	 * 从 Figma YAML/JSON 中提取含 IMAGE fill 的节点 ID
	 * 这些节点对应设计中的图片元素（头像、产品图、插图等），应下载后在代码中直接引用
	 */
	private _extractImageFillNodeIds(rawData: string): string[] {
		const nodeIds: string[] = [];

		// JSON 路径：递归查找含 IMAGE fills 的节点
		try {
			const parsed = JSON.parse(rawData);
			const walk = (node: any) => {
				if (!node || typeof node !== 'object') return;
				if (node.id && Array.isArray(node.fills)) {
					for (const fill of node.fills) {
						if (fill?.type === 'IMAGE') {
							nodeIds.push(String(node.id));
							break;
						}
					}
				}
				for (const val of Object.values(node)) {
					if (Array.isArray(val)) val.forEach(walk);
					else if (val && typeof val === 'object') walk(val);
				}
			};
			walk(parsed);
			return [...new Set(nodeIds)];
		} catch {
			// YAML 路径
		}

		// YAML 路径：向上查找含 "type: IMAGE" 的 fill 块对应的节点 id
		// YAML 结构：每个节点行 "  id: '5:10'" 后若干行内出现 "    type: IMAGE"
		const lines = rawData.split('\n');
		// 记录最近遇到的 id（每层缩进维护一个）
		const idByIndent: Map<number, string> = new Map();

		for (const line of lines) {
			const trimmed = line.trimStart();
			const indent = line.length - trimmed.length;

			// 清理比当前缩进更深的 id 记录（离开了那个节点）
			for (const k of idByIndent.keys()) {
				if (k >= indent) idByIndent.delete(k);
			}

			// 记录 id 字段
			const idMatch = trimmed.match(/^id:\s+['"]?([\d:]+)['"]?/);
			if (idMatch) {
				idByIndent.set(indent, idMatch[1]);
			}

			// 发现 IMAGE fill：找最近（缩进最小）的父节点 id
			if (trimmed === 'type: IMAGE' || trimmed.startsWith('type: IMAGE')) {
				let bestId: string | undefined;
				let bestIndent = Infinity;
				for (const [ind, id] of idByIndent.entries()) {
					if (ind < indent && ind < bestIndent) {
						bestIndent = ind;
						bestId = id;
					}
				}
				if (bestId) nodeIds.push(bestId);
			}
		}

		return [...new Set(nodeIds)];
	}

	/**
	 * 将原始 Figma MCP 数据压缩为 AI 可高效利用的精华摘要
	 *
	 * 原始数据可能是 JSON 或 YAML，大小可达数十万字符。
	 * 处理后输出结构化的设计描述，目标大小 8-15KB：
	 *   - 颜色规范（去重、限数量）
	 *   - 字体规范（去重、限数量）
	 *   - 组件树骨架（保留布局/尺寸/颜色关键属性，去掉冗余字段）
	 */
	private _preprocessFigmaData(rawData: string, hasVision = false): string {
		if (!rawData) return '（无设计数据）';

		// 尝试 JSON 解析
		let parsed: any = null;
		try {
			parsed = JSON.parse(rawData);
		} catch {
			// YAML 格式
		}

		if (parsed) {
			return this._extractFigmaJsonSummary(parsed);
		}

		// GLips YAML 格式：优先完整保留 globalVars 块（含 CSS-ready gradient/boxShadow），节点树按需截断
		return this._extractFigmaYamlPreserveGlobalVars(rawData, hasVision ? 40000 : 50000);
	}

	/**
	 * 从 GLips YAML 的 globalVars.styles 提取样式快查表
	 * 输出格式：[styleId] → css-property: value; ...
	 * 让模型直接查找 fills/effects 引用对应的 CSS 值，禁止猜测
	 */
	private _buildStylesQuickRef(yaml: string): string {
		// 找 globalVars.styles 块（2空格缩进或0缩进的 globalVars:）
		const gvIdx = yaml.indexOf('\nglobalVars:');
		if (gvIdx < 0) return '';
		const stylesIdx = yaml.indexOf('\n  styles:', gvIdx);
		if (stylesIdx < 0) return '';

		const lines = yaml.slice(stylesIdx + 1).split('\n');
		const entries: string[] = [];

		// CSS 属性名映射
		const propMap: Record<string, string> = {
			gradient: 'background',
			color: 'color',
			boxShadow: 'box-shadow',
			backdropFilter: 'backdrop-filter',
			filter: 'filter',
			border: 'border',
			opacity: 'opacity',
		};

		let currentId = '';
		let currentProps: string[] = [];

		const flush = () => {
			if (currentId && currentProps.length > 0) {
				entries.push(`[${currentId}] → ${currentProps.join('; ')}`);
			}
			currentProps = [];
		};

		for (const line of lines) {
			// 顶层 styles: 行，跳过
			if (line === '  styles:') continue;
			// 回到顶层（非 styles 子节点），停止
			if (line.length > 0 && !line.startsWith('  ')) break;
			// styles 下的 ID 行（4空格缩进，形如 "    fill_abc:"）
			const idMatch = line.match(/^    ([\w_\-.:]+):$/);
			if (idMatch) {
				flush();
				currentId = idMatch[1];
				continue;
			}
			// 属性行（6空格缩进，形如 "      gradient: ..."）
			if (currentId && line.startsWith('      ')) {
				const colonIdx = line.indexOf(':');
				if (colonIdx > 0) {
					const key = line.slice(0, colonIdx).trim();
					const raw = line.slice(colonIdx + 1).trim().replace(/^['"]|['"]$/g, '');
					// 跳过 type: IMAGE 等非 CSS 属性
					if (key === 'type' && !['color', 'background'].includes(raw)) continue;
					const cssKey = propMap[key] || key;
					if (raw) currentProps.push(`${cssKey}: ${raw}`);
				}
			}
		}
		flush();

		if (entries.length === 0) return '';
		return '### 样式快查表（fills/effects 引用 ID → CSS 值，直接复制使用）\n' + entries.join('\n');
	}

	/**
	 * GLips YAML 专用预处理：
	 * - globalVars.styles 完整保留（含 gradient/boxShadow 等 CSS-ready 字符串，不可截断）
	 * - 节点树部分截断到 maxNodeChars
	 */
	private _extractFigmaYamlPreserveGlobalVars(yaml: string, maxNodeChars: number): string {
		// 找 globalVars 块起始（顶层字段，缩进为0）
		const gvMatch = yaml.match(/\nglobalVars:/);
		const gvStart = gvMatch ? yaml.indexOf(gvMatch[0]) + 1 : -1;

		if (gvStart < 0) {
			// 没有 globalVars，直接截断
			return yaml.length > maxNodeChars ? yaml.slice(0, maxNodeChars) + '\n...[数据已截断]' : yaml;
		}

		const nodesPart = yaml.slice(0, gvStart);
		const globalVarsPart = yaml.slice(gvStart);

		// 节点树截断，globalVars 完整保留
		const nodesTruncated = nodesPart.length > maxNodeChars
			? nodesPart.slice(0, maxNodeChars) + '\n...[节点树已截断]\n'
			: nodesPart;

		return nodesTruncated + globalVarsPart;
	}

	/** 从 JSON 结构中提取精华设计摘要 */
	private _extractFigmaJsonSummary(node: any): string {
		const colors = new Set<string>();
		const fonts: string[] = [];
		const fontSeen = new Set<string>();

		const hexColor = (c: { r: number; g: number; b: number; a?: number }): string => {
			const r = Math.round(c.r * 255).toString(16).padStart(2, '0');
			const g = Math.round(c.g * 255).toString(16).padStart(2, '0');
			const b = Math.round(c.b * 255).toString(16).padStart(2, '0');
			const a = c.a !== undefined && c.a < 0.99 ? Math.round(c.a * 255).toString(16).padStart(2, '0') : '';
			return `#${r}${g}${b}${a}`;
		};

		// 递归提取 token
		const extractTokens = (n: any) => {
			if (!n || typeof n !== 'object') return;
			// 颜色
			if (Array.isArray(n.fills)) {
				for (const f of n.fills) {
					if (f?.type === 'SOLID' && f.color) colors.add(hexColor(f.color));
				}
			}
			if (Array.isArray(n.strokes)) {
				for (const s of n.strokes) {
					if (s?.type === 'SOLID' && s.color) colors.add(hexColor(s.color));
				}
			}
			// 字体
			if (n.style?.fontFamily) {
				const key = `${n.style.fontFamily} ${n.style.fontSize}px ${n.style.fontWeight || 400}`;
				if (!fontSeen.has(key)) { fontSeen.add(key); fonts.push(key); }
			}
			if (Array.isArray(n.children)) n.children.forEach(extractTokens);
		};
		extractTokens(node);

		// 构建组件树骨架（最多 6 层深）
		const buildTree = (n: any, depth: number): string => {
			if (!n || depth > 6) return '';
			const indent = '  '.repeat(depth);

			const attrs: string[] = [];
			if (n.layoutMode === 'HORIZONTAL') attrs.push('flex-row');
			else if (n.layoutMode === 'VERTICAL') attrs.push('flex-col');
			if (n.itemSpacing) attrs.push(`gap:${Math.round(n.itemSpacing)}`);
			const pt = n.paddingTop, pr = n.paddingRight, pb = n.paddingBottom, pl = n.paddingLeft;
			if (pt || pr || pb || pl) {
				attrs.push(`padding:${pt||0} ${pr||0} ${pb||0} ${pl||0}`);
			}
			if (n.cornerRadius) attrs.push(`radius:${n.cornerRadius}`);
			const box = n.absoluteBoundingBox;
			if (box?.width) attrs.push(`w:${Math.round(box.width)}`);
			if (box?.height) attrs.push(`h:${Math.round(box.height)}`);
			if (n.fills?.[0]?.color) attrs.push(`bg:${hexColor(n.fills[0].color)}`);
			if (n.strokes?.[0]?.color) attrs.push(`border:${hexColor(n.strokes[0].color)}`);
			if (n.style?.fontSize) attrs.push(`${n.style.fontSize}px`);
			if (n.style?.fontWeight && n.style.fontWeight !== 400) attrs.push(`fw:${n.style.fontWeight}`);
			if (n.characters) attrs.push(`"${String(n.characters).slice(0, 40)}"`);
			if (Array.isArray(n.effects) && n.effects.some((e: any) => e.type === 'DROP_SHADOW')) attrs.push('shadow');

			const attrStr = attrs.length ? ` [${attrs.join(', ')}]` : '';
			let result = `${indent}${n.type || 'NODE'} "${n.name || ''}"${attrStr}\n`;

			if (Array.isArray(n.children)) {
				for (const child of n.children) {
					result += buildTree(child, depth + 1);
				}
			}
			return result;
		};

		const colorSection = colors.size
			? `### 颜色\n${[...colors].slice(0, 30).map(c => `- ${c}`).join('\n')}\n`
			: '';
		const fontSection = fonts.length
			? `### 字体\n${fonts.slice(0, 15).map(f => `- ${f}`).join('\n')}\n`
			: '';
		const treeSection = `### 组件树\n${buildTree(node, 0)}`;

		return `${colorSection}\n${fontSection}\n${treeSection}`.trim();
	}


	/**
	 * 解析 download_figma_images 工具的响应，读取保存到磁盘的图片文件并返回 base64
	 * download_figma_images 将图片保存到 localPath 目录，响应为文字说明（含文件路径）
	 */
	private async _extractBase64FromDownloadFigmaResponse(responseText: string, expectedDir: string): Promise<string | null> {
		// 先尝试读取预期路径（localPath + fileName）
		const candidates: string[] = [
			`${expectedDir}/design.png`,
			`${expectedDir}/design.svg`,
		];

		// 同时从响应文本中提取绝对路径
		// 典型响应: "Downloaded images to /path/dir\n- /path/dir/nodeId.png"
		const pathPattern = /([/\\][^\s"'\\n]+\.(?:png|jpg|jpeg|svg|pdf))/gi;
		let match;
		while ((match = pathPattern.exec(responseText)) !== null) {
			if (!candidates.includes(match[1])) {
				candidates.push(match[1]);
			}
		}

		console.log('[MaxianView] download_figma_images 响应:', responseText.slice(0, 300));
		console.log('[MaxianView] 尝试读取文件路径:', candidates);

		// 依次尝试读取
		for (const filePath of candidates) {
			const base64 = await this.maxianService.readLocalFileAsBase64(filePath);
			if (base64) {
				console.log('[MaxianView] 成功读取 Figma 图片:', filePath, '大小:', base64.length);
				return base64;
			}
		}

		console.warn('[MaxianView] 所有 Figma 图片路径读取失败，候选列表:', candidates);
		return null;
	}

	/**
	 * 从 Figma MCP get_image 工具的返回值中提取 base64 图片数据
	 * 官方 Figma MCP 可能返回：base64 字符串、data:image/... URL、或包含 url 字段的 JSON
	 */
	private _extractBase64FromFigmaImageResponse(response: string): string | null {
		if (!response) return null;

		// 已经是纯 base64 字符串
		if (/^[A-Za-z0-9+/]+=*$/.test(response.trim()) && response.length > 100) {
			return response.trim();
		}

		// data:image/png;base64,... 格式
		const dataUrlMatch = response.match(/data:image\/[a-z]+;base64,([A-Za-z0-9+/]+=*)/);
		if (dataUrlMatch) return dataUrlMatch[1];

		// JSON 格式（可能包含 url 或 data 字段）
		try {
			const json = JSON.parse(response);
			// { data: "base64..." } 或 { images: { nodeId: "base64..." } }
			if (json.data && typeof json.data === 'string') {
				return this._extractBase64FromFigmaImageResponse(json.data);
			}
			if (json.images && typeof json.images === 'object') {
				const firstImg = Object.values(json.images)[0];
				if (typeof firstImg === 'string') {
					return this._extractBase64FromFigmaImageResponse(firstImg);
				}
			}
		} catch {
			// 不是 JSON，忽略
		}

		return null;
	}

	private handleMessageEvent(event: import('./maxianService.js').IMessageEvent): void {

		// 任何服务响应事件到达时移除"等待中"气泡（用户消息事件除外）
		if (event.type !== 'user') {
			this.hideWaitingIndicator();
		}

		if (event.type === 'user') {
			// 用户发送新消息时，重置AI消息元素（开始新一轮对话）
			this.currentAiMessageElement = null;
			this.currentAiMessageText = '';
			this.currentStreamingMessageElement = null;
			this.currentToolStatusElement = null;

			// 显示用户消息 - 左右布局：用户消息在右侧
			const userRow = append(this.messageArea, $('div.maxian-message-row.row-user'));

			// 右侧头像
			const userAvatarWrap = append(userRow, $('div.maxian-message-avatar-wrap'));
			userAvatarWrap.style.background = 'var(--vscode-inputOption-activeBackground, rgba(0,122,204,0.3))';
			const userIcon = append(userAvatarWrap, $('span.codicon.codicon-account'));
			userIcon.style.color = 'var(--vscode-foreground)';
			userIcon.style.fontSize = '14px';

			// 气泡
			const userMsg = append(userRow, $('div.maxian-message.maxian-message-user'));

			// 消息头部（右侧布局：名称在右，时间在左）
			const userHeader = append(userMsg, $('div.maxian-message-header'));

			// 操作按钮（最左）
			const userActions = append(userHeader, $('div.maxian-message-actions'));
			const msgContent = event.content;
			createCopyButton(userActions, () => msgContent);

			// 时间戳
			const userTime = append(userHeader, $('span.maxian-message-time'));
			userTime.textContent = formatTime(Date.now());

			// 发送者名称（最右）
			const userSender = append(userHeader, $('span.maxian-message-sender'));
			const currentUser = this.authService.currentUser;
			userSender.textContent = currentUser?.displayName || currentUser?.username || '你';

			// 消息内容（@文件名 渲染为可点击 chip），长消息支持折叠
			const FOLD_THRESHOLD = 200; // 超过此字符数时折叠
			const isLong = event.content.length > FOLD_THRESHOLD;

			const userContent = append(userMsg, $('div.maxian-message-text'));
			userContent.style.whiteSpace = 'pre-wrap';
			userContent.style.wordBreak = 'break-word';
			userContent.style.color = 'var(--vscode-foreground)';
			userContent.style.lineHeight = '1.5';

			if (isLong) {
				// 折叠态：只显示前 200 个字符
				let collapsed = true;
				const previewText = event.content.substring(0, FOLD_THRESHOLD);

				const previewEl = append(userContent, $('span'));
				previewEl.style.whiteSpace = 'pre-wrap';
				previewEl.style.wordBreak = 'break-word';
				previewEl.textContent = previewText + '...';

				const fullEl = append(userContent, $('span'));
				fullEl.style.whiteSpace = 'pre-wrap';
				fullEl.style.wordBreak = 'break-word';
				fullEl.style.display = 'none';
				this.renderMessageWithMentions(fullEl, event.content);

				const toggleBtn = append(userContent, $('span'));
				toggleBtn.style.cssText = `
					display: inline-block;
					margin-top: 4px;
					cursor: pointer;
					color: var(--vscode-textLink-foreground);
					font-size: 12px;
					user-select: none;
				`;
				toggleBtn.textContent = '展开全文';
				toggleBtn.onclick = () => {
					collapsed = !collapsed;
					previewEl.style.display = collapsed ? '' : 'none';
					fullEl.style.display = collapsed ? 'none' : '';
					toggleBtn.textContent = collapsed ? '展开全文' : '收起';
				};
			} else {
				this.renderMessageWithMentions(userContent, event.content);
			}

			this.messageArea.scrollTop = this.messageArea.scrollHeight;

			// 用户消息渲染完成后，立即显示"等待中"气泡（在用户消息下方）
			this.showWaitingIndicator();
		} else if (event.type === 'progress') {
			this.apiRequestBackendHint = event.content;
			this.updateApiRequestProgressText();
		} else if (event.type === 'assistant') {
			// 如果是流式消息
			if (event.isPartial) {
				if (!this.currentAiMessageElement) {
					// 移除旧的流式气泡（如果存在），避免孤立气泡残留
					// 场景：上一轮API调用包含工具使用，say('text')未被调用，streaming bubble未被清理
					if (this.currentStreamingMessageElement) {
						this.currentStreamingMessageElement.remove();
						this.currentStreamingMessageElement = null;
					}

					// 创建新的AI消息元素 - 左右布局：AI消息在左侧
					const aiRow = append(this.messageArea, $('div.maxian-message-row.row-ai'));

					// 左侧头像
					const aiAvatarWrap = append(aiRow, $('div.maxian-message-avatar-wrap'));
					const aiAvatarImg = append(aiAvatarWrap, $('img')) as HTMLImageElement;
					aiAvatarImg.src = FileAccess.asBrowserUri('vs/workbench/contrib/maxian/browser/media/icons/maxian-avatar.png').toString(true);

					// 气泡
					const aiMsg = append(aiRow, $('div.maxian-message.maxian-message-ai'));

					// 消息头部
					const aiHeader = append(aiMsg, $('div.maxian-message-header'));

					// 发送者名称
					const aiSender = append(aiHeader, $('span.maxian-message-sender'));
					aiSender.style.color = 'var(--vscode-foreground)';
					aiSender.textContent = '码弦';

					// 时间戳
					const aiTime = append(aiHeader, $('span.maxian-message-time'));
					aiTime.textContent = formatTime(Date.now());

					// 操作按钮区域（流式阶段不加复制按钮，等完整消息到达后添加）
					append(aiHeader, $('div.maxian-message-actions'));

					const aiContent = append(aiMsg, $('div'));
					aiContent.style.color = 'var(--vscode-foreground)';
					aiContent.style.lineHeight = '1.6';
					aiContent.style.fontFamily = 'var(--vscode-font-family)';

					// 累积原始文本
					this.currentAiMessageText = event.content;

					// 实时渲染Markdown
					MarkdownRendererDom.renderMarkdown(this.currentAiMessageText, aiContent);

					this.currentAiMessageElement = aiContent;
					// 记录外层容器（row），供renderTextMessage在完整消息到达时移除旧的流式气泡
					this.currentStreamingMessageElement = aiRow;
				} else {
					// 累积内容
					this.currentAiMessageText += event.content;

					// 实时渲染Markdown
					MarkdownRendererDom.renderMarkdown(this.currentAiMessageText, this.currentAiMessageElement);
				}
			} else {
				// 流式结束，重置内容引用（保留currentStreamingMessageElement供renderTextMessage移除旧气泡）
				this.currentAiMessageElement = null;
				this.currentAiMessageText = '';
			}

			this.messageArea.scrollTop = this.messageArea.scrollHeight;
		} else if (event.type === 'tool') {
			// 工具调用时，重置当前AI消息元素（Markdown已在流式过程中实时渲染）
			this.currentAiMessageElement = null;
			this.currentAiMessageText = '';

			// 🔧 使用统一的renderToolExecutionStatus方法来渲染工具状态
			// 这样可以保持与历史消息渲染的一致性
			this.renderToolExecutionStatus(event.content);

			this.messageArea.scrollTop = this.messageArea.scrollHeight;
		} else if (event.type === 'error') {
			// 错误时，重置当前AI消息元素（Markdown已在流式过程中实时渲染）
			this.currentAiMessageElement = null;
			this.currentAiMessageText = '';

			// 显示错误消息
			const errorMsg = append(this.messageArea, $('div'));
			errorMsg.style.marginBottom = '10px';
			errorMsg.style.padding = '10px 15px';
			errorMsg.style.backgroundColor = 'var(--vscode-inputValidation-errorBackground)';
			errorMsg.style.border = '1px solid var(--vscode-inputValidation-errorBorder)';
			errorMsg.style.borderRadius = '6px';
			errorMsg.style.borderLeft = '3px solid var(--vscode-errorForeground)';

			const errorLabel = append(errorMsg, $('div'));
			errorLabel.style.fontWeight = '600';
			errorLabel.style.marginBottom = '6px';
			errorLabel.style.color = 'var(--vscode-errorForeground)';
			errorLabel.style.fontSize = '13px';
			errorLabel.textContent = '❌ 错误';

			const errorContent = append(errorMsg, $('div'));
			errorContent.style.whiteSpace = 'pre-wrap';
			errorContent.style.wordBreak = 'break-word';
			errorContent.style.color = 'var(--vscode-foreground)';
			errorContent.style.lineHeight = '1.5';
			errorContent.textContent = event.content;

			this.messageArea.scrollTop = this.messageArea.scrollHeight;
		}
	}

	/**
	 * 处理AI提问事件
	 */
	private handleQuestionAsked(event: import('./maxianService.js').IQuestionAskedEvent): void {
		// 重置当前AI消息元素（问题是新的对话轮次）
		this.currentAiMessageElement = null;
		this.currentAiMessageText = '';

		// 显示AI的问题（特殊样式，突出显示）
		const questionMsg = append(this.messageArea, $('div'));
		questionMsg.style.marginBottom = '10px';
		questionMsg.style.padding = '12px 16px';
		questionMsg.style.backgroundColor = 'var(--vscode-inputValidation-warningBackground)';
		questionMsg.style.border = '2px solid var(--vscode-inputValidation-warningBorder)';
		questionMsg.style.borderRadius = '8px';
		questionMsg.style.borderLeft = '4px solid var(--vscode-charts-orange)';

		const questionLabel = append(questionMsg, $('div'));
		questionLabel.style.fontWeight = '700';
		questionLabel.style.marginBottom = '8px';
		questionLabel.style.fontSize = '14px';
		questionLabel.style.color = 'var(--vscode-charts-orange)';
		questionLabel.style.display = 'flex';
		questionLabel.style.alignItems = 'center';
		questionLabel.style.gap = '6px';

		const questionIcon = append(questionLabel, $('img')) as HTMLImageElement;
		questionIcon.src = FileAccess.asBrowserUri('vs/workbench/contrib/maxian/browser/media/icons/maxian-avatar.png').toString(true);
		questionIcon.style.width = '18px';
		questionIcon.style.height = '18px';
		questionIcon.style.objectFit = 'contain';
		questionIcon.style.borderRadius = '3px';

		const questionText = append(questionLabel, $('span'));
		questionText.textContent = '码弦 正在询问';

		const questionContent = append(questionMsg, $('div'));
		questionContent.style.whiteSpace = 'pre-wrap';
		questionContent.style.wordBreak = 'break-word';
		questionContent.style.color = 'var(--vscode-foreground)';
		questionContent.style.lineHeight = '1.6';
		questionContent.style.fontSize = '13px';
		questionContent.style.fontWeight = '500';
		questionContent.textContent = event.question;

		const quickOptions = ensureFollowupOptions(event.options);
		if (quickOptions.length > 0) {
			const optionsContainer = append(questionMsg, $('div'));
			optionsContainer.style.display = 'flex';
			optionsContainer.style.flexWrap = 'wrap';
			optionsContainer.style.gap = '8px';
			optionsContainer.style.marginTop = '10px';

			for (const option of quickOptions) {
				const optionButton = append(optionsContainer, $('button')) as HTMLButtonElement;
				optionButton.textContent = option.label;
				optionButton.style.padding = '6px 12px';
				optionButton.style.backgroundColor = 'var(--vscode-button-secondaryBackground)';
				optionButton.style.color = 'var(--vscode-button-secondaryForeground)';
				optionButton.style.border = '1px solid var(--vscode-contrastBorder)';
				optionButton.style.borderRadius = '4px';
				optionButton.style.cursor = 'pointer';
				optionButton.style.fontSize = '12px';
				if (option.description) {
					optionButton.title = option.description;
				}
				optionButton.onclick = () => {
					this.inputBox.textContent = option.value || option.label;
					this.sendButton.click();
				};
			}
		}

		// 添加提示文本
		const hintText = append(questionMsg, $('div'));
		hintText.style.marginTop = '8px';
		hintText.style.fontSize = '12px';
		hintText.style.color = 'var(--vscode-descriptionForeground)';
		hintText.style.fontStyle = 'italic';
		hintText.textContent = '💡 请在下方输入框中回答...';

		this.messageArea.scrollTop = this.messageArea.scrollHeight;

		// 设置等待状态
		this.awaitingUserResponse = true;

		// 更新输入框placeholder
		this.setInputPlaceholder(this.getInputPlaceholder('awaiting'));
		this.inputBox.focus();
	}

	/**
	 * 渲染Cline消息 - 处理所有ask/say消息类型
	 */
	private renderClineMessage(message: ClineMessage): void {
		// 根据消息类型路由到不同的渲染函数
		if (message.type === 'say') {
			this.renderSayMessage(message);
		} else if (message.type === 'ask') {
			this.renderAskMessage(message);
		}
	}

	/**
	 * 渲染Say消息（AI主动发送的消息）
	 */
	private renderSayMessage(message: ClineMessage): void {
		const sayType = message.say;
		if (!sayType) {return;}
		if (sayType !== 'text' && (this.pendingTextStreamBuffer || this.pendingTextStreamFinalize || this.textStreamFlushTimer !== null)) {
			if (this.textStreamFlushTimer !== null) {
				clearTimeout(this.textStreamFlushTimer);
				this.textStreamFlushTimer = null;
			}
			this.flushTextStreamBuffer();
		}

			switch (sayType) {
				case 'text':
					// 一旦收到文本流，说明请求已经有实质性进展，结束“思考中”提示
					this.stopApiRequestProgress(true);
					// 文本消息 - 使用Markdown渲染
					this.enqueueTextMessageRender(message.text || '', message.partial);
					break;

				case 'reasoning':
					// Reasoning 到达也视为已进入响应阶段，结束“思考中”提示
					this.stopApiRequestProgress(true);
					// Reasoning/思考过程 - 使用可折叠的思考块展示
					this.renderReasoningMessage(message.reasoning || message.text || '', message.partial);
					break;

				case 'completion_result':
					this.stopApiRequestProgress(true);
					// 任务完成时，移除最后一轮API调用的流式气泡（与case 'tool'相同）
					// attempt_completion不调用say('tool')，所以流式气泡未被case 'tool'清理
					if (this.currentStreamingMessageElement) {
					this.currentStreamingMessageElement.remove();
					this.currentStreamingMessageElement = null;
				}
				// 完成结果 - 显示给用户查看
				this.renderCompletionResult(message.text || '');
				break;

				case 'error':
					this.stopApiRequestProgress(true);
					// 错误时也清理流式气泡
					if (this.currentStreamingMessageElement) {
						this.currentStreamingMessageElement.remove();
					this.currentStreamingMessageElement = null;
				}
				// 错误消息
				this.renderErrorMessage(message.text || '未知错误');
				break;

				case 'api_req_started':
					// API 请求开始：显示动态进度文案，避免长时间只看到固定“思考中”
					this.startApiRequestProgress();
					break;

				case 'api_req_finished':
					// API请求完成 - 移除思考状态消息与定时器
					this.stopApiRequestProgress(true);
					break;

				case 'api_req_retried':
					// API请求重试：在同一条进度消息里更新阶段，不额外刷屏
					this.apiRequestRetryCount++;
					this.updateApiRequestProgressText();
					break;

			case 'user_feedback':
				// 用户反馈
				this.renderUserFeedback(message.text || '', message.images);
				break;

				case 'tool':
					this.stopApiRequestProgress(true);
					// 工具执行时，立即移除上一轮API调用的流式气泡（AI的思考文本不应保留）
					if (this.currentStreamingMessageElement) {
						this.currentStreamingMessageElement.remove();
					this.currentStreamingMessageElement = null;
				}
				// 工具执行状态 - 显示正在执行什么工具
				this.renderToolExecutionStatus(message.text || '');
				break;

			case 'condense_context':
				// 上下文压缩 - 显示压缩状态
				this.renderCondenseContext(message);
				break;

			case 'system_internal':
				// 🔧 系统内部消息 - 静默处理，不显示在UI（避免系统提示泄露）
				break;

			case 'file_changes':
				// 任务完成后的文件变更汇总
				this.renderFileChangesSummary(message.text || '');
				break;

			default:
				// 未处理的say消息类型
				break;
		}
	}

	/**
	 * 渲染Ask消息（需要用户响应的消息）
	 */
	private renderAskMessage(message: ClineMessage): void {
		const askType = message.ask;
		if (!askType) {return;}

		switch (askType) {
			case 'followup':
				// AI提出跟进问题
				this.renderFollowupQuestion(message);
				break;

			case 'completion_result':
				// 任务完成，请求用户确认
				this.renderCompletionConfirmation(message);
				break;

			case 'api_req_failed':
				// API请求失败，询问是否重试
				this.renderApiFailedAsk(message);
				break;

			case 'tool':
				// 工具使用确认
				this.renderToolApproval(message);
				break;

			case 'command':
				// 命令执行确认
				this.renderCommandApproval(message);
				break;

			default:
				// 未处理的ask消息类型
				break;
		}
	}

	private enqueueTextMessageRender(text: string, partial?: boolean): void {
		// 流结束信号：立即标记 finalize，并尽快 flush
		if (!text && !partial) {
			this.pendingTextStreamFinalize = true;
			this.scheduleTextStreamFlush(0);
			return;
		}

		this.pendingTextStreamBuffer += text;
		this.pendingTextStreamPartial = this.pendingTextStreamPartial || !!partial;
		this.scheduleTextStreamFlush(50);
	}

	private scheduleTextStreamFlush(delay: number): void {
		if (this.textStreamFlushTimer !== null) {
			if (delay > 0) {
				return;
			}
			clearTimeout(this.textStreamFlushTimer);
			this.textStreamFlushTimer = null;
		}

		this.textStreamFlushTimer = window.setTimeout(() => {
			this.textStreamFlushTimer = null;
			this.flushTextStreamBuffer();
		}, delay);
	}

	private flushTextStreamBuffer(): void {
		const chunk = this.pendingTextStreamBuffer;
		const hasPartial = this.pendingTextStreamPartial;
		const shouldFinalize = this.pendingTextStreamFinalize;

		this.pendingTextStreamBuffer = '';
		this.pendingTextStreamPartial = false;
		this.pendingTextStreamFinalize = false;

		if (chunk) {
			this.renderTextMessage(chunk, hasPartial);
		}
		if (shouldFinalize) {
			this.renderTextMessage('', false);
		}
	}

	/**
	 * 渲染文本消息
	 * 优化：使用新的消息气泡样式，添加时间戳和操作按钮
	 */
	private renderTextMessage(text: string, partial?: boolean): void {
		if (!text && !partial) {
			// 流结束信号 - 添加操作按钮
			if (this.currentAiMessageElement) {
				const parentMsg = this.currentAiMessageElement.parentElement;
				if (parentMsg) {
					// 添加复制按钮到消息操作区
					const actionsArea = parentMsg.querySelector('.maxian-message-actions');
					if (actionsArea && !actionsArea.querySelector('.copy-btn')) {
						const finalText = this.currentAiMessageText;
						createCopyButton(actionsArea as HTMLElement, () => finalText);
					}
				}
			}
			this.currentAiMessageElement = null;
			this.currentAiMessageText = '';
			this.currentStreamingMessageElement = null;
			return;
		}

		// 当AI开始输出文本时，清除工具状态元素的引用（保留UI但停止更新）
		if (this.currentToolStatusElement) {
			this.clearToolStatusElement();
		}

		if (!this.currentAiMessageElement) {
			// 移除旧的流式气泡（如果存在），避免与完整消息气泡重叠
			if (this.currentStreamingMessageElement) {
				this.currentStreamingMessageElement.remove();
				this.currentStreamingMessageElement = null;
			}
			// 创建新的AI消息元素 - 左右布局：AI消息在左侧
			const aiRow = append(this.messageArea, $('div.maxian-message-row.row-ai'));

			// 左侧头像
			const aiAvatarWrap = append(aiRow, $('div.maxian-message-avatar-wrap'));
			const aiAvatarImg = append(aiAvatarWrap, $('img')) as HTMLImageElement;
			aiAvatarImg.src = FileAccess.asBrowserUri('vs/workbench/contrib/maxian/browser/media/icons/maxian-avatar.png').toString(true);

			// 气泡
			const aiMsg = append(aiRow, $('div.maxian-message.maxian-message-ai'));

			// 消息头部
			const aiHeader = append(aiMsg, $('div.maxian-message-header'));

			// 发送者名称
			const aiSender = append(aiHeader, $('span.maxian-message-sender'));
			aiSender.style.color = 'var(--vscode-foreground)';
			aiSender.textContent = '码弦';

			// 时间戳
			const aiTime = append(aiHeader, $('span.maxian-message-time'));
			aiTime.textContent = formatTime(Date.now());

			// 操作按钮区域（复制按钮在消息完成后添加）
			append(aiHeader, $('div.maxian-message-actions'));

			// 消息内容
			const aiContent = append(aiMsg, $('div'));
			aiContent.style.color = 'var(--vscode-foreground)';
			aiContent.style.lineHeight = '1.6';
			aiContent.style.fontFamily = 'var(--vscode-font-family)';

			this.currentAiMessageText = text;
			MarkdownRendererDom.renderMarkdown(this.currentAiMessageText, aiContent);
			this.currentAiMessageElement = aiContent;
			// 如果不是partial消息，直接添加复制按钮（complete消息不会再收到stream-end信号）
			if (!partial) {
				const actionsArea = aiHeader.querySelector('.maxian-message-actions') as HTMLElement | null;
				if (actionsArea) {
					const capturedText = text;
					createCopyButton(actionsArea, () => capturedText);
				}
				this.currentAiMessageElement = null;
				this.currentAiMessageText = '';
			}
		} else {
			// 累积内容
			this.currentAiMessageText += text;
			MarkdownRendererDom.renderMarkdown(this.currentAiMessageText, this.currentAiMessageElement);
		}

		this.messageArea.scrollTop = this.messageArea.scrollHeight;
	}

	/**
	 * 渲染 Reasoning/思考过程（S1功能）
	 * 使用可折叠的"思考中"块展示AI的推理过程
	 */
	private renderReasoningMessage(text: string, partial?: boolean): void {
		if (!text && !partial) {
			// 流结束信号
			this.currentReasoningElement = null;
			this.currentReasoningText = '';
			return;
		}

		if (!this.currentReasoningElement) {
			// 创建新的思考块容器
			const reasoningContainer = append(this.messageArea, $('div'));
			reasoningContainer.style.marginBottom = '10px';

			// 创建标题元素
			const titleElement = $('div');
			titleElement.style.display = 'flex';
			titleElement.style.alignItems = 'center';
			titleElement.style.gap = '8px';

			// 思考图标（脑袋/灯泡）
			const thinkIcon = append(titleElement, $('span.codicon.codicon-lightbulb'));
			thinkIcon.style.fontSize = '14px';
			thinkIcon.style.color = 'var(--vscode-charts-purple, #c586c0)';

			// 标题文本
			const titleText = append(titleElement, $('span'));
			titleText.style.fontWeight = '600';
			titleText.style.fontSize = '13px';
			titleText.style.color = 'var(--vscode-charts-purple, #c586c0)';
			titleText.textContent = '思考中...';

			// 加载动画（三个点）
			const loadingDots = append(titleElement, $('span'));
			loadingDots.style.color = 'var(--vscode-descriptionForeground)';
			loadingDots.style.animation = 'blink 1s infinite';
			loadingDots.textContent = partial ? '...' : '';

			// 创建可折叠组件
			const collapsible = createCollapsible(reasoningContainer, {
				title: titleElement,
				defaultOpen: false, // 默认折叠，用户可以点击展开查看
				headerClass: 'reasoning-header',
				contentClass: 'reasoning-content'
			});

			// 设置容器样式 - 紫色主题
			collapsible.container.style.backgroundColor = 'rgba(197, 134, 192, 0.1)';
			collapsible.container.style.border = '1px solid var(--vscode-charts-purple, #c586c0)';
			collapsible.container.style.borderLeft = '3px solid var(--vscode-charts-purple, #c586c0)';

			// 内容区域
			const contentArea = collapsible.content;
			contentArea.style.fontFamily = 'var(--vscode-editor-font-family)';
			contentArea.style.fontSize = '12px';
			contentArea.style.color = 'var(--vscode-descriptionForeground)';
			contentArea.style.lineHeight = '1.6';
			contentArea.style.whiteSpace = 'pre-wrap';
			contentArea.style.wordBreak = 'break-word';
			contentArea.style.maxHeight = '300px';
			contentArea.style.overflow = 'auto';

			this.currentReasoningText = text;
			contentArea.textContent = this.currentReasoningText;
			this.currentReasoningElement = contentArea;

			// 存储标题引用以便更新
			(this.currentReasoningElement as any).__titleText = titleText;
			(this.currentReasoningElement as any).__loadingDots = loadingDots;
		} else {
			// 累积内容
			this.currentReasoningText += text;
			this.currentReasoningElement.textContent = this.currentReasoningText;
		}

		// 更新标题状态
		if (!partial && this.currentReasoningElement) {
			const titleText = (this.currentReasoningElement as any).__titleText;
			const loadingDots = (this.currentReasoningElement as any).__loadingDots;
			if (titleText) {
				titleText.textContent = '思考完成';
			}
			if (loadingDots) {
				loadingDots.textContent = '';
			}
		}

		this.messageArea.scrollTop = this.messageArea.scrollHeight;
	}

	/**
	 * 渲染上下文压缩状态（C3功能）
	 * 显示压缩完成的提示信息
	 */
	private renderCondenseContext(message: ClineMessage): void {
		const contextInfo = message.contextCondense;
		if (!contextInfo) {
			// 没有压缩信息，显示简单提示
			this.renderSystemMessage('🗜️ 上下文已压缩');
			return;
		}

		// 计算节省的token数
		const savedTokens = contextInfo.prevContextTokens - contextInfo.newContextTokens;
		const savingPercent = ((savedTokens / contextInfo.prevContextTokens) * 100).toFixed(1);

		// 创建压缩状态显示
		const compactContainer = append(this.messageArea, $('div'));
		compactContainer.style.marginBottom = '10px';

		createCompactionStatus(compactContainer, {
			compactedParts: 1, // 压缩了一次
			savedTokens: savedTokens
		});

		// 如果有摘要，显示可折叠的摘要内容
		if (contextInfo.summary) {
			const summaryContainer = append(this.messageArea, $('div'));
			summaryContainer.style.marginBottom = '10px';

			// 创建标题元素
			const titleElement = $('div');
			titleElement.style.display = 'flex';
			titleElement.style.alignItems = 'center';
			titleElement.style.gap = '8px';

			const archiveIcon = append(titleElement, $('span.codicon.codicon-archive'));
			archiveIcon.style.fontSize = '14px';
			archiveIcon.style.color = 'var(--vscode-charts-blue)';

			const titleText = append(titleElement, $('span'));
			titleText.style.fontWeight = '600';
			titleText.style.fontSize = '12px';
			titleText.style.color = 'var(--vscode-foreground)';
			titleText.textContent = `上下文压缩摘要 (节省 ${savingPercent}%)`;

			// 创建可折叠组件
			const collapsible = createCollapsible(summaryContainer, {
				title: titleElement,
				defaultOpen: false,
				headerClass: 'condense-summary-header',
				contentClass: 'condense-summary-content'
			});

			collapsible.container.style.backgroundColor = 'var(--vscode-editor-inactiveSelectionBackground)';

			// 摘要内容
			const summaryContent = collapsible.content;
			summaryContent.style.fontSize = '12px';
			summaryContent.style.color = 'var(--vscode-descriptionForeground)';
			summaryContent.style.lineHeight = '1.5';
			summaryContent.style.whiteSpace = 'pre-wrap';
			summaryContent.textContent = contextInfo.summary;
		}

		// 如果标记了自动继续，显示提示
		if (contextInfo.autoContinue) {
			const continueHint = append(this.messageArea, $('div'));
			continueHint.style.marginBottom = '10px';
			continueHint.style.padding = '8px 12px';
			continueHint.style.backgroundColor = 'var(--vscode-inputValidation-infoBackground)';
			continueHint.style.borderRadius = '6px';
			continueHint.style.display = 'flex';
			continueHint.style.alignItems = 'center';
			continueHint.style.gap = '8px';

			const refreshIcon = append(continueHint, $('span.codicon.codicon-sync.codicon-modifier-spin'));
			refreshIcon.style.fontSize = '14px';
			refreshIcon.style.color = 'var(--vscode-charts-blue)';

			const continueText = append(continueHint, $('span'));
			continueText.style.fontSize = '12px';
			continueText.style.color = 'var(--vscode-foreground)';
			continueText.textContent = '正在继续任务...';

			// 2秒后自动移除提示
			setTimeout(() => {
				continueHint.remove();
			}, 2000);
		}

		this.messageArea.scrollTop = this.messageArea.scrollHeight;
	}

	/**
	 * 渲染完成结果（用于completion_result say消息）
	 * 🔧 使用Markdown渲染以正确显示格式化内容
	 */
	private renderCompletionResult(result: string): void {
		const resultMsg = append(this.messageArea, $('div'));
		resultMsg.style.marginBottom = '10px';
		resultMsg.style.padding = '12px 16px';
		resultMsg.style.backgroundColor = 'var(--vscode-inputValidation-infoBackground)';
		resultMsg.style.border = '2px solid var(--vscode-inputValidation-infoBorder)';
		resultMsg.style.borderRadius = '8px';
		resultMsg.style.borderLeft = '4px solid var(--vscode-charts-green)';

		const resultLabel = append(resultMsg, $('div'));
		resultLabel.style.fontWeight = '700';
		resultLabel.style.marginBottom = '8px';
		resultLabel.style.fontSize = '14px';
		resultLabel.style.color = 'var(--vscode-charts-green)';
		resultLabel.textContent = '✅ 任务完成';

		const resultContent = append(resultMsg, $('div'));
		resultContent.style.whiteSpace = 'normal'; // 🔧 改为normal以支持markdown渲染
		resultContent.style.wordBreak = 'break-word';
		resultContent.style.color = 'var(--vscode-foreground)';
		resultContent.style.lineHeight = '1.6';
		// 🔧 使用MarkdownRendererDom渲染markdown内容
		MarkdownRendererDom.renderMarkdown(result, resultContent);

		this.messageArea.scrollTop = this.messageArea.scrollHeight;
	}

	/**
	 * 渲染文件变更汇总（任务完成后显示）
	 */
	private renderFileChangesSummary(text: string): void {
		let changes: { written: string[]; deleted: string[] };
		try {
			changes = JSON.parse(text);
		} catch {
			return;
		}

		if (changes.written.length === 0 && changes.deleted.length === 0) {
			return;
		}

		const container = append(this.messageArea, $('div.file-changes-summary'));
		container.style.margin = '8px 0 12px 0';
		container.style.borderRadius = '6px';
		container.style.border = '1px solid var(--vscode-panel-border)';
		container.style.overflow = 'hidden';
		container.style.fontSize = '12px';

		// 标题行
		const header = append(container, $('div'));
		header.style.padding = '6px 10px';
		header.style.backgroundColor = 'var(--vscode-editor-inactiveSelectionBackground)';
		header.style.display = 'flex';
		header.style.alignItems = 'center';
		header.style.gap = '6px';
		header.style.fontWeight = '600';
		header.style.color = 'var(--vscode-foreground)';

		const icon = append(header, $('span.codicon.codicon-diff'));
		icon.style.fontSize = '13px';
		const title = append(header, $('span'));
		const total = changes.written.length + changes.deleted.length;
		title.textContent = `文件变更汇总 · ${total} 个文件`;

		// 内容区
		const body = append(container, $('div'));
		body.style.padding = '6px 10px';
		body.style.backgroundColor = 'var(--vscode-editor-background)';

		// 渲染一组文件列表
		const renderGroup = (label: string, iconClass: string, color: string, files: string[]) => {
			if (files.length === 0) { return; }
			const group = append(body, $('div'));
			group.style.marginBottom = '4px';

			const groupLabel = append(group, $('div'));
			groupLabel.style.display = 'flex';
			groupLabel.style.alignItems = 'center';
			groupLabel.style.gap = '4px';
			groupLabel.style.color = 'var(--vscode-descriptionForeground)';
			groupLabel.style.marginBottom = '2px';
			const gIcon = append(groupLabel, $(`span.codicon.${iconClass}`));
			gIcon.style.color = color;
			gIcon.style.fontSize = '11px';
			const gText = append(groupLabel, $('span'));
			gText.textContent = `${label} (${files.length})`;
			gText.style.fontSize = '11px';
			gText.style.fontWeight = '600';

			for (const filePath of files) {
				const row = append(group, $('div'));
				row.style.display = 'flex';
				row.style.alignItems = 'center';
				row.style.gap = '4px';
				row.style.padding = '1px 0 1px 4px';
				row.style.cursor = 'pointer';
				row.style.borderRadius = '3px';
				row.style.color = 'var(--vscode-foreground)';

				const dotIcon = append(row, $(`span.codicon.${iconClass}`));
				dotIcon.style.color = color;
				dotIcon.style.fontSize = '10px';
				dotIcon.style.flexShrink = '0';

				const pathSpan = append(row, $('span'));
				// 只显示最后两段路径（更可读）
				const parts = filePath.replace(/\\/g, '/').split('/');
				const displayPath = parts.length > 2 ? `.../${parts.slice(-2).join('/')}` : filePath;
				pathSpan.textContent = displayPath;
				pathSpan.title = filePath;
				pathSpan.style.overflow = 'hidden';
				pathSpan.style.textOverflow = 'ellipsis';
				pathSpan.style.whiteSpace = 'nowrap';
				pathSpan.style.fontFamily = 'var(--vscode-editor-font-family)';

				row.onmouseenter = () => { row.style.backgroundColor = 'var(--vscode-list-hoverBackground)'; };
				row.onmouseleave = () => { row.style.backgroundColor = ''; };
			}
		};

		renderGroup('修改/创建', 'codicon-edit', 'var(--vscode-charts-green)', changes.written);
		renderGroup('删除', 'codicon-trash', 'var(--vscode-charts-red)', changes.deleted);

		this.messageArea.scrollTop = this.messageArea.scrollHeight;
	}

	/**
	 * 渲染错误消息
	 */
	private renderErrorMessage(error: string): void {
		// 解析错误信息，尝试提取详情
		let errorTitle = '错误';
		let errorMessage = error;
		let errorDetails: string | undefined;

		// 尝试解析常见的错误格式
		const apiErrorMatch = error.match(/^(API Error|Network Error|Timeout Error|Rate Limit Error):?\s*(.*)$/i);
		if (apiErrorMatch) {
			errorTitle = apiErrorMatch[1];
			errorMessage = apiErrorMatch[2] || error;
		}

		// 检查是否包含堆栈信息
		const stackIndex = error.indexOf('\n    at ');
		if (stackIndex > 0) {
			errorMessage = error.substring(0, stackIndex);
			errorDetails = error.substring(stackIndex);
		}

		// 使用 createErrorCard 创建美化的错误卡片
		createErrorCard(this.messageArea, {
			title: errorTitle,
			message: errorMessage,
			details: errorDetails
		});

		// U6: 解析错误消息中的LSP诊断信息并美化显示
		const diagnostics = parseDiagnosticsFromToolResult(error);
		if (diagnostics.length > 0) {
			const diagnosticsContainer = append(this.messageArea, $('div'));
			diagnosticsContainer.style.marginBottom = '10px';
			createDiagnosticsSummary(diagnosticsContainer, diagnostics);
		}

		this.messageArea.scrollTop = this.messageArea.scrollHeight;
	}

	/**
	 * 渲染系统消息
	 * @returns 创建的消息元素，用于后续移除
	 */
	private renderSystemMessage(message: string): HTMLElement {
		const sysMsg = append(this.messageArea, $('div'));
		sysMsg.style.marginBottom = '8px';
		sysMsg.style.padding = '6px 12px';
		sysMsg.style.backgroundColor = 'var(--vscode-editor-background)';
		sysMsg.style.borderRadius = '4px';
		sysMsg.style.fontSize = '12px';
		sysMsg.style.color = 'var(--vscode-descriptionForeground)';
		sysMsg.style.fontStyle = 'italic';
		sysMsg.textContent = message;

		this.messageArea.scrollTop = this.messageArea.scrollHeight;
		return sysMsg;
	}

	/**
	 * 启动 API 请求进度提示（动态文案 + 秒级更新）
	 */
	private startApiRequestProgress(): void {
		this.apiRequestStartAt = Date.now();
		this.apiRequestRetryCount = 0;
		this.apiRequestBackendHint = null;
		this.updateApiRequestProgressText();
		if (this.apiRequestProgressTimer !== null) {
			clearInterval(this.apiRequestProgressTimer);
		}
		this.apiRequestProgressTimer = window.setInterval(() => {
			this.updateApiRequestProgressText();
		}, 1000);
	}

	/**
	 * 停止 API 请求进度提示
	 */
	private stopApiRequestProgress(removeElement: boolean): void {
		if (this.apiRequestProgressTimer !== null) {
			clearInterval(this.apiRequestProgressTimer);
			this.apiRequestProgressTimer = null;
		}
		this.apiRequestStartAt = null;
		this.apiRequestRetryCount = 0;
		this.apiRequestBackendHint = null;
		if (removeElement && this.thinkingMessageElement && this.thinkingMessageElement.parentNode) {
			this.thinkingMessageElement.parentNode.removeChild(this.thinkingMessageElement);
			this.thinkingMessageElement = null;
		}
	}

	/**
	 * 更新 API 请求进度提示文本
	 */
	private updateApiRequestProgressText(): void {
		if (!this.thinkingMessageElement) {
			this.thinkingMessageElement = this.renderSystemMessage('');
		}
		if (!this.thinkingMessageElement) {
			return;
		}

		const elapsedSec = this.apiRequestStartAt ? Math.max(1, Math.floor((Date.now() - this.apiRequestStartAt) / 1000)) : 0;
		let text: string;

		if (elapsedSec < 3) {
			text = '🤔 码弦正在分析你的请求...';
		} else if (elapsedSec < 8) {
			text = `🔎 码弦正在检索上下文（已 ${elapsedSec}s）...`;
		} else if (elapsedSec < 15) {
			text = `🧠 码弦正在规划执行步骤（已 ${elapsedSec}s）...`;
		} else {
			text = `⏳ 码弦仍在处理中（已等待 ${elapsedSec}s）...`;
		}

		if (this.apiRequestRetryCount > 0) {
			text += `（重试 ${this.apiRequestRetryCount} 次）`;
		}
		if (this.apiRequestBackendHint) {
			text += `\n${this.apiRequestBackendHint}`;
		}

		this.thinkingMessageElement.textContent = text;
	}

	/**
	 * 显示"等待中"三点动画气泡（发送消息后、首个响应到达前）
	 */
	private showWaitingIndicator(): void {
		this.hideWaitingIndicator();

		const indicatorRow = append(this.messageArea, $('div.maxian-message-row.row-ai'));
		const indicatorAvatarWrap = append(indicatorRow, $('div.maxian-message-avatar-wrap'));
		const indicatorAvatarImg = append(indicatorAvatarWrap, $('img')) as HTMLImageElement;
		indicatorAvatarImg.src = FileAccess.asBrowserUri('vs/workbench/contrib/maxian/browser/media/icons/maxian-avatar.png').toString(true);
		const indicator = append(indicatorRow, $('div.maxian-message.maxian-message-ai'));

		// 消息头部（与普通 AI 消息一致）
		const header = append(indicator, $('div.maxian-message-header'));

		const sender = append(header, $('span.maxian-message-sender'));
		sender.style.color = 'var(--vscode-charts-blue)';
		sender.textContent = '码弦';

		// 三点动画内容区
		const content = append(indicator, $('div'));
		content.style.padding = '6px 0 10px 0';
		content.style.display = 'flex';
		content.style.alignItems = 'center';
		content.style.gap = '5px';

		for (let i = 0; i < 3; i++) {
			append(content, $('span.maxian-thinking-dot'));
		}

		this.messageArea.scrollTop = this.messageArea.scrollHeight;
		this.waitingIndicatorElement = indicatorRow;
	}

	/**
	 * 移除"等待中"气泡
	 */
	private hideWaitingIndicator(): void {
		if (this.waitingIndicatorElement) {
			this.waitingIndicatorElement.remove();
			this.waitingIndicatorElement = null;
		}
	}

	/**
	 * 渲染用户反馈消息
	 */
	private renderUserFeedback(text: string, _images?: string[]): void {
		const feedbackMsg = append(this.messageArea, $('div'));
		feedbackMsg.style.marginBottom = '10px';
		feedbackMsg.style.padding = '10px 15px';
		feedbackMsg.style.backgroundColor = 'var(--vscode-textCodeBlock-background)';
		feedbackMsg.style.borderRadius = '6px';
		feedbackMsg.style.borderLeft = '3px solid var(--vscode-textLink-foreground)';

		const feedbackLabel = append(feedbackMsg, $('div'));
		feedbackLabel.style.fontWeight = '600';
		feedbackLabel.style.marginBottom = '6px';
		feedbackLabel.style.color = 'var(--vscode-textLink-foreground)';
		feedbackLabel.style.fontSize = '13px';
		feedbackLabel.textContent = '👤 你的反馈';

		const feedbackContent = append(feedbackMsg, $('div'));
		feedbackContent.style.whiteSpace = 'pre-wrap';
		feedbackContent.style.wordBreak = 'break-word';
		feedbackContent.style.color = 'var(--vscode-foreground)';
		feedbackContent.style.lineHeight = '1.5';
		feedbackContent.textContent = text;

		this.messageArea.scrollTop = this.messageArea.scrollHeight;
	}

	/**
	 * 渲染工具执行状态（say tool）
	 * 更新而非每次都创建新元素，类似kilocode的ProgressIndicator
	 * 优化：添加执行状态细分、美化文件路径、状态颜色
	 */
	private renderToolExecutionStatus(toolStatusJson: string): void {
		try {
			const toolInfo = JSON.parse(toolStatusJson);
			const toolId = toolInfo.toolId; // 🔧 获取toolId用于元素管理

			// 获取执行状态（默认为running）
			const status: ToolStatus = toolInfo.status || 'running';
			const statusText = TOOL_STATUS_TEXT[status] || '执行中';
			// statusColor 已通过 CSS 类名控制，无需变量

			// 根据工具类型确定图标和动作描述
			const toolIconClass = getToolIcon(toolInfo.tool);
			let actionText = '正在执行工具';
			let detailText = '';

			switch (toolInfo.tool) {
				case 'readFile':
				case 'read_file':
					actionText = '读取文件';
					detailText = toolInfo.path || '';
					break;
				case 'listFiles':
				case 'list_files':
					actionText = '列出文件';
					detailText = toolInfo.path || '';
					break;
				case 'searchFiles':
				case 'search_files':
				case 'grep':
					actionText = '搜索文件';
					detailText = toolInfo.path ? `${toolInfo.path} (${toolInfo.regex || toolInfo.pattern})` : (toolInfo.regex || toolInfo.pattern);
					break;
				case 'writeToFile':
				case 'write_to_file':
				case 'write':
					actionText = '写入文件';
					detailText = toolInfo.path || '';
					break;
				case 'applyDiff':
				case 'apply_diff':
					actionText = '应用差异';
					detailText = toolInfo.path || toolInfo.file_path || '';
					break;
				case 'edit':
					actionText = '编辑文件';
					detailText = toolInfo.path || '';
					break;
				case 'multiedit':
					actionText = '多处编辑';
					detailText = toolInfo.path || '';
					break;
				case 'executeCommand':
				case 'execute_command':
				case 'bash':
					actionText = '执行命令';
					detailText = toolInfo.command || '';
					break;
				case 'askFollowupQuestion':
				case 'ask_followup_question':
					actionText = '提问';
					detailText = '';
					break;
				case 'attemptCompletion':
				case 'attempt_completion':
					actionText = '完成任务';
					detailText = '';
					break;
				case 'insertContent':
				case 'insert_content':
					actionText = '插入内容';
					detailText = toolInfo.path || '';
					break;
				case 'searchAndReplace':
				case 'search_and_replace':
					actionText = '搜索替换';
					detailText = toolInfo.path || '';
					break;
				case 'websearch':
				case 'web_search':
					actionText = '搜索网页';
					detailText = toolInfo.query || '';
					break;
				case 'skill':
					actionText = '加载技能';
					detailText = toolInfo.skillName || '';
					break;
				case 'task':
					actionText = '创建子任务';
					detailText = toolInfo.description || '';
					break;
				default:
					actionText = `执行 ${toolInfo.tool}`;
					detailText = toolInfo.params ? toolInfo.params.join(', ') : '';
			}

			// 组合状态文本
			const fullStatusText = status === 'running' ? `正在${actionText}` : `${actionText} - ${statusText}`;

			// 🔧 使用toolId管理工具状态元素（支持并行工具）
			let toolStatusElement = toolId ? this.toolStatusElements.get(toolId) : this.currentToolStatusElement;

			// 如果已有工具状态元素，更新内容而不是创建新的
			if (toolStatusElement) {
				// 更新卡片状态类
				toolStatusElement.classList.remove('tool-running', 'tool-completed', 'tool-error');
				if (status === 'running') {
					toolStatusElement.classList.add('tool-running');
				} else if (status === 'completed') {
					toolStatusElement.classList.add('tool-completed');
				} else if (status === 'error') {
					toolStatusElement.classList.add('tool-error');
				}

				// 更新图标
				const iconElement = toolStatusElement.querySelector('.tool-status-icon') as HTMLElement;
				if (iconElement) {
					iconElement.className = `codicon ${toolIconClass} tool-status-icon`;
					if (status === 'running') {
						iconElement.classList.add('codicon-modifier-spin');
					}
				}

				// 更新状态文本
				const textElement = toolStatusElement.querySelector('.tool-status-text') as HTMLElement;
				if (textElement) {
					textElement.textContent = fullStatusText;
				}

				// 更新状态标签
				const statusBadge = toolStatusElement.querySelector('.tool-status-badge') as HTMLElement;
				if (statusBadge) {
					statusBadge.textContent = statusText;
					statusBadge.className = 'maxian-tool-status-badge tool-status-badge';
					if (status === 'running') {
						statusBadge.classList.add('maxian-tool-status-running');
					} else if (status === 'completed') {
						statusBadge.classList.add('maxian-tool-status-completed');
					} else if (status === 'error') {
						statusBadge.classList.add('maxian-tool-status-error');
					}
					statusBadge.style.display = status !== 'running' ? 'inline-block' : 'none';
				}

				// 更新详情
				const detailElement = toolStatusElement.querySelector('.tool-status-detail') as HTMLElement;
				if (detailElement) {
					detailElement.textContent = detailText;
					detailElement.title = detailText;
					detailElement.style.display = detailText ? 'block' : 'none';
				}

				// 更新加载动画
				const loadingDots = toolStatusElement.querySelector('.tool-loading-dots') as HTMLElement;
				if (loadingDots) {
					loadingDots.style.display = status === 'running' ? 'inline' : 'none';
				}
			} else {
				// 创建新的工具状态元素 - 使用优化后的卡片样式
				const statusClass = status === 'running' ? 'tool-running' :
					status === 'completed' ? 'tool-completed' :
					status === 'error' ? 'tool-error' : '';

				const toolStatusContainer = append(this.messageArea, $(`div.maxian-tool-card.${statusClass}`));

				// 工具头部
				const toolHeader = append(toolStatusContainer, $('div.maxian-tool-header'));

				// 工具图标容器
				const iconContainer = append(toolHeader, $('div.maxian-tool-icon'));
				const toolIcon = append(iconContainer, $(`span.codicon.${toolIconClass}.tool-status-icon`));
				if (status === 'running') {
					toolIcon.classList.add('codicon-modifier-spin');
				}

				// 工具信息区域
				const toolInfoArea = append(toolHeader, $('div.maxian-tool-info'));

				// 工具标题行
				const toolTitleRow = append(toolInfoArea, $('div.maxian-tool-title'));
				const toolText = append(toolTitleRow, $('span.tool-status-text'));
				toolText.textContent = fullStatusText;

				// 加载指示器
				const loadingDots = append(toolTitleRow, $('span.tool-loading-dots'));
				loadingDots.textContent = '...';
				loadingDots.style.color = 'var(--vscode-descriptionForeground)';
				loadingDots.style.animation = 'blink 1s infinite';
				loadingDots.style.display = status === 'running' ? 'inline' : 'none';

				// 详情行
				if (detailText) {
					const detailRow = append(toolInfoArea, $('div.maxian-tool-detail.tool-status-detail'));
					detailRow.textContent = detailText;
					detailRow.title = detailText;
				}

				// 状态标签
				const statusBadgeClass = status === 'running' ? 'maxian-tool-status-running' :
					status === 'completed' ? 'maxian-tool-status-completed' :
					status === 'error' ? 'maxian-tool-status-error' : '';

				const statusBadge = append(toolHeader, $(`span.maxian-tool-status-badge.tool-status-badge.${statusBadgeClass}`));
				statusBadge.textContent = statusText;
				statusBadge.style.display = status !== 'running' ? 'inline-block' : 'none';

				// 🔧 保存元素引用
				toolStatusElement = toolStatusContainer;
				this.currentToolStatusElement = toolStatusContainer;
				if (toolId) {
					this.toolStatusElements.set(toolId, toolStatusContainer);
				}

				// 动画样式已在 addStyles 中全局添加，无需重复添加
				const styleId = 'maxian-tool-status-animation';
				if (!document.getElementById(styleId)) {
					const style = document.createElement('style');
					style.id = styleId;
					style.textContent = `
						@keyframes blink {
							0%, 100% { opacity: 1; }
							50% { opacity: 0.3; }
						}
						@keyframes spin {
							from { transform: rotate(0deg); }
							to { transform: rotate(360deg); }
						}
						.codicon-modifier-spin {
							animation: spin 1s linear infinite;
						}
					`;
					document.head.appendChild(style);
				}
			}

			// U6: 当工具执行完成且有输出时，解析并显示LSP诊断信息
			if ((status === 'completed' || status === 'error') && toolStatusElement) {
				const output = toolInfo.result || toolInfo.output || '';
				if (output) {
					const diagnostics = parseDiagnosticsFromToolResult(output);
					if (diagnostics.length > 0) {
						// 创建诊断信息容器
						const diagnosticsContainer = append(this.messageArea, $('div'));
						diagnosticsContainer.style.marginBottom = '10px';
						createDiagnosticsSummary(diagnosticsContainer, diagnostics);
					}
				}

				// 渲染持久化 diff 块（edit/multiedit 工具完成时）
				if (status === 'completed' && (toolInfo.tool === 'edit' || toolInfo.tool === 'multiedit')) {
					this.renderEditDiffBlock(toolInfo);
				}

				// 🔥 工具完成后，1秒后自动移除状态卡片（缩短延迟以便快速看到效果）
				const elementToRemove = toolStatusElement; // 捕获引用
				const capturedToolId = toolId; // 捕获 toolId

				setTimeout(() => {
					if (elementToRemove && elementToRemove.parentElement) {
						// 添加淡出动画
						elementToRemove.style.transition = 'opacity 0.5s ease-out';
						elementToRemove.style.opacity = '0';
						setTimeout(() => {
							elementToRemove.remove();
							// 清除引用
							if (this.currentToolStatusElement === elementToRemove) {
								this.currentToolStatusElement = null;
							}
							if (capturedToolId && this.toolStatusElements.has(capturedToolId)) {
								this.toolStatusElements.delete(capturedToolId);
							}
						}, 500); // 等待动画完成
					} else {
						console.warn(`[MaxianView] 无法移除工具状态（元素或父节点不存在）: ${toolInfo.tool}`);
					}
				}, 1000); // 缩短到1秒以便更快看到效果
			}

			this.messageArea.scrollTop = this.messageArea.scrollHeight;
		} catch {
			// 解析失败时，显示原始文本
			this.renderSystemMessage(`🔧 ${toolStatusJson}`);
		}
	}

	/**
	 * 清除当前工具状态元素（当工具执行完成时调用）
	 */
	private clearToolStatusElement(): void {
		if (this.currentToolStatusElement) {
			// 找到并移除闪动的小点元素
			const loadingDots = this.currentToolStatusElement.querySelector('span[style*="animation"]');
			if (loadingDots) {
				loadingDots.remove();
			}
		}
		this.currentToolStatusElement = null;
	}

	/**
	 * 处理任务取消事件
	 * 清理所有pending状态的工具确认UI
	 */
	private handleTaskCancelled(): void {
		// 重置当前AI消息状态
		this.currentAiMessageElement = null;
		this.currentAiMessageText = '';
		this.currentStreamingMessageElement = null;
		this.currentToolStatusElement = null;
		this.tokenStatsElement = null;

		// 重置等待状态
		this.awaitingUserResponse = false;
		this.setInputPlaceholder(this.getInputPlaceholder('normal'));

		// 清理所有pending的工具确认UI
		// 查找所有带有确认按钮的工具消息并移除或标记为已取消
		const toolApprovalElements = this.messageArea.querySelectorAll('div[style*="border: 2px solid"]');
		toolApprovalElements.forEach((element) => {
			const buttons = element.querySelectorAll('button');
			if (buttons.length > 0) {
				// 有按钮表示是等待确认的UI
				// 禁用所有按钮
				buttons.forEach((btn) => {
					(btn as HTMLButtonElement).disabled = true;
					(btn as HTMLButtonElement).style.opacity = '0.5';
				});

				// 添加取消标记
				const cancelMark = document.createElement('div');
				cancelMark.style.marginTop = '8px';
				cancelMark.style.padding = '6px 10px';
				cancelMark.style.backgroundColor = 'var(--vscode-inputValidation-warningBackground)';
				cancelMark.style.border = '1px solid var(--vscode-charts-orange)';
				cancelMark.style.borderRadius = '4px';
				cancelMark.style.fontSize = '12px';
				cancelMark.style.color = 'var(--vscode-charts-orange)';
				cancelMark.style.display = 'flex';
				cancelMark.style.alignItems = 'center';
				cancelMark.style.gap = '6px';
				append(cancelMark, $('span.codicon.codicon-warning'));
				const cancelText = append(cancelMark, $('span'));
				cancelText.textContent = '任务已取消';
				element.appendChild(cancelMark);
			}
		});

		// 关闭可能打开的diff编辑器
		this.maxianService.closeDiffWithoutSave().catch(() => {
			// 静默处理错误
		});

		// 显示取消提示
		const cancelMsg = append(this.messageArea, $('div'));
		cancelMsg.style.marginBottom = '10px';
		cancelMsg.style.padding = '8px 12px';
		cancelMsg.style.backgroundColor = 'var(--vscode-inputValidation-warningBackground)';
		cancelMsg.style.border = '1px solid var(--vscode-charts-orange)';
		cancelMsg.style.borderRadius = '6px';
		cancelMsg.style.display = 'flex';
		cancelMsg.style.alignItems = 'center';
		cancelMsg.style.gap = '8px';
		cancelMsg.style.fontSize = '13px';
		cancelMsg.style.color = 'var(--vscode-foreground)';

		const cancelIcon = append(cancelMsg, $('span.codicon.codicon-stop-circle'));
		cancelIcon.style.color = 'var(--vscode-charts-orange)';

		const cancelText = append(cancelMsg, $('span'));
		cancelText.textContent = '任务已取消';

		// 滚动到底部
		this.messageArea.scrollTop = this.messageArea.scrollHeight;
	}

	/**
	 * 处理Token使用量事件
	 * 在消息区域显示token统计
	 */
	private handleTokenUsage(event: ITokenUsageEvent): void {
		// 移除旧的token统计元素（避免每次API调用都累加一行）
		if (this.tokenStatsElement && this.tokenStatsElement.parentElement) {
			this.tokenStatsElement.remove();
			this.tokenStatsElement = null;
		}

		// 创建token统计显示（唯一元素，每次更新时替换旧的）
		const tokenStatsContainer = append(this.messageArea, $('div'));
		tokenStatsContainer.style.marginBottom = '10px';
		tokenStatsContainer.style.padding = '8px 12px';
		tokenStatsContainer.style.backgroundColor = 'var(--vscode-editor-background)';
		tokenStatsContainer.style.border = '1px solid var(--vscode-widget-border)';
		tokenStatsContainer.style.borderRadius = '6px';
		tokenStatsContainer.style.display = 'flex';
		tokenStatsContainer.style.alignItems = 'center';
		tokenStatsContainer.style.justifyContent = 'space-between';
		tokenStatsContainer.style.fontSize = '11px';

		// 左侧：模式标签
		const modeLabel = append(tokenStatsContainer, $('span'));
		modeLabel.style.color = 'var(--vscode-descriptionForeground)';
		modeLabel.style.display = 'flex';
		modeLabel.style.alignItems = 'center';
		modeLabel.style.gap = '6px';

		const modeIcon = append(modeLabel, $('span.codicon.codicon-dashboard'));
		modeIcon.style.fontSize = '12px';

		const modeText = append(modeLabel, $('span'));
		modeText.textContent = `${event.mode} 模式`;

		// 右侧：Token统计
		renderTokenStats(tokenStatsContainer, {
			inputTokens: event.promptTokens,
			outputTokens: event.completionTokens,
			cost: undefined // 如果需要成本计算，可以调用 calculateCost
		});

		// 保存引用，供下次更新时移除
		this.tokenStatsElement = tokenStatsContainer;
		this.messageArea.scrollTop = this.messageArea.scrollHeight;
	}

	/**
	 * 处理对话清空事件
	 */
	private handleConversationCleared(): void {
		this.stopApiRequestProgress(false);
		this.thinkingMessageElement = null;

		// 重置所有状态
		this.currentAiMessageElement = null;
		this.currentAiMessageText = '';
		this.currentStreamingMessageElement = null;
		this.currentToolStatusElement = null;
		this.tokenStatsElement = null;
		this.awaitingUserResponse = false;
		this.setInputPlaceholder(this.getInputPlaceholder('normal'));

		// 清空消息区域 - 使用DOM API而非innerHTML（避免TrustedHTML问题）
		while (this.messageArea.firstChild) {
			this.messageArea.removeChild(this.messageArea.firstChild);
		}

		// 重新创建欢迎消息（与初始化时完全一致）
		const welcome = append(this.messageArea, $('div'));
		this.welcomeElement = welcome;
		welcome.style.display = 'flex';
		welcome.style.flexDirection = 'column';
		welcome.style.alignItems = 'center';
		welcome.style.justifyContent = 'center';
		welcome.style.height = '100%';
		welcome.style.padding = '40px 24px';
		welcome.style.color = 'var(--vscode-descriptionForeground)';

		// 图标（保持原始比例）
		const welcomeIcon = append(welcome, $('img')) as HTMLImageElement;
		welcomeIcon.src = FileAccess.asBrowserUri('vs/workbench/contrib/maxian/browser/media/icons/maxian-avatar.png').toString(true);
		welcomeIcon.style.maxWidth = '96px';
		welcomeIcon.style.marginBottom = '24px';
		welcomeIcon.style.borderRadius = '12px';
		welcomeIcon.style.display = 'block';

		// 主标题
		const welcomeTitle = append(welcome, $('div'));
		welcomeTitle.textContent = '欢迎使用码弦';
		welcomeTitle.style.fontSize = '24px';
		welcomeTitle.style.fontWeight = '700';
		welcomeTitle.style.marginBottom = '12px';
		welcomeTitle.style.color = 'var(--vscode-foreground)';
		welcomeTitle.style.letterSpacing = '0.5px';

		// 副标题
		const welcomeSubtitle = append(welcome, $('div'));
		welcomeSubtitle.textContent = 'AI 驱动的智能编程助手';
		welcomeSubtitle.style.fontSize = '15px';
		welcomeSubtitle.style.marginBottom = '32px';
		welcomeSubtitle.style.color = 'var(--vscode-descriptionForeground)';
		welcomeSubtitle.style.opacity = '0.9';

		// 特性卡片容器
		const featuresContainer = append(welcome, $('div'));
		featuresContainer.style.display = 'flex';
		featuresContainer.style.flexDirection = 'column';
		featuresContainer.style.gap = '12px';
		featuresContainer.style.width = '100%';
		featuresContainer.style.maxWidth = '360px';
		featuresContainer.style.marginBottom = '24px';

		// 特性列表
		const features = [
			{ icon: '💬', title: '智能对话', desc: '自然语言交互，理解你的意图' },
			{ icon: '⚡', title: '代码生成', desc: '快速生成高质量代码片段' },
			{ icon: '🔧', title: '工具集成', desc: '支持文件操作、命令执行等' },
			{ icon: '🎯', title: '多种模式', desc: '代码、架构、调试等多种工作模式' }
		];

		features.forEach(feature => {
			const card = append(featuresContainer, $('div'));
			card.style.display = 'flex';
			card.style.alignItems = 'flex-start';
			card.style.gap = '12px';
			card.style.padding = '12px 16px';
			card.style.backgroundColor = 'var(--vscode-editor-inactiveSelectionBackground)';
			card.style.border = '1px solid var(--vscode-widget-border)';
			card.style.borderRadius = '8px';
			card.style.transition = 'all 0.2s ease';
			card.style.cursor = 'default';

			// 悬停效果
			card.onmouseenter = () => {
				card.style.backgroundColor = 'var(--vscode-list-hoverBackground)';
				card.style.transform = 'translateX(4px)';
			};
			card.onmouseleave = () => {
				card.style.backgroundColor = 'var(--vscode-editor-inactiveSelectionBackground)';
				card.style.transform = 'translateX(0)';
			};

			const iconBox = append(card, $('div'));
			iconBox.textContent = feature.icon;
			iconBox.style.fontSize = '20px';
			iconBox.style.lineHeight = '1';
			iconBox.style.flexShrink = '0';

			const textBox = append(card, $('div'));
			textBox.style.flex = '1';

			const featureTitle = append(textBox, $('div'));
			featureTitle.textContent = feature.title;
			featureTitle.style.fontSize = '13px';
			featureTitle.style.fontWeight = '600';
			featureTitle.style.marginBottom = '4px';
			featureTitle.style.color = 'var(--vscode-foreground)';

			const featureDesc = append(textBox, $('div'));
			featureDesc.textContent = feature.desc;
			featureDesc.style.fontSize = '12px';
			featureDesc.style.color = 'var(--vscode-descriptionForeground)';
			featureDesc.style.lineHeight = '1.4';
		});

		// 提示文本
		const hintText = append(welcome, $('div'));
		hintText.textContent = '💡 在下方输入框中开始对话';
		hintText.style.fontSize = '13px';
		hintText.style.color = 'var(--vscode-descriptionForeground)';
		hintText.style.opacity = '0.7';
		hintText.style.marginTop = '8px';
	}

	/**
	 * 渲染跟进问题（ask followup）
	 */
	private renderFollowupQuestion(message: ClineMessage): void {
		const questionMsg = append(this.messageArea, $('div'));
		questionMsg.style.marginBottom = '10px';
		questionMsg.style.padding = '12px 16px';
		questionMsg.style.backgroundColor = 'var(--vscode-inputValidation-warningBackground)';
		questionMsg.style.border = '2px solid var(--vscode-inputValidation-warningBorder)';
		questionMsg.style.borderRadius = '8px';
		questionMsg.style.borderLeft = '4px solid var(--vscode-charts-orange)';

		const questionLabel = append(questionMsg, $('div'));
		questionLabel.style.fontWeight = '700';
		questionLabel.style.marginBottom = '8px';
		questionLabel.style.fontSize = '14px';
		questionLabel.style.color = 'var(--vscode-charts-orange)';
		questionLabel.textContent = '❓ 码弦 正在询问';

		const questionContent = append(questionMsg, $('div'));
		questionContent.style.whiteSpace = 'pre-wrap';
		questionContent.style.wordBreak = 'break-word';
		questionContent.style.color = 'var(--vscode-foreground)';
		questionContent.style.lineHeight = '1.6';
		questionContent.style.marginBottom = '12px';
		questionContent.textContent = message.text || '';

		const followupOptionsRaw = (message.metadata?.kiloCode as any)?.options;
		const followupOptions = ensureFollowupOptions(followupOptionsRaw);
		if (followupOptions.length > 0) {
			const optionsContainer = append(questionMsg, $('div'));
			optionsContainer.style.display = 'flex';
			optionsContainer.style.flexWrap = 'wrap';
			optionsContainer.style.gap = '8px';
			optionsContainer.style.marginBottom = '12px';

			followupOptions.forEach((option) => {
				const optionButton = append(optionsContainer, $('button')) as HTMLButtonElement;
				optionButton.textContent = option.label;
				optionButton.style.padding = '6px 12px';
				optionButton.style.backgroundColor = 'var(--vscode-button-secondaryBackground)';
				optionButton.style.color = 'var(--vscode-button-secondaryForeground)';
				optionButton.style.border = '1px solid var(--vscode-contrastBorder)';
				optionButton.style.borderRadius = '4px';
				optionButton.style.cursor = 'pointer';
				optionButton.style.fontSize = '12px';
				if (option.description) {
					optionButton.title = option.description;
				}
				optionButton.onclick = () => {
					this.maxianService.handleAskResponse(message.ts, 'messageResponse', option.value || option.label);
					questionMsg.remove();
				};
			});
		}

		// 输入框
		const inputArea = append(questionMsg, $('textarea')) as HTMLTextAreaElement;
		inputArea.placeholder = '请输入你的回答...';
		inputArea.rows = 3;
		inputArea.style.width = '100%';
		inputArea.style.padding = '8px';
		inputArea.style.backgroundColor = 'var(--vscode-input-background)';
		inputArea.style.color = 'var(--vscode-input-foreground)';
		inputArea.style.border = '1px solid var(--vscode-input-border)';
		inputArea.style.borderRadius = '4px';
		inputArea.style.fontFamily = 'var(--vscode-font-family)';
		inputArea.style.fontSize = '13px';
		inputArea.style.marginBottom = '8px';
		inputArea.style.resize = 'vertical';

		// 提交按钮
		const submitButton = append(questionMsg, $('button')) as HTMLButtonElement;
		submitButton.textContent = '提交回答';
		submitButton.style.padding = '6px 16px';
		submitButton.style.backgroundColor = 'var(--vscode-button-background)';
		submitButton.style.color = 'var(--vscode-button-foreground)';
		submitButton.style.border = 'none';
		submitButton.style.borderRadius = '4px';
		submitButton.style.cursor = 'pointer';
		submitButton.style.fontWeight = '600';
		submitButton.onclick = () => {
			const answer = inputArea.value.trim();
			if (answer) {
				// 调用MaxianService的handleAskResponse方法
				this.maxianService.handleAskResponse(message.ts, 'messageResponse', answer);
				// 移除询问消息元素
				questionMsg.remove();
			}
		};

		this.messageArea.scrollTop = this.messageArea.scrollHeight;
	}

	/**
	 * 渲染完成确认（ask completion_result）
	 */
	private renderCompletionConfirmation(message: ClineMessage): void {
		const confirmMsg = append(this.messageArea, $('div'));
		confirmMsg.style.marginBottom = '10px';
		confirmMsg.style.padding = '12px 16px';
		confirmMsg.style.backgroundColor = 'var(--vscode-inputValidation-infoBackground)';
		confirmMsg.style.border = '2px solid var(--vscode-inputValidation-infoBorder)';
		confirmMsg.style.borderRadius = '8px';
		confirmMsg.style.borderLeft = '4px solid var(--vscode-charts-green)';

		const confirmLabel = append(confirmMsg, $('div'));
		confirmLabel.style.fontWeight = '700';
		confirmLabel.style.marginBottom = '8px';
		confirmLabel.style.fontSize = '14px';
		confirmLabel.style.color = 'var(--vscode-charts-green)';
		confirmLabel.textContent = '✅ 任务完成确认';

		const confirmText = append(confirmMsg, $('div'));
		confirmText.style.marginBottom = '12px';
		confirmText.style.fontSize = '13px';
		confirmText.style.color = 'var(--vscode-foreground)';
		confirmText.textContent = '请确认任务是否已按要求完成：';

		// 按钮容器
		const buttonContainer = append(confirmMsg, $('div'));
		buttonContainer.style.display = 'flex';
		buttonContainer.style.gap = '8px';
		buttonContainer.style.marginBottom = '8px';

		// Yes按钮
		const yesButton = append(buttonContainer, $('button')) as HTMLButtonElement;
		yesButton.textContent = '✅ 接受';
		yesButton.style.padding = '6px 16px';
		yesButton.style.backgroundColor = 'var(--vscode-button-background)';
		yesButton.style.color = 'var(--vscode-button-foreground)';
		yesButton.style.border = 'none';
		yesButton.style.borderRadius = '4px';
		yesButton.style.cursor = 'pointer';
		yesButton.style.fontWeight = '600';
		yesButton.onclick = () => {
			this.maxianService.handleAskResponse(message.ts, 'yesButtonClicked');
			confirmMsg.remove();
		};

		// No按钮
		const noButton = append(buttonContainer, $('button')) as HTMLButtonElement;
		noButton.textContent = '❌ 拒绝';
		noButton.style.padding = '6px 16px';
		noButton.style.backgroundColor = 'var(--vscode-button-secondaryBackground)';
		noButton.style.color = 'var(--vscode-button-secondaryForeground)';
		noButton.style.border = 'none';
		noButton.style.borderRadius = '4px';
		noButton.style.cursor = 'pointer';
		noButton.onclick = () => {
			this.maxianService.handleAskResponse(message.ts, 'noButtonClicked');
			confirmMsg.remove();
		};

		this.messageArea.scrollTop = this.messageArea.scrollHeight;
	}

	/**
	 * 渲染API失败询问（ask api_req_failed）
	 */
	private renderApiFailedAsk(message: ClineMessage): void {
		const failedMsg = append(this.messageArea, $('div'));
		failedMsg.style.marginBottom = '10px';
		failedMsg.style.padding = '12px 16px';
		failedMsg.style.backgroundColor = 'var(--vscode-inputValidation-errorBackground)';
		failedMsg.style.border = '2px solid var(--vscode-inputValidation-errorBorder)';
		failedMsg.style.borderRadius = '8px';
		failedMsg.style.borderLeft = '4px solid var(--vscode-errorForeground)';

		// 标题行：图标 + 标题 + 时间戳
		const headerRow = append(failedMsg, $('div'));
		headerRow.style.display = 'flex';
		headerRow.style.alignItems = 'center';
		headerRow.style.justifyContent = 'space-between';
		headerRow.style.marginBottom = '8px';

		const titleArea = append(headerRow, $('div'));
		titleArea.style.display = 'flex';
		titleArea.style.alignItems = 'center';
		titleArea.style.gap = '8px';

		// 警告图标
		const warnIcon = append(titleArea, $('span.codicon.codicon-warning'));
		warnIcon.style.fontSize = '16px';
		warnIcon.style.color = 'var(--vscode-charts-orange)';

		const failedLabel = append(titleArea, $('span'));
		failedLabel.style.fontWeight = '700';
		failedLabel.style.fontSize = '14px';
		failedLabel.style.color = 'var(--vscode-errorForeground)';
		failedLabel.textContent = 'API请求失败';

		// 时间戳
		if (message.ts) {
			const timeLabel = append(headerRow, $('span'));
			timeLabel.style.fontSize = '11px';
			timeLabel.style.color = 'var(--vscode-descriptionForeground)';
			timeLabel.textContent = formatTime(message.ts);
		}

		// 解析错误信息
		let errorMessage = message.text || 'API请求失败';
		let retryAttempt = 1;

		// 尝试解析重试次数
		const retryMatch = errorMessage.match(/retry\s*#?(\d+)/i);
		if (retryMatch) {
			retryAttempt = parseInt(retryMatch[1], 10);
		}

		// 错误内容
		const failedContent = append(failedMsg, $('div'));
		failedContent.style.marginBottom = '12px';
		failedContent.style.color = 'var(--vscode-foreground)';
		failedContent.style.fontSize = '13px';
		failedContent.style.lineHeight = '1.5';
		failedContent.textContent = errorMessage;

		// 重试状态提示
		const retryStatusContainer = append(failedMsg, $('div'));
		retryStatusContainer.style.marginBottom = '12px';

		// 重试状态UI
		let retryCountdownTimer: ReturnType<typeof setInterval> | null = null;
		let retryCountdown = 5; // 5秒倒计时

		const retryStatusEl = createRetryStatus(retryStatusContainer, {
			attempt: retryAttempt,
			delayMs: retryCountdown * 1000,
			message: `第 ${retryAttempt} 次重试失败`
		});

		// 自动重试倒计时（可被用户取消）
		let autoRetryEnabled = false; // 默认不自动重试，让用户选择

		// 按钮容器
		const buttonContainer = append(failedMsg, $('div'));
		buttonContainer.style.display = 'flex';
		buttonContainer.style.gap = '8px';
		buttonContainer.style.flexWrap = 'wrap';

		// Retry按钮
		const retryButton = append(buttonContainer, $('button')) as HTMLButtonElement;
		const retryIcon = append(retryButton, $('span.codicon.codicon-refresh'));
		retryIcon.style.marginRight = '4px';
		const retryText = append(retryButton, $('span'));
		retryText.textContent = '立即重试';
		retryButton.style.padding = '6px 16px';
		retryButton.style.backgroundColor = 'var(--vscode-button-background)';
		retryButton.style.color = 'var(--vscode-button-foreground)';
		retryButton.style.border = 'none';
		retryButton.style.borderRadius = '4px';
		retryButton.style.cursor = 'pointer';
		retryButton.style.fontWeight = '600';
		retryButton.style.display = 'flex';
		retryButton.style.alignItems = 'center';
		retryButton.onclick = () => {
			// 清除倒计时
			if (retryCountdownTimer) {
				clearInterval(retryCountdownTimer);
				retryCountdownTimer = null;
			}
			retryStatusEl.remove();

			this.maxianService.handleAskResponse(message.ts, 'yesButtonClicked');
			retryButton.disabled = true;
			cancelButton.disabled = true;
			// 更新按钮内容
			clearNode(retryButton);
			const loadingIcon = append(retryButton, $('span.codicon.codicon-loading.codicon-modifier-spin'));
			loadingIcon.style.marginRight = '4px';
			const loadingText = append(retryButton, $('span'));
			loadingText.textContent = '正在重试...';
		};

		// Cancel按钮
		const cancelButton = append(buttonContainer, $('button')) as HTMLButtonElement;
		cancelButton.textContent = '取消任务';
		cancelButton.style.padding = '6px 16px';
		cancelButton.style.backgroundColor = 'var(--vscode-button-secondaryBackground)';
		cancelButton.style.color = 'var(--vscode-button-secondaryForeground)';
		cancelButton.style.border = 'none';
		cancelButton.style.borderRadius = '4px';
		cancelButton.style.cursor = 'pointer';
		cancelButton.onclick = () => {
			// 清除倒计时
			if (retryCountdownTimer) {
				clearInterval(retryCountdownTimer);
				retryCountdownTimer = null;
			}
			retryStatusEl.remove();

			this.maxianService.handleAskResponse(message.ts, 'noButtonClicked');
			retryButton.disabled = true;
			cancelButton.disabled = true;
			cancelButton.textContent = '已取消';
			failedMsg.remove();
		};

		// 自动重试开关
		const autoRetryToggle = append(buttonContainer, $('label')) as HTMLLabelElement;
		autoRetryToggle.style.display = 'flex';
		autoRetryToggle.style.alignItems = 'center';
		autoRetryToggle.style.gap = '4px';
		autoRetryToggle.style.fontSize = '12px';
		autoRetryToggle.style.color = 'var(--vscode-descriptionForeground)';
		autoRetryToggle.style.cursor = 'pointer';

		const autoRetryCheckbox = append(autoRetryToggle, $('input')) as HTMLInputElement;
		autoRetryCheckbox.type = 'checkbox';
		autoRetryCheckbox.checked = autoRetryEnabled;
		autoRetryCheckbox.onchange = () => {
			autoRetryEnabled = autoRetryCheckbox.checked;
			if (autoRetryEnabled) {
				// 开始倒计时
				retryCountdown = 5;
				retryStatusEl.updateCountdown(retryCountdown * 1000);
				retryCountdownTimer = setInterval(() => {
					retryCountdown--;
					retryStatusEl.updateCountdown(retryCountdown * 1000);
					if (retryCountdown <= 0 && autoRetryEnabled) {
						clearInterval(retryCountdownTimer!);
						retryButton.click();
					}
				}, 1000);
			} else {
				// 停止倒计时
				if (retryCountdownTimer) {
					clearInterval(retryCountdownTimer);
					retryCountdownTimer = null;
				}
			}
		};

		const autoRetryLabel = append(autoRetryToggle, $('span'));
		autoRetryLabel.textContent = '自动重试';

		this.messageArea.scrollTop = this.messageArea.scrollHeight;
	}

	/**
	 * 渲染工具批准请求（ask tool）
	 * 解析JSON格式的工具信息，以diff模式显示文件修改
	 * 优化：添加变更统计、美化文件路径、工具图标、展开/折叠功能
	 */
	private renderToolApproval(message: ClineMessage): void {
		// 🔥 首先检查是否已设置自动批准
		// 尝试解析工具信息以获取工具名称
		let toolInfo: {
			tool?: string;
			path?: string;
			diff?: string;
			content?: string;
			command?: string;
			originalContent?: string;
			newContent?: string;
			operationCount?: number;
			oldString?: string;
			newString?: string;
			edits?: Array<{ oldString?: string; newString?: string }>;
		} | null = null;
		try {
			if (message.text) {
				toolInfo = JSON.parse(message.text);
			}
		} catch {
			// 解析失败，使用原始文本
			toolInfo = null;
		}

		const isEditApproval = toolInfo?.tool === 'edit' || toolInfo?.tool === 'multiedit';
		const getEditOps = () => {
			if (!toolInfo || !isEditApproval) {
				return [];
			}
			return toolInfo.tool === 'edit'
				? [{ oldString: toolInfo.oldString || '', newString: toolInfo.newString || '' }]
				: (toolInfo.edits || []).map(edit => ({
					oldString: edit.oldString || '',
					newString: edit.newString || ''
				}));
		};

		// 如果已设置全局自动批准（始终允许），直接执行批准操作
		const toolName = toolInfo?.tool || '';
		if (this.maxianService.isToolAutoApproved('*') || (toolName && this.maxianService.isToolAutoApproved(toolName))) {
			(async () => {
				if (isEditApproval && toolInfo?.path) {
					const previewResult = await this.maxianService.openEditPreviewDiff(toolInfo.path, getEditOps());
					if (previewResult.blockingReason) {
						this.maxianService.handleAskResponse(message.ts, 'messageResponse', previewResult.blockingReason);
						return;
					}
				}

				this.maxianService.closeDiffWithoutSave().then(() => {
					this.maxianService.handleAskResponse(message.ts, 'yesButtonClicked');
				});
			})().catch(error => {
				console.error('[Maxian] 自动批准前预检查失败:', error);
				this.maxianService.handleAskResponse(message.ts, 'messageResponse', '工具预检查失败，请重新读取文件并生成新的修改方案。');
			});
			return;
		}

		const toolMsg = append(this.messageArea, $('div'));
		toolMsg.style.marginBottom = '10px';

		// 工具图标和类型名称
		const toolIconClass = toolInfo?.tool ? getToolIcon(toolInfo.tool) : 'codicon-tools';
		let toolTypeName = '工具使用';
		if (toolInfo?.tool) {
			switch (toolInfo.tool) {
				case 'appliedDiff':
					toolTypeName = '应用差异修改';
					break;
				case 'newFileCreated':
					toolTypeName = '创建新文件';
					break;
				case 'editedExistingFile':
					toolTypeName = '编辑现有文件';
					break;
				case 'insertContent':
					toolTypeName = '插入内容';
					break;
				case 'searchAndReplace':
					toolTypeName = '搜索替换';
					break;
				default:
					toolTypeName = toolInfo.tool;
			}
		}

		// 计算变更统计
		let diffStats: DiffStats | null = null;
		if (toolInfo?.diff) {
			diffStats = calculateSearchReplaceDiffStats(toolInfo.diff);
		} else if (toolInfo?.content) {
			const lines = toolInfo.content.split('\n').length;
			diffStats = { additions: lines, deletions: 0 };
		} else if (toolInfo?.originalContent && toolInfo?.newContent) {
			diffStats = calculateDiffStats(toolInfo.originalContent, toolInfo.newContent);
		}

		// 创建可折叠的标题元素
		const titleElement = $('div');
		titleElement.style.display = 'flex';
		titleElement.style.alignItems = 'center';
		titleElement.style.gap = '8px';
		titleElement.style.flex = '1';
		titleElement.style.overflow = 'hidden';

		// 工具图标
		const toolIcon = append(titleElement, $(`span.codicon.${toolIconClass}`));
		toolIcon.style.fontSize = '14px';
		toolIcon.style.color = 'var(--vscode-charts-blue)';
		toolIcon.style.flexShrink = '0';

		// 工具类型名称
		const toolTypeSpan = append(titleElement, $('span'));
		toolTypeSpan.style.fontWeight = '600';
		toolTypeSpan.style.fontSize = '13px';
		toolTypeSpan.style.color = 'var(--vscode-foreground)';
		toolTypeSpan.textContent = toolTypeName;

		// 文件路径摘要（显示在标题中）
		if (toolInfo?.path) {
			const filename = toolInfo.path.split('/').pop() || toolInfo.path;
			const pathSummary = append(titleElement, $('span'));
			pathSummary.style.fontSize = '12px';
			pathSummary.style.color = 'var(--vscode-descriptionForeground)';
			pathSummary.style.overflow = 'hidden';
			pathSummary.style.textOverflow = 'ellipsis';
			pathSummary.style.whiteSpace = 'nowrap';
			pathSummary.textContent = `· ${filename}`;
			pathSummary.title = toolInfo.path;
		}

		// 变更统计标签（显示在标题中）
		if (diffStats && (diffStats.additions > 0 || diffStats.deletions > 0)) {
			const statsSpan = append(titleElement, $('span'));
			statsSpan.style.marginLeft = 'auto';
			statsSpan.style.flexShrink = '0';
			renderDiffStats(statsSpan, diffStats, 'default');
		}

		// 时间戳
		if (message.ts) {
			const timeSpan = append(titleElement, $('span'));
			timeSpan.style.fontSize = '10px';
			timeSpan.style.color = 'var(--vscode-descriptionForeground)';
			timeSpan.style.marginLeft = diffStats ? '8px' : 'auto';
			timeSpan.style.flexShrink = '0';
			timeSpan.textContent = formatTime(message.ts);
		}

		// 创建可折叠组件
		const collapsible = createCollapsible(toolMsg, {
			title: titleElement,
			defaultOpen: true, // 默认展开，因为需要用户确认
			headerClass: 'tool-approval-header',
			contentClass: 'tool-approval-content'
		});

		// 设置容器样式
		collapsible.container.style.backgroundColor = 'var(--vscode-editor-inactiveSelectionBackground)';
		collapsible.container.style.border = '2px solid var(--vscode-widget-border)';

		// 在内容区域添加详细信息
		const contentArea = collapsible.content;
		let pendingPreviewBlockReason: string | undefined;
		let approveButton: HTMLButtonElement | undefined;
		let alwaysAllowButton: HTMLButtonElement | undefined;
		let applyPreviewGuard: ((reason: string) => void) | undefined;

		if (toolInfo && toolInfo.tool) {
			// 显示完整文件路径
			if (toolInfo.path) {
				const pathRow = append(contentArea, $('div'));
				pathRow.style.marginBottom = '12px';
				renderFilePath(pathRow, toolInfo.path);

				// 创建提示信息容器（稍后根据结果更新）
				const infoLabel = append(contentArea, $('div'));
				infoLabel.style.marginBottom = '12px';
				infoLabel.style.fontSize = '12px';
				infoLabel.style.color = 'var(--vscode-descriptionForeground)';
				infoLabel.style.fontStyle = 'italic';
				infoLabel.textContent = '正在打开差异视图...';

				// 自动打开diff视图
				const filePath = toolInfo.path;
				if (toolInfo.diff) {
					const diffContent = toolInfo.diff;
					this.maxianService.applyDiffView(filePath, diffContent).then(success => {
						if (success) {
							infoLabel.textContent = '💡 完整的差异视图已在左侧编辑器中打开';
						} else {
							infoLabel.textContent = '⚠️ 无法打开差异视图，请查看右侧面板中的变更预览';
							infoLabel.style.color = 'var(--vscode-charts-orange)';
						}
					}).catch(() => {
						infoLabel.textContent = '⚠️ 打开差异视图失败';
						infoLabel.style.color = 'var(--vscode-errorForeground)';
					});
				} else if (toolInfo.content) {
					const newContent = toolInfo.content;
					this.maxianService.openDiffView(filePath, newContent).then(success => {
						if (success) {
							infoLabel.textContent = '💡 完整的差异视图已在左侧编辑器中打开';
						} else {
							infoLabel.textContent = '⚠️ 无法打开差异视图，请查看右侧面板中的变更预览';
							infoLabel.style.color = 'var(--vscode-charts-orange)';
						}
					}).catch(() => {
						infoLabel.textContent = '⚠️ 打开差异视图失败';
						infoLabel.style.color = 'var(--vscode-errorForeground)';
					});
				} else if (toolInfo.originalContent && toolInfo.newContent) {
					const operationInfo = append(contentArea, $('div'));
					operationInfo.style.marginBottom = '8px';
					operationInfo.style.fontSize = '12px';
					operationInfo.style.color = 'var(--vscode-descriptionForeground)';
					operationInfo.textContent = `共 ${toolInfo.operationCount || 0} 个替换操作`;
					// 没有diff视图，更新提示信息
					infoLabel.textContent = '💡 请查看上方的变更详情';
				} else if (toolInfo.tool === 'edit' || toolInfo.tool === 'multiedit') {
					// edit/multiedit：在 VS Code diff 编辑器中打开对比视图（git diff 方式）
					const editOps = getEditOps();
					this.maxianService.openEditPreviewDiff(filePath, editOps).then(result => {
						if (result.opened) {
							infoLabel.textContent = '💡 差异视图已在左侧编辑器中打开（git diff 方式）';
						} else if (result.blockingReason) {
							infoLabel.textContent = `⛔ ${result.blockingReason}`;
							infoLabel.style.color = 'var(--vscode-errorForeground)';
							if (applyPreviewGuard) {
								applyPreviewGuard(result.blockingReason);
							} else {
								pendingPreviewBlockReason = result.blockingReason;
							}
						} else {
							// 降级：在确认卡片内显示内联 diff
							infoLabel.style.display = 'none';
							this.renderInlineEditDiff(contentArea, toolInfo);
						}
					}).catch((error) => {
						console.error('[Maxian] 打开 edit 预览失败:', error);
						infoLabel.style.display = 'none';
						this.renderInlineEditDiff(contentArea, toolInfo);
					});
				} else {
					// 没有diff相关内容，隐藏提示
					infoLabel.style.display = 'none';
				}
			}
		} else {
			// 无法解析，显示原始文本
			const toolContent = append(contentArea, $('div'));
			toolContent.style.marginBottom = '12px';
			toolContent.style.whiteSpace = 'pre-wrap';
			toolContent.style.wordBreak = 'break-word';
			toolContent.style.color = 'var(--vscode-foreground)';
			toolContent.textContent = message.text || '是否允许执行此工具？';
		}

		// 按钮容器
		const buttonContainer = append(contentArea, $('div'));
		buttonContainer.style.display = 'flex';
		buttonContainer.style.gap = '8px';
		buttonContainer.style.flexWrap = 'wrap';

		// Approve按钮
		approveButton = append(buttonContainer, $('button')) as HTMLButtonElement;
		approveButton.textContent = '✅ 批准';
		approveButton.style.padding = '6px 16px';
		approveButton.style.backgroundColor = 'var(--vscode-button-background)';
		approveButton.style.color = 'var(--vscode-button-foreground)';
		approveButton.style.border = 'none';
		approveButton.style.borderRadius = '4px';
		approveButton.style.cursor = 'pointer';
		approveButton.style.fontWeight = '600';
		approveButton.onclick = async () => {
			approveButton.disabled = true;
			denyButton.disabled = true;
			alwaysAllowButton!.disabled = true;
			approveButton.textContent = '正在确认...';

			try {
				// 预览仅用于确认，不提前写盘；真正的落盘由工具执行链统一提交。
				await this.maxianService.closeDiffWithoutSave();
				this.maxianService.handleAskResponse(message.ts, 'yesButtonClicked');
			} finally {
				toolMsg.remove();
			}
		};

		// Deny按钮
		const denyButton = append(buttonContainer, $('button')) as HTMLButtonElement;
		denyButton.textContent = '❌ 拒绝';
		denyButton.style.padding = '6px 16px';
		denyButton.style.backgroundColor = 'var(--vscode-button-secondaryBackground)';
		denyButton.style.color = 'var(--vscode-button-secondaryForeground)';
		denyButton.style.border = 'none';
		denyButton.style.borderRadius = '4px';
		denyButton.style.cursor = 'pointer';
		denyButton.onclick = async () => {
			approveButton.disabled = true;
			denyButton.disabled = true;
			alwaysAllowButton!.disabled = true;
			denyButton.textContent = '正在关闭...';

			await this.maxianService.closeDiffWithoutSave();
			this.maxianService.handleAskResponse(message.ts, 'noButtonClicked');
			toolMsg.remove();
		};

		// 始终允许按钮
		const currentToolName = toolInfo?.tool || '';
		alwaysAllowButton = append(buttonContainer, $('button')) as HTMLButtonElement;
		// 使用 DOM API 而非 innerHTML（避免 CSP 问题）
		const alwaysAllowIcon = append(alwaysAllowButton, $('span.codicon.codicon-shield'));
		alwaysAllowIcon.style.marginRight = '4px';
		const alwaysAllowText = append(alwaysAllowButton, $('span'));
		alwaysAllowText.textContent = '始终允许';
		alwaysAllowButton.style.padding = '6px 16px';
		alwaysAllowButton.style.backgroundColor = 'transparent';
		alwaysAllowButton.style.color = 'var(--vscode-charts-green)';
		alwaysAllowButton.style.border = '1px solid var(--vscode-charts-green)';
		alwaysAllowButton.style.borderRadius = '4px';
		alwaysAllowButton.style.cursor = 'pointer';
		alwaysAllowButton.style.fontSize = '12px';
		alwaysAllowButton.style.display = 'flex';
		alwaysAllowButton.style.alignItems = 'center';
		alwaysAllowButton.title = currentToolName ? `始终允许 "${currentToolName}" 工具的操作` : '始终允许此类工具操作';
		alwaysAllowButton.onclick = async () => {
			approveButton.disabled = true;
			denyButton.disabled = true;
			alwaysAllowButton.disabled = true;
			// 更新按钮内容为loading状态
			alwaysAllowIcon.className = 'codicon codicon-loading codicon-modifier-spin';
			alwaysAllowText.textContent = '设置中...';

			// 始终允许：对本次任务会话中所有工具类型生效（通配符 '*'）
			this.maxianService.setToolAutoApprove('*', true);

			try {
				await this.maxianService.closeDiffWithoutSave();
				this.maxianService.handleAskResponse(message.ts, 'yesButtonClicked');
			} finally {
				toolMsg.remove();
			}
		};

		applyPreviewGuard = (reason: string) => {
			if (!approveButton || !alwaysAllowButton) {
				pendingPreviewBlockReason = reason;
				return;
			}
			approveButton.disabled = true;
			approveButton.textContent = '⛔ 预检查失败';
			approveButton.title = reason;
			alwaysAllowButton.disabled = true;
			alwaysAllowButton.title = reason;
		};

		if (pendingPreviewBlockReason) {
			applyPreviewGuard(pendingPreviewBlockReason);
		}

		this.messageArea.scrollTop = this.messageArea.scrollHeight;
	}

	/**
	 * 渲染命令批准请求（ask command）
	 * 优化：添加展开/折叠功能
	 */
	private renderCommandApproval(message: ClineMessage): void {
		// 🔥 首先检查是否已设置命令自动批准
		const cmdText = message.text || '';
		if (this.maxianService.isCommandAutoApproved('*')) {
			// 直接执行批准操作
			this.maxianService.handleAskResponse(message.ts, 'yesButtonClicked');
			return;
		}

		const cmdMsg = append(this.messageArea, $('div'));
		cmdMsg.style.marginBottom = '10px';

		// 提取命令摘要（取前50个字符）
		const cmdSummary = cmdText.length > 50 ? cmdText.substring(0, 50) + '...' : cmdText;

		// 创建可折叠的标题元素
		const titleElement = $('div');
		titleElement.style.display = 'flex';
		titleElement.style.alignItems = 'center';
		titleElement.style.gap = '8px';
		titleElement.style.flex = '1';
		titleElement.style.overflow = 'hidden';

		// 终端图标
		const cmdIcon = append(titleElement, $('span.codicon.codicon-terminal'));
		cmdIcon.style.fontSize = '14px';
		cmdIcon.style.color = 'var(--vscode-charts-orange)';
		cmdIcon.style.flexShrink = '0';

		// 命令执行确认标签
		const cmdLabel = append(titleElement, $('span'));
		cmdLabel.style.fontWeight = '600';
		cmdLabel.style.fontSize = '13px';
		cmdLabel.style.color = 'var(--vscode-foreground)';
		cmdLabel.textContent = '命令执行';

		// 命令摘要（显示在标题中）
		const cmdSummarySpan = append(titleElement, $('span'));
		cmdSummarySpan.style.fontSize = '12px';
		cmdSummarySpan.style.color = 'var(--vscode-descriptionForeground)';
		cmdSummarySpan.style.fontFamily = 'var(--vscode-editor-font-family)';
		cmdSummarySpan.style.overflow = 'hidden';
		cmdSummarySpan.style.textOverflow = 'ellipsis';
		cmdSummarySpan.style.whiteSpace = 'nowrap';
		cmdSummarySpan.textContent = `$ ${cmdSummary}`;
		cmdSummarySpan.title = cmdText;

		// 时间戳
		if (message.ts) {
			const timeSpan = append(titleElement, $('span'));
			timeSpan.style.fontSize = '10px';
			timeSpan.style.color = 'var(--vscode-descriptionForeground)';
			timeSpan.style.marginLeft = 'auto';
			timeSpan.style.flexShrink = '0';
			timeSpan.textContent = formatTime(message.ts);
		}

		// 创建可折叠组件
		const collapsible = createCollapsible(cmdMsg, {
			title: titleElement,
			defaultOpen: true,
			headerClass: 'command-approval-header',
			contentClass: 'command-approval-content'
		});

		// 设置容器样式
		collapsible.container.style.backgroundColor = 'var(--vscode-editor-inactiveSelectionBackground)';
		collapsible.container.style.border = '2px solid var(--vscode-widget-border)';

		// 内容区域
		const contentArea = collapsible.content;

		// 命令内容容器
		const cmdContentWrapper = append(contentArea, $('div'));
		cmdContentWrapper.style.position = 'relative';
		cmdContentWrapper.style.marginBottom = '12px';

		const cmdContent = append(cmdContentWrapper, $('div'));
		cmdContent.style.whiteSpace = 'pre-wrap';
		cmdContent.style.wordBreak = 'break-word';
		cmdContent.style.fontFamily = 'var(--vscode-editor-font-family)';
		cmdContent.style.backgroundColor = 'var(--vscode-textCodeBlock-background)';
		cmdContent.style.padding = '10px 40px 10px 10px';
		cmdContent.style.borderRadius = '4px';
		cmdContent.style.color = 'var(--vscode-foreground)';
		cmdContent.style.fontSize = '13px';
		cmdContent.textContent = cmdText;

		// 复制按钮
		const copyBtnWrapper = append(cmdContentWrapper, $('div'));
		copyBtnWrapper.style.position = 'absolute';
		copyBtnWrapper.style.top = '6px';
		copyBtnWrapper.style.right = '6px';
		createCopyButton(copyBtnWrapper, () => cmdText);

		// 按钮容器
		const buttonContainer = append(contentArea, $('div'));
		buttonContainer.style.display = 'flex';
		buttonContainer.style.gap = '8px';
		buttonContainer.style.flexWrap = 'wrap';

		// Allow按钮
		const allowButton = append(buttonContainer, $('button')) as HTMLButtonElement;
		allowButton.textContent = '✅ 允许执行';
		allowButton.style.padding = '6px 16px';
		allowButton.style.backgroundColor = 'var(--vscode-button-background)';
		allowButton.style.color = 'var(--vscode-button-foreground)';
		allowButton.style.border = 'none';
		allowButton.style.borderRadius = '4px';
		allowButton.style.cursor = 'pointer';
		allowButton.style.fontWeight = '600';
		allowButton.onclick = () => {
			allowButton.disabled = true;
			denyButton.disabled = true;
			alwaysAllowButton.disabled = true;
			this.maxianService.handleAskResponse(message.ts, 'yesButtonClicked');
			cmdMsg.remove();
		};

		// Deny按钮
		const denyButton = append(buttonContainer, $('button')) as HTMLButtonElement;
		denyButton.textContent = '❌ 拒绝';
		denyButton.style.padding = '6px 16px';
		denyButton.style.backgroundColor = 'var(--vscode-button-secondaryBackground)';
		denyButton.style.color = 'var(--vscode-button-secondaryForeground)';
		denyButton.style.border = 'none';
		denyButton.style.borderRadius = '4px';
		denyButton.style.cursor = 'pointer';
		denyButton.onclick = () => {
			allowButton.disabled = true;
			denyButton.disabled = true;
			alwaysAllowButton.disabled = true;
			this.maxianService.handleAskResponse(message.ts, 'noButtonClicked');
			cmdMsg.remove();
		};

		// 始终允许按钮
		const alwaysAllowButton = append(buttonContainer, $('button')) as HTMLButtonElement;
		// 使用 DOM API 而非 innerHTML（避免 CSP 问题）
		const cmdAlwaysAllowIcon = append(alwaysAllowButton, $('span.codicon.codicon-shield'));
		cmdAlwaysAllowIcon.style.marginRight = '4px';
		const cmdAlwaysAllowText = append(alwaysAllowButton, $('span'));
		cmdAlwaysAllowText.textContent = '始终允许';
		alwaysAllowButton.style.padding = '6px 16px';
		alwaysAllowButton.style.backgroundColor = 'transparent';
		alwaysAllowButton.style.color = 'var(--vscode-charts-green)';
		alwaysAllowButton.style.border = '1px solid var(--vscode-charts-green)';
		alwaysAllowButton.style.borderRadius = '4px';
		alwaysAllowButton.style.cursor = 'pointer';
		alwaysAllowButton.style.fontSize = '12px';
		alwaysAllowButton.style.display = 'flex';
		alwaysAllowButton.style.alignItems = 'center';
		alwaysAllowButton.title = '始终允许所有命令执行（点击后将不再询问）';
		alwaysAllowButton.onclick = () => {
			allowButton.disabled = true;
			denyButton.disabled = true;
			alwaysAllowButton.disabled = true;
			// 更新按钮内容为loading状态
			cmdAlwaysAllowIcon.className = 'codicon codicon-loading codicon-modifier-spin';
			cmdAlwaysAllowText.textContent = '设置中...';

			this.maxianService.setCommandAutoApprove('*', true);
			this.maxianService.handleAskResponse(message.ts, 'yesButtonClicked');
			cmdMsg.remove();
		};

		this.messageArea.scrollTop = this.messageArea.scrollHeight;
	}

	/**
	 * 加载知识库列表
	 */
	private async loadKnowledgeBases(): Promise<void> {
		try {
			// 获取API配置
			const apiUrl = this.configurationService.getValue<string>('zhikai.auth.apiUrl');

			// ⚠️ 架构修复：从 StorageService 读取凭据（与 authService 一致）
			const storedCredentials = this.storageService.get('zhikai.auth.credentials', StorageScope.APPLICATION);
			if (!storedCredentials || !apiUrl) {
				console.debug('[MaxianView] API credentials not configured, skipping knowledge base loading');
				this.knowledgeBases = [];
				this.updateKnowledgeBaseSelector();
				return;
			}

			const credentials = JSON.parse(storedCredentials);
			const username = credentials.username;
			const password = credentials.password;

			if (!username || !password) {
				console.debug('[MaxianView] API credentials not configured, skipping knowledge base loading');
				// 清空知识库列表并更新UI
				this.knowledgeBases = [];
				this.updateKnowledgeBaseSelector();
				return;
			}

			// 构建认证头（浏览器环境使用btoa）
			const authHeader = btoa(`${username}:${password}`);

			// 调用知识库API（POST请求，参数通过URL传递，请求体包含Base64编码的用户名密码）
			const baseUrl = apiUrl.replace(/\/$/, '');
			const response = await fetch(`${baseUrl}/knowledge/knowledgeApplication/listByUser?applicationStatus=0`, {
				method: 'POST',
				headers: {
					'Authorization': `Basic ${authHeader}`,
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({
					username: btoa(username),
					password: btoa(password)
				})
			});

			if (!response.ok) {
				console.warn('[MaxianView] Failed to fetch knowledge bases:', response.status);
				// 清空知识库列表并更新UI
				this.knowledgeBases = [];
				this.updateKnowledgeBaseSelector();
				return;
			}

			const result = await response.json();

			// 支持数字和字符串类型的code
			if ((result.code === 200 || result.code === '200') && result.data) {
				this.knowledgeBases = result.data;
				this.updateKnowledgeBaseSelector();
			} else {
				// API返回失败，清空知识库列表
				this.knowledgeBases = [];
				this.updateKnowledgeBaseSelector();
			}
		} catch (error) {
			console.warn('[MaxianView] Error loading knowledge bases:', error);
			// 发生异常时，清空知识库列表并更新UI
			this.knowledgeBases = [];
			this.updateKnowledgeBaseSelector();
		}
	}

	/**
	 * 更新知识库选择器选项
	 */
	private updateKnowledgeBaseSelector(): void {
		if (!this.knowledgeBaseDropdownList) {
			console.warn('[MaxianView] knowledgeBaseDropdownList is not initialized');
			return;
		}

		// 清除所有现有列表项
		while (this.knowledgeBaseDropdownList.firstChild) {
			this.knowledgeBaseDropdownList.removeChild(this.knowledgeBaseDropdownList.firstChild);
		}

		// 添加知识库列表项
		this.knowledgeBases.forEach((kb, _index) => {
			const li = append(this.knowledgeBaseDropdownList, $('li')) as HTMLLIElement;
			li.style.padding = '9px 12px';
			li.style.cursor = 'pointer';
			li.style.transition = 'all 0.15s ease';
			li.style.display = 'flex';
			li.style.alignItems = 'center';
			li.style.gap = '8px';
			li.style.borderRadius = '6px';
			li.style.margin = '2px 6px';
			li.style.fontSize = '12px';
			li.style.lineHeight = '1.3';
			li.setAttribute('data-kb-id', kb.id);

			// 知识库名称
			const name = append(li, $('span'));
			name.textContent = kb.applicationName;
			name.title = kb.applicationName;
			name.style.flex = '1';
			name.style.minWidth = '0';
			name.style.overflow = 'hidden';
			name.style.textOverflow = 'ellipsis';
			name.style.whiteSpace = 'nowrap';
			name.style.fontWeight = '500';

			// 选中标记（默认隐藏）
			const checkmark = append(li, $('span.codicon.codicon-check'));
			checkmark.style.color = 'var(--vscode-charts-green, #4EC9B0)';
			checkmark.style.fontSize = '14px';
			checkmark.style.opacity = '0';
			checkmark.style.transition = 'opacity 0.2s ease';
			checkmark.style.flexShrink = '0';
			checkmark.style.width = '14px';
			checkmark.style.textAlign = 'center';

			// Hover效果
			li.onmouseenter = () => {
				li.style.backgroundColor = 'var(--vscode-list-hoverBackground, rgba(90, 93, 94, 0.31))';
			};
			li.onmouseleave = () => {
				if (this.selectedKnowledgeBaseId !== kb.id) {
					li.style.backgroundColor = 'transparent';
				}
			};

			// 点击选择
			li.onclick = (e) => {
				e.stopPropagation();
				this.selectedKnowledgeBaseId = kb.id;
				// 更新显示文本
				const textSpan = this.knowledgeBaseSelector.querySelector('[data-role="kb-text"]') as HTMLSpanElement;
				if (textSpan) {
					textSpan.textContent = kb.applicationName;
					textSpan.title = kb.applicationName;
				}

				// 更新所有列表项的选中状态
				Array.from(this.knowledgeBaseDropdownList.children).forEach((item, idx) => {
					const listItem = item as HTMLLIElement;
					const itemCheckmark = listItem.querySelector('span.codicon-check') as HTMLSpanElement;
					if (idx === this.knowledgeBases.findIndex(k => k.id === kb.id)) {
						listItem.style.backgroundColor = 'var(--vscode-list-activeSelectionBackground, rgba(0, 122, 204, 0.2))';
						listItem.style.color = 'var(--vscode-list-activeSelectionForeground)';
						if (itemCheckmark) {
							itemCheckmark.style.opacity = '1';
						}
					} else {
						listItem.style.backgroundColor = 'transparent';
						listItem.style.color = 'var(--vscode-foreground)';
						if (itemCheckmark) {
							itemCheckmark.style.opacity = '0';
						}
					}
				});

				// 关闭下拉列表（需要同步isDropdownOpen状态）
				this.isKnowledgeBaseDropdownOpen = false;
				this.closeKnowledgeBaseDropdown();
			};

		});

		// 自动选择第一个知识库
		if (this.knowledgeBases.length > 0) {
			this.selectedKnowledgeBaseId = this.knowledgeBases[0].id;
			// 更新显示文本
			const textSpan = this.knowledgeBaseSelector.querySelector('[data-role="kb-text"]') as HTMLSpanElement;
			if (textSpan) {
				textSpan.textContent = this.knowledgeBases[0].applicationName;
				textSpan.title = this.knowledgeBases[0].applicationName;
			}

			// 高亮第一项
			const firstItem = this.knowledgeBaseDropdownList.children[0] as HTMLLIElement;
			if (firstItem) {
				firstItem.style.backgroundColor = 'var(--vscode-list-activeSelectionBackground, rgba(0, 122, 204, 0.2))';
				firstItem.style.color = 'var(--vscode-list-activeSelectionForeground)';
				const checkmark = firstItem.querySelector('span.codicon-check') as HTMLSpanElement;
				if (checkmark) {
					checkmark.style.opacity = '1';
				}
			}

			} else {
			// 没有知识库时，清空选择并更新UI
			this.selectedKnowledgeBaseId = null;
			const textSpan = this.knowledgeBaseSelector.querySelector('[data-role="kb-text"]') as HTMLSpanElement;
			if (textSpan) {
				textSpan.textContent = '无可用知识库';
				textSpan.title = '无可用知识库';
			}
			console.warn('[MaxianView] 没有可用的知识库');
		}
	}

	/**
	 * 根据知识库名称计算下拉列表宽度，尽量完整展示名称
	 */
	private computeKnowledgeBaseDropdownWidth(fallbackWidth: number): number {
		const MIN_WIDTH = Math.max(220, fallbackWidth);
		const MAX_WIDTH = Math.min(480, Math.max(260, window.innerWidth - 24));
		if (this.knowledgeBases.length === 0) {
			return MIN_WIDTH;
		}

		let longestNameWidth = 0;
		const canvas = document.createElement('canvas');
		const ctx = canvas.getContext('2d');
		if (!ctx) {
			return MIN_WIDTH;
		}

		ctx.font = `${getComputedStyle(this.knowledgeBaseSelector).fontSize} ${getComputedStyle(this.knowledgeBaseSelector).fontFamily}`;
		for (const kb of this.knowledgeBases) {
			const measured = ctx.measureText(kb.applicationName).width;
			if (measured > longestNameWidth) {
				longestNameWidth = measured;
			}
		}

		const PADDING_AND_ICONS = 44; // 右对勾 + 左右间距
		const calculated = Math.ceil(longestNameWidth + PADDING_AND_ICONS);
		return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, calculated));
	}

	private computeModeDropdownWidth(fallbackWidth: number): number {
		const MIN_WIDTH = Math.max(280, fallbackWidth + 48);
		const MAX_WIDTH = Math.min(560, Math.max(320, window.innerWidth - 16));
		if (!this.modeDropdownList || this.modeDropdownList.children.length === 0) {
			return MIN_WIDTH;
		}

		let longestNameWidth = 0;
		const canvas = document.createElement('canvas');
		const ctx = canvas.getContext('2d');
		if (!ctx) {
			return MIN_WIDTH;
		}

		ctx.font = `${getComputedStyle(this.modeSelector).fontSize} ${getComputedStyle(this.modeSelector).fontFamily}`;
		for (const node of Array.from(this.modeDropdownList.children)) {
			const nameEl = (node as HTMLElement).querySelector('span:not(.codicon)') as HTMLElement | null;
			const label = nameEl?.textContent?.trim();
			if (!label) {
				continue;
			}
			const measured = ctx.measureText(label).width;
			if (measured > longestNameWidth) {
				longestNameWidth = measured;
			}
		}

		const PADDING_AND_ICONS = 80; // 左侧图标 + 右侧对勾 + 间距
		const calculated = Math.ceil(longestNameWidth + PADDING_AND_ICONS);
		return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, calculated));
	}

	/**
	 * 获取当前选中的知识库ID
	 */
	public getSelectedKnowledgeBaseId(): string | null {
		return this.selectedKnowledgeBaseId;
	}

	/**
	 * 关闭知识库下拉列表
	 */
	private closeKnowledgeBaseDropdown(): void {
		this.knowledgeBaseDropdown.style.opacity = '0';
		// 根据展开方向使用相反的transform（关闭动画）
		this.knowledgeBaseDropdown.style.transform = this.isDropdownOpeningUpward ? 'translateY(8px)' : 'translateY(-8px)';
		setTimeout(() => {
			this.knowledgeBaseDropdown.style.display = 'none';
		}, 200);
		this.knowledgeBaseSelectorArrow.style.transform = 'rotate(0deg)';
		this.applyKnowledgeBaseSelectorVisualState('default');
	}

	private openFloatingDropdown(
		anchorEl: HTMLElement,
		dropdownEl: HTMLElement,
		options: { maxHeight: number; width: number; margin?: number }
	): boolean {
		const anchorRect = anchorEl.getBoundingClientRect();
		const viewportHeight = window.innerHeight;
		const viewportWidth = window.innerWidth;
		const margin = options.margin ?? 8;
		const spaceBelow = viewportHeight - anchorRect.bottom - margin;
		const spaceAbove = anchorRect.top - margin;

		const openingUpward = spaceBelow < options.maxHeight && spaceAbove > spaceBelow;
		const actualMaxHeight = Math.max(80, Math.min(options.maxHeight, openingUpward ? spaceAbove : spaceBelow));

		dropdownEl.style.top = '';
		dropdownEl.style.bottom = '';
		dropdownEl.style.left = '';
		dropdownEl.style.right = '';

		dropdownEl.style.maxHeight = `${actualMaxHeight}px`;
		dropdownEl.style.width = `${options.width}px`;
		const constrainedLeft = Math.max(
			margin,
			Math.min(anchorRect.left, viewportWidth - options.width - margin)
		);
		dropdownEl.style.left = `${constrainedLeft}px`;

		if (openingUpward) {
			const bottomPosition = viewportHeight - anchorRect.top + 2;
			dropdownEl.style.bottom = `${bottomPosition}px`;
			dropdownEl.style.transform = 'translateY(8px)';
		} else {
			const topPosition = anchorRect.bottom + 2;
			dropdownEl.style.top = `${topPosition}px`;
			dropdownEl.style.transform = 'translateY(-8px)';
		}

		dropdownEl.style.display = 'block';
		void dropdownEl.offsetHeight;
		requestAnimationFrame(() => {
			dropdownEl.style.opacity = '1';
			dropdownEl.style.transform = 'translateY(0)';
		});

		return openingUpward;
	}

	private applyKnowledgeBaseSelectorVisualState(state: 'default' | 'hover' | 'open'): void {
		if (state === 'open') {
			this.knowledgeBaseSelector.style.backgroundColor = 'var(--vscode-input-background, rgba(128, 128, 128, 0.12))';
			this.knowledgeBaseSelector.style.color = 'var(--vscode-foreground)';
			this.knowledgeBaseSelector.style.borderColor = 'var(--vscode-focusBorder, #007acc)';
			this.knowledgeBaseSelector.style.boxShadow = '0 0 0 1px var(--vscode-focusBorder, #007acc)';
			this.knowledgeBaseSelectorArrow.style.color = 'var(--vscode-focusBorder, #007acc)';
			return;
		}

		if (state === 'hover') {
			this.knowledgeBaseSelector.style.backgroundColor = 'var(--vscode-list-hoverBackground, rgba(128, 128, 128, 0.12))';
			this.knowledgeBaseSelector.style.color = 'var(--vscode-foreground)';
			this.knowledgeBaseSelector.style.borderColor = 'var(--vscode-input-border, rgba(128, 128, 128, 0.45))';
			this.knowledgeBaseSelector.style.boxShadow = 'none';
			this.knowledgeBaseSelectorArrow.style.color = 'var(--vscode-descriptionForeground)';
			return;
		}

		this.knowledgeBaseSelector.style.backgroundColor = 'var(--vscode-input-background, rgba(128, 128, 128, 0.08))';
		this.knowledgeBaseSelector.style.color = 'var(--vscode-descriptionForeground)';
		this.knowledgeBaseSelector.style.borderColor = 'var(--vscode-input-border, rgba(128, 128, 128, 0.35))';
		this.knowledgeBaseSelector.style.boxShadow = 'none';
		this.knowledgeBaseSelectorArrow.style.color = 'var(--vscode-descriptionForeground)';
	}

	/**
	 * 关闭模式下拉列表
	 */
	private closeModeDropdown(): void {
		this.modeDropdown.style.opacity = '0';
		// 根据展开方向使用相反的transform（关闭动画）
		this.modeDropdown.style.transform = this.isModeDropdownOpeningUpward ? 'translateY(8px)' : 'translateY(-8px)';
		setTimeout(() => {
			this.modeDropdown.style.display = 'none';
		}, 200);
		this.modeSelectorArrow.style.transform = 'rotate(0deg)';
		this.modeSelector.style.backgroundColor = 'var(--vscode-input-background, rgba(128, 128, 128, 0.08))';
		this.modeSelector.style.color = 'var(--vscode-descriptionForeground)';
		this.modeSelector.style.borderColor = 'var(--vscode-input-border, rgba(128, 128, 128, 0.35))';
		this.modeSelector.style.boxShadow = 'none';
		this.modeSelectorArrow.style.color = 'var(--vscode-descriptionForeground)';
		this.modeSelectorIcon.style.color = 'var(--vscode-descriptionForeground)';
	}

	/**
	 * 更新可用模式 - 根据用户权限动态调整
	 */
	private updateAvailableModes(): void {
		if (!this.modeSelector || !this.modeDropdownList || !this.knowledgeBaseSelectorWrapper) {
			return; // 如果选择器还未创建,跳过
		}

		// 清空现有列表项
		while (this.modeDropdownList.firstChild) {
			this.modeDropdownList.removeChild(this.modeDropdownList.firstChild);
		}

		// 获取用户权限
		const currentUser = this.authService.currentUser;
		const agentPermission = currentUser?.agentPermission;

		// 过滤可用模式
		const allModes = getAllModes();
		const availableModes = allModes.filter(mode => {
			if (mode.slug === 'ask') {
				return true; // ask 模式固定可用
			}
			if (!agentPermission || agentPermission.length === 0) {
				return false; // 没有权限配置,只显示 ask
			}
			return agentPermission.includes(mode.slug); // 检查是否在权限列表中
		});

		// 排序：ask 模式固定在第一位，其他模式按原顺序
		availableModes.sort((a, b) => {
			if (a.slug === 'ask') {
				return -1; // ask 始终在前
			}
			if (b.slug === 'ask') {
				return 1; // ask 始终在前
			}
			return 0; // 其他模式保持原顺序
		});

		// 模式图标映射
		const modeIconMap: Record<string, string> = {
			'code': 'codicon-code',
			'architect': 'codicon-symbol-namespace',
			'ask': 'codicon-comment-discussion',
			'debug': 'codicon-bug',
			'orchestrator': 'codicon-hubot',
			'spec': 'codicon-checklist'
		};

		// 添加模式列表项
		availableModes.forEach((mode) => {
			const li = append(this.modeDropdownList, $('li')) as HTMLLIElement;
			li.style.fontSize = '12px';
			li.style.padding = '8px 12px';
			li.style.cursor = 'pointer';
			li.style.display = 'flex';
			li.style.alignItems = 'center';
			li.style.gap = '8px';
			li.style.transition = 'background-color 0.15s ease';
			li.style.borderRadius = '4px';
			li.style.margin = '0 4px';

			// 模式图标
			const icon = append(li, $(`span.codicon.${modeIconMap[mode.slug] || 'codicon-circle-outline'}`));
			icon.style.fontSize = '13px';
			icon.style.flexShrink = '0';
			icon.style.color = 'var(--vscode-descriptionForeground)';

			// 模式名称
			const name = append(li, $('span'));
			name.textContent = mode.name;
			name.style.flex = '1';
			name.style.display = 'block';
			name.style.overflow = 'visible';
			name.style.textOverflow = 'clip';
			name.style.whiteSpace = 'nowrap';
			name.style.wordBreak = 'normal';
			name.style.lineHeight = '1.2';

			// 选中标记（默认隐藏）
			const checkmark = append(li, $('span.codicon.codicon-check'));
			checkmark.style.color = 'var(--vscode-charts-green, #4EC9B0)';
			checkmark.style.fontSize = '14px';
			checkmark.style.opacity = '0';
			checkmark.style.transition = 'opacity 0.2s ease';
			checkmark.style.flexShrink = '0';
			checkmark.style.width = '14px';
			checkmark.style.textAlign = 'center';
			checkmark.style.marginTop = '1px';

			// 如果是当前模式，高亮显示
			if (mode.slug === this.currentMode) {
				li.style.backgroundColor = 'var(--vscode-list-activeSelectionBackground, rgba(0, 122, 204, 0.2))';
				li.style.color = 'var(--vscode-list-activeSelectionForeground)';
				checkmark.style.opacity = '1';
			}

			// Hover效果
			li.onmouseenter = () => {
				li.style.backgroundColor = 'var(--vscode-list-hoverBackground, rgba(90, 93, 94, 0.31))';
			};
			li.onmouseleave = () => {
				if (this.currentMode !== mode.slug) {
					li.style.backgroundColor = 'transparent';
				}
			};

			// 点击选择
			li.onclick = (e) => {
				e.stopPropagation();
				this.currentMode = mode.slug as Mode;

				// 更新显示文本
				const textSpan = this.modeSelector.querySelector('[data-role="mode-text"]') as HTMLSpanElement;
				if (textSpan) {
					textSpan.textContent = mode.name;
				}
				this.modeSelectorIcon.className = `codicon ${modeIconMap[mode.slug] || 'codicon-circle-outline'}`;

				// 控制连续对话复选框的显示（仅ask模式显示）
				if (this.currentMode === 'ask') {
					this.continuousConversationWrapper.style.display = 'flex';
				} else {
					this.continuousConversationWrapper.style.display = 'none';
				}
				// 控制知识库选择器的显示（仅ask模式显示）
				this.knowledgeBaseSelectorWrapper.style.display = this.currentMode === 'ask' ? '' : 'none';
				// 切换模式时关闭历史面板
				if (this.historyPanel) {
					this.historyPanel.remove();
					this.historyPanel = null;
				}

				// 更新所有列表项的选中状态
				Array.from(this.modeDropdownList.children).forEach((item, idx) => {
					const listItem = item as HTMLLIElement;
					const itemCheckmark = listItem.querySelector('span.codicon-check') as HTMLSpanElement;
					if (idx === availableModes.findIndex(m => m.slug === mode.slug)) {
						listItem.style.backgroundColor = 'var(--vscode-list-activeSelectionBackground, rgba(0, 122, 204, 0.2))';
						listItem.style.color = 'var(--vscode-list-activeSelectionForeground)';
						if (itemCheckmark) {
							itemCheckmark.style.opacity = '1';
						}
					} else {
						listItem.style.backgroundColor = 'transparent';
						listItem.style.color = 'var(--vscode-foreground)';
						if (itemCheckmark) {
							itemCheckmark.style.opacity = '0';
						}
					}
				});

				// 关闭下拉列表
				this.isModeDropdownOpen = false;
				this.closeModeDropdown();
			};
		});

		// 如果当前模式不在可用模式中,切换到 ask 模式
		if (!availableModes.some(m => m.slug === this.currentMode)) {
			this.currentMode = 'ask';
		}

		// 更新显示框的文本为当前模式
		const currentModeInfo = availableModes.find(m => m.slug === this.currentMode);
		if (currentModeInfo) {
			const textSpan = this.modeSelector.querySelector('[data-role="mode-text"]') as HTMLSpanElement;
			if (textSpan) {
				textSpan.textContent = currentModeInfo.name;
			}
			this.modeSelectorIcon.className = `codicon ${modeIconMap[currentModeInfo.slug] || 'codicon-circle-outline'}`;
		}

		// 根据当前模式更新知识库选择器显示状态
		this.knowledgeBaseSelectorWrapper.style.display = this.currentMode === 'ask' ? '' : 'none';
	}

	/**
	 * 切换问答历史面板（ask模式专用）
	 */
	public async toggleAskHistoryPanel(): Promise<void> {
		// 如果已打开，关闭它
		if (this.historyPanel) {
			this.historyPanel.remove();
			this.historyPanel = null;
			return;
		}

		// 创建面板覆盖层
		const panel = $('div.maxian-history-panel');
		panel.style.position = 'absolute';
		panel.style.top = '0';
		panel.style.left = '0';
		panel.style.right = '0';
		panel.style.bottom = '0';
		panel.style.backgroundColor = 'var(--vscode-sideBar-background)';
		panel.style.zIndex = '100';
		panel.style.display = 'flex';
		panel.style.flexDirection = 'column';
		panel.style.overflow = 'hidden';

		// 面板头部
		const header = append(panel, $('div.maxian-history-header'));
		header.style.display = 'flex';
		header.style.alignItems = 'center';
		header.style.justifyContent = 'space-between';
		header.style.padding = '12px 16px';
		header.style.borderBottom = '1px solid var(--vscode-widget-border)';
		header.style.flexShrink = '0';

		const title = append(header, $('span'));
		title.textContent = '问答历史';
		title.style.fontWeight = '600';
		title.style.fontSize = '13px';
		title.style.color = 'var(--vscode-foreground)';

		const closeBtn = append(header, $('button.codicon.codicon-close')) as HTMLButtonElement;
		closeBtn.title = '关闭';
		closeBtn.style.background = 'transparent';
		closeBtn.style.border = 'none';
		closeBtn.style.cursor = 'pointer';
		closeBtn.style.padding = '4px';
		closeBtn.style.color = 'var(--vscode-descriptionForeground)';
		closeBtn.style.fontSize = '14px';
		closeBtn.style.display = 'inline-flex';
		closeBtn.style.alignItems = 'center';
		closeBtn.style.justifyContent = 'center';
		closeBtn.style.borderRadius = '4px';
		closeBtn.onmouseenter = () => {
			closeBtn.style.backgroundColor = 'rgba(255,255,255,0.08)';
			closeBtn.style.color = 'var(--vscode-foreground)';
		};
		closeBtn.onmouseleave = () => {
			closeBtn.style.backgroundColor = 'transparent';
			closeBtn.style.color = 'var(--vscode-descriptionForeground)';
		};
		closeBtn.onclick = () => {
			panel.remove();
			this.historyPanel = null;
		};

		// 内容区域（滚动，支持选择）
		const content = append(panel, $('div.maxian-history-content'));
		content.style.flex = '1';
		content.style.overflowY = 'auto';
		content.style.padding = '8px 0';
		content.style.userSelect = 'text';
		content.style.webkitUserSelect = 'text';

		// 加载中状态
		const loadingEl = append(content, $('div'));
		loadingEl.style.padding = '24px 16px';
		loadingEl.style.textAlign = 'center';
		loadingEl.style.color = 'var(--vscode-descriptionForeground)';
		loadingEl.style.fontSize = '12px';
		loadingEl.textContent = '加载中...';

		// 挂载面板到容器
		this.container.style.position = 'relative';
		this.container.appendChild(panel);
		this.historyPanel = panel;

		// 异步加载历史数据
		try {
			const history: AskHistoryItem[] = await this.maxianService.getAskHistory(50);
			loadingEl.remove();

			if (history.length === 0) {
				const emptyEl = append(content, $('div'));
				emptyEl.style.padding = '24px 16px';
				emptyEl.style.textAlign = 'center';
				emptyEl.style.color = 'var(--vscode-descriptionForeground)';
				emptyEl.style.fontSize = '12px';
				emptyEl.textContent = '暂无问答历史记录';
				return;
			}

			for (const item of history) {
				const card = append(content, $('div.maxian-history-item'));
				card.style.margin = '0 12px 8px 12px';
				card.style.borderRadius = '6px';
				card.style.border = '1px solid var(--vscode-widget-border, rgba(255,255,255,0.08))';
				card.style.backgroundColor = 'var(--vscode-editor-background)';
				card.style.overflow = 'hidden';

				// ── 折叠头部（始终可见，点击展开/折叠）──
				const cardHeader = append(card, $('div'));
				cardHeader.style.display = 'flex';
				cardHeader.style.alignItems = 'flex-start';
				cardHeader.style.gap = '6px';
				cardHeader.style.padding = '8px 10px';
				cardHeader.style.cursor = 'pointer';
				cardHeader.style.userSelect = 'none';
				cardHeader.style.webkitUserSelect = 'none';

				cardHeader.onmouseenter = () => { cardHeader.style.backgroundColor = 'var(--vscode-list-hoverBackground)'; };
				cardHeader.onmouseleave = () => { cardHeader.style.backgroundColor = 'transparent'; };

				// 折叠箭头
				const arrow = append(cardHeader, $('span.codicon.codicon-chevron-right'));
				arrow.style.fontSize = '12px';
				arrow.style.color = 'var(--vscode-descriptionForeground)';
				arrow.style.flexShrink = '0';
				arrow.style.marginTop = '2px';
				arrow.style.transition = 'transform 0.15s';

				// 头部右侧：时间 + 问题首行预览
				const headerRight = append(cardHeader, $('div'));
				headerRight.style.flex = '1';
				headerRight.style.minWidth = '0';

				// 元信息行：时间 + 模型 + 知识库
				const metaRow = append(headerRight, $('div'));
				metaRow.style.display = 'flex';
				metaRow.style.alignItems = 'center';
				metaRow.style.gap = '6px';
				metaRow.style.flexWrap = 'wrap';
				metaRow.style.marginBottom = '3px';

				const ts = item.startTime;
				const date = new Date(typeof ts === 'number' && ts < 1e12 ? ts * 1000 : ts);
				const timeEl = append(metaRow, $('span'));
				timeEl.style.fontSize = '11px';
				timeEl.style.color = 'var(--vscode-descriptionForeground)';
				timeEl.textContent = date.toLocaleString('zh-CN', {
					month: '2-digit', day: '2-digit',
					hour: '2-digit', minute: '2-digit'
				});

				if (item.model) {
					const modelTag = append(metaRow, $('span'));
					modelTag.style.padding = '0 5px';
					modelTag.style.fontSize = '10px';
					modelTag.style.borderRadius = '3px';
					modelTag.style.backgroundColor = 'var(--vscode-badge-background)';
					modelTag.style.color = 'var(--vscode-badge-foreground)';
					modelTag.textContent = item.model;
				}

				if (item.knowledgeBaseName) {
					const kbTag = append(metaRow, $('span'));
					kbTag.style.padding = '0 5px';
					kbTag.style.fontSize = '10px';
					kbTag.style.borderRadius = '3px';
					kbTag.style.backgroundColor = 'rgba(0,122,204,0.2)';
					kbTag.style.color = 'var(--vscode-textLink-foreground)';
					kbTag.textContent = `📚 ${item.knowledgeBaseName}`;
				}

				// 问题预览（首行，最多80字）
				const preview = append(headerRight, $('div'));
				preview.style.fontSize = '12px';
				preview.style.color = 'var(--vscode-foreground)';
				preview.style.overflow = 'hidden';
				preview.style.textOverflow = 'ellipsis';
				preview.style.whiteSpace = 'nowrap';
				const previewText = (item.requestSummary || '').split('\n')[0].substring(0, 80);
				preview.textContent = previewText;

				// ── 展开内容区（默认隐藏）──
				const expandArea = append(card, $('div'));
				expandArea.style.display = 'none';
				expandArea.style.borderTop = '1px solid var(--vscode-widget-border, rgba(255,255,255,0.06))';
				expandArea.style.userSelect = 'text';
				expandArea.style.webkitUserSelect = 'text';

				// 问题完整内容
				if (item.requestSummary) {
					const qSection = append(expandArea, $('div'));
					qSection.style.padding = '10px 12px';
					qSection.style.borderBottom = item.responseSummary
						? '1px solid var(--vscode-widget-border, rgba(255,255,255,0.06))'
						: 'none';

					const qLabel = append(qSection, $('div'));
					qLabel.style.fontSize = '11px';
					qLabel.style.fontWeight = '600';
					qLabel.style.color = 'var(--vscode-textLink-foreground)';
					qLabel.style.marginBottom = '6px';
					qLabel.textContent = '问';

					const qContent = append(qSection, $('div'));
					qContent.style.fontSize = '12px';
					qContent.style.lineHeight = '1.6';
					qContent.style.userSelect = 'text';
					qContent.style.webkitUserSelect = 'text';
					MarkdownRendererDom.renderMarkdown(item.requestSummary, qContent);
				}

				// 回答完整内容
				if (item.responseSummary) {
					const aSection = append(expandArea, $('div'));
					aSection.style.padding = '10px 12px';
					aSection.style.backgroundColor = 'rgba(255,255,255,0.02)';

					const aLabel = append(aSection, $('div'));
					aLabel.style.fontSize = '11px';
					aLabel.style.fontWeight = '600';
					aLabel.style.color = 'var(--vscode-charts-green, #4ec9b0)';
					aLabel.style.marginBottom = '6px';
					aLabel.textContent = '答';

					const aContent = append(aSection, $('div'));
					aContent.style.fontSize = '12px';
					aContent.style.lineHeight = '1.6';
					aContent.style.userSelect = 'text';
					aContent.style.webkitUserSelect = 'text';
					MarkdownRendererDom.renderMarkdown(item.responseSummary, aContent);
				}

				// 点击折叠头部切换展开状态
				let expanded = false;
				cardHeader.onclick = () => {
					expanded = !expanded;
					expandArea.style.display = expanded ? 'block' : 'none';
					arrow.style.transform = expanded ? 'rotate(90deg)' : 'none';
				};
			}
		} catch (err) {
			loadingEl.textContent = '加载失败，请重试';
			console.error('[MaxianView] 加载问答历史失败:', err);
		}
	}

	/**
	 * 创建任务进度条区域
	 * 显示在消息区域上方，用于展示当前任务的整体进度
	 */
	private createTaskProgressBar(): void {
		// 创建进度条容器（插入到消息区域之前）
		this.taskProgressContainer = $('div.task-progress-container');
		this.container.insertBefore(this.taskProgressContainer, this.messageArea);
		this.taskProgressContainer.style.padding = '12px 16px';
		this.taskProgressContainer.style.borderBottom = '2px solid var(--vscode-widget-border)';
		this.taskProgressContainer.style.backgroundColor = 'var(--vscode-sideBar-background)';
		this.taskProgressContainer.style.display = 'none'; // 默认隐藏
		// 🔧 固定在顶部，防止被滚动遮挡
		this.taskProgressContainer.style.position = 'sticky';
		this.taskProgressContainer.style.top = '0';
		this.taskProgressContainer.style.zIndex = '100';
		this.taskProgressContainer.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.15)';

		// 进度条头部（步骤描述 + 进度文字）
		const progressHeader = append(this.taskProgressContainer, $('div'));
		progressHeader.style.display = 'flex';
		progressHeader.style.justifyContent = 'space-between';
		progressHeader.style.alignItems = 'center';
		progressHeader.style.marginBottom = '6px';

		// 当前步骤描述
		this.taskProgressStep = append(progressHeader, $('span'));
		this.taskProgressStep.style.fontSize = '12px';
		this.taskProgressStep.style.color = 'var(--vscode-foreground)';
		this.taskProgressStep.style.fontWeight = '500';
		this.taskProgressStep.style.overflow = 'hidden';
		this.taskProgressStep.style.textOverflow = 'ellipsis';
		this.taskProgressStep.style.whiteSpace = 'nowrap';
		this.taskProgressStep.style.flex = '1';
		this.taskProgressStep.style.marginRight = '12px';
		this.taskProgressStep.textContent = '正在处理...';

		// 进度数字
		this.taskProgressText = append(progressHeader, $('span'));
		this.taskProgressText.style.fontSize = '11px';
		this.taskProgressText.style.color = 'var(--vscode-descriptionForeground)';
		this.taskProgressText.style.flexShrink = '0';
		this.taskProgressText.textContent = '0/0';

		// 进度条背景
		const progressBarBg = append(this.taskProgressContainer, $('div'));
		progressBarBg.style.width = '100%';
		progressBarBg.style.height = '4px';
		progressBarBg.style.backgroundColor = 'var(--vscode-progressBar-background, rgba(0, 122, 204, 0.2))';
		progressBarBg.style.borderRadius = '2px';
		progressBarBg.style.overflow = 'hidden';

		// 进度条填充
		this.taskProgressBar = append(progressBarBg, $('div'));
		this.taskProgressBar.style.height = '100%';
		this.taskProgressBar.style.width = '0%';
		this.taskProgressBar.style.background = 'linear-gradient(90deg, var(--vscode-charts-blue), var(--vscode-charts-green))';
		this.taskProgressBar.style.borderRadius = '2px';
		this.taskProgressBar.style.transition = 'width 0.3s ease';
	}

	/**
	 * 处理任务进度事件
	 * 更新进度条显示
	 */
	private handleTaskProgress(event: ITaskProgressEvent): void {
		if (!this.taskProgressContainer || !this.taskProgressBar || !this.taskProgressText || !this.taskProgressStep) {
			return;
		}

		// 根据状态决定显示/隐藏
		if (event.status === 'running') {
			this.taskProgressContainer.style.display = 'block';

			// 更新进度条宽度
			const percent = event.total > 0 ? (event.current / event.total) * 100 : 0;
			this.taskProgressBar.style.width = `${Math.min(100, percent)}%`;

			// 更新进度文字
			this.taskProgressText.textContent = `${event.current}/${event.total}`;

			// 更新步骤描述
			if (event.currentStep) {
				this.taskProgressStep.textContent = event.currentStep;
			} else {
				this.taskProgressStep.textContent = `步骤 ${event.current}/${event.total}`;
			}

			// 设置进度条颜色
			this.taskProgressBar.style.background = 'linear-gradient(90deg, var(--vscode-charts-blue), var(--vscode-charts-green))';

		} else if (event.status === 'completed') {
			// 完成时显示100%，然后渐隐
			this.taskProgressBar.style.width = '100%';
			this.taskProgressBar.style.background = 'var(--vscode-charts-green)';
			this.taskProgressText.textContent = `${event.total}/${event.total}`;
			this.taskProgressStep.textContent = '✓ 任务完成';

			// 2秒后隐藏
			setTimeout(() => {
				if (this.taskProgressContainer) {
					this.taskProgressContainer.style.display = 'none';
				}
			}, 2000);

		} else if (event.status === 'error') {
			// 错误时显示红色
			this.taskProgressBar.style.background = 'var(--vscode-charts-red, #f14c4c)';
			this.taskProgressStep.textContent = '✗ 任务出错';

			// 3秒后隐藏
			setTimeout(() => {
				if (this.taskProgressContainer) {
					this.taskProgressContainer.style.display = 'none';
				}
			}, 3000);

		} else if (event.status === 'cancelled') {
			// 取消时显示灰色
			this.taskProgressBar.style.background = 'var(--vscode-descriptionForeground)';
			this.taskProgressStep.textContent = '任务已取消';

			// 2秒后隐藏
			setTimeout(() => {
				if (this.taskProgressContainer) {
					this.taskProgressContainer.style.display = 'none';
				}
			}, 2000);
		}
	}

	/**
	 * 处理工具输入流式事件
	 * 实时显示工具调用的参数信息
	 */
	private handleToolInputStreaming(event: IToolInputStreamingEvent): void {
		// 节流：将事件存为 pending，300ms 内只渲染一次
		this.toolInputPendingEvents.set(event.toolId, event);

		if (!this.toolInputThrottleTimers.has(event.toolId)) {
			const timer = window.setTimeout(() => {
				this.toolInputThrottleTimers.delete(event.toolId);
				const latestEvent = this.toolInputPendingEvents.get(event.toolId);
				if (latestEvent) {
					this.toolInputPendingEvents.delete(event.toolId);
					this._renderToolInputStreaming(latestEvent);
				}
			}, 300);
			this.toolInputThrottleTimers.set(event.toolId, timer);
		}

		// isPartial=false（完成事件）需要立即渲染，不能再等
		if (!event.isPartial) {
			const existingTimer = this.toolInputThrottleTimers.get(event.toolId);
			if (existingTimer !== undefined) {
				window.clearTimeout(existingTimer);
				this.toolInputThrottleTimers.delete(event.toolId);
			}
			this.toolInputPendingEvents.delete(event.toolId);
			this._renderToolInputStreaming(event);
		}
	}

	private _renderToolInputStreaming(event: IToolInputStreamingEvent): void {
		// 获取或创建显示元素
		let streamingElement = this.toolInputStreamingElements.get(event.toolId);

		if (!streamingElement) {
			streamingElement = $('div.tool-input-streaming');
			streamingElement.style.cssText = `
				margin: 6px 0;
				background: var(--vscode-editor-background);
				border: 1px solid var(--vscode-inputValidation-infoBorder, #007acc);
				border-radius: 6px;
				overflow: hidden;
				font-size: 12px;
			`;

			// 标题栏
			const header = $('div.tool-streaming-header');
			header.style.cssText = `
				display: flex;
				align-items: center;
				gap: 6px;
				padding: 6px 10px;
				background: var(--vscode-inputValidation-infoBackground, rgba(0,127,255,0.08));
				border-bottom: 1px solid var(--vscode-inputValidation-infoBorder, #007acc);
			`;

			const iconSpan = $('span.tool-icon');
			iconSpan.textContent = getToolIcon(event.toolName as any);
			iconSpan.style.fontSize = '14px';
			header.appendChild(iconSpan);

			const nameSpan = $('span.tool-name');
			nameSpan.textContent = event.toolName;
			nameSpan.style.cssText = `font-weight: 600; color: var(--vscode-foreground); flex: 1;`;
			header.appendChild(nameSpan);

			const indicator = $('span.streaming-indicator');
			indicator.style.cssText = `font-size: 11px; color: var(--vscode-charts-blue, #007acc);`;
			header.appendChild(indicator);

			streamingElement.appendChild(header);

			// 内容区
			const contentArea = $('div.tool-streaming-content');
			contentArea.style.cssText = `
				padding: 8px 10px;
				max-height: 120px;
				overflow-y: auto;
				color: var(--vscode-descriptionForeground);
				font-family: var(--vscode-editor-font-family, monospace);
				font-size: 11px;
			`;
			streamingElement.appendChild(contentArea);

			this.messageArea.appendChild(streamingElement);
			this.toolInputStreamingElements.set(event.toolId, streamingElement);
			this.messageArea.scrollTop = this.messageArea.scrollHeight;
		}

		const indicator = streamingElement.querySelector('.streaming-indicator') as HTMLElement;
		const contentArea = streamingElement.querySelector('.tool-streaming-content') as HTMLElement;

		if (event.isPartial) {
			// 流式进行中：只显示字符数进度，不显示原始内容
			if (indicator) {
				indicator.textContent = '⠋ 生成中...';
				indicator.style.color = 'var(--vscode-charts-blue, #007acc)';
			}
			if (contentArea) {
				const rawLen = typeof event.input === 'string'
					? event.input.length
					: JSON.stringify(event.input || '').length;
				contentArea.textContent = `已生成 ${rawLen.toLocaleString()} 字符...`;
			}
		} else {
			// 完成：解析 JSON 提取关键信息，用 markdown 渲染
			if (indicator) {
				indicator.textContent = '✓ 完成';
				indicator.style.color = 'var(--vscode-charts-green, #89d185)';
			}
			if (contentArea) {
				const mdText = this._formatToolInputAsMarkdown(event.toolName, event.input);
				contentArea.style.cssText = `
					padding: 8px 10px;
					max-height: 200px;
					overflow-y: auto;
					font-size: 12px;
				`;
				MarkdownRendererDom.renderMarkdown(mdText, contentArea);
			}

			// 1.5秒后移除（工具结果会替代它）
			setTimeout(() => {
				const element = this.toolInputStreamingElements.get(event.toolId);
				if (element && element.parentNode) {
					element.parentNode.removeChild(element);
					this.toolInputStreamingElements.delete(event.toolId);
				}
			}, 1500);
		}
	}

	/** 将工具 input JSON 格式化为可读的 Markdown 摘要 */
	private _formatToolInputAsMarkdown(toolName: string, input: any): string {
		let parsed: any = null;
		try {
			parsed = typeof input === 'string' ? JSON.parse(input) : input;
		} catch {
			// 解析失败，展示截断的原始内容
			const raw = String(input || '');
			return `\`\`\`\n${raw.substring(0, 300)}${raw.length > 300 ? '\n...' : ''}\n\`\`\``;
		}
		if (!parsed) return '';

		const lines: string[] = [];

		// 根据工具名提取关键字段
		if (parsed.path) {
			lines.push(`📄 \`${parsed.path}\``);
		}
		if (parsed.command) {
			lines.push(`\`\`\`bash\n${parsed.command}\n\`\`\``);
		}
		if (parsed.content !== undefined) {
			const content = String(parsed.content);
			const preview = content.length > 400 ? content.substring(0, 400) + '\n...' : content;
			// 猜测语言
			const ext = (parsed.path || '').split('.').pop() || '';
			const langMap: Record<string, string> = { ts: 'typescript', js: 'javascript', py: 'python', java: 'java', go: 'go', rs: 'rust', md: 'markdown', json: 'json', css: 'css', html: 'html' };
			const lang = langMap[ext] || '';
			lines.push(`\`\`\`${lang}\n${preview}\n\`\`\``);
		}
		if (parsed.old_string !== undefined) {
			lines.push(`**替换内容** (${String(parsed.old_string).length} 字符 → ${String(parsed.new_string || '').length} 字符)`);
		}
		if (parsed.query) {
			lines.push(`🔍 \`${parsed.query}\``);
		}
		if (parsed.url) {
			lines.push(`🌐 ${parsed.url}`);
		}
		// 如果没有提取到任何信息，显示简要的 JSON 摘要
		if (lines.length === 0) {
			const keys = Object.keys(parsed).slice(0, 3);
			keys.forEach(k => {
				const v = String(parsed[k]);
				lines.push(`**${k}**: ${v.length > 80 ? v.substring(0, 80) + '...' : v}`);
			});
		}

		return lines.join('\n\n');
	}

	/**
	 * 清除所有工具输入流式显示
	 */
	private clearToolInputStreaming(): void {
		for (const [_toolId, element] of this.toolInputStreamingElements) {
			if (element.parentNode) {
				element.parentNode.removeChild(element);
			}
		}
		this.toolInputStreamingElements.clear();
	}

	/**
	 * 处理工具完成事件
	 * 更新工具执行状态（从运行中到完成/失败）
	 */
	private handleToolCompleted(event: IToolCompletedEvent): void {

		// 通过toolId查找对应的工具状态元素
		const toolStatusElement = this.toolStatusElements.get(event.toolId);
		if (!toolStatusElement) {
			console.warn('[MaxianView] 未找到toolId对应的状态元素:', event.toolId);
			return;
		}

		// 所有工具完成后（不管成功还是失败）都自动消失，不保留卡片
		toolStatusElement.classList.remove('tool-running');
		toolStatusElement.classList.add(event.isError ? 'tool-error' : 'tool-completed');

		// 停止旋转动画
		const iconElement = toolStatusElement.querySelector('.tool-status-icon') as HTMLElement;
		if (iconElement) {
			iconElement.classList.remove('codicon-modifier-spin');
		}
		const loadingDots = toolStatusElement.querySelector('.tool-loading-dots') as HTMLElement;
		if (loadingDots) {
			loadingDots.style.display = 'none';
		}

		// 淡出并移除
		toolStatusElement.style.transition = 'opacity 0.5s ease-out';
		setTimeout(() => {
			toolStatusElement.style.opacity = '0';
		}, 1000);
		setTimeout(() => {
			toolStatusElement.remove();
			this.toolStatusElements.delete(event.toolId);
		}, 1500);
		}

	/**
	 * 在工具确认卡片内渲染内联 diff（edit/multiedit 确认时使用）
	 */
	private renderInlineEditDiff(container: HTMLElement, toolInfo: any): void {
		const isSingleEdit = toolInfo.tool === 'edit';
		const edits: Array<{ oldString: string; newString: string }> = isSingleEdit
			? [{ oldString: toolInfo.oldString || '', newString: toolInfo.newString || '' }]
			: (toolInfo.edits || []);

		if (edits.length === 0 || !edits.some((e: any) => e.oldString || e.newString)) {
			return;
		}

		const diffWrapper = append(container, $('div'));
		diffWrapper.style.cssText = `
			margin: 0 0 8px 0;
			border: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.3));
			border-radius: 4px;
			overflow: hidden;
			font-family: var(--vscode-editor-font-family, monospace);
			font-size: 12px;
			max-height: 300px;
			overflow-y: auto;
		`;

		for (const edit of edits) {
			if (!edit.oldString && !edit.newString) { continue; }
			const oldLines = (edit.oldString || '').split('\n');
			const newLines = (edit.newString || '').split('\n');

			for (const line of oldLines) {
				const row = append(diffWrapper, $('div'));
				row.style.cssText = `padding: 1px 8px; background: var(--vscode-diffEditor-removedLineBackground, rgba(255,0,0,0.1)); color: var(--vscode-gitDecoration-deletedResourceForeground, #f14c4c); white-space: pre-wrap; word-break: break-all;`;
				row.textContent = '- ' + line;
			}
			for (const line of newLines) {
				const row = append(diffWrapper, $('div'));
				row.style.cssText = `padding: 1px 8px; background: var(--vscode-diffEditor-insertedLineBackground, rgba(0,255,0,0.1)); color: var(--vscode-gitDecoration-addedResourceForeground, #73c991); white-space: pre-wrap; word-break: break-all;`;
				row.textContent = '+ ' + line;
			}
			if (edits.length > 1) {
				const sep = append(diffWrapper, $('div'));
				sep.style.cssText = `height: 1px; background: var(--vscode-panel-border, rgba(128,128,128,0.3)); margin: 2px 0;`;
			}
		}
	}

	/**
	 * 渲染 edit/multiedit 工具的持久化 diff 块（类似 git diff）
	 * 在工具卡片消失后，在消息区域保留一个永久的 diff 视图
	 */
	private renderEditDiffBlock(toolInfo: any): void {
		const path: string = toolInfo.path || '';
		const isSingleEdit = toolInfo.tool === 'edit';

		// 构建 diff 数据：单处 edit 或多处 edit（multiedit）
		const edits: Array<{ oldString: string; newString: string }> = isSingleEdit
			? [{ oldString: toolInfo.oldString || '', newString: toolInfo.newString || '' }]
			: (toolInfo.edits || []);

		if (edits.length === 0 || !edits.some((e: any) => e.oldString || e.newString)) {
			return; // 没有 diff 内容，不渲染
		}

		// 外层容器（持久化，不会消失）
		const diffBlock = append(this.messageArea, $('div.maxian-diff-block'));
		diffBlock.style.cssText = `
			margin: 4px 0 8px 0;
			border: 1px solid var(--vscode-diffEditor-removedLineBackground, rgba(255,0,0,0.15));
			border-radius: 6px;
			overflow: hidden;
			font-family: var(--vscode-editor-font-family, monospace);
			font-size: 12px;
		`;

		// 头部：文件路径 + 折叠按钮
		const diffHeader = append(diffBlock, $('div.maxian-diff-header'));
		diffHeader.style.cssText = `
			display: flex;
			align-items: center;
			gap: 6px;
			padding: 5px 10px;
			background: var(--vscode-editorGroupHeader-tabsBackground, var(--vscode-editor-background));
			border-bottom: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.2));
			cursor: pointer;
			user-select: none;
		`;

		const diffIcon = append(diffHeader, $('span.codicon.codicon-diff'));
		diffIcon.style.cssText = `color: var(--vscode-icon-foreground); font-size: 13px;`;

		const diffPath = append(diffHeader, $('span'));
		diffPath.textContent = path;
		diffPath.style.cssText = `
			flex: 1;
			color: var(--vscode-foreground);
			font-family: var(--vscode-editor-font-family, monospace);
			font-size: 12px;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		`;

		// "在编辑器中查看 Diff" 按钮（仅当有文件路径时显示）
		if (path) {
			const openDiffBtn = append(diffHeader, $('span'));
			openDiffBtn.title = '在编辑器中查看完整 Diff';
			openDiffBtn.style.cssText = `
				display: inline-flex;
				align-items: center;
				gap: 3px;
				padding: 2px 6px;
				border-radius: 3px;
				font-size: 11px;
				color: var(--vscode-textLink-foreground, #4fc1ff);
				cursor: pointer;
				border: 1px solid transparent;
				flex-shrink: 0;
				margin-right: 4px;
			`;
			const openDiffIcon = append(openDiffBtn, $('span.codicon.codicon-diff'));
			openDiffIcon.style.fontSize = '11px';
			openDiffIcon.style.pointerEvents = 'none';
			const openDiffLabel = append(openDiffBtn, $('span'));
			openDiffLabel.textContent = '编辑器查看';
			openDiffLabel.style.pointerEvents = 'none';
			openDiffBtn.onmouseenter = () => {
				openDiffBtn.style.backgroundColor = 'var(--vscode-toolbar-hoverBackground, rgba(90,93,94,0.31))';
				openDiffBtn.style.borderColor = 'var(--vscode-widget-border, rgba(127,127,127,0.3))';
			};
			openDiffBtn.onmouseleave = () => {
				openDiffBtn.style.backgroundColor = 'transparent';
				openDiffBtn.style.borderColor = 'transparent';
			};
			openDiffBtn.onclick = (e) => {
				e.stopPropagation();
				// 使用 openEditPreviewDiff 打开编辑器 diff 视图
				this.maxianService.openEditPreviewDiff(path, edits).catch(() => {});
			};
		}

		const toggleBtn = append(diffHeader, $('span.codicon.codicon-chevron-down'));
		toggleBtn.style.cssText = `color: var(--vscode-icon-foreground); font-size: 11px; transition: transform 0.2s;`;

		// diff 内容区域（可折叠）
		const diffContent = append(diffBlock, $('div.maxian-diff-content'));
		diffContent.style.cssText = `max-height: 400px; overflow-y: auto;`;

		// 渲染每组 edit 的 diff 行
		for (let i = 0; i < edits.length; i++) {
			const { oldString, newString } = edits[i];
			if (!oldString && !newString) { continue; }

			// multiedit 多组之间加分隔线
			if (i > 0) {
				const sep = append(diffContent, $('div'));
				sep.style.cssText = `height: 1px; background: var(--vscode-panel-border, rgba(128,128,128,0.2));`;
			}

			// 渲染 old 行（红色，"-"）
			if (oldString) {
				for (const line of oldString.split('\n')) {
					const row = append(diffContent, $('div.maxian-diff-row-del'));
					row.style.cssText = `
						display: flex;
						padding: 0 10px;
						background: var(--vscode-diffEditor-removedLineBackground, rgba(255,0,0,0.08));
						color: var(--vscode-diffEditor-removedTextForeground, #f97583);
						white-space: pre;
						line-height: 20px;
					`;
					const prefix = append(row, $('span'));
					prefix.textContent = '-';
					prefix.style.cssText = `
						min-width: 16px;
						margin-right: 8px;
						color: var(--vscode-diffEditor-removedTextForeground, #f97583);
						user-select: none;
					`;
					const text = append(row, $('span'));
					text.textContent = line;
				}
			}

			// 渲染 new 行（绿色，"+"）
			if (newString) {
				for (const line of newString.split('\n')) {
					const row = append(diffContent, $('div.maxian-diff-row-add'));
					row.style.cssText = `
						display: flex;
						padding: 0 10px;
						background: var(--vscode-diffEditor-insertedLineBackground, rgba(0,255,0,0.08));
						color: var(--vscode-diffEditor-insertedTextForeground, #85e89d);
						white-space: pre;
						line-height: 20px;
					`;
					const prefix = append(row, $('span'));
					prefix.textContent = '+';
					prefix.style.cssText = `
						min-width: 16px;
						margin-right: 8px;
						color: var(--vscode-diffEditor-insertedTextForeground, #85e89d);
						user-select: none;
					`;
					const text = append(row, $('span'));
					text.textContent = line;
				}
			}
		}

		// 折叠/展开交互
		let collapsed = false;
		diffHeader.addEventListener('click', () => {
			collapsed = !collapsed;
			diffContent.style.display = collapsed ? 'none' : 'block';
			toggleBtn.style.transform = collapsed ? 'rotate(-90deg)' : 'rotate(0deg)';
		});
	}

	// ========== 任务列表（Todo List）相关方法 ==========

	/**
	 * 创建任务列表容器
	 * 显示在进度条下方，用于展示任务清单
	 */
	private createTodoListContainer(): void {
		// 创建任务列表容器（插入到消息区域之前）
		this.todoListContainer = $('div.todo-list-container');
		this.container.insertBefore(this.todoListContainer, this.messageArea);

		this.todoListContainer.style.cssText = `
			padding: 0;
			background: var(--vscode-editor-background);
			display: none;
			border-bottom: 1px solid var(--vscode-widget-border);
		`;

		// 创建可折叠的头部
		const header = append(this.todoListContainer, $('div.todo-list-header'));
		header.style.cssText = `
			display: flex;
			align-items: center;
			justify-content: space-between;
			padding: 8px 12px;
			cursor: pointer;
			user-select: none;
			background: var(--vscode-sideBarSectionHeader-background);
			border-bottom: 1px solid var(--vscode-widget-border);
		`;

		// 左侧：图标 + 标题 + 计数
		const headerLeft = append(header, $('div.todo-list-header-left'));
		headerLeft.style.cssText = `
			display: flex;
			align-items: center;
			gap: 8px;
		`;

		// 展开/折叠箭头
		const arrow = append(headerLeft, $('span.todo-list-arrow'));
		arrow.textContent = '▼';
		arrow.style.cssText = `
			font-size: 10px;
			color: var(--vscode-foreground);
			transition: transform 0.2s ease;
		`;

		// 任务图标
		const icon = append(headerLeft, $('span.todo-list-icon'));
		icon.textContent = '📋';
		icon.style.fontSize = '14px';

		// 标题
		const title = append(headerLeft, $('span.todo-list-title'));
		title.textContent = '任务列表';
		title.style.cssText = `
			font-size: 12px;
			font-weight: 600;
			color: var(--vscode-foreground);
		`;

		// 计数徽章
		const badge = append(headerLeft, $('span.todo-list-badge'));
		badge.style.cssText = `
			font-size: 11px;
			padding: 1px 6px;
			border-radius: 10px;
			background: var(--vscode-badge-background);
			color: var(--vscode-badge-foreground);
		`;
		badge.textContent = '0/0';

		// 右侧进度指示
		const progressInfo = append(header, $('span.todo-list-progress-info'));
		progressInfo.style.cssText = `
			font-size: 11px;
			color: var(--vscode-descriptionForeground);
		`;

		// 创建任务列表内容区域
		this.todoListContent = append(this.todoListContainer, $('div.todo-list-content'));
		this.todoListContent.style.cssText = `
			max-height: 200px;
			overflow-y: auto;
			padding: 8px 12px;
			display: block;
		`;

		// 折叠/展开功能 - 默认展开
		let isCollapsed = false;
		header.addEventListener('click', (e) => {
			e.preventDefault();
			e.stopPropagation();
			isCollapsed = !isCollapsed;
			arrow.style.transform = isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)';
			if (this.todoListContent) {
				this.todoListContent.style.display = isCollapsed ? 'none' : 'block';
			}
		});
	}

	/**
	 * 处理任务列表更新事件
	 */
	private handleTodoListUpdate(event: ITodoListEvent): void {

		if (!this.todoListContainer || !this.todoListContent) {
			return;
		}

		// 防御性处理：确保 todos 是数组（AI 可能传入 JSON 字符串或非数组格式）
		let todos = event.todos;
		if (!Array.isArray(todos)) {
			console.warn('[MaxianView] handleTodoListUpdate: todos is not an array, got:', typeof todos, todos);
			if (typeof todos === 'string') {
				try {
					const parsed = JSON.parse(todos);
					todos = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.todos) ? parsed.todos : []);
				} catch {
					todos = [];
				}
			} else if (todos && typeof todos === 'object' && Array.isArray((todos as any).todos)) {
				todos = (todos as any).todos;
			} else {
				todos = [];
			}
		}

		// 没有任务时隐藏容器
		if (todos.length === 0) {
			this.clearTodoList();
			return;
		}

		// 显示容器
		this.todoListContainer.style.display = 'block';

		// 计算完成数（completed 和 failed 分别统计）
		const completedCount = todos.filter(t => t.status === 'completed').length;
		const failedCount = todos.filter(t => t.status === 'failed').length;
		const totalCount = todos.length;
		const doneCount = completedCount + failedCount; // 已处理（完成或失败）

		// 更新徽章
		const badge = this.todoListContainer.querySelector('.todo-list-badge') as HTMLElement;
		if (badge) {
			badge.textContent = `${completedCount}/${totalCount}`;
			if (failedCount > 0) {
				badge.style.background = 'var(--vscode-charts-orange, #cc8800)';
			} else if (completedCount === totalCount && totalCount > 0) {
				badge.style.background = 'var(--vscode-charts-green)';
			} else {
				badge.style.background = 'var(--vscode-badge-background)';
			}
		}

		// 更新进度信息
		const progressInfo = this.todoListContainer.querySelector('.todo-list-progress-info') as HTMLElement;
		if (progressInfo) {
			const percent = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;
			if (failedCount > 0 && completedCount + failedCount === totalCount) {
				progressInfo.textContent = `⚠️ ${completedCount} 完成 / ${failedCount} 失败`;
				progressInfo.style.color = 'var(--vscode-charts-orange, #cc8800)';
			} else if (completedCount === totalCount && totalCount > 0) {
				progressInfo.textContent = '✅ 全部完成';
				progressInfo.style.color = 'var(--vscode-charts-green)';
			} else {
				progressInfo.textContent = `${percent}% 完成`;
				progressInfo.style.color = 'var(--vscode-descriptionForeground)';
			}
		}

		// 确保内容区域可见（默认展开）
		if (this.todoListContent) {
			this.todoListContent.style.display = 'block';
		}

		// 重置箭头状态
		const arrow = this.todoListContainer.querySelector('.todo-list-arrow') as HTMLElement;
		if (arrow) {
			arrow.style.transform = 'rotate(0deg)';
		}

		// 渲染任务列表
		this.renderTodoList(todos);
	}

	/**
	 * 渲染任务列表内容
	 */
	private renderTodoList(todos: ITodoItem[]): void {
		if (!this.todoListContent) {
			return;
		}

		// 清空现有内容
		clearNode(this.todoListContent);

		if (todos.length === 0) {
			const emptyMsg = append(this.todoListContent, $('div.todo-empty'));
			emptyMsg.textContent = '暂无任务';
			emptyMsg.style.cssText = `
				color: var(--vscode-descriptionForeground);
				font-size: 12px;
				text-align: center;
				padding: 16px;
			`;
			return;
		}

		// 创建任务列表
		const list = append(this.todoListContent, $('ul.todo-items'));
		list.style.cssText = `
			list-style: none;
			padding: 0;
			margin: 0;
		`;

		todos.forEach((todo, index) => {
			const item = append(list, $('li.todo-item'));
			item.style.cssText = `
				display: flex;
				align-items: flex-start;
				gap: 8px;
				padding: 6px 4px;
				border-radius: 4px;
				transition: background 0.15s ease;
			`;

			// 悬停效果
			item.addEventListener('mouseenter', () => {
				item.style.background = 'var(--vscode-list-hoverBackground)';
			});
			item.addEventListener('mouseleave', () => {
				item.style.background = 'transparent';
			});

			// 状态图标
			const statusIcon = append(item, $('span.todo-status-icon'));
			statusIcon.style.cssText = `
				flex-shrink: 0;
				width: 18px;
				height: 18px;
				display: flex;
				align-items: center;
				justify-content: center;
				font-size: 14px;
			`;

			switch (todo.status) {
				case 'completed': {
					const icon = append(statusIcon, $('span'));
					icon.style.color = 'var(--vscode-charts-green)';
					icon.textContent = '✅';
					// 已完成：背景轻微绿色
					item.style.backgroundColor = 'rgba(var(--vscode-charts-green-rgb, 52, 168, 83), 0.04)';
					break;
				}
				case 'in_progress': {
					// 使用 CSS 动画实现旋转的加载图标
					const spinner = append(statusIcon, $('span.todo-spinner'));
					spinner.style.cssText = `
						display: inline-block;
						width: 14px;
						height: 14px;
						border: 2px solid var(--vscode-charts-blue);
						border-top-color: transparent;
						border-radius: 50%;
						animation: todo-spin 1s linear infinite;
					`;
					// 进行中：背景轻微蓝色 + 左边框高亮
					item.style.backgroundColor = 'rgba(0, 122, 204, 0.06)';
					item.style.borderLeft = '2px solid var(--vscode-charts-blue)';
					item.style.paddingLeft = '6px';
					break;
				}
				case 'failed': {
					const icon = append(statusIcon, $('span'));
					icon.style.color = 'var(--vscode-errorForeground, #f14c4c)';
					icon.textContent = '❌';
					// 失败：背景轻微红色
					item.style.backgroundColor = 'rgba(var(--vscode-charts-red-rgb, 241, 76, 76), 0.06)';
					break;
				}
				case 'pending':
				default: {
					const icon = append(statusIcon, $('span'));
					icon.style.color = 'var(--vscode-descriptionForeground)';
					icon.textContent = '⬜';
					break;
				}
			}

			// 任务内容
			const content = append(item, $('span.todo-content'));
			let contentColor = 'var(--vscode-foreground)';
			let textDecoration = '';
			if (todo.status === 'completed') {
				contentColor = 'var(--vscode-descriptionForeground)';
				textDecoration = 'text-decoration: line-through;';
			} else if (todo.status === 'failed') {
				contentColor = 'var(--vscode-errorForeground, #f14c4c)';
			}
			content.style.cssText = `
				flex: 1;
				font-size: 12px;
				line-height: 1.5;
				color: ${contentColor};
				${textDecoration}
			`;

			// 显示内容或进行中描述
			if (todo.status === 'in_progress' && todo.activeForm) {
				content.textContent = todo.activeForm;
				content.style.fontWeight = '500';
				content.style.color = 'var(--vscode-foreground)';
			} else {
				content.textContent = todo.content;
			}

			// 序号
			const indexSpan = append(item, $('span.todo-index'));
			indexSpan.textContent = `#${index + 1}`;
			indexSpan.style.cssText = `
				flex-shrink: 0;
				font-size: 10px;
				color: var(--vscode-descriptionForeground);
				opacity: 0.6;
			`;
		});
	}

	/**
	 * 清空任务列表
	 */
	private clearTodoList(): void {
		if (this.todoListContainer) {
			this.todoListContainer.style.display = 'none';
		}
		if (this.todoListContent) {
			clearNode(this.todoListContent);
		}
	}

	override dispose(): void {
		this.stopApiRequestProgress(true);
		if (this.textStreamFlushTimer !== null) {
			clearTimeout(this.textStreamFlushTimer);
			this.textStreamFlushTimer = null;
		}
		this.clearToolInputStreaming();
		this.clearTodoList();
		super.dispose();
	}

	// ===================================================================
	// MCP 设置面板
	// ===================================================================

	/** 切换 MCP 设置面板 */
	private toggleMcpPanel(): void {
		if (this.mcpPanel) {
			this.mcpPanel.remove();
			this.mcpPanel = null;
			return;
		}
		this.renderMcpPanel();
	}

	/** 渲染 MCP 设置面板 */
	private renderMcpPanel(): void {
		const panel = append(this.container, $('div.maxian-mcp-panel'));
		this.mcpPanel = panel;
		panel.style.cssText = `
			position: absolute;
			bottom: 0; left: 0; right: 0;
			background: var(--vscode-editor-background);
			border-top: 1px solid var(--vscode-widget-border);
			z-index: 200;
			display: flex;
			flex-direction: column;
			max-height: 80%;
			overflow: hidden;
		`;

		// 标题栏
		const header = append(panel, $('div'));
		header.style.cssText = `
			display: flex; align-items: center; justify-content: space-between;
			padding: 10px 14px;
			border-bottom: 1px solid var(--vscode-widget-border);
			background: var(--vscode-sideBarSectionHeader-background, var(--vscode-editor-background));
			flex-shrink: 0;
		`;
		const title = append(header, $('span'));
		title.textContent = 'MCP 服务器';
		title.style.cssText = 'font-size: 13px; font-weight: 600; color: var(--vscode-foreground);';

		const closeBtn = append(header, $('button.codicon.codicon-close')) as HTMLButtonElement;
		closeBtn.style.cssText = `
			background: transparent; border: none; cursor: pointer;
			color: var(--vscode-descriptionForeground); padding: 2px; border-radius: 4px;
		`;
		closeBtn.onclick = () => { panel.remove(); this.mcpPanel = null; };

		// 服务器列表区域
		const listArea = append(panel, $('div'));
		listArea.style.cssText = 'flex: 1; overflow-y: auto; padding: 8px;';

		const renderServerList = () => {
			clearNode(listArea);
			const servers = this.maxianService.getMcpServers();
			if (servers.length === 0) {
				const empty = append(listArea, $('div'));
				empty.style.cssText = 'text-align: center; padding: 20px; color: var(--vscode-descriptionForeground); font-size: 12px;';
				empty.textContent = '暂无 MCP 服务器。点击下方"添加服务器"配置。';
			} else {
				for (const server of servers) {
					this.renderMcpServerItem(listArea, server, renderServerList);
				}
			}
		};

		renderServerList();

		// 订阅变化
		const unsub = this.maxianService.onMcpServersChange(() => renderServerList());
		panel.addEventListener('remove', unsub as any);

		// 底部工具栏
		const footer = append(panel, $('div'));
		footer.style.cssText = `
			display: flex; justify-content: flex-end; align-items: center;
			padding: 8px 14px;
			border-top: 1px solid var(--vscode-widget-border);
			flex-shrink: 0;
		`;
		const addBtn = append(footer, $('button'));
		addBtn.textContent = '+ 添加服务器';
		addBtn.style.cssText = `
			padding: 5px 12px; font-size: 12px; cursor: pointer;
			background: var(--vscode-button-background); color: var(--vscode-button-foreground);
			border: none; border-radius: 4px;
		`;
		addBtn.onclick = () => this.showMcpServerForm(null, renderServerList);
	}

	/** 渲染单个 MCP 服务器条目 */
	private renderMcpServerItem(container: HTMLElement, server: McpServerInfo, refresh: () => void): void {
		const item = append(container, $('div'));
		item.style.cssText = `
			display: flex; align-items: center; gap: 8px;
			padding: 8px 10px; margin-bottom: 4px; border-radius: 6px;
			border: 1px solid var(--vscode-widget-border);
			background: var(--vscode-textCodeBlock-background, rgba(128,128,128,0.05));
		`;

		// 状态指示点
		const dot = append(item, $('span'));
		dot.style.cssText = `
			width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0;
			background: ${server.isConnected ? '#4CAF50' : server.isConnecting ? '#FF9800' : '#f44336'};
		`;
		dot.title = server.isConnected ? '已连接' : server.isConnecting ? '连接中...' : (server.error || '未连接');

		// 名称 + 状态
		const info = append(item, $('div'));
		info.style.cssText = 'flex: 1; min-width: 0;';
		const name = append(info, $('div'));
		name.style.cssText = 'font-size: 12px; font-weight: 600; color: var(--vscode-foreground); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;';
		name.textContent = server.config.name;

		const statusLine = append(info, $('div'));
		statusLine.style.cssText = 'font-size: 11px; color: var(--vscode-descriptionForeground); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-top: 2px;';
		if (server.isConnected) {
			statusLine.textContent = `${server.tools.length} 个工具 · ${server.config.url}`;
		} else if (server.isConnecting) {
			statusLine.textContent = '连接中...';
		} else if (server.error) {
			statusLine.textContent = `错误: ${server.error}`;
			statusLine.style.color = 'var(--vscode-errorForeground)';
		} else {
			statusLine.textContent = server.config.url;
		}

		// 操作按钮
		const actions = append(item, $('div'));
		actions.style.cssText = 'display: flex; gap: 4px; flex-shrink: 0;';

		// 重新连接按钮
		const reconnectBtn = append(actions, $('button.codicon.codicon-refresh')) as HTMLButtonElement;
		reconnectBtn.title = '重新连接';
		reconnectBtn.style.cssText = 'background: transparent; border: none; cursor: pointer; color: var(--vscode-descriptionForeground); padding: 3px; border-radius: 3px; font-size: 13px;';
		reconnectBtn.onclick = async () => {
			reconnectBtn.style.opacity = '0.5';
			await this.maxianService.reconnectMcpServer(server.config.name);
			reconnectBtn.style.opacity = '1';
		};

		// 编辑按钮
		const editBtn = append(actions, $('button.codicon.codicon-edit')) as HTMLButtonElement;
		editBtn.title = '编辑';
		editBtn.style.cssText = 'background: transparent; border: none; cursor: pointer; color: var(--vscode-descriptionForeground); padding: 3px; border-radius: 3px; font-size: 13px;';
		editBtn.onclick = () => this.showMcpServerForm(server.config, refresh);

		// 删除按钮
		const deleteBtn = append(actions, $('button.codicon.codicon-trash')) as HTMLButtonElement;
		deleteBtn.title = '删除';
		deleteBtn.style.cssText = 'background: transparent; border: none; cursor: pointer; color: var(--vscode-errorForeground); padding: 3px; border-radius: 3px; font-size: 13px;';
		deleteBtn.onclick = () => {
			this.maxianService.deleteMcpServer(server.config.name);
		};
	}

	/** 显示添加/编辑 MCP 服务器表单 */
	private showMcpServerForm(existing: McpServerConfig | null, refresh: () => void): void {
		// 弹出表单层
		const overlay = append(this.container, $('div'));
		overlay.style.cssText = `
			position: absolute; top: 0; left: 0; right: 0; bottom: 0;
			background: rgba(0,0,0,0.5); z-index: 300;
			display: flex; align-items: center; justify-content: center;
		`;

		const form = append(overlay, $('div'));
		form.style.cssText = `
			background: var(--vscode-editor-background);
			border: 1px solid var(--vscode-widget-border);
			border-radius: 8px; padding: 20px; width: 380px; max-width: 90%;
			display: flex; flex-direction: column; gap: 12px;
		`;

		const formTitle = append(form, $('div'));
		formTitle.textContent = existing ? '编辑 MCP 服务器' : '添加 MCP 服务器';
		formTitle.style.cssText = 'font-size: 14px; font-weight: 600; color: var(--vscode-foreground); margin-bottom: 4px;';

		const makeField = (label: string, placeholder: string, value: string = '', type = 'text') => {
			const wrapper = append(form, $('div'));
			wrapper.style.cssText = 'display: flex; flex-direction: column; gap: 4px;';
			const lbl = append(wrapper, $('label'));
			lbl.textContent = label;
			lbl.style.cssText = 'font-size: 11px; color: var(--vscode-descriptionForeground);';
			const input = append(wrapper, $('input')) as HTMLInputElement;
			input.type = type;
			input.placeholder = placeholder;
			input.value = value;
			input.style.cssText = `
				padding: 6px 8px; font-size: 12px; border-radius: 4px;
				background: var(--vscode-input-background); color: var(--vscode-input-foreground);
				border: 1px solid var(--vscode-input-border, var(--vscode-widget-border)); outline: none;
			`;
			return input;
		};

		const nameInput = makeField('服务器名称 *', '如: figma', existing?.name || '');
		const urlInput = makeField('服务器 URL *', '如: https://mcp.figma.com/mcp', existing?.url || '');
		const tokenInput = makeField('Authorization Token', 'Bearer <token> 或直接输入 token', existing?.headers?.['Authorization'] || '', 'text');

		// 描述
		const descInput = makeField('描述（可选）', '如: Figma 设计稿读取', existing?.description || '');

		// 启用开关
		const enabledWrapper = append(form, $('div'));
		enabledWrapper.style.cssText = 'display: flex; align-items: center; gap: 8px;';
		const enabledCheck = append(enabledWrapper, $('input')) as HTMLInputElement;
		enabledCheck.type = 'checkbox';
		enabledCheck.checked = existing?.enabled !== false;
		const enabledLabel = append(enabledWrapper, $('label'));
		enabledLabel.textContent = '启用此服务器';
		enabledLabel.style.cssText = 'font-size: 12px; color: var(--vscode-foreground); cursor: pointer;';
		enabledLabel.onclick = () => { enabledCheck.checked = !enabledCheck.checked; };

		// 错误提示
		const errorMsg = append(form, $('div'));
		errorMsg.style.cssText = 'font-size: 11px; color: var(--vscode-errorForeground); display: none;';

		// 按钮
		const btnRow = append(form, $('div'));
		btnRow.style.cssText = 'display: flex; justify-content: flex-end; gap: 8px; margin-top: 4px;';

		const cancelBtn = append(btnRow, $('button'));
		cancelBtn.textContent = '取消';
		cancelBtn.style.cssText = `
			padding: 5px 14px; font-size: 12px; cursor: pointer; border-radius: 4px;
			background: transparent; color: var(--vscode-foreground);
			border: 1px solid var(--vscode-widget-border);
		`;
		cancelBtn.onclick = () => overlay.remove();

		const saveBtn = append(btnRow, $('button'));
		saveBtn.textContent = existing ? '保存' : '添加并连接';
		saveBtn.style.cssText = `
			padding: 5px 14px; font-size: 12px; cursor: pointer; border-radius: 4px;
			background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none;
		`;
		saveBtn.onclick = async () => {
			const name = nameInput.value.trim();
			const url = urlInput.value.trim();
			if (!name || !url) {
				errorMsg.textContent = '服务器名称和 URL 为必填项';
				errorMsg.style.display = 'block';
				return;
			}

			// 构建 headers
			const headers: Record<string, string> = {};
			const token = tokenInput.value.trim();
			if (token) {
				headers['Authorization'] = token.startsWith('Bearer ') ? token : `Bearer ${token}`;
			}

			const config: McpServerConfig = {
				name,
				url,
				headers: Object.keys(headers).length > 0 ? headers : undefined,
				enabled: enabledCheck.checked,
				description: descInput.value.trim() || undefined,
			};

			saveBtn.textContent = '连接中...';
			saveBtn.setAttribute('disabled', 'true');
			try {
				await this.maxianService.saveMcpServer(config);
				overlay.remove();
				refresh();
			} catch (e: any) {
				errorMsg.textContent = `保存失败: ${e?.message || String(e)}`;
				errorMsg.style.display = 'block';
				saveBtn.textContent = existing ? '保存' : '添加并连接';
				saveBtn.removeAttribute('disabled');
			}
		};

		// 点击遮罩关闭
		overlay.addEventListener('click', (e) => {
			if (e.target === overlay) overlay.remove();
		});
	}
}
