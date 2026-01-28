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
import { IMaxianService, type ITokenUsageEvent, type ITaskProgressEvent, type IToolInputStreamingEvent, type IToolCompletedEvent, type ITodoListEvent, type ITodoItem } from './maxianService.js';
import { $, append, clearNode } from '../../../../base/browser/dom.js';
import { IStorageService, StorageScope } from '../../../../platform/storage/common/storage.js';
import { getAllModes, DEFAULT_MODE, type Mode } from '../common/modes/modeTypes.js';
import { MarkdownRendererDom } from './markdownRendererDom.js';
import { FileAccess } from '../../../../base/common/network.js';
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

/**
 * 码弦 Agent 视图面板
 * 基于Kilocode的功能设计，用VSCode内部API重新实现
 */
export class MaxianView extends ViewPane {
	private container!: HTMLElement;
	private messageArea!: HTMLElement;
	private inputBox!: HTMLTextAreaElement;
	private sendButton!: HTMLButtonElement;
	private currentAiMessageElement: HTMLElement | null = null;
	private currentAiMessageText: string = ''; // 累积的原始文本
	private currentMode: Mode = DEFAULT_MODE;
	private modeSelector!: HTMLDivElement; // 模式选择器显示框
	private modeDropdown!: HTMLDivElement; // 模式下拉列表
	private modeDropdownList!: HTMLUListElement; // 模式下拉列表ul
	private modeSelectorArrow!: HTMLSpanElement; // 模式选择器箭头
	private isModeDropdownOpeningUpward: boolean = false; // 模式下拉列表是否向上展开
	private isModeDropdownOpen: boolean = false; // 模式下拉列表是否打开
	private awaitingUserResponse: boolean = false; // 是否正在等待用户回答AI的问题
	private currentToolStatusElement: HTMLElement | null = null; // 当前工具状态元素（更新而非新建）
	private toolStatusElements: Map<string, HTMLElement> = new Map(); // 工具ID到状态元素的映射（支持并行工具）
	private thinkingMessageElement: HTMLElement | null = null; // "正在思考"消息元素（避免重复显示）
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
	// 任务列表相关
	private todoListContainer: HTMLElement | null = null; // 任务列表容器
	private todoListContent: HTMLElement | null = null; // 任务列表内容区域

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
		this.messageArea.style.padding = '16px';
		this.messageArea.style.backgroundColor = 'var(--vscode-editor-background)';

		// 欢迎消息
		const welcome = append(this.messageArea, $('div'));
		this.welcomeElement = welcome; // 保存引用
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

		// ========== 创建输入区域容器（类似 kilocode 的 ChatTextArea） ==========
		const inputContainer = append(this.container, $('div.maxian-input-container'));
		inputContainer.style.display = 'flex';
		inputContainer.style.flexDirection = 'column';
		inputContainer.style.gap = '4px';
		inputContainer.style.borderTop = '1px solid var(--vscode-widget-border)';
		inputContainer.style.backgroundColor = 'var(--vscode-editor-background)';
		inputContainer.style.padding = '8px 12px';
		inputContainer.style.position = 'relative';

		// 输入框容器（相对定位，为负边距控制区提供基准）
		const textAreaWrapper = append(inputContainer, $('div'));
		textAreaWrapper.style.position = 'relative';
		textAreaWrapper.style.display = 'flex';
		textAreaWrapper.style.flexDirection = 'column';
		textAreaWrapper.style.minHeight = '0';
		textAreaWrapper.style.overflow = 'hidden';
		textAreaWrapper.style.borderRadius = '4px';

		// 输入框（底部留出空间给控制区）
		this.inputBox = append(textAreaWrapper, $('textarea')) as HTMLTextAreaElement;
		this.inputBox.placeholder = '输入消息... (Enter 发送, Shift+Enter 换行)';
		this.inputBox.rows = 3;
		this.inputBox.style.width = '100%';
		this.inputBox.style.minHeight = '90px';
		this.inputBox.style.padding = '8px 12px';
		this.inputBox.style.paddingBottom = '50px'; // 为底部控制区留出空间（类似kilocode的pb-16）
		this.inputBox.style.backgroundColor = 'var(--vscode-input-background)';
		this.inputBox.style.color = 'var(--vscode-input-foreground)';
		this.inputBox.style.border = '1px solid var(--vscode-input-border)';
		this.inputBox.style.borderRadius = '4px';
		this.inputBox.style.fontFamily = 'var(--vscode-font-family)';
		this.inputBox.style.fontSize = '13px';
		this.inputBox.style.resize = 'vertical';
		this.inputBox.style.outline = 'none';
		this.inputBox.style.lineHeight = '1.5';
		this.inputBox.style.boxSizing = 'border-box';
		this.inputBox.style.overflowX = 'hidden';
		this.inputBox.style.overflowY = 'auto';
		this.inputBox.style.zIndex = '1';

		// 输入框聚焦效果
		this.inputBox.onfocus = () => {
			this.inputBox.style.borderColor = 'var(--vscode-focusBorder)';
			this.inputBox.style.outline = '1px solid var(--vscode-focusBorder)';
		};
		this.inputBox.onblur = () => {
			this.inputBox.style.borderColor = 'var(--vscode-input-border)';
			this.inputBox.style.outline = 'none';
		};

		// 透明渐变遮罩（避免文本与底部控制区重叠）
		const gradientOverlay = append(textAreaWrapper, $('div'));
		gradientOverlay.style.position = 'absolute';
		gradientOverlay.style.bottom = '1px';
		gradientOverlay.style.left = '8px';
		gradientOverlay.style.right = '8px';
		gradientOverlay.style.height = '48px';
		gradientOverlay.style.background = 'linear-gradient(to top, var(--vscode-input-background), transparent)';
		gradientOverlay.style.pointerEvents = 'none';
		gradientOverlay.style.zIndex = '2';

		// ========== 底部控制栏（使用负边距叠加到输入框底部，类似kilocode） ==========
		const bottomControls = append(textAreaWrapper, $('div'));
		bottomControls.style.marginTop = '-38px'; // 负边距向上叠加（类似kilocode的marginTop: "-38px"）
		bottomControls.style.zIndex = '10'; // 确保在输入框和渐变层之上
		bottomControls.style.paddingLeft = '8px';
		bottomControls.style.paddingRight = '8px';
		bottomControls.style.paddingBottom = '2px';
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
		modeSelectorWrapper.style.flexShrink = '1';
		modeSelectorWrapper.style.minWidth = '90px';
		modeSelectorWrapper.style.maxWidth = '130px';
		modeSelectorWrapper.style.position = 'relative';
		modeSelectorWrapper.style.display = 'flex';
		modeSelectorWrapper.style.alignItems = 'center';
		modeSelectorWrapper.style.zIndex = '100';

		// 模式选择器显示框（自定义div）
		this.modeSelector = append(modeSelectorWrapper, $('div')) as HTMLDivElement;
		this.modeSelector.style.position = 'relative';
		this.modeSelector.style.display = 'flex';
		this.modeSelector.style.alignItems = 'center';
		this.modeSelector.style.height = '34px';
		this.modeSelector.style.padding = '0 28px 0 10px';
		this.modeSelector.style.fontSize = '12px';
		this.modeSelector.style.fontWeight = '400';
		this.modeSelector.style.borderRadius = '8px';
		this.modeSelector.style.backgroundColor = 'var(--vscode-input-background)';
		this.modeSelector.style.color = 'var(--vscode-input-foreground)';
		this.modeSelector.style.border = '1px solid var(--vscode-input-border, rgba(128, 128, 128, 0.35))';
		this.modeSelector.style.cursor = 'pointer';
		this.modeSelector.style.userSelect = 'none';
		this.modeSelector.style.whiteSpace = 'nowrap';
		this.modeSelector.style.overflow = 'hidden';
		this.modeSelector.style.textOverflow = 'ellipsis';
		this.modeSelector.style.boxShadow = '0 1px 3px rgba(0, 0, 0, 0.12)';
		this.modeSelector.style.transition = 'all 0.2s ease';
		this.modeSelector.title = '选择模式';

		// 文本显示span
		const modeTextSpan = append(this.modeSelector, $('span')) as HTMLSpanElement;
		modeTextSpan.textContent = '加载中...';
		modeTextSpan.setAttribute('data-role', 'mode-text');

		// 下拉箭头
		this.modeSelectorArrow = append(this.modeSelector, $('span.codicon.codicon-chevron-down')) as HTMLSpanElement;
		this.modeSelectorArrow.style.position = 'absolute';
		this.modeSelectorArrow.style.right = '8px';
		this.modeSelectorArrow.style.fontSize = '14px';
		this.modeSelectorArrow.style.transition = 'transform 0.2s ease';
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
			console.log('[MaxianView] 模式选择器被点击');
			e.stopPropagation();
			this.isModeDropdownOpen = !this.isModeDropdownOpen;

			if (this.isModeDropdownOpen) {
				console.log('[MaxianView] 打开模式下拉列表');

				// 判断应该向上还是向下展开
				const selectorRect = this.modeSelector.getBoundingClientRect();
				const viewportHeight = window.innerHeight;
				const dropdownMaxHeight = 280;
				const margin = 8;
				const spaceBelow = viewportHeight - selectorRect.bottom - margin;
				const spaceAbove = selectorRect.top - margin;

				let actualMaxHeight = dropdownMaxHeight;

				if (spaceBelow < dropdownMaxHeight && spaceAbove > spaceBelow) {
					// 向上展开
					this.isModeDropdownOpeningUpward = true;
					actualMaxHeight = Math.min(dropdownMaxHeight, spaceAbove);
				} else {
					this.isModeDropdownOpeningUpward = false;
					actualMaxHeight = Math.min(dropdownMaxHeight, spaceBelow);
				}

				// 设置动态的maxHeight和宽度
				this.modeDropdown.style.maxHeight = `${actualMaxHeight}px`;
				this.modeDropdown.style.minWidth = `${selectorRect.width}px`;
				this.modeDropdown.style.width = 'auto';
				this.modeDropdown.style.left = `${selectorRect.left}px`;

				// 根据方向设置位置
				if (this.isModeDropdownOpeningUpward) {
					const bottomPosition = viewportHeight - selectorRect.top + 2;
					this.modeDropdown.style.bottom = `${bottomPosition}px`;
					this.modeDropdown.style.top = 'auto';
					this.modeDropdown.style.transform = 'translateY(8px)';
				} else {
					const topPosition = selectorRect.bottom + 2;
					this.modeDropdown.style.top = `${topPosition}px`;
					this.modeDropdown.style.bottom = 'auto';
					this.modeDropdown.style.transform = 'translateY(-8px)';
				}

				// 显示下拉列表
				this.modeDropdown.style.display = 'block';
				setTimeout(() => {
					this.modeDropdown.style.opacity = '1';
					this.modeDropdown.style.transform = 'translateY(0)';
				}, 10);
				this.modeSelectorArrow.style.transform = 'rotate(180deg)';
				this.modeSelector.style.borderColor = 'var(--vscode-focusBorder, #007ACC)';
				this.modeSelector.style.boxShadow = '0 0 0 2px rgba(0, 122, 204, 0.25)';
			} else {
				console.log('[MaxianView] 关闭模式下拉列表');
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
				this.modeSelector.style.borderColor = 'var(--vscode-focusBorder, #007ACC)';
				this.modeSelector.style.backgroundColor = 'var(--vscode-list-hoverBackground, rgba(90, 93, 94, 0.31))';
				this.modeSelector.style.boxShadow = '0 2px 8px rgba(0, 122, 204, 0.15)';
			}
		};
		this.modeSelector.onmouseleave = () => {
			if (!this.isModeDropdownOpen) {
				this.modeSelector.style.borderColor = 'var(--vscode-input-border, rgba(128, 128, 128, 0.35))';
				this.modeSelector.style.backgroundColor = 'var(--vscode-input-background)';
				this.modeSelector.style.boxShadow = '0 1px 3px rgba(0, 0, 0, 0.12)';
			}
		};

		// 模式列表将在 updateAvailableModes 方法中填充

		// 自定义知识库选择器
		const knowledgeBaseSelectorWrapper = append(leftControls, $('div'));
		knowledgeBaseSelectorWrapper.style.flexShrink = '1';
		knowledgeBaseSelectorWrapper.style.minWidth = '160px';
		knowledgeBaseSelectorWrapper.style.maxWidth = '220px';
		knowledgeBaseSelectorWrapper.style.position = 'relative';
		knowledgeBaseSelectorWrapper.style.zIndex = '100'; // 确保高于其他元素

		// 知识库选择器显示框
		this.knowledgeBaseSelector = append(knowledgeBaseSelectorWrapper, $('div')) as HTMLDivElement;
		this.knowledgeBaseSelector.style.position = 'relative';
		this.knowledgeBaseSelector.style.display = 'flex';
		this.knowledgeBaseSelector.style.alignItems = 'center';
		this.knowledgeBaseSelector.style.height = '34px';
		this.knowledgeBaseSelector.style.padding = '0 32px 0 36px';
		this.knowledgeBaseSelector.style.backgroundColor = 'var(--vscode-input-background)';
		this.knowledgeBaseSelector.style.color = 'var(--vscode-input-foreground)';
		this.knowledgeBaseSelector.style.border = '1px solid var(--vscode-input-border, rgba(128, 128, 128, 0.35))';
		this.knowledgeBaseSelector.style.borderRadius = '8px';
		this.knowledgeBaseSelector.style.fontFamily = 'var(--vscode-font-family)';
		this.knowledgeBaseSelector.style.fontSize = '12px';
		this.knowledgeBaseSelector.style.fontWeight = '400';
		this.knowledgeBaseSelector.style.cursor = 'pointer';
		this.knowledgeBaseSelector.style.transition = 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)';
		this.knowledgeBaseSelector.style.boxShadow = '0 1px 3px rgba(0, 0, 0, 0.12)';
		this.knowledgeBaseSelector.style.userSelect = 'none';
		this.knowledgeBaseSelector.title = '点击选择知识库';

		// 知识库图标
		const kbIcon = append(this.knowledgeBaseSelector, $('span.codicon.codicon-database'));
		kbIcon.style.position = 'absolute';
		kbIcon.style.left = '12px';
		kbIcon.style.color = 'var(--vscode-charts-blue, #007ACC)';
		kbIcon.style.fontSize = '16px';
		kbIcon.style.transition = 'all 0.2s ease';

		// 文本显示span
		const kbTextSpan = append(this.knowledgeBaseSelector, $('span')) as HTMLSpanElement;
		kbTextSpan.textContent = '加载中...';
		kbTextSpan.style.flex = '1';
		kbTextSpan.style.overflow = 'hidden';
		kbTextSpan.style.textOverflow = 'ellipsis';
		kbTextSpan.style.whiteSpace = 'nowrap';
		kbTextSpan.setAttribute('data-role', 'kb-text');

		// 下拉箭头
		this.knowledgeBaseSelectorArrow = append(this.knowledgeBaseSelector, $('span.codicon.codicon-chevron-down')) as HTMLSpanElement;
		this.knowledgeBaseSelectorArrow.style.position = 'absolute';
		this.knowledgeBaseSelectorArrow.style.right = '10px';
		this.knowledgeBaseSelectorArrow.style.fontSize = '14px';
		this.knowledgeBaseSelectorArrow.style.color = 'var(--vscode-descriptionForeground)';
		this.knowledgeBaseSelectorArrow.style.transition = 'transform 0.2s ease';

		// 下拉列表容器（使用fixed定位，脱离文档流，不受父容器限制）
		this.knowledgeBaseDropdown = append(knowledgeBaseSelectorWrapper, $('div')) as HTMLDivElement;
		this.knowledgeBaseDropdown.style.position = 'fixed'; // 改为fixed定位
		// 注意：不在这里设置top/bottom/left/right，在点击时动态计算绝对位置
		this.knowledgeBaseDropdown.style.maxHeight = '280px';
		this.knowledgeBaseDropdown.style.backgroundColor = 'var(--vscode-dropdown-background)';
		this.knowledgeBaseDropdown.style.border = '1px solid var(--vscode-dropdown-border, rgba(128, 128, 128, 0.4))';
		this.knowledgeBaseDropdown.style.borderRadius = '8px';
		this.knowledgeBaseDropdown.style.boxShadow = '0 8px 24px rgba(0, 0, 0, 0.25), 0 0 0 1px rgba(0, 0, 0, 0.08)';
		this.knowledgeBaseDropdown.style.overflowY = 'auto';
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
			console.log('[MaxianView] 知识库选择器被点击');
			e.stopPropagation();
			this.isKnowledgeBaseDropdownOpen = !this.isKnowledgeBaseDropdownOpen;
			console.log('[MaxianView] isDropdownOpen:', this.isKnowledgeBaseDropdownOpen);

			if (this.isKnowledgeBaseDropdownOpen) {
				console.log('[MaxianView] 打开下拉列表');
				console.log('[MaxianView] dropdown元素:', this.knowledgeBaseDropdown);
				console.log('[MaxianView] 列表项数量:', this.knowledgeBaseDropdownList.children.length);

				// 判断应该向上还是向下展开
				const selectorRect = this.knowledgeBaseSelector.getBoundingClientRect();
				const viewportHeight = window.innerHeight;
				const dropdownMaxHeight = 280; // 下拉列表默认最大高度
				const margin = 8; // 与边界的安全边距
				const spaceBelow = viewportHeight - selectorRect.bottom - margin; // 选择器下方的可用空间
				const spaceAbove = selectorRect.top - margin; // 选择器上方的可用空间（避免被输入框挡住）

				console.log('[MaxianView] 窗口高度:', viewportHeight);
				console.log('[MaxianView] 选择器位置:', selectorRect.top, '-', selectorRect.bottom);
				console.log('[MaxianView] 下方可用空间:', spaceBelow, 'px, 上方可用空间:', spaceAbove, 'px');

				let actualMaxHeight = dropdownMaxHeight;

				if (spaceBelow < dropdownMaxHeight && spaceAbove > spaceBelow) {
					// 下方空间不足且上方空间更大，向上展开
					this.isDropdownOpeningUpward = true;
					actualMaxHeight = Math.min(dropdownMaxHeight, spaceAbove); // 使用上方实际可用空间
					console.log('[MaxianView] 向上展开下拉列表, maxHeight:', actualMaxHeight);
				} else {
					this.isDropdownOpeningUpward = false;
					actualMaxHeight = Math.min(dropdownMaxHeight, spaceBelow); // 使用下方实际可用空间
					console.log('[MaxianView] 向下展开下拉列表, maxHeight:', actualMaxHeight);
				}

				// 清除之前的top/bottom设置
				this.knowledgeBaseDropdown.style.top = '';
				this.knowledgeBaseDropdown.style.bottom = '';
				this.knowledgeBaseDropdown.style.left = '';
				this.knowledgeBaseDropdown.style.right = '';

				// 设置动态的maxHeight和宽度
				this.knowledgeBaseDropdown.style.maxHeight = `${actualMaxHeight}px`;
				this.knowledgeBaseDropdown.style.width = `${selectorRect.width}px`;
				this.knowledgeBaseDropdown.style.left = `${selectorRect.left}px`;

				// 根据方向设置位置和初始transform（使用fixed定位的绝对坐标）
				if (this.isDropdownOpeningUpward) {
					// 向上展开：设置bottom为距离窗口底部的距离
					const bottomPosition = viewportHeight - selectorRect.top + 2; // 2px间隙
					this.knowledgeBaseDropdown.style.bottom = `${bottomPosition}px`;
					this.knowledgeBaseDropdown.style.transform = 'translateY(8px)'; // 向下偏移8px（动画效果）
					console.log('[MaxianView] 设置bottom定位:', bottomPosition, 'px');
				} else {
					// 向下展开：设置top为选择器底部位置
					const topPosition = selectorRect.bottom + 2; // 2px间隙
					this.knowledgeBaseDropdown.style.top = `${topPosition}px`;
					this.knowledgeBaseDropdown.style.transform = 'translateY(-8px)'; // 向上偏移8px（动画效果）
					console.log('[MaxianView] 设置top定位:', topPosition, 'px');
				}

				// 设置display: block（但保持opacity: 0）
				this.knowledgeBaseDropdown.style.display = 'block';
				console.log('[MaxianView] 设置display为block');

				// 强制浏览器重新计算布局（触发reflow）
				const forceReflow = this.knowledgeBaseDropdown.offsetHeight;
				console.log('[MaxianView] 强制reflow完成, offsetHeight:', forceReflow);

				// 使用requestAnimationFrame确保在下一帧设置opacity，让transition生效
				requestAnimationFrame(() => {
					this.knowledgeBaseDropdown.style.opacity = '1';
					this.knowledgeBaseDropdown.style.transform = 'translateY(0)';
					console.log('[MaxianView] 下拉列表显示完成');

					// transition完成后检查位置
					setTimeout(() => {
						const rect = this.knowledgeBaseDropdown.getBoundingClientRect();
						console.log('[MaxianView] 下拉列表最终位置:', 'top:', rect.top, 'bottom:', rect.bottom);
						console.log('[MaxianView] 下拉列表是否在可视区域:', rect.top >= 0 && rect.bottom <= window.innerHeight);
					}, 250);
				});
				this.knowledgeBaseSelectorArrow.style.transform = 'rotate(180deg)';
				this.knowledgeBaseSelector.style.borderColor = 'var(--vscode-focusBorder, #007ACC)';
				this.knowledgeBaseSelector.style.boxShadow = '0 0 0 2px rgba(0, 122, 204, 0.25)';
			} else {
				console.log('[MaxianView] 关闭下拉列表');
				this.closeKnowledgeBaseDropdown();
			}
		};

		// 点击外部关闭下拉列表
		document.addEventListener('click', (e) => {
			if (this.isKnowledgeBaseDropdownOpen && !knowledgeBaseSelectorWrapper.contains(e.target as Node)) {
				this.isKnowledgeBaseDropdownOpen = false;
				this.closeKnowledgeBaseDropdown();
			}
		});

		// Hover效果
		this.knowledgeBaseSelector.onmouseenter = () => {
			if (!this.isKnowledgeBaseDropdownOpen) {
				this.knowledgeBaseSelector.style.borderColor = 'var(--vscode-focusBorder, #007ACC)';
				this.knowledgeBaseSelector.style.backgroundColor = 'var(--vscode-list-hoverBackground, rgba(90, 93, 94, 0.31))';
				this.knowledgeBaseSelector.style.boxShadow = '0 2px 8px rgba(0, 122, 204, 0.15)';
			}
			kbIcon.style.color = 'var(--vscode-focusBorder, #007ACC)';
			kbIcon.style.transform = 'scale(1.05)';
		};
		this.knowledgeBaseSelector.onmouseleave = () => {
			if (!this.isKnowledgeBaseDropdownOpen) {
				this.knowledgeBaseSelector.style.borderColor = 'var(--vscode-input-border, rgba(128, 128, 128, 0.35))';
				this.knowledgeBaseSelector.style.backgroundColor = 'var(--vscode-input-background)';
				this.knowledgeBaseSelector.style.boxShadow = '0 1px 3px rgba(0, 0, 0, 0.12)';
			}
			kbIcon.style.color = 'var(--vscode-charts-blue, #007ACC)';
			kbIcon.style.transform = 'scale(1)';
		};

		// 加载知识库列表
		this.loadKnowledgeBases();

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
			console.log('[MaxianView] 刷新按钮被点击');
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
			console.log('[MaxianView] 连续对话模式:', this.isContinuousConversation ? '已启用' : '已禁用');
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
			const message = this.inputBox.value.trim();
			if (message) {
				// 清除欢迎消息（使用成员变量，支持清空对话后重新创建的欢迎界面）
				if (this.welcomeElement && this.welcomeElement.parentElement) {
					this.welcomeElement.remove();
					this.welcomeElement = null;
				}

				// 检查是否在等待用户回答AI的问题
				if (this.awaitingUserResponse) {
					// 显示用户的回答
					const userMsg = append(this.messageArea, $('div'));
					userMsg.style.marginBottom = '10px';
					userMsg.style.padding = '10px 15px';
					userMsg.style.backgroundColor = 'var(--vscode-textCodeBlock-background)';
					userMsg.style.borderRadius = '6px';
					userMsg.style.borderLeft = '3px solid var(--vscode-textLink-foreground)';

					const userLabel = append(userMsg, $('div'));
					userLabel.style.fontWeight = '600';
					userLabel.style.marginBottom = '6px';
					userLabel.style.color = 'var(--vscode-textLink-foreground)';
					userLabel.style.fontSize = '13px';
					userLabel.textContent = '👤 你的回答';

					const userContent = append(userMsg, $('div'));
					userContent.style.whiteSpace = 'pre-wrap';
					userContent.style.wordBreak = 'break-word';
					userContent.style.color = 'var(--vscode-foreground)';
					userContent.style.lineHeight = '1.5';
					userContent.textContent = message;

					this.messageArea.scrollTop = this.messageArea.scrollHeight;

					// 提交用户回复
					this.maxianService.submitUserResponse(message);

					// 恢复正常状态
					this.awaitingUserResponse = false;
					this.inputBox.placeholder = '输入消息... (Enter 发送, Shift+Enter 换行)';
				} else {
					// 正常发送消息
					this.sendMessage(message);
				}

				this.inputBox.value = '';
				this.inputBox.style.height = 'auto';
			}
		};

		// 输入框回车事件（Shift+Enter换行，Enter发送）
		this.inputBox.onkeydown = (e) => {
			if (e.key === 'Enter' && !e.shiftKey) {
				e.preventDefault();
				this.sendButton.click();
			}
		};

		// 自动调整输入框高度
		this.inputBox.oninput = () => {
			this.inputBox.style.height = 'auto';
			const newHeight = this.inputBox.scrollHeight;
			this.inputBox.style.height = newHeight + 'px';
		};
	}

	/**
	 * 添加Markdown和代码高亮样式
	 */
	private addStyles(): void {
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

			/* ========== 优化：消息气泡样式 ========== */
			.maxian-message {
				margin-bottom: 12px;
				padding: 12px 16px;
				border-radius: 12px;
				position: relative;
				transition: box-shadow 0.2s ease;
			}

			.maxian-message:hover {
				box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
			}

			.maxian-message-ai {
				background: linear-gradient(135deg,
					var(--vscode-editor-inactiveSelectionBackground) 0%,
					rgba(var(--vscode-charts-blue-rgb, 66, 133, 244), 0.08) 100%);
				border-left: 4px solid var(--vscode-charts-blue);
			}

			.maxian-message-user {
				background: linear-gradient(135deg,
					var(--vscode-textCodeBlock-background) 0%,
					rgba(var(--vscode-textLink-foreground-rgb, 66, 133, 244), 0.08) 100%);
				border-left: 4px solid var(--vscode-textLink-foreground);
			}

			/* 消息头部 */
			.maxian-message-header {
				display: flex;
				align-items: center;
				gap: 8px;
				margin-bottom: 8px;
			}

			.maxian-message-avatar {
				width: 24px;
				height: 24px;
				border-radius: 6px;
				object-fit: contain;
				flex-shrink: 0;
			}

			.maxian-message-sender {
				font-weight: 600;
				font-size: 13px;
				flex: 1;
			}

			.maxian-message-time {
				font-size: 10px;
				color: var(--vscode-descriptionForeground);
				opacity: 0;
				transition: opacity 0.2s ease;
			}

			.maxian-message:hover .maxian-message-time {
				opacity: 1;
			}

			.maxian-message-actions {
				display: flex;
				gap: 4px;
				opacity: 0;
				transition: opacity 0.2s ease;
			}

			.maxian-message:hover .maxian-message-actions {
				opacity: 1;
			}

			.maxian-action-btn {
				background: transparent;
				border: none;
				cursor: pointer;
				padding: 4px;
				border-radius: 4px;
				color: var(--vscode-descriptionForeground);
				transition: all 0.15s ease;
			}

			.maxian-action-btn:hover {
				background: var(--vscode-toolbar-hoverBackground);
				color: var(--vscode-foreground);
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

			/* ========== 滚动条美化 ========== */
			.maxian-messages::-webkit-scrollbar {
				width: 8px;
			}

			.maxian-messages::-webkit-scrollbar-track {
				background: transparent;
			}

			.maxian-messages::-webkit-scrollbar-thumb {
				background: var(--vscode-scrollbarSlider-background);
				border-radius: 4px;
			}

			.maxian-messages::-webkit-scrollbar-thumb:hover {
				background: var(--vscode-scrollbarSlider-hoverBackground);
			}
		`;
		this.container.appendChild(style);
	}

	private async sendMessage(message: string): Promise<void> {
		// 调用maxianService发送消息，传递当前模式
		// maxianService会通过onMessage事件通知UI更新

		// 如果是 ask 模式，且选中了知识库，则传递知识库配置
		let knowledgeBaseConfig: import('./maxianService.js').IKnowledgeBaseConfig | undefined;
		if (this.currentMode === 'ask') {
			// 如果没有启用连续对话，重置conversation_id（开始新对话）
			if (!this.isContinuousConversation) {
				this.maxianService.resetAskConversation();
				console.log('[MaxianView] 未启用连续对话，已重置会话ID');
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
					console.log('[MaxianView] 使用知识库配置:', knowledgeBaseConfig.apiUrl);
				}
			}
		}

		await this.maxianService.sendMessage(message, this.currentMode, knowledgeBaseConfig);
	}

	private handleMessageEvent(event: import('./maxianService.js').IMessageEvent): void {

		if (event.type === 'user') {
			// 用户发送新消息时，重置AI消息元素（开始新一轮对话）
			this.currentAiMessageElement = null;
			this.currentAiMessageText = '';
			this.currentToolStatusElement = null;

			// 显示用户消息 - 使用优化后的样式
			const userMsg = append(this.messageArea, $('div.maxian-message.maxian-message-user'));

			// 消息头部
			const userHeader = append(userMsg, $('div.maxian-message-header'));

			// 用户头像（使用 codicon）
			const userAvatar = append(userHeader, $('div'));
			userAvatar.style.width = '24px';
			userAvatar.style.height = '24px';
			userAvatar.style.borderRadius = '6px';
			userAvatar.style.background = 'var(--vscode-textLink-foreground)';
			userAvatar.style.display = 'flex';
			userAvatar.style.alignItems = 'center';
			userAvatar.style.justifyContent = 'center';
			const userIcon = append(userAvatar, $('span.codicon.codicon-account'));
			userIcon.style.color = 'var(--vscode-button-foreground)';
			userIcon.style.fontSize = '14px';

			// 发送者名称
			const userSender = append(userHeader, $('span.maxian-message-sender'));
			userSender.style.color = 'var(--vscode-textLink-foreground)';
			userSender.textContent = '你';

			// 时间戳
			const userTime = append(userHeader, $('span.maxian-message-time'));
			userTime.textContent = formatTime(Date.now());

			// 操作按钮区域
			const userActions = append(userHeader, $('div.maxian-message-actions'));
			const msgContent = event.content;
			createCopyButton(userActions, () => msgContent);

			// 消息内容
			const userContent = append(userMsg, $('div'));
			userContent.style.whiteSpace = 'pre-wrap';
			userContent.style.wordBreak = 'break-word';
			userContent.style.color = 'var(--vscode-foreground)';
			userContent.style.lineHeight = '1.5';
			userContent.textContent = event.content;

			this.messageArea.scrollTop = this.messageArea.scrollHeight;
		} else if (event.type === 'assistant') {
			// 如果是流式消息
			if (event.isPartial) {
				if (!this.currentAiMessageElement) {

					// 创建新的AI消息元素
					const aiMsg = append(this.messageArea, $('div'));
					aiMsg.style.marginBottom = '10px';
					aiMsg.style.padding = '10px 15px';
					aiMsg.style.backgroundColor = 'var(--vscode-editor-inactiveSelectionBackground)';
					aiMsg.style.borderRadius = '6px';
					aiMsg.style.borderLeft = '3px solid var(--vscode-charts-blue)';

					const aiLabel = append(aiMsg, $('div'));
					aiLabel.style.fontWeight = '600';
					aiLabel.style.marginBottom = '6px';
					aiLabel.style.fontSize = '13px';
					aiLabel.style.color = 'var(--vscode-charts-blue)';
					aiLabel.style.display = 'flex';
					aiLabel.style.alignItems = 'center';
					aiLabel.style.gap = '6px';

					const aiIcon = append(aiLabel, $('img')) as HTMLImageElement;
					aiIcon.src = FileAccess.asBrowserUri('vs/workbench/contrib/maxian/browser/media/icons/maxian-avatar.png').toString(true);
					aiIcon.style.width = '18px';
					aiIcon.style.height = '18px';
					aiIcon.style.objectFit = 'contain'; // 防止拉伸
					aiIcon.style.borderRadius = '3px';

					const aiText = append(aiLabel, $('span'));
					aiText.textContent = '码弦';

					const aiContent = append(aiMsg, $('div'));
					aiContent.style.color = 'var(--vscode-foreground)';
					aiContent.style.lineHeight = '1.6';
					aiContent.style.fontFamily = 'var(--vscode-font-family)';

					// 累积原始文本
					this.currentAiMessageText = event.content;

					// 实时渲染Markdown
					MarkdownRendererDom.renderMarkdown(this.currentAiMessageText, aiContent);

					this.currentAiMessageElement = aiContent;
				} else {
					// 累积内容
					this.currentAiMessageText += event.content;

					// 实时渲染Markdown
					MarkdownRendererDom.renderMarkdown(this.currentAiMessageText, this.currentAiMessageElement);
				}
			} else {
				// 流式结束，重置
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
		this.inputBox.placeholder = '💬 正在回答码弦的问题... (Enter 发送, Shift+Enter 换行)';
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

		switch (sayType) {
			case 'text':
				// 文本消息 - 使用Markdown渲染
				this.renderTextMessage(message.text || '', message.partial);
				break;

			case 'reasoning':
				// Reasoning/思考过程 - 使用可折叠的思考块展示
				this.renderReasoningMessage(message.reasoning || message.text || '', message.partial);
				break;

			case 'completion_result':
				// 完成结果 - 显示给用户查看
				this.renderCompletionResult(message.text || '');
				break;

			case 'error':
				// 错误消息
				this.renderErrorMessage(message.text || '未知错误');
				break;

			case 'api_req_started':
				// API请求开始 - 显示思考状态，避免前端卡住的感觉
				// 如果已有思考消息，先移除旧的
				if (this.thinkingMessageElement && this.thinkingMessageElement.parentNode) {
					this.thinkingMessageElement.parentNode.removeChild(this.thinkingMessageElement);
				}
				// 显示新的思考消息
				this.thinkingMessageElement = this.renderSystemMessage('🤔 码弦正在思考...');
				break;

			case 'api_req_finished':
				// API请求完成 - 移除思考状态消息
				if (this.thinkingMessageElement && this.thinkingMessageElement.parentNode) {
					this.thinkingMessageElement.parentNode.removeChild(this.thinkingMessageElement);
					this.thinkingMessageElement = null;
				}
				break;

			case 'api_req_retried':
				// API请求重试
				this.renderSystemMessage('🔄 正在重试API请求...');
				break;

			case 'user_feedback':
				// 用户反馈
				this.renderUserFeedback(message.text || '', message.images);
				break;

			case 'tool':
				// 工具执行状态 - 显示正在执行什么工具
				this.renderToolExecutionStatus(message.text || '');
				break;

			case 'condense_context':
				// 上下文压缩 - 显示压缩状态
				this.renderCondenseContext(message);
				break;

			case 'system_internal':
				// 🔧 系统内部消息 - 静默处理，不显示在UI（避免系统提示泄露）
				console.log('[MaxianView] 系统内部消息（已过滤）:', message.text?.substring(0, 50));
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
			return;
		}

		// 当AI开始输出文本时，清除工具状态元素的引用（保留UI但停止更新）
		if (this.currentToolStatusElement) {
			this.clearToolStatusElement();
		}

		if (!this.currentAiMessageElement) {
			// 创建新的AI消息元素 - 使用优化后的样式
			const aiMsg = append(this.messageArea, $('div.maxian-message.maxian-message-ai'));

			// 消息头部
			const aiHeader = append(aiMsg, $('div.maxian-message-header'));

			// 头像
			const aiIcon = append(aiHeader, $('img.maxian-message-avatar')) as HTMLImageElement;
			aiIcon.src = FileAccess.asBrowserUri('vs/workbench/contrib/maxian/browser/media/icons/maxian-avatar.png').toString(true);

			// 发送者名称
			const aiSender = append(aiHeader, $('span.maxian-message-sender'));
			aiSender.style.color = 'var(--vscode-charts-blue)';
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
	 * 渲染用户反馈消息
	 */
	private renderUserFeedback(text: string, images?: string[]): void {
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
				case 'edit':
					actionText = '应用差异';
					detailText = toolInfo.path || toolInfo.file_path || '';
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
				case 'webfetch':
				case 'web_fetch':
					actionText = '获取网页';
					detailText = toolInfo.url || '';
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
		this.currentToolStatusElement = null;

		// 重置等待状态
		this.awaitingUserResponse = false;
		this.inputBox.placeholder = '输入消息... (Enter 发送, Shift+Enter 换行)';

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
		// 创建token统计显示
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

		this.messageArea.scrollTop = this.messageArea.scrollHeight;
	}

	/**
	 * 处理对话清空事件
	 */
	private handleConversationCleared(): void {
		// 重置所有状态
		this.currentAiMessageElement = null;
		this.currentAiMessageText = '';
		this.currentToolStatusElement = null;
		this.awaitingUserResponse = false;
		this.inputBox.placeholder = '输入消息... (Enter 发送, Shift+Enter 换行)';

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
			yesButton.disabled = true;
			noButton.disabled = true;
			yesButton.textContent = '已接受';
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
			yesButton.disabled = true;
			noButton.disabled = true;
			noButton.textContent = '已拒绝';
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
		const toolMsg = append(this.messageArea, $('div'));
		toolMsg.style.marginBottom = '10px';

		// 尝试解析JSON格式的工具信息
		let toolInfo: { tool?: string; path?: string; diff?: string; content?: string; command?: string; originalContent?: string; newContent?: string; operationCount?: number } | null = null;
		try {
			if (message.text) {
				toolInfo = JSON.parse(message.text);
			}
		} catch {
			// 解析失败，使用原始文本
			toolInfo = null;
		}

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
		const approveButton = append(buttonContainer, $('button')) as HTMLButtonElement;
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
			alwaysAllowButton.disabled = true;
			approveButton.textContent = '正在保存...';

			await this.maxianService.saveDiffAndClose();
			this.maxianService.handleAskResponse(message.ts, 'yesButtonClicked');
			toolMsg.remove();
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
			alwaysAllowButton.disabled = true;
			denyButton.textContent = '正在关闭...';

			await this.maxianService.closeDiffWithoutSave();
			this.maxianService.handleAskResponse(message.ts, 'noButtonClicked');
			toolMsg.remove();
		};

		// 始终允许按钮
		const currentToolName = toolInfo?.tool || '';
		const alwaysAllowButton = append(buttonContainer, $('button')) as HTMLButtonElement;
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

			if (currentToolName) {
				this.maxianService.setToolAutoApprove(currentToolName, true);
			}

			await this.maxianService.saveDiffAndClose();
			this.maxianService.handleAskResponse(message.ts, 'yesButtonClicked');
			toolMsg.remove();
		};

		this.messageArea.scrollTop = this.messageArea.scrollHeight;
	}

	/**
	 * 渲染命令批准请求（ask command）
	 * 优化：添加展开/折叠功能
	 */
	private renderCommandApproval(message: ClineMessage): void {
		const cmdMsg = append(this.messageArea, $('div'));
		cmdMsg.style.marginBottom = '10px';

		// 提取命令摘要（取前50个字符）
		const cmdText = message.text || '';
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
			console.log('[MaxianView] Knowledge bases response:', result);

			// 支持数字和字符串类型的code
			if ((result.code === 200 || result.code === '200') && result.data) {
				this.knowledgeBases = result.data;
				console.log('[MaxianView] Loaded', this.knowledgeBases.length, 'knowledge bases');
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
		console.log('[MaxianView] 更新知识库选择器,共', this.knowledgeBases.length, '个知识库');
		if (!this.knowledgeBaseDropdownList) {
			console.warn('[MaxianView] knowledgeBaseDropdownList is not initialized');
			return;
		}

		// 清除所有现有列表项
		while (this.knowledgeBaseDropdownList.firstChild) {
			this.knowledgeBaseDropdownList.removeChild(this.knowledgeBaseDropdownList.firstChild);
		}

		// 添加知识库列表项
		this.knowledgeBases.forEach((kb, index) => {
			const li = append(this.knowledgeBaseDropdownList, $('li')) as HTMLLIElement;
			li.style.padding = '10px 16px';
			li.style.cursor = 'pointer';
			li.style.transition = 'all 0.15s ease';
			li.style.display = 'flex';
			li.style.alignItems = 'center';
			li.style.gap = '10px';
			li.style.borderRadius = '4px';
			li.style.margin = '2px 6px';
			li.style.fontSize = '12px';
			li.setAttribute('data-kb-id', kb.id);

			// 知识库图标
			const icon = append(li, $('span.codicon.codicon-database'));
			icon.style.color = 'var(--vscode-charts-blue, #007ACC)';
			icon.style.fontSize = '14px';
			icon.style.flexShrink = '0';

			// 知识库名称
			const name = append(li, $('span'));
			name.textContent = kb.applicationName;
			name.style.flex = '1';
			name.style.overflow = 'hidden';
			name.style.textOverflow = 'ellipsis';
			name.style.whiteSpace = 'nowrap';

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
				}
				console.log('[MaxianView] Selected knowledge base:', kb.applicationName);

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

			console.log('[MaxianView] 已自动选择第一个知识库:', this.knowledgeBases[0].applicationName);
		} else {
			// 没有知识库时，清空选择并更新UI
			this.selectedKnowledgeBaseId = null;
			const textSpan = this.knowledgeBaseSelector.querySelector('[data-role="kb-text"]') as HTMLSpanElement;
			if (textSpan) {
				textSpan.textContent = '无可用知识库';
			}
			console.warn('[MaxianView] 没有可用的知识库');
		}
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
		this.knowledgeBaseSelector.style.borderColor = 'var(--vscode-input-border, rgba(128, 128, 128, 0.35))';
		this.knowledgeBaseSelector.style.boxShadow = '0 1px 3px rgba(0, 0, 0, 0.12)';
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
		this.modeSelector.style.borderColor = 'var(--vscode-input-border, rgba(128, 128, 128, 0.35))';
		this.modeSelector.style.boxShadow = '0 1px 3px rgba(0, 0, 0, 0.12)';
	}

	/**
	 * 更新可用模式 - 根据用户权限动态调整
	 */
	private updateAvailableModes(): void {
		if (!this.modeSelector || !this.modeDropdownList) {
			return; // 如果选择器还未创建,跳过
		}

		console.log('[MaxianView] 更新可用模式列表');

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
			'code': '💻',
			'architect': '🏗️',
			'ask': '❓',
			'debug': '🔧',
			'orchestrator': '🎯'
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
			const icon = append(li, $('span'));
			icon.textContent = modeIconMap[mode.slug] || '📝';
			icon.style.fontSize = '14px';
			icon.style.flexShrink = '0';

			// 模式名称
			const name = append(li, $('span'));
			name.textContent = mode.name;
			name.style.flex = '1';
			name.style.overflow = 'hidden';
			name.style.textOverflow = 'ellipsis';
			name.style.whiteSpace = 'nowrap';

			// 选中标记（默认隐藏）
			const checkmark = append(li, $('span.codicon.codicon-check'));
			checkmark.style.color = 'var(--vscode-charts-green, #4EC9B0)';
			checkmark.style.fontSize = '14px';
			checkmark.style.opacity = '0';
			checkmark.style.transition = 'opacity 0.2s ease';
			checkmark.style.flexShrink = '0';
			checkmark.style.width = '14px';
			checkmark.style.textAlign = 'center';

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
					textSpan.textContent = `${modeIconMap[mode.slug] || '📝'} ${mode.name}`;
				}

				console.log('[MaxianView] Selected mode:', mode.slug);

				// 控制连续对话复选框的显示（仅ask模式显示）
				if (this.currentMode === 'ask') {
					this.continuousConversationWrapper.style.display = 'flex';
				} else {
					this.continuousConversationWrapper.style.display = 'none';
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
				const icon = modeIconMap[currentModeInfo.slug] || '📝';
				textSpan.textContent = `${icon} ${currentModeInfo.name}`;
			}
		}

		console.log('[MaxianView] Updated available modes:', availableModes.map(m => m.slug), 'Current mode:', this.currentMode);
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
		console.log('[MaxianView] 工具输入流式:', event.toolName, event.isPartial);

		// 获取或创建显示元素
		let streamingElement = this.toolInputStreamingElements.get(event.toolId);

		if (!streamingElement) {
			// 创建新的流式显示元素
			streamingElement = $('div.tool-input-streaming');
			streamingElement.style.cssText = `
				padding: 8px 12px;
				margin: 4px 0;
				background: var(--vscode-inputValidation-infoBackground, rgba(0, 127, 255, 0.1));
				border-left: 3px solid var(--vscode-inputValidation-infoBorder, #007acc);
				border-radius: 4px;
				font-size: 12px;
				font-family: var(--vscode-editor-font-family, monospace);
				overflow: hidden;
			`;

			// 创建标题行
			const headerRow = $('div.tool-input-header');
			headerRow.style.cssText = `
				display: flex;
				align-items: center;
				gap: 8px;
				margin-bottom: 4px;
				color: var(--vscode-foreground);
			`;

			// 工具图标
			const iconSpan = $('span.tool-icon');
			iconSpan.textContent = getToolIcon(event.toolName as any);
			headerRow.appendChild(iconSpan);

			// 工具名称
			const nameSpan = $('span.tool-name');
			nameSpan.textContent = event.toolName;
			nameSpan.style.fontWeight = '600';
			headerRow.appendChild(nameSpan);

			// 流式指示器
			const streamingIndicator = $('span.streaming-indicator');
			streamingIndicator.textContent = '⏳ 接收参数中...';
			streamingIndicator.style.cssText = `
				font-size: 11px;
				color: var(--vscode-descriptionForeground);
				margin-left: auto;
			`;
			headerRow.appendChild(streamingIndicator);

			streamingElement.appendChild(headerRow);

			// 创建参数显示区域
			const inputArea = $('div.tool-input-content');
			inputArea.style.cssText = `
				max-height: 150px;
				overflow-y: auto;
				white-space: pre-wrap;
				word-break: break-all;
				color: var(--vscode-editor-foreground);
				opacity: 0.9;
				padding: 4px 0;
			`;
			streamingElement.appendChild(inputArea);

			// 将元素添加到消息区域
			this.messageArea.appendChild(streamingElement);
			this.toolInputStreamingElements.set(event.toolId, streamingElement);

			// 自动滚动到底部
			this.messageArea.scrollTop = this.messageArea.scrollHeight;
		}

		// 更新参数内容
		const inputArea = streamingElement.querySelector('.tool-input-content') as HTMLElement;
		if (inputArea && event.input) {
			try {
				// 格式化输入参数
				let inputText: string;
				if (typeof event.input === 'string') {
					inputText = event.input;
				} else {
					inputText = JSON.stringify(event.input, null, 2);
				}

				// 截断过长的输入
				if (inputText.length > 500) {
					inputText = inputText.substring(0, 500) + '\n... (已截断)';
				}

				inputArea.textContent = inputText;
			} catch (e) {
				inputArea.textContent = String(event.input);
			}
		}

		// 更新流式指示器
		const streamingIndicator = streamingElement.querySelector('.streaming-indicator') as HTMLElement;
		if (streamingIndicator) {
			if (event.isPartial) {
				streamingIndicator.textContent = '⏳ 接收参数中...';
				streamingIndicator.style.color = 'var(--vscode-charts-blue, #007acc)';
			} else {
				streamingIndicator.textContent = '✓ 参数已完成';
				streamingIndicator.style.color = 'var(--vscode-charts-green, #89d185)';

				// 完成后2秒移除流式显示（工具结果会替代它）
				setTimeout(() => {
					const element = this.toolInputStreamingElements.get(event.toolId);
					if (element && element.parentNode) {
						element.parentNode.removeChild(element);
						this.toolInputStreamingElements.delete(event.toolId);
					}
				}, 1500);
			}
		}
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
		console.log('[MaxianView] 工具完成:', event.toolName, event.isError ? '(失败)' : '(成功)');

		// 通过toolId查找对应的工具状态元素
		const toolStatusElement = this.toolStatusElements.get(event.toolId);
		if (!toolStatusElement) {
			console.warn('[MaxianView] 未找到toolId对应的状态元素:', event.toolId);
			return;
		}

		// 🔧 如果是成功完成（非错误），根据工具类型决定是否自动移除
		if (!event.isError) {
			// 对于以下工具类型，成功后自动移除（不需要用户看结果）
			const autoRemoveTools = new Set([
				'batch',           // batch工具：子工具结果已在各自卡片显示
				'skill',           // skill工具：仅加载技能，无需显示
				'new_task',        // 新建任务：结果在任务列表显示
				'update_todo_list' // 更新任务列表：结果在任务列表显示
			]);

			if (autoRemoveTools.has(event.toolName)) {
				// 短暂显示完成状态，然后自动移除
				toolStatusElement.classList.remove('tool-running');
				toolStatusElement.classList.add('tool-completed');

				// 添加淡出动画
				toolStatusElement.style.transition = 'opacity 0.5s ease-out';
				setTimeout(() => {
					toolStatusElement.style.opacity = '0';
				}, 1000); // 1秒后开始淡出

				// 1.5秒后移除元素
				setTimeout(() => {
					toolStatusElement.remove();
					this.toolStatusElements.delete(event.toolId);
					console.log('[MaxianView] 工具卡片已自动移除:', event.toolId);
				}, 1500);
				return;
			}

			// 其他工具：更新为完成状态但保留显示（用户可能需要查看结果）
			toolStatusElement.classList.remove('tool-running');
			toolStatusElement.classList.add('tool-completed');

			// 停止图标旋转动画
			const iconElement = toolStatusElement.querySelector('.tool-status-icon') as HTMLElement;
			if (iconElement) {
				iconElement.classList.remove('codicon-modifier-spin');
			}

			// 隐藏加载动画
			const loadingDots = toolStatusElement.querySelector('.tool-loading-dots') as HTMLElement;
			if (loadingDots) {
				loadingDots.style.display = 'none';
			}

			// 显示"完成"状态标签
			const statusBadge = toolStatusElement.querySelector('.tool-status-badge') as HTMLElement;
			if (statusBadge) {
				statusBadge.textContent = '完成';
				statusBadge.style.display = 'inline-block';
				statusBadge.classList.remove('maxian-tool-status-running', 'maxian-tool-status-error');
				statusBadge.classList.add('maxian-tool-status-completed');
			}

			console.log('[MaxianView] 工具完成状态已更新（保留显示）:', event.toolId);
			return;
		}

		// 🔧 如果是错误，保留显示错误状态
		const finalStatus = 'error';
		const statusText = '失败';

		// 更新卡片状态类
		toolStatusElement.classList.remove('tool-running', 'tool-completed', 'tool-error');
		toolStatusElement.classList.add(`tool-${finalStatus}`);

		// 停止图标旋转动画
		const iconElement = toolStatusElement.querySelector('.tool-status-icon') as HTMLElement;
		if (iconElement) {
			iconElement.classList.remove('codicon-modifier-spin');
		}

		// 隐藏加载动画
		const loadingDots = toolStatusElement.querySelector('.tool-loading-dots') as HTMLElement;
		if (loadingDots) {
			loadingDots.style.display = 'none';
		}

		// 显示并更新状态标签
		const statusBadge = toolStatusElement.querySelector('.tool-status-badge') as HTMLElement;
		if (statusBadge) {
			statusBadge.textContent = statusText;
			statusBadge.style.display = 'inline-block';
			statusBadge.classList.remove('maxian-tool-status-running', 'maxian-tool-status-completed', 'maxian-tool-status-error');
			statusBadge.classList.add(`maxian-tool-status-${finalStatus}`);
		}

		console.log('[MaxianView] 工具错误状态已更新:', event.toolId, finalStatus);
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
			console.log('[MaxianView] 任务列表折叠状态:', isCollapsed);
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
		console.log('[MaxianView] 任务列表更新:', event.todos.length, '项');

		if (!this.todoListContainer || !this.todoListContent) {
			return;
		}

		// 显示容器
		this.todoListContainer.style.display = 'block';

		// 计算完成数
		const completedCount = event.todos.filter(t => t.status === 'completed').length;
		const totalCount = event.todos.length;

		// 更新徽章
		const badge = this.todoListContainer.querySelector('.todo-list-badge') as HTMLElement;
		if (badge) {
			badge.textContent = `${completedCount}/${totalCount}`;
			if (completedCount === totalCount && totalCount > 0) {
				badge.style.background = 'var(--vscode-charts-green)';
			} else {
				badge.style.background = 'var(--vscode-badge-background)';
			}
		}

		// 更新进度信息
		const progressInfo = this.todoListContainer.querySelector('.todo-list-progress-info') as HTMLElement;
		if (progressInfo) {
			const percent = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;
			if (completedCount === totalCount && totalCount > 0) {
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
		this.renderTodoList(event.todos);

		console.log('[MaxianView] 任务列表渲染完成，todos:', event.todos);
	}

	/**
	 * 渲染任务列表内容
	 */
	private renderTodoList(todos: ITodoItem[]): void {
		console.log('[MaxianView] renderTodoList 开始, todos数量:', todos.length, 'todoListContent存在:', !!this.todoListContent);

		if (!this.todoListContent) {
			console.log('[MaxianView] todoListContent 不存在，退出');
			return;
		}

		// 清空现有内容
		clearNode(this.todoListContent);
		console.log('[MaxianView] 已清空内容，开始渲染');

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
			console.log(`[MaxianView] 渲染任务 ${index + 1}:`, todo.content, '状态:', todo.status);
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
			content.style.cssText = `
				flex: 1;
				font-size: 12px;
				line-height: 1.5;
				color: ${todo.status === 'completed' ? 'var(--vscode-descriptionForeground)' : 'var(--vscode-foreground)'};
				${todo.status === 'completed' ? 'text-decoration: line-through;' : ''}
			`;

			// 显示内容或进行中描述
			if (todo.status === 'in_progress' && todo.activeForm) {
				content.textContent = todo.activeForm;
				content.style.fontWeight = '500';
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
		this.clearToolInputStreaming();
		this.clearTodoList();
		super.dispose();
	}
}
