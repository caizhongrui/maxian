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
import { IMaxianService } from './maxianService.js';
import { $, append } from '../../../../base/browser/dom.js';
import { ISecretStorageService } from '../../../../platform/secrets/common/secrets.js';
import { getAllModes, DEFAULT_MODE, type Mode } from '../common/modes/modeTypes.js';
import { MarkdownRendererDom } from './markdownRendererDom.js';
import { FileAccess } from '../../../../base/common/network.js';
import { ClineMessage } from '../common/task/taskTypes.js';
import { IAuthService } from '../../auth/common/authService.js';

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
		@ISecretStorageService private readonly secretStorageService: ISecretStorageService,
		@IAuthService private readonly authService: IAuthService
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

		// ========== 创建消息区域 ==========
		this.messageArea = append(this.container, $('div.maxian-messages'));
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
		modeSelectorWrapper.style.minWidth = '80px';
		modeSelectorWrapper.style.maxWidth = '110px';
		modeSelectorWrapper.style.position = 'relative';
		modeSelectorWrapper.style.display = 'flex';
		modeSelectorWrapper.style.alignItems = 'center';
		modeSelectorWrapper.style.zIndex = '100';

		// 模式图标
		const modeIcon = append(modeSelectorWrapper, $('span.codicon.codicon-symbol-event'));
		modeIcon.style.position = 'absolute';
		modeIcon.style.left = '8px';
		modeIcon.style.pointerEvents = 'none';
		modeIcon.style.color = 'var(--vscode-charts-blue, #007ACC)';
		modeIcon.style.fontSize = '14px';
		modeIcon.style.zIndex = '1';
		modeIcon.style.transition = 'all 0.2s ease';

		// 模式选择器显示框（自定义div）
		this.modeSelector = append(modeSelectorWrapper, $('div')) as HTMLDivElement;
		this.modeSelector.style.position = 'relative';
		this.modeSelector.style.display = 'flex';
		this.modeSelector.style.alignItems = 'center';
		this.modeSelector.style.height = '34px';
		this.modeSelector.style.padding = '0 32px 0 36px';
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
				this.modeDropdown.style.width = `${selectorRect.width}px`;
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
			modeIcon.style.color = 'var(--vscode-focusBorder, #007ACC)';
			modeIcon.style.transform = 'scale(1.05)';
		};
		this.modeSelector.onmouseleave = () => {
			if (!this.isModeDropdownOpen) {
				this.modeSelector.style.borderColor = 'var(--vscode-input-border, rgba(128, 128, 128, 0.35))';
				this.modeSelector.style.backgroundColor = 'var(--vscode-input-background)';
				this.modeSelector.style.boxShadow = '0 1px 3px rgba(0, 0, 0, 0.12)';
			}
			modeIcon.style.color = 'var(--vscode-charts-blue, #007ACC)';
			modeIcon.style.transform = 'scale(1)';
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

			/* 代码高亮样式 */
			.markdown-content .keyword {
				color: #569cd6;
				font-weight: 600;
			}

			.markdown-content .string {
				color: #ce9178;
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

			.markdown-content .class {
				color: #4ec9b0;
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
		`;
		this.container.appendChild(style);
	}

	private async sendMessage(message: string): Promise<void> {
		// 调用maxianService发送消息，传递当前模式
		// maxianService会通过onMessage事件通知UI更新

		// 如果是 ask 模式，且选中了知识库，则传递知识库配置
		let knowledgeBaseConfig: import('./maxianService.js').IKnowledgeBaseConfig | undefined;
		if (this.currentMode === 'ask' && this.selectedKnowledgeBaseId) {
			// 从知识库列表中找到选中的知识库
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

		await this.maxianService.sendMessage(message, this.currentMode, knowledgeBaseConfig);
	}

	private handleMessageEvent(event: import('./maxianService.js').IMessageEvent): void {

		if (event.type === 'user') {
			// 用户发送新消息时，重置AI消息元素（开始新一轮对话）
			this.currentAiMessageElement = null;
			this.currentAiMessageText = '';

			// 显示用户消息
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
			userLabel.textContent = '👤 你';

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

			// 解析工具信息（格式：正在执行工具: xxx\n参数: {...}）
			const lines = event.content.split('\n');
			const toolNameLine = lines[0] || '';
			const toolName = toolNameLine.replace('正在执行工具: ', '').trim();
			const paramsLine = lines.slice(1).join('\n'); // 参数部分（包括"参数: "前缀）

			// ========== kilocode风格的工具显示 ==========
			// Header区域（类似kilocode的headerStyle）
			const toolHeader = append(this.messageArea, $('div'));
			toolHeader.style.display = 'flex';
			toolHeader.style.alignItems = 'center';
			toolHeader.style.gap = '10px';
			toolHeader.style.marginBottom = '10px';
			toolHeader.style.wordBreak = 'break-word';

			// 工具图标（使用codicon）
			const toolIcon = append(toolHeader, $('span.codicon.codicon-tools'));
			toolIcon.style.color = 'var(--vscode-foreground)';
			toolIcon.style.marginBottom = '-1.5px';
			toolIcon.style.fontSize = '16px';

			// 工具标题（粗体）
			const toolTitle = append(toolHeader, $('span'));
			toolTitle.style.fontWeight = 'bold';
			toolTitle.textContent = `正在执行工具: ${toolName}`;

			// 内容区域（类似kilocode的pl-6，paddingLeft: 1.5rem = 24px）
			const toolContentWrapper = append(this.messageArea, $('div'));
			toolContentWrapper.style.paddingLeft = '24px';
			toolContentWrapper.style.marginBottom = '10px';

			// ToolUseBlock容器
			const toolUseBlock = append(toolContentWrapper, $('div'));
			toolUseBlock.style.overflow = 'hidden';
			toolUseBlock.style.borderRadius = '6px';
			toolUseBlock.style.padding = '8px';
			toolUseBlock.style.cursor = 'pointer';
			toolUseBlock.style.backgroundColor = 'var(--vscode-editor-background)';
			toolUseBlock.style.border = '1px solid var(--vscode-widget-border)';

			// ToolUseBlockHeader - 显示参数
			const toolUseHeader = append(toolUseBlock, $('div'));
			toolUseHeader.style.display = 'flex';
			toolUseHeader.style.fontFamily = 'var(--vscode-editor-font-family)'; // 等宽字体
			toolUseHeader.style.alignItems = 'center';
			toolUseHeader.style.userSelect = 'text'; // 允许选择
			toolUseHeader.style.fontSize = '12px';
			toolUseHeader.style.color = 'var(--vscode-descriptionForeground)';
			toolUseHeader.style.whiteSpace = 'pre-wrap';
			toolUseHeader.style.wordBreak = 'break-word';
			toolUseHeader.style.lineHeight = '1.5';
			toolUseHeader.textContent = paramsLine;

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

			case 'completion_result':
				// 完成结果 - 显示给用户查看
				this.renderCompletionResult(message.text || '');
				break;

			case 'error':
				// 错误消息
				this.renderErrorMessage(message.text || '未知错误');
				break;

			case 'api_req_started':
				// API请求开始 - 静默处理，不在UI中显示（与kilocode一致）
				break;

			case 'api_req_finished':
				// API请求完成 - 静默处理（kilocode不再使用api_req_finished）
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
	 */
	private renderTextMessage(text: string, partial?: boolean): void {
		if (!text && !partial) {
			// 流结束信号
			this.currentAiMessageElement = null;
			this.currentAiMessageText = '';
			return;
		}

		// 当AI开始输出文本时，清除工具状态元素的引用（保留UI但停止更新）
		if (this.currentToolStatusElement) {
			this.clearToolStatusElement();
		}

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
			aiIcon.style.objectFit = 'contain';
			aiIcon.style.borderRadius = '3px';

			const aiText = append(aiLabel, $('span'));
			aiText.textContent = '码弦';

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
	 * 渲染完成结果（用于completion_result say消息）
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
		resultContent.style.whiteSpace = 'pre-wrap';
		resultContent.style.wordBreak = 'break-word';
		resultContent.style.color = 'var(--vscode-foreground)';
		resultContent.style.lineHeight = '1.6';
		resultContent.textContent = result;

		this.messageArea.scrollTop = this.messageArea.scrollHeight;
	}

	/**
	 * 渲染错误消息
	 */
	private renderErrorMessage(error: string): void {
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
		errorContent.textContent = error;

		this.messageArea.scrollTop = this.messageArea.scrollHeight;
	}

	/**
	 * 渲染系统消息
	 */
	private renderSystemMessage(message: string): void {
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
	 */
	private renderToolExecutionStatus(toolStatusJson: string): void {
		try {
			const toolInfo = JSON.parse(toolStatusJson);

			// 根据工具类型确定图标和标题
			let iconClass = 'codicon-tools';
			let statusText = '正在执行工具...';
			let detailText = '';

			switch (toolInfo.tool) {
				case 'readFile':
					iconClass = 'codicon-file-code';
					statusText = '正在读取文件';
					detailText = toolInfo.path || '';
					break;
				case 'listFiles':
					iconClass = 'codicon-folder-opened';
					statusText = '正在列出文件';
					detailText = toolInfo.path || '';
					break;
				case 'searchFiles':
					iconClass = 'codicon-search';
					statusText = '正在搜索文件';
					detailText = toolInfo.path ? `${toolInfo.path} (${toolInfo.regex})` : toolInfo.regex;
					break;
				case 'writeToFile':
					iconClass = 'codicon-new-file';
					statusText = '正在写入文件';
					detailText = toolInfo.path || '';
					break;
				case 'applyDiff':
					iconClass = 'codicon-diff';
					statusText = '正在应用差异';
					detailText = toolInfo.path || '';
					break;
				case 'executeCommand':
					iconClass = 'codicon-terminal';
					statusText = '正在执行命令';
					detailText = toolInfo.command || '';
					break;
				case 'askFollowupQuestion':
					iconClass = 'codicon-comment-discussion';
					statusText = '正在提问';
					detailText = '';
					break;
				case 'attemptCompletion':
					iconClass = 'codicon-check';
					statusText = '正在完成任务';
					detailText = '';
					break;
				case 'insertContent':
					iconClass = 'codicon-add';
					statusText = '正在插入内容';
					detailText = toolInfo.path || '';
					break;
				case 'searchAndReplace':
					iconClass = 'codicon-find-replace';
					statusText = '正在搜索替换';
					detailText = toolInfo.path || '';
					break;
				default:
					statusText = `正在执行 ${toolInfo.tool}`;
					detailText = toolInfo.params ? toolInfo.params.join(', ') : '';
			}

			// 如果已有工具状态元素，更新内容而不是创建新的
			if (this.currentToolStatusElement) {
				// 更新图标
				const iconElement = this.currentToolStatusElement.querySelector('.tool-status-icon') as HTMLElement;
				if (iconElement) {
					iconElement.className = `codicon ${iconClass} tool-status-icon`;
				}

				// 更新状态文本
				const textElement = this.currentToolStatusElement.querySelector('.tool-status-text') as HTMLElement;
				if (textElement) {
					textElement.textContent = statusText;
				}

				// 更新详情
				const detailElement = this.currentToolStatusElement.querySelector('.tool-status-detail') as HTMLElement;
				if (detailElement) {
					detailElement.textContent = detailText;
					detailElement.style.display = detailText ? 'block' : 'none';
				}
			} else {
				// 创建新的工具状态元素
				const toolStatusContainer = append(this.messageArea, $('div'));
				toolStatusContainer.style.marginBottom = '10px';
				toolStatusContainer.style.padding = '8px 12px';
				toolStatusContainer.style.backgroundColor = 'var(--vscode-editor-background)';
				toolStatusContainer.style.border = '1px solid var(--vscode-widget-border)';
				toolStatusContainer.style.borderRadius = '6px';
				toolStatusContainer.style.display = 'flex';
				toolStatusContainer.style.flexDirection = 'column';
				toolStatusContainer.style.gap = '4px';

				// 状态行（图标 + 状态文本）
				const statusRow = append(toolStatusContainer, $('div'));
				statusRow.style.display = 'flex';
				statusRow.style.alignItems = 'center';
				statusRow.style.gap = '8px';

				// 图标（带旋转动画表示进行中）
				const toolIcon = append(statusRow, $(`span.codicon.${iconClass}.tool-status-icon`));
				toolIcon.style.color = 'var(--vscode-charts-blue)';
				toolIcon.style.fontSize = '14px';

				// 状态文本
				const toolText = append(statusRow, $('span.tool-status-text'));
				toolText.style.fontSize = '13px';
				toolText.style.color = 'var(--vscode-foreground)';
				toolText.style.fontWeight = '500';
				toolText.textContent = statusText;

				// 加载指示器（三个点动画）
				const loadingDots = append(statusRow, $('span'));
				loadingDots.style.color = 'var(--vscode-descriptionForeground)';
				loadingDots.style.marginLeft = '4px';
				loadingDots.textContent = '...';
				loadingDots.style.animation = 'blink 1s infinite';

				// 详情行（文件路径等）
				const detailRow = append(toolStatusContainer, $('div.tool-status-detail'));
				detailRow.style.fontSize = '12px';
				detailRow.style.color = 'var(--vscode-descriptionForeground)';
				detailRow.style.fontFamily = 'var(--vscode-editor-font-family)';
				detailRow.style.marginLeft = '22px'; // 与图标对齐
				detailRow.style.wordBreak = 'break-all';
				detailRow.textContent = detailText;
				detailRow.style.display = detailText ? 'block' : 'none';

				this.currentToolStatusElement = toolStatusContainer;

				// 添加blink动画样式
				const styleId = 'maxian-tool-status-animation';
				if (!document.getElementById(styleId)) {
					const style = document.createElement('style');
					style.id = styleId;
					style.textContent = `
						@keyframes blink {
							0%, 100% { opacity: 1; }
							50% { opacity: 0.3; }
						}
					`;
					document.head.appendChild(style);
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
		this.currentToolStatusElement = null;
	}

	/**
	 * 处理任务取消事件
	 */
	private handleTaskCancelled(): void {
		// 重置当前AI消息状态
		this.currentAiMessageElement = null;
		this.currentAiMessageText = '';
		this.currentToolStatusElement = null;

		// 重置等待状态
		this.awaitingUserResponse = false;
		this.inputBox.placeholder = '输入消息... (Enter 发送, Shift+Enter 换行)';

		// 静默处理，不显示任何提示消息
		// 滚动到底部
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
				// 禁用输入和按钮
				inputArea.disabled = true;
				submitButton.disabled = true;
				submitButton.textContent = '已提交';
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
			feedbackButton.disabled = true;
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
			feedbackButton.disabled = true;
			noButton.textContent = '已拒绝';
		};

		// Feedback按钮
		const feedbackButton = append(buttonContainer, $('button')) as HTMLButtonElement;
		feedbackButton.textContent = '💬 提供反馈';
		feedbackButton.style.padding = '6px 16px';
		feedbackButton.style.backgroundColor = 'var(--vscode-button-secondaryBackground)';
		feedbackButton.style.color = 'var(--vscode-button-secondaryForeground)';
		feedbackButton.style.border = 'none';
		feedbackButton.style.borderRadius = '4px';
		feedbackButton.style.cursor = 'pointer';
		feedbackButton.onclick = () => {
			// 显示反馈输入框
			feedbackInput.style.display = 'block';
			submitFeedbackButton.style.display = 'block';
			feedbackButton.disabled = true;
		};

		// 反馈输入框（初始隐藏）
		const feedbackInput = append(confirmMsg, $('textarea')) as HTMLTextAreaElement;
		feedbackInput.placeholder = '请输入你的反馈...';
		feedbackInput.rows = 3;
		feedbackInput.style.width = '100%';
		feedbackInput.style.padding = '8px';
		feedbackInput.style.backgroundColor = 'var(--vscode-input-background)';
		feedbackInput.style.color = 'var(--vscode-input-foreground)';
		feedbackInput.style.border = '1px solid var(--vscode-input-border)';
		feedbackInput.style.borderRadius = '4px';
		feedbackInput.style.fontFamily = 'var(--vscode-font-family)';
		feedbackInput.style.fontSize = '13px';
		feedbackInput.style.marginBottom = '8px';
		feedbackInput.style.resize = 'vertical';
		feedbackInput.style.display = 'none';

		// 提交反馈按钮（初始隐藏）
		const submitFeedbackButton = append(confirmMsg, $('button')) as HTMLButtonElement;
		submitFeedbackButton.textContent = '提交反馈';
		submitFeedbackButton.style.padding = '6px 16px';
		submitFeedbackButton.style.backgroundColor = 'var(--vscode-button-background)';
		submitFeedbackButton.style.color = 'var(--vscode-button-foreground)';
		submitFeedbackButton.style.border = 'none';
		submitFeedbackButton.style.borderRadius = '4px';
		submitFeedbackButton.style.cursor = 'pointer';
		submitFeedbackButton.style.fontWeight = '600';
		submitFeedbackButton.style.display = 'none';
		submitFeedbackButton.onclick = () => {
			const feedback = feedbackInput.value.trim();
			if (feedback) {
				this.maxianService.handleAskResponse(message.ts, 'messageResponse', feedback);
				yesButton.disabled = true;
				noButton.disabled = true;
				feedbackButton.disabled = true;
				feedbackInput.disabled = true;
				submitFeedbackButton.disabled = true;
				submitFeedbackButton.textContent = '已提交反馈';
			}
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

		const failedLabel = append(failedMsg, $('div'));
		failedLabel.style.fontWeight = '700';
		failedLabel.style.marginBottom = '8px';
		failedLabel.style.fontSize = '14px';
		failedLabel.style.color = 'var(--vscode-errorForeground)';
		failedLabel.textContent = '⚠️ API请求失败';

		const failedContent = append(failedMsg, $('div'));
		failedContent.style.marginBottom = '12px';
		failedContent.style.color = 'var(--vscode-foreground)';
		failedContent.textContent = message.text || 'API请求失败，是否重试？';

		// 按钮容器
		const buttonContainer = append(failedMsg, $('div'));
		buttonContainer.style.display = 'flex';
		buttonContainer.style.gap = '8px';

		// Retry按钮
		const retryButton = append(buttonContainer, $('button')) as HTMLButtonElement;
		retryButton.textContent = '🔄 重试';
		retryButton.style.padding = '6px 16px';
		retryButton.style.backgroundColor = 'var(--vscode-button-background)';
		retryButton.style.color = 'var(--vscode-button-foreground)';
		retryButton.style.border = 'none';
		retryButton.style.borderRadius = '4px';
		retryButton.style.cursor = 'pointer';
		retryButton.style.fontWeight = '600';
		retryButton.onclick = () => {
			this.maxianService.handleAskResponse(message.ts, 'yesButtonClicked');
			retryButton.disabled = true;
			cancelButton.disabled = true;
			retryButton.textContent = '正在重试...';
		};

		// Cancel按钮
		const cancelButton = append(buttonContainer, $('button')) as HTMLButtonElement;
		cancelButton.textContent = '❌ 取消';
		cancelButton.style.padding = '6px 16px';
		cancelButton.style.backgroundColor = 'var(--vscode-button-secondaryBackground)';
		cancelButton.style.color = 'var(--vscode-button-secondaryForeground)';
		cancelButton.style.border = 'none';
		cancelButton.style.borderRadius = '4px';
		cancelButton.style.cursor = 'pointer';
		cancelButton.onclick = () => {
			this.maxianService.handleAskResponse(message.ts, 'noButtonClicked');
			retryButton.disabled = true;
			cancelButton.disabled = true;
			cancelButton.textContent = '已取消';
		};

		this.messageArea.scrollTop = this.messageArea.scrollHeight;
	}

	/**
	 * 渲染工具批准请求（ask tool）
	 * 解析JSON格式的工具信息，以diff模式显示文件修改
	 */
	private renderToolApproval(message: ClineMessage): void {
		const toolMsg = append(this.messageArea, $('div'));
		toolMsg.style.marginBottom = '10px';
		toolMsg.style.padding = '12px 16px';
		toolMsg.style.backgroundColor = 'var(--vscode-editor-inactiveSelectionBackground)';
		toolMsg.style.border = '2px solid var(--vscode-widget-border)';
		toolMsg.style.borderRadius = '8px';

		const toolLabel = append(toolMsg, $('div'));
		toolLabel.style.fontWeight = '700';
		toolLabel.style.marginBottom = '8px';
		toolLabel.style.fontSize = '14px';
		toolLabel.style.color = 'var(--vscode-foreground)';
		toolLabel.textContent = '🔧 工具使用确认';

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

		if (toolInfo && toolInfo.tool) {
			// 显示工具类型
			const toolTypeLabel = append(toolMsg, $('div'));
			toolTypeLabel.style.marginBottom = '8px';
			toolTypeLabel.style.fontSize = '13px';
			toolTypeLabel.style.color = 'var(--vscode-descriptionForeground)';

			switch (toolInfo.tool) {
				case 'appliedDiff':
					toolTypeLabel.textContent = '📝 应用差异修改';
					break;
				case 'newFileCreated':
					toolTypeLabel.textContent = '📄 创建新文件';
					break;
				case 'editedExistingFile':
					toolTypeLabel.textContent = '✏️ 编辑现有文件';
					break;
				case 'insertContent':
					toolTypeLabel.textContent = '➕ 插入内容';
					break;
				case 'searchAndReplace':
					toolTypeLabel.textContent = '🔍 搜索替换';
					break;
				default:
					toolTypeLabel.textContent = `🔧 ${toolInfo.tool}`;
			}

			// 显示文件路径
			if (toolInfo.path) {
				const pathContainer = append(toolMsg, $('div'));
				pathContainer.style.marginBottom = '12px';
				pathContainer.style.display = 'flex';
				pathContainer.style.alignItems = 'center';
				pathContainer.style.gap = '6px';
				pathContainer.style.overflow = 'hidden'; // 防止溢出

				const pathIcon = append(pathContainer, $('span.codicon.codicon-file'));
				pathIcon.style.color = 'var(--vscode-textLink-foreground)';
				pathIcon.style.fontSize = '14px';
				pathIcon.style.flexShrink = '0'; // 图标不缩小

				const pathText = append(pathContainer, $('span'));
				pathText.style.fontFamily = 'var(--vscode-editor-font-family)';
				pathText.style.fontSize = '13px';
				pathText.style.color = 'var(--vscode-textLink-foreground)';
				pathText.style.fontWeight = '600';
				pathText.style.overflow = 'hidden';
				pathText.style.textOverflow = 'ellipsis';
				pathText.style.whiteSpace = 'nowrap';
				pathText.title = toolInfo.path; // 鼠标悬停显示完整路径
				pathText.textContent = toolInfo.path;

				// 自动打开diff视图（在编辑器中显示）
				const filePath = toolInfo.path;
				if (toolInfo.diff) {
					// 对于apply_diff工具，在编辑器中打开diff视图
					const diffContent = toolInfo.diff;
					this.maxianService.applyDiffView(filePath, diffContent).catch(() => {
						// Diff视图打开失败
					});
				} else if (toolInfo.content) {
					// 对于新文件创建，在编辑器中打开diff视图
					const newContent = toolInfo.content;
					this.maxianService.openDiffView(filePath, newContent).catch(() => {
						// 新文件视图打开失败
					});
				} else if (toolInfo.originalContent && toolInfo.newContent) {
					// 对于search_and_replace工具，显示搜索替换的对比
					// 这里我们直接使用openDiffView，传入新内容
					// 由于search_and_replace是对文件的部分修改，我们不能直接打开完整文件的diff
					// 暂时显示操作数量
					const operationInfo = append(toolMsg, $('div'));
					operationInfo.style.marginBottom = '8px';
					operationInfo.style.fontSize = '12px';
					operationInfo.style.color = 'var(--vscode-descriptionForeground)';
					operationInfo.textContent = `共 ${toolInfo.operationCount || 0} 个替换操作`;
				}
			}

			// 显示简化的提示信息
			const infoLabel = append(toolMsg, $('div'));
			infoLabel.style.marginBottom = '12px';
			infoLabel.style.fontSize = '12px';
			infoLabel.style.color = 'var(--vscode-descriptionForeground)';
			infoLabel.style.fontStyle = 'italic';
			infoLabel.textContent = '💡 完整的差异视图已在左侧编辑器中打开';
		} else {
			// 无法解析，显示原始文本
			const toolContent = append(toolMsg, $('div'));
			toolContent.style.marginBottom = '12px';
			toolContent.style.whiteSpace = 'pre-wrap';
			toolContent.style.wordBreak = 'break-word';
			toolContent.style.color = 'var(--vscode-foreground)';
			toolContent.textContent = message.text || '是否允许执行此工具？';
		}

		// 按钮容器
		const buttonContainer = append(toolMsg, $('div'));
		buttonContainer.style.display = 'flex';
		buttonContainer.style.gap = '8px';

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
		approveButton.onclick = () => {
			this.maxianService.handleAskResponse(message.ts, 'yesButtonClicked');
			approveButton.disabled = true;
			denyButton.disabled = true;
			approveButton.textContent = '已批准';
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
			this.maxianService.handleAskResponse(message.ts, 'noButtonClicked');
			approveButton.disabled = true;
			denyButton.disabled = true;
			denyButton.textContent = '已拒绝';
		};

		this.messageArea.scrollTop = this.messageArea.scrollHeight;
	}

	/**
	 * 渲染命令批准请求（ask command）
	 */
	private renderCommandApproval(message: ClineMessage): void {
		const cmdMsg = append(this.messageArea, $('div'));
		cmdMsg.style.marginBottom = '10px';
		cmdMsg.style.padding = '12px 16px';
		cmdMsg.style.backgroundColor = 'var(--vscode-editor-inactiveSelectionBackground)';
		cmdMsg.style.border = '2px solid var(--vscode-widget-border)';
		cmdMsg.style.borderRadius = '8px';

		const cmdLabel = append(cmdMsg, $('div'));
		cmdLabel.style.fontWeight = '700';
		cmdLabel.style.marginBottom = '8px';
		cmdLabel.style.fontSize = '14px';
		cmdLabel.style.color = 'var(--vscode-foreground)';
		cmdLabel.textContent = '⌨️ 命令执行确认';

		const cmdContent = append(cmdMsg, $('div'));
		cmdContent.style.marginBottom = '12px';
		cmdContent.style.whiteSpace = 'pre-wrap';
		cmdContent.style.wordBreak = 'break-word';
		cmdContent.style.fontFamily = 'var(--vscode-editor-font-family)';
		cmdContent.style.backgroundColor = 'var(--vscode-textCodeBlock-background)';
		cmdContent.style.padding = '8px';
		cmdContent.style.borderRadius = '4px';
		cmdContent.style.color = 'var(--vscode-foreground)';
		cmdContent.textContent = message.text || '';

		// 按钮容器
		const buttonContainer = append(cmdMsg, $('div'));
		buttonContainer.style.display = 'flex';
		buttonContainer.style.gap = '8px';

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
			this.maxianService.handleAskResponse(message.ts, 'yesButtonClicked');
			allowButton.disabled = true;
			denyButton.disabled = true;
			allowButton.textContent = '已允许';
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
			this.maxianService.handleAskResponse(message.ts, 'noButtonClicked');
			allowButton.disabled = true;
			denyButton.disabled = true;
			denyButton.textContent = '已拒绝';
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
			const username = this.configurationService.getValue<string>('zhikai.auth.username');
			// 密码存储在 secretStorageService 中
			const password = await this.secretStorageService.get('zhikai.auth.password');

			if (!apiUrl || !username || !password) {
				console.debug('[MaxianView] API credentials not configured, skipping knowledge base loading');
				// 清空知识库列表并更新UI
				this.knowledgeBases = [];
				this.updateKnowledgeBaseSelector();
				return;
			}

			// 构建认证头（浏览器环境使用btoa）
			const credentials = btoa(`${username}:${password}`);

			// 调用知识库API（POST请求，参数通过URL传递，请求体包含Base64编码的用户名密码）
			const baseUrl = apiUrl.replace(/\/$/, '');
			const response = await fetch(`${baseUrl}/knowledge/knowledgeApplication/listByUser?applicationStatus=0`, {
				method: 'POST',
				headers: {
					'Authorization': `Basic ${credentials}`,
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

	override dispose(): void {
		super.dispose();
	}
}
