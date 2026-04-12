/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { EditorPane } from '../../../browser/parts/editor/editorPane.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { IEditorGroup } from '../../../services/editor/common/editorGroupsService.js';
import { IWorkbenchLayoutService, Parts } from '../../../services/layout/browser/layoutService.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { ConfigurationTarget } from '../../../../platform/configuration/common/configuration.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { IEditorOptions } from '../../../../platform/editor/common/editor.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { Dimension, IDomPosition } from '../../../../base/browser/dom.js';
import { $, append, safeInnerHtml } from '../../../../base/browser/dom.js';
import { IMaxianService, IMessageEvent, ITodoListEvent, ITokenUsageEvent } from './maxianService.js';
import { SoloEditorInput } from './soloEditorInput.js';
import { ClineMessage } from '../common/task/taskTypes.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IEditorWillOpenEvent } from '../../../common/editor.js';
import { URI } from '../../../../base/common/uri.js';
import { ILifecycleService } from '../../../services/lifecycle/common/lifecycle.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { ITerminalService } from '../../terminal/browser/terminal.js';
import { SoloTerminalPanel } from './soloTerminalPanel.js';
import { createCopyButton } from './uiUtils.js';

/**
 * Solo 模式编辑器面板
 *
 * 布局（三栏 + VSCode 原生侧边栏右置）：
 * ┌──────────┬─────────────────────┬──────────────┐  ┌──────────────┐
 * │ 会话列表  │   AI 对话（中间）    │  实时跟随     │  │ 原生侧边栏    │
 * │（左栏）   │                     │（Tab 文件）   │  │（资源管理器等）│
 * └──────────┴─────────────────────┴──────────────┘  └──────────────┘
 */
/**
 * Solo 会话恢复用的 DOMPurify 配置：在默认白名单基础上追加 table 等标签和自定义 data 属性，
 * 避免 sessions.json 中保存的表格、图片等 HTML 被消毒移除。
 */
const SOLO_SESSION_PURIFY_CONFIG = {
	ALLOWED_TAGS: [
		// 默认白名单
		'a', 'button', 'blockquote', 'code', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
		'hr', 'input', 'label', 'li', 'p', 'pre', 'select', 'small', 'span', 'strong',
		'textarea', 'ul', 'ol',
		// Solo markdown 渲染会用到的额外标签
		'table', 'thead', 'tbody', 'tr', 'th', 'td',
		'em', 'b', 'i', 'br', 'img', 'mark', 'del', 'sub', 'sup',
	],
	ALLOWED_ATTR: [
		// 默认白名单
		'href', 'data-href', 'data-command', 'target', 'title', 'name', 'src', 'alt',
		'class', 'id', 'role', 'tabindex', 'style', 'data-code', 'width', 'height',
		'align', 'x-dispatch', 'required', 'checked', 'placeholder', 'type', 'start',
		// Solo 自定义属性
		'data-finalized', 'data-session-id', 'data-tool-id',
	],
};

export class SoloEditorPane extends EditorPane {

	static readonly ID = SoloEditorInput.EditorID;

	// ─── DOM 根节点 ────────────────────────────────────────
	private container!: HTMLElement;

	// ─── 状态字段（供事件处理引用）──────────────────────────
	private headerStatusText!: HTMLElement;
	private headerStopBtn!: HTMLElement;

	// ─── 列1：会话列表 ─────────────────────────────────────
	private leftPanel!: HTMLElement;
	private sessionListEl!: HTMLElement;   // 会话条目容器
	private taskProgressText!: HTMLElement;
	private taskStatsEl!: HTMLElement;
	private taskElapsedText!: HTMLElement;
	private _todoListEl!: HTMLElement;  // Todo 列表显示区域

	// ─── @mention 文件引用 ─────────────────────────────────
	private _mentionDropdown: HTMLElement | null = null;
	private _mentionItems: string[] = [];
	private _mentionIndex = -1;

	// ─── 图片支持 ─────────────────────────────────────────
	private _pendingImages: string[] = [];  // base64 图片数据
	private _imagePreviewContainer: HTMLElement | null = null;

	// ─── 会话管理 ─────────────────────────────────────────
	private _sessions: Array<{
		id: string;
		title: string;
		status: 'running' | 'done' | 'error' | 'idle';
		time: number;
		msgContainer: HTMLElement;   // 该会话所有消息的容器 div
		leftBtn: HTMLElement;        // 左侧列表中的条目 DOM
		todoTotal: number;
		todoDone: number;
		// ─── 每会话 Token 统计 ────────────────────────────
		inputTokens: number;
		outputTokens: number;
		contextTokens: number;
	}> = [];
	private _currentSessionId = '';

	// ─── 列2：AI 对话 ──────────────────────────────────────
	private rightPanel!: HTMLElement;
	private messageArea!: HTMLElement;     // 所有会话 msgContainer 的父容器（可滚动）
	private inputWrapper!: HTMLElement;
	private inputEl!: HTMLElement;
	private sendBtn!: HTMLElement;

	// ─── 欢迎卡片（空闲时显示，运行时隐藏）─────────────────
	private welcomeCard!: HTMLElement;

	// ─── 列3：实时跟随面板 ────────────────────────────────────────
	private liveFollowPanel!: HTMLElement;
	private liveTabBar!: HTMLElement;
	private liveTabContent!: HTMLElement;
	private liveEmptyHint!: HTMLElement;
	private _liveTabs: Array<{ path: string; name: string; btn: HTMLElement; tabBadge?: HTMLElement }> = [];
	private _activeTabPath = '';  // 当前激活的 Tab 路径

	// ─── 状态 ──────────────────────────────────────────────
	private isRunning = false;
	private startTime = 0;
	private elapsedTimer: number | null = null;
	private todoTotal = 0;
	private todoDone = 0;

	// ─── 进入 Solo 前的布局快照（退出时恢复）─────────────
	private _savedSidebarVisible = true;
	private _savedActivityBarVisible = true;
	private _savedPanelVisible = false;
	private _savedAuxBarVisible = false;
	private _savedShowTabs: string = 'multiple';
	private _savedSidebarLocation = 'left';
	private _savedActivityBarLocation = 'side';

	// ─── 最后一条 AI 文本气泡（用于流式追加）──────────────
	private lastAiBubble: HTMLElement | null = null;
	private lastAiBubbleText: HTMLElement | null = null;
	private _lastAiAccText = '';   // 流式累积文本（用于实时 markdown 渲染）

	// ─── 思考过程气泡 ────────────────────────────────────
	private _reasoningBubble: HTMLElement | null = null;
	private _reasoningContent: HTMLElement | null = null;
	private _reasoningAccText = '';

	// ─── 当前 ask 消息（等待用户回应）──────────────────────
	private _pendingAskTs: number | null = null;

	// ─── 防抖保存计时器 ──────────────────────────────────
	private _saveDebounceTimer: ReturnType<typeof setTimeout> | null = null;

	// ─── 工具调用批次（同一 AI 回合内的工具调用合并显示）──────
	private _currentToolBatch: {
		wrapper: HTMLElement;
		detailsEl: HTMLElement;
		items: Array<{ toolName: string; target: string }>;
		toolCounts: Map<string, number>;
		summaryTextEl: HTMLElement;
		countBadge: HTMLElement;
		expanded: boolean;
		chevron: HTMLElement;
	} | null = null;

	// ─── Token 统计显示 ──────────────────────────────────────────────────
	private _sessionInputTokens = 0;
	private _sessionOutputTokens = 0;
	private _sessionContextTokens = 0;   // 当前上下文占用（totalTokens）
	private _tokenDisplayEl: HTMLElement | null = null;

	// ─── 文件内容缓存（AI 写入前的原始内容，用于 Diff 统计）──────────
	private _fileContentCache = new Map<string, string>();

	// ─── 终端面板 ──────────────────────────────────────────
	private _terminalPanel!: SoloTerminalPanel;

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@IMaxianService private readonly maxianService: IMaxianService,
		@IWorkbenchLayoutService private readonly layoutService: IWorkbenchLayoutService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IFileService private readonly fileService: IFileService,
		@IEditorService private readonly editorService: IEditorService,
		@ILifecycleService private readonly lifecycleService: ILifecycleService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@ITerminalService private readonly terminalService: ITerminalService,
	) {
		super(SoloEditorPane.ID, group, telemetryService, themeService, storageService);
	}

	// ── 生命周期 ──────────────────────────────────────────────────────────────

	/** Solo 模式可见时在 body 上加 solo-mode-active，用于 CSS 隐藏锁定/拆分按钮 */
	override setVisible(visible: boolean): void {
		super.setVisible(visible);
		if (visible) {
			document.body.classList.add('solo-mode-active');
		} else {
			document.body.classList.remove('solo-mode-active');
		}
	}

	protected createEditor(parent: HTMLElement): void {
		this.container = append(parent, $('div.solo-editor-container'));
		this.container.style.cssText = `
			display: flex;
			flex-direction: column;
			height: 100%;
			width: 100%;
			overflow: hidden;
			background: var(--vscode-editor-background);
			font-family: var(--vscode-font-family);
		`;

		// 注入脉冲动画 CSS（会话状态点）
		this._injectStyles();

		// ── 上方区域：三栏（会话列表 | AI对话 | 实时跟随）────────────────────────────
		const topRow = append(this.container, $('div.solo-top-row'));
		topRow.style.cssText = `
			display: flex;
			flex-direction: row;
			flex: 1;
			min-height: 0;
			overflow: hidden;
		`;

		this._buildLeftPanel(topRow);
		const rz1 = this._addResizer(topRow);
		this._buildCenterPanel(topRow);
		const rz2 = this._addResizer(topRow);
		this._buildLiveFollowPanel(topRow);
		this._buildHiddenHeader();
		this._subscribeEvents();

		// 连接拖拽调整句柄
		this._setupResize(rz1, this.leftPanel, 'left');
		this._setupResize(rz2, this.liveFollowPanel, 'right');

		// ── 下方区域：内嵌终端面板 ────────────────────────────────────────────────────
		const workspaceRoot = this.workspaceContextService.getWorkspace().folders[0]?.uri.fsPath ?? '';
		this._terminalPanel = this._register(new SoloTerminalPanel(this.terminalService, workspaceRoot));
		this._terminalPanel.build(this.container);
		// 加载历史会话
		this._loadSessionsFromStorage();
		// 注册 IDE 关闭时保存会话，用 join() 等待文件写入完成再关闭
		this._register(this.lifecycleService.onWillShutdown(e => {
			const uri = this._getSessionsFileUri();
			if (uri && this._sessions.length > 0) {
				const stored = this._sessions.map(s => ({
					id: s.id, title: s.title,
					status: s.status === 'running' ? 'done' : s.status,
					time: s.time, html: this._cleanHtmlForSave(s.msgContainer.innerHTML),
					history: this.maxianService.getSoloSessionHistory(s.id),
				}));
				const json = JSON.stringify(stored, null, 2);
				e.join(this.fileService.writeFile(uri, VSBuffer.fromString(json)).then(() => undefined), {
					id: 'maxian.solo.saveSessions',
					label: '保存 Coding 会话历史',
				});
			}
		}));
		// 每 30 秒自动保存一次，防止意外崩溃丢失数据
		const autoSaveInterval = setInterval(() => this._saveSessionsToStorage(), 30_000);
		this._register({ dispose: () => clearInterval(autoSaveInterval) });
	}

	private _injectStyles(): void {
		const styleId = 'solo-editor-pane-styles';
		if (document.getElementById(styleId)) { return; }
		const style = document.createElement('style');
		style.id = styleId;
		style.textContent = `
			@keyframes solo-pulse {
				0%, 100% { opacity: 1; }
				50% { opacity: 0.4; }
			}
			/* 消息区域允许文本选择和复制 */
			.solo-message-area,
			.solo-message-area * {
				user-select: text !important;
				-webkit-user-select: text !important;
			}
			.solo-message-area ::selection {
				background: var(--vscode-editor-selectionBackground, rgba(0,122,204,0.3));
			}
			.solo-session-item.active {
				background: rgba(255,140,0,0.12) !important;
				border-left: 2px solid #FFA500 !important;
				padding-left: 10px !important;
			}
			.solo-tool-batch-summary:hover {
				background: rgba(128,128,128,0.06) !important;
			}
			.solo-tool-batch-detail-item:hover {
				background: rgba(128,128,128,0.04);
			}
			.solo-md-code-block {
				display: block;
				background: rgba(128,128,128,0.12);
				border: 1px solid rgba(128,128,128,0.2);
				border-radius: 6px;
				padding: 10px 12px;
				font-size: 12px;
				font-family: var(--vscode-editor-font-family, monospace);
				white-space: pre;
				overflow-x: auto;
				margin: 6px 0;
				color: var(--vscode-foreground);
				line-height: 1.5;
				position: relative;
			}
			.solo-md-code-block .solo-code-copy {
				position: absolute;
				top: 4px;
				right: 4px;
				opacity: 0;
				transition: opacity 0.15s;
			}
			.solo-md-code-block:hover .solo-code-copy {
				opacity: 1;
			}
			/* 已移至内联样式 */
			.solo-md-inline-code {
				background: rgba(128,128,128,0.15);
				border-radius: 3px;
				padding: 1px 4px;
				font-size: 12px;
				font-family: var(--vscode-editor-font-family, monospace);
				color: var(--vscode-textPreformat-foreground, #CE9178);
			}
			.solo-md-h1, .solo-md-h2, .solo-md-h3 {
				font-weight: 700;
				margin: 8px 0 4px;
				color: var(--vscode-foreground);
			}
			.solo-md-h1 { font-size: 16px; }
			.solo-md-h2 { font-size: 14px; }
			.solo-md-h3 { font-size: 13px; }
			.solo-md-p { margin: 4px 0; line-height: 1.6; }
			.solo-md-li { margin: 2px 0; line-height: 1.6; padding-left: 4px; }
			.solo-md-ul { margin: 4px 0; padding-left: 16px; }
			.solo-ask-confirmation, .solo-ask-followup {
				margin-top: 8px;
			}
			.solo-reasoning-bubble {
				border-radius: 8px;
				background: rgba(128,128,128,0.06);
				border: 1px solid rgba(128,128,128,0.15);
				overflow: hidden;
				font-size: 12px;
			}
			.solo-reasoning-header {
				display: flex;
				align-items: center;
				gap: 6px;
				padding: 6px 10px;
				cursor: pointer;
				user-select: none;
				transition: background 0.15s;
			}
			.solo-reasoning-header:hover {
				background: rgba(128,128,128,0.06);
			}
			.solo-reasoning-text {
				padding: 6px 12px 10px;
				font-size: 12px;
				color: var(--vscode-descriptionForeground);
				line-height: 1.6;
				white-space: pre-wrap;
				word-break: break-word;
				max-height: 300px;
				overflow-y: auto;
				border-top: 1px solid rgba(128,128,128,0.1);
			}
			.solo-md-table {
				border-collapse: collapse;
				width: 100%;
				margin: 6px 0;
				font-size: 12px;
			}
			.solo-md-table th, .solo-md-table td {
				border: 1px solid rgba(128,128,128,0.25);
				padding: 5px 10px;
				text-align: left;
				line-height: 1.5;
			}
			.solo-md-table th {
				background: rgba(128,128,128,0.1);
				font-weight: 600;
				color: var(--vscode-foreground);
			}
			.solo-md-table td {
				color: var(--vscode-foreground);
				opacity: 0.9;
			}
			.solo-md-table tr:nth-child(even) td {
				background: rgba(128,128,128,0.04);
			}
			.solo-session-close-btn {
				opacity: 0;
				transition: opacity 0.15s;
				width: 16px; height: 16px;
				border-radius: 4px;
				display: flex; align-items: center; justify-content: center;
				flex-shrink: 0;
				font-size: 12px;
				line-height: 1;
				cursor: pointer;
				color: var(--vscode-descriptionForeground);
			}
			.solo-session-item:hover .solo-session-close-btn {
				opacity: 1;
			}
			.solo-session-close-btn:hover {
				background: rgba(244,135,113,0.2);
				color: #f48771;
			}
		`;
		document.head.appendChild(style);
	}

	override async setInput(input: EditorInput, options: IEditorOptions | undefined, context: any, token: CancellationToken): Promise<void> {
		await super.setInput(input, options, context, token);

		// 进入 Solo：锁定组（防止文件编辑器替换 Solo pane，消除闪动）
		// 锁定后 Explorer 点文件会被重定向到其他组，onWillOpenEditor 在那个组上拦截
		this.group.lock(true);

		// 进入 Solo 模式：保存布局快照
		this._savedSidebarVisible = this.layoutService.isVisible(Parts.SIDEBAR_PART);
		this._savedActivityBarVisible = this.layoutService.isVisible(Parts.ACTIVITYBAR_PART);
		this._savedPanelVisible = this.layoutService.isVisible(Parts.PANEL_PART);
		this._savedAuxBarVisible = this.layoutService.isVisible(Parts.AUXILIARYBAR_PART);
		this._savedShowTabs = this.configurationService.getValue<string>('workbench.editor.showTabs') ?? 'multiple';
		this._savedSidebarLocation = this.configurationService.getValue<string>('workbench.sideBar.location') ?? 'left';
		this._savedActivityBarLocation = this.configurationService.getValue<string>('workbench.activityBar.location') ?? 'side';

		// 隐藏底部面板 / 辅助栏
		if (this._savedPanelVisible) { this.layoutService.setPartHidden(true, Parts.PANEL_PART); }
		if (this._savedAuxBarVisible) { this.layoutService.setPartHidden(true, Parts.AUXILIARYBAR_PART); }

		// 将原生侧边栏移到右侧，activity bar 横向置顶（第四列效果）
		await this.configurationService.updateValue('workbench.sideBar.location', 'right', ConfigurationTarget.MEMORY);
		await this.configurationService.updateValue('workbench.activityBar.location', 'top', ConfigurationTarget.MEMORY);

		// 确保侧边栏可见
		if (!this._savedSidebarVisible) { this.layoutService.setPartHidden(false, Parts.SIDEBAR_PART); }
		if (!this._savedActivityBarVisible) { this.layoutService.setPartHidden(false, Parts.ACTIVITYBAR_PART); }

		// 隐藏编辑器标签栏，让 Solo 面板独占整个编辑区
		await this.configurationService.updateValue('workbench.editor.showTabs', 'none', ConfigurationTarget.MEMORY);

		// 隐藏 Solo 所在 editor group 的拆分/锁定/关闭按钮
		this._hideSoloGroupActions();

		// Solo 面板打开即就绪，聚焦输入框
		requestAnimationFrame(() => this.inputEl?.focus());
	}

	override layout(dimension: Dimension, _position?: IDomPosition): void {
		if (!this.container) { return; }
		this.container.style.width = `${dimension.width}px`;
		this.container.style.height = `${dimension.height}px`;
	}

	override focus(): void {
		this.inputEl?.focus();
	}

	override clearInput(): void {
		this._restoreLayout();
		super.clearInput();
	}

	private _restoreLayout(): void {
		// 恢复 Solo 所在 editor group 的操作按钮
		this._showSoloGroupActions();
		// 解锁 Solo 组，允许普通编辑器恢复
		this.group.lock(false);

		// 恢复侧边栏位置和 activity bar 样式
		this.configurationService.updateValue('workbench.sideBar.location', this._savedSidebarLocation, ConfigurationTarget.MEMORY);
		this.configurationService.updateValue('workbench.activityBar.location', this._savedActivityBarLocation, ConfigurationTarget.MEMORY);
		// 恢复侧边栏 / 活动栏可见性
		this.layoutService.setPartHidden(!this._savedSidebarVisible, Parts.SIDEBAR_PART);
		this.layoutService.setPartHidden(!this._savedActivityBarVisible, Parts.ACTIVITYBAR_PART);
		// 恢复底部面板和辅助栏
		if (this._savedPanelVisible) { this.layoutService.setPartHidden(false, Parts.PANEL_PART); }
		if (this._savedAuxBarVisible) { this.layoutService.setPartHidden(false, Parts.AUXILIARYBAR_PART); }
		this.configurationService.updateValue('workbench.editor.showTabs', this._savedShowTabs, ConfigurationTarget.MEMORY);
	}

	/** 标题栏中编辑器相关操作按钮（split/lock/close）— 隐藏 */
	private _hiddenActionItems: HTMLElement[] = [];
	private _titlebarObserver: MutationObserver | null = null;
	private _hideSoloGroupActions(): void {
		const doHide = () => {
			// 先恢复之前隐藏的（防止重复）
			for (const li of this._hiddenActionItems) { li.style.display = ''; }
			this._hiddenActionItems = [];

			const codicons = ['.codicon-split-horizontal', '.codicon-lock', '.codicon-close', '.codicon.separator'];
			for (const sel of codicons) {
				document.querySelectorAll(`.titlebar-right ${sel}`).forEach(a => {
					const li = a.closest('li.action-item') as HTMLElement | null;
					if (li && li.style.display !== 'none') {
						li.style.display = 'none';
						this._hiddenActionItems.push(li);
					}
				});
			}
		};

		// 立即执行一次 + 延迟执行（titlebar 可能在 setInput 后重建）
		doHide();
		requestAnimationFrame(doHide);
		setTimeout(doHide, 200);

		// 监听 titlebar-right 变化，toolbar 重建时重新隐藏
		const titlebarRight = document.querySelector('.titlebar-right');
		if (titlebarRight && !this._titlebarObserver) {
			this._titlebarObserver = new MutationObserver(() => doHide());
			this._titlebarObserver.observe(titlebarRight, { childList: true, subtree: true });
		}
	}

	/** 标题栏中编辑器相关操作按钮 — 恢复 */
	private _showSoloGroupActions(): void {
		if (this._titlebarObserver) {
			this._titlebarObserver.disconnect();
			this._titlebarObserver = null;
		}
		for (const li of this._hiddenActionItems) {
			li.style.display = '';
		}
		this._hiddenActionItems = [];
	}

	override dispose(): void {
		this._stopElapsedTimer();
		// IDE 关闭前强制保存所有会话
		this._saveSessionsToStorage();
		try {
			this._restoreLayout();
		} catch { /* ignore */ }
		super.dispose();
	}

	// ── 构建 DOM ──────────────────────────────────────────────────────────────

	/** 初始化状态字段（不渲染 UI） */
	private _buildHiddenHeader(): void {
		this.headerStatusText = document.createElement('span');
	}

	/** 左栏：会话列表 */
	private _buildLeftPanel(parent: HTMLElement): void {
		this.leftPanel = append(parent, $('div.solo-left-panel'));
		this.leftPanel.style.cssText = `
			width: 220px;
			flex-shrink: 0;
			display: flex;
			flex-direction: column;
			border-right: 1px solid var(--vscode-sideBarSectionHeader-border, rgba(128,128,128,0.15));
			background: var(--vscode-sideBar-background, var(--vscode-editor-background));
			overflow: hidden;
		`;

		// ── 新任务按钮 ──
		const newTaskBtn = append(this.leftPanel, $('button.solo-new-task-btn'));
		newTaskBtn.style.cssText = `
			display: flex;
			align-items: center;
			justify-content: space-between;
			margin: 10px 10px 0;
			padding: 8px 12px;
			border: 1px solid var(--vscode-button-border, rgba(128,128,128,0.3));
			border-radius: 8px;
			background: transparent;
			color: var(--vscode-foreground);
			font-size: 13px;
			font-family: inherit;
			cursor: pointer;
			flex-shrink: 0;
			transition: background 0.15s;
		`;
		newTaskBtn.onmouseenter = () => { newTaskBtn.style.background = 'rgba(128,128,128,0.1)'; };
		newTaskBtn.onmouseleave = () => { newTaskBtn.style.background = 'transparent'; };
		newTaskBtn.onclick = () => { this._startNewSession(); };

		const newTaskLeft = append(newTaskBtn, $('span'));
		newTaskLeft.style.cssText = 'display:flex;align-items:center;gap:6px;';
		const plusIcon = append(newTaskLeft, $('span.codicon.codicon-add'));
		plusIcon.style.cssText = 'font-size:14px;pointer-events:none;';
		const newTaskLabel = append(newTaskLeft, $('span'));
		newTaskLabel.textContent = '新任务';
		newTaskLabel.style.pointerEvents = 'none';

		const newTaskShortcut = append(newTaskBtn, $('span'));
		newTaskShortcut.style.cssText = 'font-size:11px;opacity:0.5;pointer-events:none;';
		newTaskShortcut.textContent = '⌘N';

		// ── 会话计数 ──
		this.taskProgressText = append(this.leftPanel, $('div'));
		this.taskProgressText.style.cssText = `
			padding: 10px 14px 6px;
			font-size: 11px;
			color: var(--vscode-descriptionForeground);
			opacity: 0.7;
			flex-shrink: 0;
		`;
		this.taskProgressText.textContent = '会话  0';

		// ── 会话列表滚动区 ──
		const sessionScroll = append(this.leftPanel, $('div'));
		sessionScroll.style.cssText = 'flex:1;overflow-y:auto;display:flex;flex-direction:column;';

		this.sessionListEl = append(sessionScroll, $('div'));
		this.sessionListEl.style.cssText = 'display:flex;flex-direction:column;padding:4px 0;';

		// ── 底部：计时器 / 空态提示 ──
		this.taskStatsEl = append(this.leftPanel, $('div'));
		this.taskStatsEl.style.cssText = `
			padding: 12px 14px;
			display: flex;
			flex-direction: column;
			align-items: center;
			gap: 6px;
			flex-shrink: 0;
			opacity: 0.5;
		`;
		const chatIcon = append(this.taskStatsEl, $('span.codicon.codicon-comment-discussion'));
		chatIcon.style.cssText = 'font-size:20px;color:var(--vscode-descriptionForeground);';
		this.taskElapsedText = append(this.taskStatsEl, $('div'));
		this.taskElapsedText.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);text-align:center;line-height:1.5;';
		this.taskElapsedText.textContent = '和智能体对话，\n开始你的第一个任务吧';

		// Todo 列表显示区域
		this._todoListEl = append(this.leftPanel, $('div.solo-todo-list'));
		this._todoListEl.style.cssText = `
			flex: 1;
			overflow-y: auto;
			padding: 8px 10px;
			display: none;
		`;
	}

	/** 中间主面板：欢迎卡 + 消息流 + 输入框 */
	private _buildCenterPanel(parent: HTMLElement): void {
		this.rightPanel = append(parent, $('div.solo-center-panel'));
		this.rightPanel.style.cssText = `
			flex: 1;
			display: flex;
			flex-direction: column;
			overflow: hidden;
			position: relative;
		`;

		// ── 欢迎卡（空闲时显示）──
		this.welcomeCard = append(this.rightPanel, $('div.solo-welcome-card'));
		this.welcomeCard.style.cssText = `
			flex: 1;
			display: flex;
			flex-direction: column;
			align-items: center;
			justify-content: center;
			gap: 0;
			padding: 40px 60px;
			overflow: hidden;
		`;

		// Logo + 标题
		const logoWrap = append(this.welcomeCard, $('div'));
		logoWrap.style.cssText = 'display:flex;align-items:center;gap:14px;margin-bottom:10px;';
		const logoBox = append(logoWrap, $('div'));
		logoBox.style.cssText = `
			width: 48px; height: 48px;
			border-radius: 12px;
			background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
			border: 1px solid rgba(255,255,255,0.12);
			display: flex; align-items: center; justify-content: center;
		`;
		const logoIcon = append(logoBox, $('span.codicon.codicon-rocket'));
		logoIcon.style.cssText = 'font-size:22px;color:#FFA500;';
		const titleText = append(logoWrap, $('span'));
		titleText.style.cssText = 'font-size:26px;font-weight:700;color:var(--vscode-foreground);letter-spacing:-0.5px;';
		titleText.textContent = 'Coding';

		const subtitle = append(this.welcomeCard, $('div'));
		subtitle.style.cssText = 'font-size:13px;color:var(--vscode-descriptionForeground);margin-bottom:24px;opacity:0.8;';
		subtitle.textContent = '自主编码智能体，端到端完成复杂开发任务';

		const bullets: [string, string][] = [
			['codicon-code', '擅长项目迭代、问题修复与架构重构'],
			['codicon-list-ordered', '智能任务规划，确认后精准推进执行'],
			['codicon-hubot', '自主编排智能体，AI 专家团队协同开发'],
		];
		for (const [icon, text] of bullets) {
			const row = append(this.welcomeCard, $('div'));
			row.style.cssText = 'display:flex;align-items:center;gap:10px;margin-bottom:8px;';
			const ic = append(row, $('span.codicon.' + icon));
			ic.style.cssText = 'font-size:14px;color:var(--vscode-foreground);opacity:0.5;flex-shrink:0;';
			const t = append(row, $('span'));
			t.style.cssText = 'font-size:13px;color:var(--vscode-descriptionForeground);opacity:0.75;';
			t.textContent = text;
		}

		// ── 消息区（运行时显示，可滚动）──
		this.messageArea = append(this.rightPanel, $('div.solo-message-area'));
		this.messageArea.style.cssText = `
			flex: 1;
			overflow-y: auto;
			padding: 20px 24px;
			display: none;
			flex-direction: column;
			gap: 0;
			user-select: text;
			-webkit-user-select: text;
			cursor: text;
		`;

		// ── 输入区（始终显示）──
		this._buildInputArea();
	}

	/** 列3：实时跟随面板（Tab 式文件查看） */
	private _buildLiveFollowPanel(parent: HTMLElement): void {
		this.liveFollowPanel = append(parent, $('div.solo-live-panel'));
		this.liveFollowPanel.style.cssText = `
			width: 300px;
			flex-shrink: 0;
			display: flex;
			flex-direction: column;
			border-left: 1px solid var(--vscode-sideBarSectionHeader-border, rgba(128,128,128,0.15));
			background: var(--vscode-sideBar-background, var(--vscode-editor-background));
			overflow: hidden;
		`;

		// ── 面板标题 ──
		const header = append(this.liveFollowPanel, $('div'));
		header.style.cssText = `
			display: flex;
			align-items: center;
			gap: 6px;
			padding: 6px 12px 0;
			flex-shrink: 0;
			font-size: 11px;
			font-weight: 600;
			color: var(--vscode-sideBarSectionHeader-foreground, var(--vscode-foreground));
			text-transform: uppercase;
			letter-spacing: 0.6px;
			opacity: 0.8;
		`;
		const eyeIcon = append(header, $('span.codicon.codicon-eye'));
		eyeIcon.style.cssText = 'font-size:12px;color:#FFA500;';
		const headerTitle = append(header, $('span'));
		headerTitle.textContent = '实时跟随';

		// token 统计已移至中间列输入框上方

		// ── Tab 条 ──
		this.liveTabBar = append(this.liveFollowPanel, $('div.solo-live-tabs'));
		this.liveTabBar.style.cssText = `
			display: flex;
			flex-shrink: 0;
			border-bottom: 1px solid var(--vscode-editorGroupHeader-tabsBorder, rgba(128,128,128,0.15));
			background: var(--vscode-editorGroupHeader-tabsBackground, rgba(128,128,128,0.04));
			overflow-x: auto;
			scrollbar-width: none;
			min-height: 34px;
			align-items: flex-end;
		`;

		// ── 空态提示 ──
		this.liveEmptyHint = append(this.liveFollowPanel, $('div'));
		this.liveEmptyHint.style.cssText = `
			flex: 1;
			display: flex;
			flex-direction: column;
			align-items: center;
			justify-content: center;
			gap: 8px;
			padding: 20px;
			color: var(--vscode-descriptionForeground);
			opacity: 0.4;
			font-size: 12px;
			text-align: center;
		`;
		const hintIcon = append(this.liveEmptyHint, $('span.codicon.codicon-eye'));
		hintIcon.style.fontSize = '24px';
		const hintText = append(this.liveEmptyHint, $('span'));
		hintText.textContent = 'AI 操作文件时将在此处以 Tab 形式显示';

		// ── Tab 内容区 ──
		this.liveTabContent = append(this.liveFollowPanel, $('div.solo-live-content'));
		this.liveTabContent.style.cssText = `
			flex: 1;
			overflow: hidden;
			display: none;
			flex-direction: column;
		`;

		// 文件内容 pre 元素（不截断，显示完整内容）
		const contentPre = append(this.liveTabContent, $('pre'));
		contentPre.style.cssText = `
			flex: 1;
			overflow-y: auto;
			margin: 0;
			padding: 10px 12px;
			font-size: 11px;
			line-height: 1.6;
			font-family: var(--vscode-editor-font-family, monospace);
			color: var(--vscode-foreground);
			white-space: pre;
			word-break: normal;
		`;
		(this.liveTabContent as any)._pre = contentPre;
	}

	/** 更新 Token 统计显示 */
	private _updateTokenDisplay(): void {
		if (!this._tokenDisplayEl) { return; }
		this._tokenDisplayEl.textContent = '';
		if (this._sessionInputTokens === 0 && this._sessionOutputTokens === 0) { return; }

		const fmt = (n: number) => n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n);
		const MAX_CTX = 1_000_000; // Qwen3 上下文窗口 1M

		// ↓ 输入
		const inEl = document.createElement('span');
		inEl.style.cssText = 'display:flex;align-items:center;gap:2px;';
		const inArrow = document.createElement('span');
		inArrow.textContent = '↓';
		inArrow.style.color = 'var(--vscode-charts-blue)';
		const inCount = document.createElement('span');
		inCount.textContent = fmt(this._sessionInputTokens);
		inEl.appendChild(inArrow);
		inEl.appendChild(inCount);

		// ↑ 输出
		const outEl = document.createElement('span');
		outEl.style.cssText = 'display:flex;align-items:center;gap:2px;';
		const outArrow = document.createElement('span');
		outArrow.textContent = '↑';
		outArrow.style.color = 'var(--vscode-charts-green)';
		const outCount = document.createElement('span');
		outCount.textContent = fmt(this._sessionOutputTokens);
		outEl.appendChild(outArrow);
		outEl.appendChild(outCount);

		this._tokenDisplayEl.appendChild(inEl);
		this._tokenDisplayEl.appendChild(outEl);

		// ⬜ 上下文占用（当前上下文 / 1M）
		if (this._sessionContextTokens > 0) {
			const pct = Math.min(100, Math.round(this._sessionContextTokens / MAX_CTX * 100));
			// 颜色：<60% 绿，60-80% 橙，>80% 红
			const ctxColor = pct >= 80
				? 'var(--vscode-charts-red)'
				: pct >= 60
					? 'var(--vscode-charts-yellow)'
					: 'var(--vscode-charts-green)';

			const ctxEl = document.createElement('span');
			ctxEl.style.cssText = 'display:flex;align-items:center;gap:2px;';
			const ctxIcon = document.createElement('span');
			ctxIcon.textContent = '⬜';
			ctxIcon.style.cssText = `color:${ctxColor};font-size:10px;`;
			const ctxCount = document.createElement('span');
			ctxCount.textContent = `${fmt(this._sessionContextTokens)}/${Math.round(MAX_CTX / 1000)}k`;
			ctxCount.style.color = ctxColor;
			ctxEl.appendChild(ctxIcon);
			ctxEl.appendChild(ctxCount);
			ctxEl.title = `当前上下文占用：${this._sessionContextTokens.toLocaleString()} / ${MAX_CTX.toLocaleString()} tokens（${pct}%）`;
			this._tokenDisplayEl.appendChild(ctxEl);
		}
	}

	/** 列间拖拽分隔条 */
	private _addResizer(parent: HTMLElement): HTMLElement {
		const el = append(parent, $('div.solo-col-resizer'));
		el.style.cssText = `
			width: 3px;
			flex-shrink: 0;
			cursor: col-resize;
			background: var(--vscode-panel-border, rgba(128,128,128,0.2));
			transition: background 0.15s;
			z-index: 10;
		`;
		el.onmouseenter = () => { el.style.background = 'var(--vscode-sash-hoverBorder, rgba(0,122,204,0.6))'; };
		el.onmouseleave = () => { el.style.background = 'var(--vscode-panel-border, rgba(128,128,128,0.2))'; };
		return el;
	}

	private _setupResize(handle: HTMLElement, fixedPanel: HTMLElement, fixedSide: 'left' | 'right'): void {
		handle.addEventListener('mousedown', (startEvt: MouseEvent) => {
			startEvt.preventDefault();
			const startX = startEvt.clientX;
			const startW = fixedPanel.getBoundingClientRect().width;

			const onMove = (e: MouseEvent) => {
				const delta = e.clientX - startX;
				const newW = fixedSide === 'left'
					? Math.max(120, Math.min(500, startW + delta))
					: Math.max(120, Math.min(500, startW - delta));
				fixedPanel.style.width = `${newW}px`;
				fixedPanel.style.flexShrink = '0';
			};

			const onUp = () => {
				document.removeEventListener('mousemove', onMove);
				document.removeEventListener('mouseup', onUp);
				handle.onmouseleave?.(new MouseEvent('mouseleave'));
			};

			document.addEventListener('mousemove', onMove);
			document.addEventListener('mouseup', onUp);
		});
	}

	/** 底部输入区（Trae 风格） */
	private _buildInputArea(): void {
		this.inputWrapper = append(this.rightPanel, $('div.solo-input-wrapper'));
		this.inputWrapper.style.cssText = `
			flex-shrink: 0;
			padding: 6px 16px 16px;
			display: flex;
			flex-direction: column;
			gap: 0;
			background: var(--vscode-editor-background);
		`;

		// ── Token 统计（显示在输入框上方，与 IDE 模式一致）──
		this._tokenDisplayEl = append(this.inputWrapper, $('div'));
		this._tokenDisplayEl.style.cssText = `
			display: flex;
			align-items: center;
			gap: 8px;
			padding: 2px 4px 6px;
			font-size: 11px;
			color: var(--vscode-descriptionForeground);
			min-height: 18px;
		`;
		this._tokenDisplayEl.title = '本次任务消耗的 Token 数（输入 / 输出）';

		// 输入框卡片
		const inputCard = append(this.inputWrapper, $('div.solo-input-card'));
		inputCard.style.cssText = `
			border: 1px solid var(--vscode-input-border, rgba(128,128,128,0.3));
			border-radius: 12px;
			background: var(--vscode-input-background, rgba(128,128,128,0.05));
			display: flex;
			flex-direction: column;
			transition: border-color 0.15s, box-shadow 0.15s;
			overflow: visible;
			position: relative;
		`;

		// 顶部标签行
		const labelRow = append(inputCard, $('div'));
		labelRow.style.cssText = `
			display: flex;
			align-items: center;
			gap: 6px;
			padding: 8px 14px 0;
		`;
		const agentIcon = append(labelRow, $('span.codicon.codicon-rocket'));
		agentIcon.style.cssText = 'font-size:12px;color:#FFA500;';
		const agentLabel = append(labelRow, $('span'));
		agentLabel.style.cssText = 'font-size:12px;font-weight:500;color:var(--vscode-foreground);opacity:0.85;';
		agentLabel.textContent = '@码弦 Coding';

		// Solo 自动执行提示
		const autoTip = append(labelRow, $('span'));
		autoTip.style.cssText = 'font-size:11px;color:rgba(255,140,0,0.7);margin-left:4px;';
		autoTip.textContent = '— 全程自动执行';

		// 输入框
		this.inputEl = append(inputCard, $('div.solo-input'));
		this.inputEl.contentEditable = 'true';
		this.inputEl.style.cssText = `
			min-height: 60px;
			max-height: 180px;
			padding: 8px 14px;
			font-size: 13px;
			font-family: inherit;
			color: var(--vscode-input-foreground);
			outline: none;
			overflow-y: auto;
			word-break: break-word;
			line-height: 1.6;
		`;
		this.inputEl.setAttribute('data-placeholder', '描述你的任务，Coding 智能体将自主完成...');

		// 输入框聚焦样式
		this.inputEl.addEventListener('focus', () => {
			inputCard.style.borderColor = 'rgba(255,140,0,0.5)';
			inputCard.style.boxShadow = '0 0 0 2px rgba(255,140,0,0.15)';
		});
		this.inputEl.addEventListener('blur', () => {
			inputCard.style.borderColor = 'var(--vscode-input-border, rgba(128,128,128,0.3))';
			inputCard.style.boxShadow = 'none';
		});

		// 粘贴：支持图片 + 纯文本（去除富文本格式）
		this.inputEl.addEventListener('paste', (e) => {
			e.preventDefault();

			// 检查是否有图片
			const files = e.clipboardData?.files;
			if (files && files.length > 0) {
				for (let i = 0; i < files.length; i++) {
					const file = files[i];
					if (file.type.startsWith('image/')) {
						this._addImageFromFile(file);
					}
				}
				// 如果只粘贴了图片（没有文本），直接返回
				const text = e.clipboardData?.getData('text/plain') ?? '';
				if (!text.trim()) { return; }
			}

			// 纯文本粘贴
			const text = e.clipboardData?.getData('text/plain') ?? '';
			if (!text) { return; }
			const sel = window.getSelection();
			if (!sel || sel.rangeCount === 0) { return; }
			const range = sel.getRangeAt(0);
			range.deleteContents();
			range.insertNode(document.createTextNode(text));
			range.collapse(false);
			sel.removeAllRanges();
			sel.addRange(range);
		});

		// 拖拽图片支持
		this.inputEl.addEventListener('dragover', (e) => {
			e.preventDefault();
			e.stopPropagation();
			inputCard.style.borderColor = 'var(--vscode-focusBorder, #007acc)';
		});
		this.inputEl.addEventListener('dragleave', () => {
			inputCard.style.borderColor = 'var(--vscode-input-border, rgba(128,128,128,0.3))';
		});
		this.inputEl.addEventListener('drop', (e) => {
			e.preventDefault();
			e.stopPropagation();
			inputCard.style.borderColor = 'var(--vscode-input-border, rgba(128,128,128,0.3))';
			const files = e.dataTransfer?.files;
			if (files) {
				for (let i = 0; i < files.length; i++) {
					if (files[i].type.startsWith('image/')) {
						this._addImageFromFile(files[i]);
					}
				}
			}
		});

		// 键盘事件：Enter 发送、Ctrl+A 全选
		// 注意：mention dropdown 的 ArrowDown/ArrowUp/Enter/Escape 由 _mentionKeyHandler 处理
		this.inputEl.addEventListener('keydown', (e) => {
			// mention dropdown 打开时，不处理 Enter/ArrowDown/ArrowUp/Escape（交给 _mentionKeyHandler）
			const dropdownOpen = this._mentionDropdown && this._mentionDropdown.style.display !== 'none';
			if (dropdownOpen && (e.key === 'Enter' || e.key === 'Tab' || e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Escape')) {
				return; // 让 _mentionKeyHandler 处理
			}

			// Enter 发送（Shift+Enter 换行）
			if (e.key === 'Enter' && !e.shiftKey) {
				e.preventDefault();
				this._sendMessage();
			}
			// Ctrl/Cmd+A 全选输入框内容
			if (e.key === 'a' && (e.ctrlKey || e.metaKey)) {
				e.preventDefault();
				e.stopPropagation();
				const sel = window.getSelection();
				const range = document.createRange();
				range.selectNodeContents(this.inputEl);
				sel?.removeAllRanges();
				sel?.addRange(range);
			}
		});

		// @mention 文件引用
		this.inputEl.addEventListener('input', () => {
			this._checkMentionTrigger();
		});

		// 底部操作栏
		const bottomBar = append(inputCard, $('div'));
		bottomBar.style.cssText = `
			display: flex;
			align-items: center;
			justify-content: space-between;
			padding: 6px 10px 8px;
		`;

		// 左侧占位（按需扩展）
		append(bottomBar, $('div'));

		// 右侧：停止 / 发送
		const rightBtns = append(bottomBar, $('div'));
		rightBtns.style.cssText = 'display:flex;align-items:center;gap:6px;';

		// 停止按钮（运行时显示）
		this.headerStopBtn = append(rightBtns, $('button')) as HTMLButtonElement;
		this.headerStopBtn.style.cssText = `
			display: none;
			align-items: center;
			gap: 4px;
			padding: 5px 12px;
			border: 1px solid rgba(255,100,100,0.5);
			border-radius: 8px;
			background: rgba(255,100,100,0.1);
			color: #ff6464;
			font-size: 12px;
			cursor: pointer;
			font-family: inherit;
			transition: background 0.15s;
		`;
		const stopIcon2 = append(this.headerStopBtn, $('span.codicon.codicon-stop-circle'));
		stopIcon2.style.cssText = 'font-size:13px;pointer-events:none;';
		const stopText2 = append(this.headerStopBtn, $('span'));
		stopText2.textContent = ' 停止';
		stopText2.style.pointerEvents = 'none';
		this.headerStopBtn.onmouseenter = () => { this.headerStopBtn.style.background = 'rgba(255,100,100,0.2)'; };
		this.headerStopBtn.onmouseleave = () => { this.headerStopBtn.style.background = 'rgba(255,100,100,0.1)'; };
		this.headerStopBtn.onclick = () => {
			this.maxianService.cancelTask(this._currentSessionId || undefined);
			setTimeout(() => {
				if (this.isRunning) { this._setRunning(false); }
			}, 800);
		};

		// 发送按钮
		this.sendBtn = append(rightBtns, $('button')) as HTMLButtonElement;
		this.sendBtn.style.cssText = `
			width: 32px;
			height: 32px;
			border: none;
			border-radius: 8px;
			background: var(--vscode-button-background, #FFA500);
			color: var(--vscode-button-foreground, #000);
			font-size: 15px;
			cursor: pointer;
			display: flex;
			align-items: center;
			justify-content: center;
			transition: background 0.15s, opacity 0.15s;
			flex-shrink: 0;
		`;
		const sendIcon2 = append(this.sendBtn, $('span.codicon.codicon-arrow-up'));
		sendIcon2.style.cssText = 'font-size:15px;pointer-events:none;';
		this.sendBtn.onmouseenter = () => { if (!this.isRunning) { this.sendBtn.style.opacity = '0.85'; } };
		this.sendBtn.onmouseleave = () => { this.sendBtn.style.opacity = '1'; };
		this.sendBtn.onclick = () => this._sendMessage();
	}

	// ── 事件订阅 ──────────────────────────────────────────────────────────────

	private _subscribeEvents(): void {
		// 消息流（用户/AI/错误）—— 路由到正确的会话容器，而非只处理当前会话
		this._register(this.maxianService.onMessage((event: IMessageEvent) => {
			if (!event.sessionId) { return; } // Solo 模式事件必须有 sessionId
			const targetSession = this._sessions.find(s => s.id === event.sessionId);
			if (!targetSession) { return; }
			const isCurrentSession = event.sessionId === this._currentSessionId;
			// 临时切换 _currentSessionId，使 _getCurrentMsgContainer() 指向正确容器
			const savedId = this._currentSessionId;
			this._currentSessionId = event.sessionId;
			this._handleMessage(event, isCurrentSession);
			this._currentSessionId = savedId;
		}));

		// Cline 完整消息（工具调用等）—— 同样路由到正确会话
		this._register(this.maxianService.onClineMessage((event) => {
			if (!event.sessionId) { return; }
			const targetSession = this._sessions.find(s => s.id === event.sessionId);
			if (!targetSession) { return; }
			const isCurrentSession = event.sessionId === this._currentSessionId;
			const savedId = this._currentSessionId;
			this._currentSessionId = event.sessionId;
			this._handleClineMessage(event.message, isCurrentSession);
			this._currentSessionId = savedId;
		}));

		// Todo 列表更新（只更新对应会话的 todo 计数，UI 进度只刷新当前会话）
		this._register(this.maxianService.onTodoListUpdate((event: ITodoListEvent) => {
			console.log(`[ToolTrace] [Todo] sessionId=${event.sessionId}, currentSession=${this._currentSessionId}, todos=${event.todos?.length}`);
			if (!event.sessionId) { return; }
			const isCurrentSession = event.sessionId === this._currentSessionId;
			if (!isCurrentSession) {
				// 后台会话：只更新 session.todoTotal/todoDone，不刷新 UI
				const sess = this._sessions.find(s => s.id === event.sessionId);
				if (sess && event.todos) {
					sess.todoTotal = event.todos.length;
					sess.todoDone = event.todos.filter((t: { status: string }) => t.status === 'completed').length;
				}
				return;
			}
			this._handleTodoUpdate(event);
		}));

		// Token 使用量 —— 存入对应会话，切换会话时刷新显示
		this._register(this.maxianService.onTokenUsage((event: ITokenUsageEvent) => {
			if (!event.sessionId) { return; }
			const sess = this._sessions.find(s => s.id === event.sessionId);
			if (!sess) { return; }
			if (!event.isEstimated) {
				// 更新该会话存储的 token 数据
				sess.inputTokens = event.promptTokens;
				sess.outputTokens = event.completionTokens;
				// contextTokens 优先，否则用 totalTokens
				sess.contextTokens = event.contextTokens ?? event.totalTokens ?? 0;
				// 只有当前显示的会话才刷新 token 显示栏
				if (event.sessionId === this._currentSessionId) {
					this._sessionInputTokens = sess.inputTokens;
					this._sessionOutputTokens = sess.outputTokens;
					this._sessionContextTokens = sess.contextTokens;
					this._updateTokenDisplay();
				}
			}
		}));

		// 拦截：Solo 模式下 Explorer 点文件时，转为在实时跟随 Tab 显示
		//
		// 时序分析（closeEditor(SoloEditorInput) 触发时）：
		//   onWillOpenEditor(file2) 先触发 → 然后才是 onWillCloseEditor(Solo)
		//   所以 _soloExiting 类的过渡标志在 onWillOpenEditor 时还未生效，无法保护。
		//
		// 正确判断方式：利用 group.lock(true) 的语义
		//   Solo 组被锁定后，Explorer 点文件会被 VSCode 重定向到其他组（e.groupId ≠ this.group.id）
		//   Solo 组内部编辑器的激活（如 Solo 关闭后恢复 file2）仍在 Solo 组内（e.groupId === this.group.id）
		//   ─ 只拦截"另一个组"的情况，Solo 组内的事件直接放行
		//   ─ isVisible() 确保退出 Solo 后不再拦截任何事件
		this._register(this.editorService.onWillOpenEditor((e: IEditorWillOpenEvent) => {
			// Solo 面板不可见（已退出 Solo 模式）→ 不拦截
			if (!this.isVisible()) { return; }
			// SoloEditorInput 本身的打开不拦截
			if (e.editor instanceof SoloEditorInput) { return; }
			const resource = e.editor.resource;
			if (!resource) { return; }

			// Solo 组内的事件：Solo 组被锁定，此情况只发生于内部编辑器激活
			// （如 Solo 关闭后 VSCode 恢复组内旧 tab），直接放行，绝不能关闭
			if (e.groupId === this.group.id) { return; }

			// 另一个组：Explorer 点文件被 lock 重定向过来的，在实时跟随 Tab 显示
			const editorToClose = e.editor;
			const targetGroupId = e.groupId;
			Promise.resolve().then(() => {
				const targetGroup = this.editorService.visibleEditorPanes
					.find(p => p.group.id === targetGroupId)?.group;
				targetGroup?.closeEditor(editorToClose).catch(() => { /* ignore */ });
				this.group.focus();
				this._readAndShowInTab(resource);
			});
		}));

		// AI 执行命令时，在终端面板中镜像显示
		this._register(this.maxianService.onAiExecuteCommand((event) => {
			if (!this.isVisible()) { return; }
			if (event.sessionId && event.sessionId !== this._currentSessionId) {
				return;
			}
			this._terminalPanel.mirrorAiCommand(event.command, event.cwd, event.sessionId);
		}));

		// 自动给所有消息行加复制按钮（AI消息、用户消息、完成摘要）

		const getContentText = (el: HTMLElement): string => {
			// 克隆节点，移除时间戳和复制按钮，再取文本
			const clone = el.cloneNode(true) as HTMLElement;
			// 移除所有时间戳（font-size:10px + opacity）
			clone.querySelectorAll('span[style*="opacity: 0.45"], span[style*="opacity:0.45"], div[style*="opacity: 0.45"], div[style*="opacity:0.45"]').forEach(ts => ts.remove());
			// 移除复制按钮
			clone.querySelectorAll('.solo-copy-btn').forEach(btn => btn.remove());
			// 移除头像（单字母 S 或文字）
			clone.querySelectorAll('div[style*="border-radius:50%"], div[style*="border-radius: 50%"]').forEach(av => av.remove());
			return clone.innerText.trim();
		};

		const addCopyBtn = (el: HTMLElement) => {
			if (el.querySelector('.solo-copy-btn')) { return; }
			const btn = document.createElement('div');
			btn.className = 'solo-copy-btn';
			btn.title = '复制';
			btn.style.cssText = `
				position:absolute;top:6px;right:6px;
				width:28px;height:28px;
				background:var(--vscode-editor-background, #1e1e1e);
				border:1px solid var(--vscode-widget-border, rgba(128,128,128,0.3));
				border-radius:6px;cursor:pointer;
				opacity:0;transition:opacity 0.15s;z-index:10;
				display:flex;align-items:center;justify-content:center;
			`;
			// 用两个小方块叠在一起模拟复制图标
			const icon = document.createElement('div');
			icon.style.cssText = `
				width:10px;height:10px;
				border:1.5px solid var(--vscode-descriptionForeground);
				border-radius:2px;
				position:relative;
			`;
			const shadow = document.createElement('div');
			shadow.style.cssText = `
				width:10px;height:10px;
				border:1.5px solid var(--vscode-descriptionForeground);
				border-radius:2px;
				position:absolute;top:-4px;left:4px;
				background:var(--vscode-editor-background, #1e1e1e);
			`;
			icon.appendChild(shadow);
			btn.appendChild(icon);

			btn.onclick = (e) => {
				e.stopPropagation();
				const text = getContentText(el);
				navigator.clipboard.writeText(text).catch(() => {
					const ta = document.createElement('textarea');
					ta.value = text; ta.style.cssText = 'position:fixed;opacity:0;';
					document.body.appendChild(ta); ta.select();
					document.execCommand('copy'); document.body.removeChild(ta);
				});
				// 确认反馈
				icon.style.display = 'none';
				btn.style.color = '#4EC9B0';
				btn.textContent = '✓';
				btn.style.fontSize = '14px';
				btn.style.fontWeight = '700';
				setTimeout(() => {
					btn.textContent = '';
					icon.style.display = '';
					btn.appendChild(icon);
					btn.style.color = '';
					btn.style.fontSize = '';
					btn.style.fontWeight = '';
				}, 2000);
			};
			btn.onmouseenter = () => { btn.style.borderColor = 'var(--vscode-focusBorder, #007acc)'; };
			btn.onmouseleave = () => { btn.style.borderColor = 'var(--vscode-widget-border, rgba(128,128,128,0.3))'; };
			el.style.position = 'relative';
			el.appendChild(btn);
			el.addEventListener('mouseenter', () => { btn.style.opacity = '1'; });
			el.addEventListener('mouseleave', () => { btn.style.opacity = '0'; });
		};

		const scanAndAddCopyBtns = () => {
			// 用户消息、任务完成摘要 — 立即加
			this.messageArea.querySelectorAll('.solo-msg-row-user, .solo-ask-confirmation').forEach(el => {
				addCopyBtn(el as HTMLElement);
			});
			// AI 消息 — 只给非当前流式的加（当前流式气泡会被 textContent='' 清掉）
			this.messageArea.querySelectorAll('.solo-msg-row-ai').forEach(el => {
				if (el === this.lastAiBubble) { return; } // 跳过正在流式的
				addCopyBtn(el as HTMLElement);
			});
		};

		// 监听子树变化，但 addCopyBtn 内部会跳过正在流式的 AI 行
		let scanTimer: any = null;
		const debouncedScan = () => {
			if (scanTimer) { clearTimeout(scanTimer); }
			scanTimer = setTimeout(scanAndAddCopyBtns, 200);
		};
		const observer = new MutationObserver(debouncedScan);
		observer.observe(this.messageArea, { childList: true, subtree: true });

		// 初始扫描（恢复的旧会话）
		setTimeout(scanAndAddCopyBtns, 500);
	}

	// ── 会话管理 ──────────────────────────────────────────────────────────────

	/** 开始新会话（清空中间面板，回到欢迎卡状态，等待用户输入） */
	private _startNewSession(): void {
		this.inputEl?.focus();
		// 如果当前有 running 会话，切换不影响它（依然在后台运行）
		// 清空当前会话选中状态
		if (this._currentSessionId) {
			const prev = this._sessions.find(s => s.id === this._currentSessionId);
			if (prev) {
				prev.leftBtn.classList.remove('active');
				prev.leftBtn.style.background = 'transparent';
			}
			this._currentSessionId = '';
		}
		// 回到欢迎界面（无 msgContainer 激活）
		for (const s of this._sessions) {
			s.msgContainer.style.display = 'none';
		}
		this.welcomeCard.style.display = 'flex';
		this.messageArea.style.display = 'none';
		this.lastAiBubble = null;
		this.lastAiBubbleText = null;
		this._lastAiAccText = '';
		this._collapseReasoning();

		// 重置 Token 统计 + Tab 面板
		this._sessionInputTokens = 0;
		this._sessionOutputTokens = 0;
		this._sessionContextTokens = 0;
		this._updateTokenDisplay();
		this._fileContentCache.clear();
		// 清空 Tab
		this._liveTabs.forEach(t => t.btn.remove());
		this._liveTabs = [];
		this._activeTabPath = '';
		this.liveTabBar.textContent = '';
		const pre = (this.liveTabContent as any)._pre as HTMLElement | undefined;
		if (pre) { pre.textContent = ''; }
		this.liveTabContent.style.display = 'none';
		this.liveEmptyHint.style.display = 'flex';
	}

	/** 创建新会话并切换到它 */
	private _createSession(title: string): string {
		const id = Date.now().toString();

		// 创建该会话的消息容器（是 messageArea 的子节点）
		const msgContainer = document.createElement('div');
		msgContainer.style.cssText = 'display:flex;flex-direction:column;gap:12px;';
		this.messageArea.appendChild(msgContainer);

		// 左侧列表条目（传入创建时间）
		const now = Date.now();
		const leftBtn = this._buildSessionItem(id, title, 'running', now);

		const session = {
			id,
			title,
			status: 'running' as const,
			time: now,
			msgContainer,
			leftBtn,
			todoTotal: 0,
			todoDone: 0,
			inputTokens: 0,
			outputTokens: 0,
			contextTokens: 0,
		};

		this._sessions.push(session);
		this._switchToSession(id);
		this._updateSessionCount();

		return id;
	}

	/** 在左侧会话列表中构建一个条目（含创建时间 + 双击改名） */
	private _buildSessionItem(id: string, title: string, status: 'running' | 'done' | 'error' | 'idle', time?: number): HTMLElement {
		const item = append(this.sessionListEl, $('div.solo-session-item'));
		item.style.cssText = `
			display: flex;
			flex-direction: column;
			gap: 2px;
			padding: 6px 10px 6px 12px;
			cursor: pointer;
			border-radius: 6px;
			margin: 1px 6px;
			transition: background 0.15s;
			user-select: none;
			border-left: 2px solid transparent;
		`;
		item.onmouseenter = () => {
			if (id !== this._currentSessionId) {
				item.style.background = 'rgba(128,128,128,0.08)';
			}
		};
		item.onmouseleave = () => {
			if (id !== this._currentSessionId) {
				item.style.background = 'transparent';
			}
		};
		item.onclick = () => this._switchToSession(id);

		// ── 第一行：状态点 + 标题 + 关闭按钮 ──
		const row1 = append(item, $('div'));
		row1.style.cssText = 'display:flex;align-items:center;gap:6px;min-width:0;';

		// 状态点
		const dot = append(row1, $('span'));
		dot.style.cssText = 'width:6px;height:6px;border-radius:50%;flex-shrink:0;transition:background 0.3s;';
		this._applyDotStatus(dot, status);
		(item as any)._dot = dot;

		// 标题（双击进入改名模式）
		const titleEl = append(row1, $('span'));
		titleEl.style.cssText = 'flex:1;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--vscode-foreground);min-width:0;';
		titleEl.textContent = title;
		(item as any)._titleEl = titleEl;

		// 双击改名
		titleEl.addEventListener('dblclick', (e) => {
			e.stopPropagation();
			this._startRename(id, titleEl);
		});

		// 关闭按钮
		const closeBtn = append(row1, $('span.solo-session-close-btn'));
		closeBtn.textContent = '×';
		closeBtn.title = '关闭会话（丢弃历史记录）';
		closeBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			this._closeSession(id);
		});

		// ── 第二行：创建时间 ──
		const row2 = append(item, $('div'));
		row2.style.cssText = 'display:flex;align-items:center;gap:4px;padding-left:12px;';
		const timeEl = append(row2, $('span'));
		timeEl.style.cssText = 'font-size:10px;color:var(--vscode-descriptionForeground);opacity:0.5;';
		const ts = time || parseInt(id, 10) || Date.now();
		const d = new Date(ts);
		const pad = (n: number) => n.toString().padStart(2, '0');
		timeEl.textContent = `${d.getMonth()+1}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;

		return item;
	}

	/** 双击改名：将标题元素替换为 input */
	private _startRename(id: string, titleEl: HTMLElement): void {
		const session = this._sessions.find(s => s.id === id);
		if (!session) { return; }

		const currentTitle = session.title;
		const input = document.createElement('input');
		input.value = currentTitle;
		input.style.cssText = `
			flex: 1;
			font-size: 12px;
			background: var(--vscode-input-background, rgba(128,128,128,0.1));
			border: 1px solid var(--vscode-focusBorder, #FFA500);
			border-radius: 3px;
			color: var(--vscode-foreground);
			padding: 1px 4px;
			outline: none;
			min-width: 0;
			width: 100%;
		`;

		titleEl.replaceWith(input);
		input.focus();
		input.select();

		const commit = () => {
			const newTitle = input.value.trim() || currentTitle;
			session.title = newTitle;
			titleEl.textContent = newTitle;
			input.replaceWith(titleEl);
			// 重新绑定双击
			titleEl.addEventListener('dblclick', (e) => {
				e.stopPropagation();
				this._startRename(id, titleEl);
			});
			this._saveSessionsToStorage();
		};

		input.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') { commit(); }
			if (e.key === 'Escape') {
				input.value = currentTitle;
				commit();
			}
		});
		input.addEventListener('blur', () => commit());
	}

	private _applyDotStatus(dot: HTMLElement, status: 'running' | 'done' | 'error' | 'idle'): void {
		switch (status) {
			case 'running':
				dot.style.background = '#FFA500';
				dot.style.animation = 'solo-pulse 1.5s infinite';
				break;
			case 'done':
				dot.style.background = '#4EC9B0';
				dot.style.animation = 'none';
				break;
			case 'error':
				dot.style.background = '#f48771';
				dot.style.animation = 'none';
				break;
			default:
				dot.style.background = 'rgba(128,128,128,0.5)';
				dot.style.animation = 'none';
		}
	}

	/** 切换到指定会话 */
	private _switchToSession(id: string): void {
		const session = this._sessions.find(s => s.id === id);
		if (!session) { return; }
		// 切换会话时关闭上一个会话的工具批次
		this._closeToolBatch();

		// 取消之前高亮
		if (this._currentSessionId && this._currentSessionId !== id) {
			const prev = this._sessions.find(s => s.id === this._currentSessionId);
			if (prev) {
				prev.leftBtn.style.background = 'transparent';
				prev.leftBtn.style.borderLeft = '2px solid transparent';
			}
		}

		this._currentSessionId = id;

		// 恢复目标会话的 token 统计显示
		this._sessionInputTokens = session.inputTokens;
		this._sessionOutputTokens = session.outputTokens;
		this._sessionContextTokens = session.contextTokens;
		this._updateTokenDisplay();

		// 同步 isRunning 状态为目标会话的运行状态
		const targetRunning = session.status === 'running';
		if (this.isRunning !== targetRunning) {
			this._setRunning(targetRunning);
		}

		// 高亮当前条目
		session.leftBtn.style.background = 'rgba(255,140,0,0.12)';
		session.leftBtn.style.borderLeft = '2px solid #FFA500';

		// 显示当前会话的消息容器，隐藏其他
		for (const s of this._sessions) {
			s.msgContainer.style.display = s.id === id ? 'flex' : 'none';
		}

		// 显示消息区，隐藏欢迎卡
		this.welcomeCard.style.display = 'none';
		this.messageArea.style.display = 'flex';

		// 滚动到底部
		setTimeout(() => this._scrollToBottom(), 50);
	}

	/** 更新会话状态点 */
	private _updateSessionStatus(id: string, status: 'running' | 'done' | 'error' | 'idle'): void {
		const session = this._sessions.find(s => s.id === id);
		if (!session) { return; }
		session.status = status;
		const dot = (session.leftBtn as any)._dot as HTMLElement;
		if (dot) {
			this._applyDotStatus(dot, status);
		}
	}

	/** 更新左侧会话数量 */
	private _updateSessionCount(): void {
		this.taskProgressText.textContent = `会话  ${this._sessions.length}`;
	}

	/** 关闭（删除）指定会话 */
	private _closeSession(id: string): void {
		const idx = this._sessions.findIndex(s => s.id === id);
		if (idx === -1) { return; }

		const session = this._sessions[idx];

		// 从 DOM 移除
		session.leftBtn.remove();
		session.msgContainer.remove();
		this._sessions.splice(idx, 1);

		this._updateSessionCount();
		this._saveSessionsToStorage();

		// 如果关闭的是当前会话，切换到相邻会话或回到欢迎页
		if (this._currentSessionId === id) {
			this._currentSessionId = '';
			this._closeToolBatch();
			this.lastAiBubble = null;
			this.lastAiBubbleText = null;
			this._lastAiAccText = '';

			if (this._sessions.length > 0) {
				const next = this._sessions[Math.min(idx, this._sessions.length - 1)];
				this._switchToSession(next.id);
			} else {
				// 无会话 → 回到欢迎页
				for (const s of this._sessions) { s.msgContainer.style.display = 'none'; }
				this.welcomeCard.style.display = 'flex';
				this.messageArea.style.display = 'none';
			}
		}
	}

	// ── 会话持久化（写入项目文件） ─────────────────────────────────────────

	/** 返回当前工作区的 sessions 文件 URI（{workspaceRoot}/.maxian/sessions.json） */
	private _getSessionsFileUri(): URI | null {
		const folders = this.workspaceContextService.getWorkspace().folders;
		if (folders.length === 0) { return null; }
		return URI.joinPath(folders[0].uri, '.maxian', 'sessions.json');
	}

	/** 将所有会话序列化并写入 {workspaceRoot}/.maxian/sessions.json（含 AI 上下文历史） */
	private _saveSessionsToStorage(): void {
		const uri = this._getSessionsFileUri();
		if (!uri) { return; }
		if (this._sessions.length === 0) { return; }
		try {
			const stored = this._sessions.map(s => {
				const history = this.maxianService.getSoloSessionHistory(s.id);
				// Solo-Save 日志已移除
				return {
					id: s.id,
					title: s.title,
					status: s.status === 'running' ? 'done' : s.status,
					time: s.time,
					html: this._cleanHtmlForSave(s.msgContainer.innerHTML),
					history,
				};
			});
			const json = JSON.stringify(stored, null, 2);
			// 异步写入，不阻塞 UI
			this.fileService.writeFile(uri, VSBuffer.fromString(json)).catch(() => { /* ignore */ });
		} catch { /* ignore */ }
	}

	/** 从 {workspaceRoot}/.maxian/sessions.json 读取历史会话（异步，加载后渲染） */
	/** 恢复 HTML 后重新绑定事件（reasoning 展开/收起、工具批次展开/收起、复制按钮） */
	/** 保存前清理 HTML：用正则移除 UI 功能元素（避免 innerHTML 赋值触发 CSP TrustedHTML） */
	private _cleanHtmlForSave(html: string): string {
		return html
			// 移除复制按钮（各种形式）
			.replace(/<button[^>]*class="[^"]*solo-copy-btn[^"]*"[^>]*>[\s\S]*?<\/button>/g, '')
			.replace(/<div[^>]*class="[^"]*solo-copy-btn[^"]*"[^>]*>[\s\S]*?<\/div>/g, '')
			.replace(/<div[^>]*class="[^"]*solo-code-copy[^"]*"[^>]*>[\s\S]*?<\/div>/g, '')
			.replace(/<div[^>]*class="[^"]*solo-bubble-copy[^"]*"[^>]*>[\s\S]*?<\/div>/g, '')
			.replace(/<button[^>]*class="codicon codicon-copy[^"]*"[^>]*>[\s\S]*?<\/button>/g, '')
			// 移除进度提示
			.replace(/<div[^>]*class="[^"]*solo-progress-hint[^"]*"[^>]*>[\s\S]*?<\/div>/g, '');
	}

	private _rebindRestoredEvents(container: HTMLElement): void {
		// 0. 清理旧的复制按钮（从 sessions.json HTML 恢复的，codicon 不可见且无事件）
		container.querySelectorAll('.solo-copy-btn, .solo-code-copy, .solo-bubble-copy').forEach(el => el.remove());
		// 旧的 codicon-copy 按钮（可能残留在保存的 HTML 中）
		container.querySelectorAll('button.codicon.codicon-copy').forEach(el => el.remove());

		// 1. Reasoning bubble 展开/收起
		container.querySelectorAll('.solo-reasoning-header').forEach(header => {
			const wrapper = header.parentElement;
			if (!wrapper) { return; }
			const contentEl = wrapper.querySelector('.solo-reasoning-text') as HTMLElement;
			const chevron = header.querySelector('.codicon-chevron-down, .codicon-chevron-right') as HTMLElement;
			if (!contentEl) { return; }
			let collapsed = contentEl.style.display === 'none';
			header.addEventListener('click', () => {
				collapsed = !collapsed;
				contentEl.style.display = collapsed ? 'none' : 'block';
				if (chevron) {
					chevron.style.transform = collapsed ? 'rotate(-90deg)' : 'rotate(0deg)';
				}
			});
		});

		// 2. 工具批次展开/收起
		container.querySelectorAll('.solo-tool-batch-summary').forEach(summary => {
			const wrapper = summary.parentElement;
			if (!wrapper) { return; }
			const details = wrapper.querySelector('div[style*="border-top"]') as HTMLElement;
			const chevron = summary.querySelector('.codicon-chevron-right') as HTMLElement;
			if (!details) { return; }
			let expanded = details.style.display !== 'none';
			summary.addEventListener('click', () => {
				expanded = !expanded;
				details.style.display = expanded ? 'block' : 'none';
				if (chevron) {
					chevron.style.transform = expanded ? 'rotate(90deg)' : 'rotate(0deg)';
				}
			});
		});

		// 3. 代码块复制按钮
		container.querySelectorAll('.solo-md-code-block').forEach(pre => {
			// 移除旧的（可能是空的）复制按钮占位
			const oldCopy = pre.querySelector('.solo-code-copy');
			if (oldCopy) { oldCopy.remove(); }
			const codeCopyWrap = document.createElement('div');
			codeCopyWrap.className = 'solo-code-copy';
			const codeText = (pre as HTMLElement).textContent || '';
			createCopyButton(codeCopyWrap, () => codeText);
			pre.appendChild(codeCopyWrap);
		});
	}

	private _loadSessionsFromStorage(): void {
		const uri = this._getSessionsFileUri();
		if (!uri) { return; }
		this.fileService.readFile(uri).then(file => {
			try {
				const stored = JSON.parse(file.value.toString()) as Array<{
					id: string; title: string; status: string; time: number; html: string; history?: unknown[];
				}>;
				for (const item of stored) {
					// 避免重复加载
					if (this._sessions.find(s => s.id === item.id)) { continue; }
					const msgContainer = document.createElement('div');
					msgContainer.style.cssText = 'display:none;flex-direction:column;gap:12px;';
					if (item.html) {
						// 使用扩展的白名单恢复 HTML，包含 table/img/em 等 Solo 渲染用到的标签
						safeInnerHtml(msgContainer, item.html, SOLO_SESSION_PURIFY_CONFIG);
						this._rebindRestoredEvents(msgContainer);
					}
					this.messageArea.appendChild(msgContainer);

					// 恢复 AI 消息历史，使后续对话可以延续上下文
					console.log(`[ToolTrace] [Solo-Load] session=${item.id.slice(-6)}, historyLen=${Array.isArray(item.history) ? item.history.length : 0}`);
					if (item.history && Array.isArray(item.history) && item.history.length > 0) {
						this.maxianService.setSoloSessionHistory(item.id, item.history as any[]);
					}

					const status = (item.status as 'done' | 'error' | 'idle') || 'done';
					const leftBtn = this._buildSessionItem(item.id, item.title, status, item.time);

					this._sessions.push({
						id: item.id,
						title: item.title,
						status,
						time: item.time,
						msgContainer,
						leftBtn,
						todoTotal: 0,
						todoDone: 0,
						inputTokens: 0,
						outputTokens: 0,
						contextTokens: 0,
					});
				}
				this._updateSessionCount();
			} catch { /* json parse error, ignore */ }
		}).catch(() => { /* file not found yet, ignore */ });
	}

	/** 获取当前会话的消息容器（append 消息时使用） */
	private _getCurrentMsgContainer(): HTMLElement {
		if (this._currentSessionId) {
			const session = this._sessions.find(s => s.id === this._currentSessionId);
			if (session) { return session.msgContainer; }
		}
		// 兜底：直接用 messageArea
		return this.messageArea;
	}

	// ── 消息处理 ──────────────────────────────────────────────────────────────

	private _handleMessage(event: IMessageEvent, isCurrentSession: boolean = true): void {
		switch (event.type) {
			case 'user':
				this._appendUserBubble(event.content);
				if (isCurrentSession) { this._setRunning(true); }
				else { this._updateSessionStatus(event.sessionId!, 'running'); }
				break;

			case 'reasoning':
				if (isCurrentSession) { this._appendOrUpdateReasoning(event.content); }
				break;

			case 'assistant':
				if (event.isPartial) {
					this._appendOrUpdateAIText(event.content);
				} else {
					this._finalizeAIText(event.content);
				}
				break;

			case 'complete':
				// 任务真正完成（TaskStatus.COMPLETED），结束运行状态
				if (isCurrentSession) { this._setRunning(false); }
				else { this._updateSessionStatus(event.sessionId!, 'done'); }
				break;

			case 'progress':
				if (isCurrentSession) { this._updateProgressHint(event.content); }
				break;

			case 'error':
				this._appendErrorBubble(event.content);
				if (isCurrentSession) { this._setRunning(false); }
				else { this._updateSessionStatus(event.sessionId!, 'error'); }
				break;
		}
	}

	private _handleClineMessage(msg: ClineMessage, isCurrentSession: boolean = true): void {
		if (msg.type === 'say') {
			switch (msg.say) {
				case 'tool':
					this._appendToolLog(msg);
					if (isCurrentSession) { this._trackFileFromTool(msg); }
					break;
				case 'completion_result':
					this._closeToolBatch();
					this._appendCompletionDone(msg.text || '');
					break;
				case 'file_changes':
					this._appendFileChangesSummary(msg.text || '');
					break;
			}
		} else if (msg.type === 'ask') {
			this._handleAskMessage(msg, isCurrentSession);
		}
	}

	private _handleAskMessage(msg: ClineMessage, isCurrentSession: boolean = true): void {
		switch (msg.ask) {
			case 'completion_result':
				this._appendCompletionDone(msg.text || '');
				this._pendingAskTs = null;
				this.maxianService.handleAskResponse(msg.ts, 'yesButtonClicked', undefined, undefined, this._currentSessionId || undefined);
				if (isCurrentSession) { this._setRunning(false); }
				else { this._updateSessionStatus(this._currentSessionId, 'done'); }
				break;

			case 'followup':
				if (isCurrentSession) {
					this._pendingAskTs = msg.ts;
					this._appendAskFollowup(msg);
					// followup = 任务暂停等待用户输入，解除 running 锁定
					// 用 idle 状态，让主输入框可用（_sendMessage 会把输入作为 followup 回应）
					this._setRunning(false);
					this._updateSessionStatus(this._currentSessionId, 'idle');
				} else {
					// 后台会话的 followup：自动回复，不中断用户当前工作
					this.maxianService.handleAskResponse(msg.ts, 'yesButtonClicked', undefined, undefined, this._currentSessionId || undefined);
				}
				break;

			case 'resume_task':
			case 'resume_completed_task':
				this._pendingAskTs = null;
				this.maxianService.handleAskResponse(msg.ts, 'yesButtonClicked', undefined, undefined, this._currentSessionId || undefined);
				break;

			default:
				this._pendingAskTs = null;
				this.maxianService.handleAskResponse(msg.ts, 'yesButtonClicked', undefined, undefined, this._currentSessionId || undefined);
				break;
		}
	}

	/** Solo 模式任务完成提示（无需用户确认，自动接受） */
	private _appendCompletionDone(text?: string): void {
		this._closeToolBatch();
		this._collapseReasoning();
		const container = this._getCurrentMsgContainer();

		const bar = document.createElement('div');
		bar.className = 'solo-ask-confirmation';
		bar.style.cssText = `
			padding: 8px 12px;
			border-radius: 8px;
			background: rgba(78,201,176,0.06);
			border: 1px solid rgba(78,201,176,0.2);
			display: flex;
			flex-direction: column;
			gap: 6px;
		`;

		const headerRow = document.createElement('div');
		headerRow.style.cssText = 'display:flex;align-items:center;gap:8px;';

		const icon = document.createElement('span');
		icon.className = 'codicon codicon-check-all';
		icon.style.cssText = 'font-size:14px;color:var(--vscode-charts-green,#4EC9B0);flex-shrink:0;';

		const label = document.createElement('span');
		label.style.cssText = 'font-weight:600;color:var(--vscode-charts-green,#4EC9B0);font-size:13px;';
		label.textContent = '任务已完成';

		headerRow.appendChild(icon);
		headerRow.appendChild(label);
		bar.appendChild(headerRow);

		if (text) {
			const desc = document.createElement('div');
			desc.style.cssText = `
				font-size: 13px;
				line-height: 1.6;
				color: var(--vscode-foreground);
				word-break: break-word;
				padding-left: 2px;
			`;
			this._renderMarkdown(text, desc);
			bar.appendChild(desc);
		}

		container.appendChild(bar);
		this._scrollToBottom();
	}

	/** 渲染 followup 问题（AI 提问 + 用户输入）*/
	private _appendAskFollowup(msg: ClineMessage): void {
		this._closeToolBatch();
		const container = this._getCurrentMsgContainer();

		const card = document.createElement('div');
		card.className = 'solo-ask-followup';
		card.style.cssText = `
			padding: 12px;
			border-radius: 8px;
			background: var(--vscode-editorWidget-background, rgba(128,128,128,0.08));
			border: 1px solid rgba(255,140,0,0.3);
			display: flex;
			flex-direction: column;
			gap: 10px;
		`;

		// AI 问题
		if (msg.text) {
			const questionDiv = document.createElement('div');
			questionDiv.style.cssText = `
				display: flex;
				gap: 8px;
				align-items: flex-start;
			`;
			const aiIcon = document.createElement('span');
			aiIcon.style.cssText = `
				width: 22px; height: 22px;
				border-radius: 50%;
				background: linear-gradient(135deg,#FFA500,#FF6400);
				display: flex; align-items: center; justify-content: center;
				font-size: 11px; font-weight: 700; color: #fff;
				flex-shrink: 0; margin-top: 1px;
			`;
			aiIcon.textContent = 'S';
			const qText = document.createElement('div');
			qText.style.cssText = 'font-size:13px;color:var(--vscode-foreground);line-height:1.6;flex:1;';
			this._renderMarkdown(msg.text, qText);
			questionDiv.appendChild(aiIcon);
			questionDiv.appendChild(qText);
			card.appendChild(questionDiv);
		}

		// 选项（如果有）
		if (msg.text) {
			try {
				const parsed = JSON.parse(msg.text);
				if (Array.isArray(parsed?.options) && parsed.options.length > 0) {
					const optionsDiv = document.createElement('div');
					optionsDiv.style.cssText = 'display:flex;flex-direction:column;gap:4px;';
					for (const opt of parsed.options as string[]) {
						const optBtn = document.createElement('button');
						optBtn.style.cssText = `
							padding: 6px 12px;
							border: 1px solid rgba(128,128,128,0.25);
							border-radius: 6px;
							background: transparent;
							color: var(--vscode-foreground);
							font-size: 12px;
							cursor: pointer;
							font-family: inherit;
							text-align: left;
							transition: background 0.15s;
						`;
						optBtn.textContent = opt;
						optBtn.onmouseenter = () => { optBtn.style.background = 'rgba(255,140,0,0.1)'; optBtn.style.borderColor = 'rgba(255,140,0,0.4)'; };
						optBtn.onmouseleave = () => { optBtn.style.background = 'transparent'; optBtn.style.borderColor = 'rgba(128,128,128,0.25)'; };
						optBtn.onclick = () => {
							this._appendUserBubble(opt);
							card.style.opacity = '0.5';
							card.style.pointerEvents = 'none';
							this._pendingAskTs = null;
							this._setRunning(true);
							this.maxianService.handleAskResponse(msg.ts, 'messageResponse', opt, undefined, this._currentSessionId || undefined);
						};
						optionsDiv.appendChild(optBtn);
					}
					card.appendChild(optionsDiv);
				}
			} catch { /* not JSON, ignore */ }
		}

		// 自由输入框
		const inputRow = document.createElement('div');
		inputRow.style.cssText = 'display:flex;gap:6px;';

		const followupInput = document.createElement('input');
		followupInput.type = 'text';
		followupInput.placeholder = '输入回复...';
		followupInput.style.cssText = `
			flex: 1;
			padding: 6px 10px;
			border: 1px solid var(--vscode-input-border, rgba(128,128,128,0.3));
			border-radius: 6px;
			background: var(--vscode-input-background);
			color: var(--vscode-input-foreground);
			font-size: 12px;
			font-family: inherit;
			outline: none;
		`;

		const sendBtn = document.createElement('button');
		sendBtn.style.cssText = `
			padding: 6px 12px;
			border: none;
			border-radius: 6px;
			background: rgba(255,140,0,0.2);
			color: #FFA500;
			font-size: 12px;
			cursor: pointer;
			font-family: inherit;
			font-weight: 600;
			transition: background 0.15s;
		`;
		sendBtn.textContent = '发送';
		sendBtn.onmouseenter = () => { sendBtn.style.background = 'rgba(255,140,0,0.35)'; };
		sendBtn.onmouseleave = () => { sendBtn.style.background = 'rgba(255,140,0,0.2)'; };

		const submitFollowup = () => {
			const text = followupInput.value.trim();
			if (!text) { return; }
			this._appendUserBubble(text);
			card.style.opacity = '0.5';
			card.style.pointerEvents = 'none';
			this._pendingAskTs = null;
			// followup 回应后任务重新恢复执行
			this._setRunning(true);
			this.maxianService.handleAskResponse(msg.ts, 'messageResponse', text, undefined, this._currentSessionId || undefined);
		};

		followupInput.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') {
				e.preventDefault();
				submitFollowup();
			}
		});
		sendBtn.onclick = () => submitFollowup();

		inputRow.appendChild(followupInput);
		inputRow.appendChild(sendBtn);
		card.appendChild(inputRow);

		container.appendChild(card);
		// 自动聚焦输入框
		setTimeout(() => followupInput.focus(), 50);
		this._scrollToBottom();
	}

	/** 从工具调用消息中提取文件路径，在实时跟随 Tab 里显示，并记录 diff 统计 */
	private _trackFileFromTool(msg: ClineMessage): void {
		if (!msg.text) { return; }
		try {
			const parsed = JSON.parse(msg.text);
			const tool: string = parsed.tool || '';
			const filePath: string = parsed.path || '';
			if (!filePath) { return; }

			const fileTools = ['write_to_file', 'create_file', 'read_file', 'edit_file', 'edit', 'multiedit', 'apply_diff', 'str_replace', 'patch'];
			if (!fileTools.some(t => tool.includes(t))) { return; }

			const isWrite = ['write_to_file', 'create_file', 'edit_file', 'edit', 'multiedit', 'apply_diff', 'str_replace', 'patch'].some(t => tool.includes(t));
			const uri = URI.file(filePath);

			if (isWrite) {
				// 写入后：读新内容，与缓存的旧内容比较，更新 tab 的 diff 徽章
				this._readAndShowInTabWithDiff(uri);
			} else {
				// 读取：缓存内容，在 Tab 中显示
				this._readAndShowInTab(uri);
			}
		} catch { /* ignore */ }
	}

	/** 读取文件并在 Tab 中显示（读操作，缓存原始内容） */
	private async _readAndShowInTab(uri: URI): Promise<void> {
		const filePath = uri.fsPath;
		const filename = filePath.split('/').pop() || filePath;

		let text = '';
		try {
			const content = await this.fileService.readFile(uri);
			text = content.value.toString();
		} catch { return; }

		// 首次见到这个文件时缓存原始内容
		if (!this._fileContentCache.has(filePath)) {
			this._fileContentCache.set(filePath, text);
		}

		const existing = this._liveTabs.find(t => t.path === filePath);
		if (existing) {
			this._setActiveTab(filePath);
			this._showContentInTab(text);
			return;
		}

		this._createTab(filePath, filename);
		this._setActiveTab(filePath);
		this._showContentInTab(text);
	}

	/** 写入后：读新内容，计算 diff，更新 Tab 显示 */
	private async _readAndShowInTabWithDiff(uri: URI): Promise<void> {
		const filePath = uri.fsPath;
		const filename = filePath.split('/').pop() || filePath;

		let newText = '';
		try {
			const content = await this.fileService.readFile(uri);
			newText = content.value.toString();
		} catch { return; }

		const originalText = this._fileContentCache.get(filePath);

		// 计算 diff 统计
		let additions = 0;
		let deletions = 0;
		if (originalText !== undefined && originalText !== newText) {
			const oldLines = originalText.split('\n');
			const newLines = newText.split('\n');
			const oldSet = new Set(oldLines);
			const newSet = new Set(newLines);
			for (const l of newLines) { if (!oldSet.has(l)) { additions++; } }
			for (const l of oldLines) { if (!newSet.has(l)) { deletions++; } }
		}

		// 更新缓存为最新
		this._fileContentCache.set(filePath, newText);

		// 确保 Tab 存在
		const existing = this._liveTabs.find(t => t.path === filePath);
		if (!existing) {
			this._createTab(filePath, filename);
		}
		this._setActiveTab(filePath);
		this._showContentInTab(newText);

		// 更新 Tab 的 diff 统计徽章
		const tab = this._liveTabs.find(t => t.path === filePath);
		if (tab && tab.tabBadge) {
			if (additions > 0 || deletions > 0) {
				tab.tabBadge.textContent = `+${additions} -${deletions}`;
				tab.tabBadge.style.display = 'inline';
			}
		}
	}

	/** 创建新 Tab 按钮 */
	private _createTab(filePath: string, filename: string): void {
		const tabBtn = append(this.liveTabBar, $('div.solo-live-tab'));
		tabBtn.style.cssText = `
			display: flex;
			align-items: center;
			gap: 4px;
			padding: 0 8px;
			height: 34px;
			font-size: 12px;
			font-family: inherit;
			cursor: pointer;
			white-space: nowrap;
			color: var(--vscode-tab-inactiveForeground);
			background: var(--vscode-tab-inactiveBackground);
			border-right: 1px solid var(--vscode-tab-border, rgba(128,128,128,0.15));
			user-select: none;
			flex-shrink: 0;
			transition: background 0.1s;
		`;

		const tabName = append(tabBtn, $('span'));
		tabName.textContent = filename;

		// Diff 统计徽章（初始隐藏）
		const tabBadge = append(tabBtn, $('span'));
		tabBadge.style.cssText = `
			display: none;
			font-size: 10px;
			padding: 0 4px;
			border-radius: 3px;
			background: rgba(78,201,176,0.15);
			color: #4EC9B0;
			font-weight: 600;
			margin-left: 2px;
		`;

		const closeX = append(tabBtn, $('span'));
		closeX.textContent = '×';
		closeX.style.cssText = 'margin-left:2px;opacity:0.4;font-size:14px;line-height:1;padding:0 2px;border-radius:3px;';
		closeX.onmouseenter = () => { closeX.style.opacity = '1'; closeX.style.background = 'rgba(128,128,128,0.2)'; };
		closeX.onmouseleave = () => { closeX.style.opacity = '0.4'; closeX.style.background = 'transparent'; };
		closeX.onclick = (e) => {
			e.stopPropagation();
			this._closeTab(filePath, tabBtn);
		};

		tabBtn.onclick = () => {
			this._setActiveTab(filePath);
			// 重新加载当前内容
			this._loadAndShowTab(URI.file(filePath));
		};

		this._liveTabs.push({ path: filePath, name: filename, btn: tabBtn, tabBadge });
	}

	private _setActiveTab(filePath: string): void {
		this._activeTabPath = filePath;
		for (const tab of this._liveTabs) {
			const isActive = tab.path === this._activeTabPath;
			tab.btn.style.color = isActive
				? 'var(--vscode-tab-activeForeground, var(--vscode-foreground))'
				: 'var(--vscode-tab-inactiveForeground)';
			tab.btn.style.background = isActive
				? 'var(--vscode-tab-activeBackground, var(--vscode-editor-background))'
				: 'var(--vscode-tab-inactiveBackground)';
			tab.btn.style.borderBottom = isActive ? '2px solid #FFA500' : '2px solid transparent';
		}
		if (this._liveTabs.length > 0) {
			this.liveEmptyHint.style.display = 'none';
			this.liveTabContent.style.display = 'flex';
		}
	}

	private _closeTab(filePath: string, btn: HTMLElement): void {
		const idx = this._liveTabs.findIndex(t => t.path === filePath);
		if (idx === -1) { return; }
		this._liveTabs.splice(idx, 1);
		btn.remove();
		this._fileContentCache.delete(filePath);
		if (this._liveTabs.length === 0) {
			this.liveTabContent.style.display = 'none';
			this.liveEmptyHint.style.display = 'flex';
			this._activeTabPath = '';
		} else {
			const nextTab = this._liveTabs[Math.min(idx, this._liveTabs.length - 1)];
			this._setActiveTab(nextTab.path);
			this._loadAndShowTab(URI.file(nextTab.path));
		}
	}

	/** 显示文本内容（无截断） */
	private _showContentInTab(text: string): void {
		const pre = (this.liveTabContent as any)._pre as HTMLElement;
		if (pre) { pre.textContent = text; }
	}

	/** 从磁盘加载并显示文件内容 */
	private async _loadAndShowTab(uri: URI): Promise<void> {
		const pre = (this.liveTabContent as any)._pre as HTMLElement;
		if (!pre) { return; }
		pre.textContent = '加载中...';
		try {
			const content = await this.fileService.readFile(uri);
			pre.textContent = content.value.toString();
		} catch {
			pre.textContent = '无法读取文件内容';
		}
	}

	private _handleTodoUpdate(event: ITodoListEvent): void {
		const todos = event.todos;
		if (!todos) { return; }

		this.todoTotal = todos.length;
		this.todoDone = todos.filter(t => t.status === 'completed').length;

		// 更新当前会话的 todo 进度
		if (this._currentSessionId) {
			const session = this._sessions.find(s => s.id === this._currentSessionId);
			if (session) {
				session.todoTotal = this.todoTotal;
				session.todoDone = this.todoDone;
			}
		}

		// 渲染 todo 列表到左侧面板
		if (todos.length === 0) {
			this._todoListEl.style.display = 'none';
			return;
		}

		this._todoListEl.style.display = 'block';
		// 清空旧内容
		while (this._todoListEl.firstChild) {
			this._todoListEl.removeChild(this._todoListEl.firstChild);
		}

		// 标题
		const header = document.createElement('div');
		header.style.cssText = 'font-size:11px;font-weight:600;color:var(--vscode-foreground);margin-bottom:6px;display:flex;align-items:center;gap:4px;';
		const headerIcon = document.createElement('span');
		headerIcon.className = 'codicon codicon-checklist';
		headerIcon.style.cssText = 'font-size:12px;';
		header.appendChild(headerIcon);
		header.appendChild(document.createTextNode(`执行计划 ${this.todoDone}/${this.todoTotal}`));
		this._todoListEl.appendChild(header);

		// 列表项
		for (const todo of todos) {
			const item = document.createElement('div');
			item.style.cssText = `
				display: flex;
				align-items: flex-start;
				gap: 5px;
				padding: 3px 0;
				font-size: 11px;
				line-height: 1.4;
				color: var(--vscode-descriptionForeground);
			`;

			const icon = document.createElement('span');
			if (todo.status === 'completed') {
				icon.className = 'codicon codicon-check';
				icon.style.cssText = 'font-size:11px;color:var(--vscode-charts-green,#4EC9B0);flex-shrink:0;margin-top:1px;';
			} else if (todo.status === 'in_progress') {
				icon.className = 'codicon codicon-loading codicon-modifier-spin';
				icon.style.cssText = 'font-size:11px;color:#FFA500;flex-shrink:0;margin-top:1px;';
			} else {
				icon.className = 'codicon codicon-circle-outline';
				icon.style.cssText = 'font-size:11px;opacity:0.4;flex-shrink:0;margin-top:1px;';
			}
			item.appendChild(icon);

			const text = document.createElement('span');
			text.textContent = (todo.activeForm || todo.content || '').slice(0, 40);
			if (todo.status === 'completed') {
				text.style.opacity = '0.5';
				text.style.textDecoration = 'line-through';
			} else if (todo.status === 'in_progress') {
				text.style.color = 'var(--vscode-foreground)';
				text.style.fontWeight = '500';
			}
			item.appendChild(text);

			this._todoListEl.appendChild(item);
		}
	}

	// ── 气泡渲染 ──────────────────────────────────────────────────────────────

	private _appendUserBubble(text: string): void {
		this.lastAiBubble = null;
		this.lastAiBubbleText = null;
		this._closeToolBatch();

		const container = this._getCurrentMsgContainer();
		const row = document.createElement('div');
		row.className = 'solo-msg-row-user';
		row.style.cssText = 'display:flex;justify-content:flex-end;';

		const bubble = document.createElement('div');
		bubble.className = 'solo-bubble-content';
		bubble.style.cssText = `
			max-width: 100%;
			padding: 8px 12px;
			border-radius: 12px 12px 4px 12px;
			background: rgba(255,140,0,0.15);
			border: 1px solid rgba(255,140,0,0.3);
			font-size: 13px;
			line-height: 1.6;
			color: var(--vscode-foreground);
			word-break: break-word;
			white-space: pre-wrap;
		`;
		bubble.textContent = text;

		// 时间戳（年月日 时:分:秒）
		const tsEl = document.createElement('div');
		tsEl.style.cssText = 'font-size:10px;color:var(--vscode-descriptionForeground);opacity:0.45;text-align:right;margin-top:2px;padding-right:2px;';
		const now = new Date();
		const pad = (n: number) => n.toString().padStart(2, '0');
		tsEl.textContent = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

		const bubbleWrap = document.createElement('div');
		bubbleWrap.style.cssText = 'display:flex;flex-direction:column;max-width:90%;';
		bubbleWrap.appendChild(bubble);
		bubbleWrap.appendChild(tsEl);

		row.appendChild(bubbleWrap);
		container.appendChild(row);

		this._scrollToBottom();
	}

	private _appendOrUpdateAIText(text: string): void {
		this._clearProgressHint();
		if (!this.lastAiBubble) {
			// 新建 AI 气泡：关闭当前工具批次和思考过程
			this._closeToolBatch();
			this._collapseReasoning();
			const container = this._getCurrentMsgContainer();
			const row = document.createElement('div');
			row.className = 'solo-msg-row-ai';
			row.style.cssText = 'display:flex;gap:8px;align-items:flex-start;';

			const avatar = document.createElement('div');
			avatar.style.cssText = `
				width: 28px;height:28px;flex-shrink:0;
				border-radius:50%;
				background:linear-gradient(135deg,#FFA500,#FF6400);
				display:flex;align-items:center;justify-content:center;
				font-size:12px;font-weight:700;color:#fff;
				margin-top:2px;
			`;
			avatar.textContent = 'S';

			const bubble = document.createElement('div');
			bubble.className = 'solo-bubble-content';
			bubble.style.cssText = `
				flex: 1;
				padding: 8px 12px;
				border-radius: 4px 12px 12px 12px;
				background: var(--vscode-editorWidget-background, rgba(128,128,128,0.08));
				border: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.15));
				font-size: 13px;
				line-height: 1.6;
				color: var(--vscode-foreground);
				word-break: break-word;
			`;

			// 时间戳 + 复制按钮（显示在气泡下方，一行）
			const aiFooter = document.createElement('div');
			aiFooter.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-top:2px;padding:0 2px;';

			const aiTsEl = document.createElement('span');
			aiTsEl.style.cssText = 'font-size:10px;color:var(--vscode-descriptionForeground);opacity:0.45;';
			const aiNow = new Date();
			const aiPad = (n: number) => n.toString().padStart(2, '0');
			aiTsEl.textContent = `${aiNow.getFullYear()}-${aiPad(aiNow.getMonth()+1)}-${aiPad(aiNow.getDate())} ${aiPad(aiNow.getHours())}:${aiPad(aiNow.getMinutes())}:${aiPad(aiNow.getSeconds())}`;
			aiFooter.appendChild(aiTsEl);
			// 复制按钮由 MutationObserver 统一添加，不在这里创建

			// bubbleWrap: 包含气泡 + footer
			const bubbleWrap = document.createElement('div');
			bubbleWrap.style.cssText = 'flex:1;display:flex;flex-direction:column;min-width:0;';
			bubbleWrap.appendChild(bubble);
			bubbleWrap.appendChild(aiFooter);

			row.appendChild(avatar);
			row.appendChild(bubbleWrap);
			container.appendChild(row);

			this.lastAiBubble = row;
			this.lastAiBubbleText = bubble;
			this._lastAiAccText = '';
		}

		if (this.lastAiBubbleText) {
			// chunk 是增量 delta，累积并实时 markdown 渲染
			this._lastAiAccText += text;
			this.lastAiBubbleText.textContent = '';
			this._renderMarkdown(this._lastAiAccText, this.lastAiBubbleText);
		}
		this._scrollToBottom();
	}

	private _finalizeAIText(_text: string): void {
		// 流结束：清空引用，让 Observer 的 scanAndAddCopyBtns 自动加复制按钮
		const finishedRow = this.lastAiBubble;
		this._lastAiAccText = '';
		this.lastAiBubble = null;
		this.lastAiBubbleText = null;
		this._scrollToBottom();
		// 触发一次 DOM mutation 让 Observer 扫描到
		if (finishedRow) {
			requestAnimationFrame(() => {
				finishedRow.setAttribute('data-finalized', 'true');
			});
		}
	}

	/** 思考过程：流式追加，默认展开，AI 文字开始时自动折叠 */
	private _appendOrUpdateReasoning(text: string): void {
		if (!this._reasoningBubble) {
			const container = this._getCurrentMsgContainer();

			const wrapper = document.createElement('div');
			wrapper.className = 'solo-reasoning-bubble';

			const header = document.createElement('div');
			header.className = 'solo-reasoning-header';

			const spinnerIcon = document.createElement('span');
			spinnerIcon.className = 'codicon codicon-loading codicon-modifier-spin';
			spinnerIcon.style.cssText = 'font-size:11px;color:rgba(128,128,128,0.6);flex-shrink:0;';

			const headerLabel = document.createElement('span');
			headerLabel.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);flex:1;';
			headerLabel.textContent = '思考过程';

			const chevron = document.createElement('span');
			chevron.className = 'codicon codicon-chevron-down';
			chevron.style.cssText = 'font-size:10px;opacity:0.5;flex-shrink:0;transition:transform 0.15s;';

			header.appendChild(spinnerIcon);
			header.appendChild(headerLabel);
			header.appendChild(chevron);

			const contentEl = document.createElement('div');
			contentEl.className = 'solo-reasoning-text';

			// 点击切换展开/折叠
			let collapsed = false;
			header.addEventListener('click', () => {
				collapsed = !collapsed;
				contentEl.style.display = collapsed ? 'none' : 'block';
				chevron.style.transform = collapsed ? 'rotate(-90deg)' : 'rotate(0deg)';
			});
			(wrapper as any)._collapse = () => {
				if (!collapsed) {
					collapsed = true;
					contentEl.style.display = 'none';
					chevron.style.transform = 'rotate(-90deg)';
					// 变为静态图标
					spinnerIcon.className = 'codicon codicon-lightbulb';
					spinnerIcon.style.cssText = 'font-size:11px;color:rgba(255,200,0,0.6);flex-shrink:0;';
					headerLabel.textContent = `思考过程（${this._reasoningAccText.length} 字）`;
				}
			};

			wrapper.appendChild(header);
			wrapper.appendChild(contentEl);
			container.appendChild(wrapper);

			this._reasoningBubble = wrapper;
			this._reasoningContent = contentEl;
			this._reasoningAccText = '';
		}

		this._reasoningAccText += text;
		if (this._reasoningContent) {
			this._reasoningContent.textContent = this._reasoningAccText;
			this._reasoningContent.scrollTop = this._reasoningContent.scrollHeight;
		}
		this._scrollToBottom();
	}

	/** 折叠思考过程（AI 正文开始时调用） */
	private _collapseReasoning(): void {
		if (this._reasoningBubble) {
			const fn = (this._reasoningBubble as any)._collapse;
			if (typeof fn === 'function') { fn(); }
			this._reasoningBubble = null;
			this._reasoningContent = null;
			this._reasoningAccText = '';
		}
	}

	/**
	 * 工具调用批次合并显示：同一 AI 回合内连续的工具调用合并为一个可折叠行
	 * 新的 AI 文本气泡或用户消息出现时，自动关闭当前批次
	 */
	private _appendToolLog(msg: ClineMessage): void {
		this._clearProgressHint(); // 工具到达时清除生成进度提示
		let toolName = '';
		let toolTarget = '';

		if (msg.text) {
			try {
				const parsed = JSON.parse(msg.text);
				toolName = parsed.tool || '';
				toolTarget = parsed.path || parsed.command || parsed.query || '';
			} catch {
				toolName = msg.text.slice(0, 40);
			}
		}

		const isCompleted = !msg.partial;
		const container = this._getCurrentMsgContainer();

		// ── 如果没有当前批次，创建新的批次容器 ──
		if (!this._currentToolBatch) {
			const wrapper = document.createElement('div');
			wrapper.className = 'solo-tool-batch';
			wrapper.style.cssText = `
				border-radius: 6px;
				border: 1px solid rgba(78,201,176,0.18);
				background: rgba(78,201,176,0.04);
				font-size: 11px;
				overflow: hidden;
				margin: 0;
			`;

			// 摘要行（始终可见）
			const summaryRow = document.createElement('div');
			summaryRow.className = 'solo-tool-batch-summary';
			summaryRow.style.cssText = `
				display: flex;
				align-items: center;
				gap: 6px;
				padding: 5px 8px;
				cursor: pointer;
				user-select: none;
				border-radius: 6px;
				transition: background 0.15s;
			`;
			summaryRow.title = '点击展开/收起工具调用详情';

			// 状态图标
			const statusIcon = document.createElement('span');
			statusIcon.className = 'codicon codicon-tools';
			statusIcon.style.cssText = 'font-size:11px;flex-shrink:0;color:rgba(78,201,176,0.8);';
			summaryRow.appendChild(statusIcon);

			// "已执行" 标签
			const execLabel = document.createElement('span');
			execLabel.style.cssText = 'color:rgba(78,201,176,0.9);font-weight:600;flex-shrink:0;font-size:11px;';
			execLabel.textContent = '已执行';
			summaryRow.appendChild(execLabel);

			// 工具名称摘要（动态更新）
			const summaryTextEl = document.createElement('span');
			summaryTextEl.style.cssText = 'color:var(--vscode-foreground);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;opacity:0.85;';
			summaryRow.appendChild(summaryTextEl);

			// 调用次数徽章
			const countBadge = document.createElement('span');
			countBadge.style.cssText = `
				background: rgba(78,201,176,0.15);
				color: rgba(78,201,176,0.9);
				border-radius: 10px;
				padding: 1px 6px;
				font-size: 10px;
				font-weight: 600;
				flex-shrink: 0;
				min-width: 18px;
				text-align: center;
			`;
			countBadge.textContent = '0';
			summaryRow.appendChild(countBadge);

			// 折叠箭头
			const chevron = document.createElement('span');
			chevron.className = 'codicon codicon-chevron-right';
			chevron.style.cssText = 'font-size:10px;opacity:0.4;flex-shrink:0;transition:transform 0.15s;';
			summaryRow.appendChild(chevron);

			// 详情区（默认收起）
			const detailsEl = document.createElement('div');
			detailsEl.style.cssText = 'display:none;border-top:1px solid rgba(128,128,128,0.1);';

			// 点击切换展开/收起
			summaryRow.addEventListener('click', () => {
				if (!this._currentToolBatch && wrapper !== null) {
					// 批次已关闭，仍可展开
					const isExpanded = detailsEl.style.display !== 'none';
					detailsEl.style.display = isExpanded ? 'none' : 'block';
					chevron.style.transform = isExpanded ? 'rotate(0deg)' : 'rotate(90deg)';
				} else if (this._currentToolBatch) {
					this._currentToolBatch.expanded = !this._currentToolBatch.expanded;
					detailsEl.style.display = this._currentToolBatch.expanded ? 'block' : 'none';
					chevron.style.transform = this._currentToolBatch.expanded ? 'rotate(90deg)' : 'rotate(0deg)';
				}
			});

			wrapper.appendChild(summaryRow);
			wrapper.appendChild(detailsEl);
			container.appendChild(wrapper);

			this._currentToolBatch = {
				wrapper,
				detailsEl,
				items: [],
				toolCounts: new Map(),
				summaryTextEl,
				countBadge,
				expanded: false,
				chevron,
			};
		}

		// ── 将当前工具调用加入批次 ──
		const batch = this._currentToolBatch;
		batch.items.push({ toolName, target: toolTarget });

		// 更新工具名称计数
		batch.toolCounts.set(toolName, (batch.toolCounts.get(toolName) || 0) + 1);

		// 更新摘要文字：readFile × 3，listFiles × 2
		const summaryParts: string[] = [];
		for (const [tool, count] of batch.toolCounts) {
			summaryParts.push(count > 1 ? `${tool} × ${count}` : tool);
		}
		batch.summaryTextEl.textContent = '  ' + summaryParts.join('，');

		// 更新总次数徽章
		batch.countBadge.textContent = String(batch.items.length);

		// 在详情区追加一条记录
		const detailItem = document.createElement('div');
		detailItem.className = 'solo-tool-batch-detail-item';
		detailItem.style.cssText = `
			display: flex;
			align-items: center;
			gap: 6px;
			padding: 3px 8px 3px 24px;
			font-size: 11px;
			color: var(--vscode-descriptionForeground);
			transition: background 0.1s;
		`;

		const icon = document.createElement('span');
		icon.className = 'codicon ' + (isCompleted ? 'codicon-check' : 'codicon-loading codicon-modifier-spin');
		icon.style.cssText = 'font-size:10px;flex-shrink:0;color:' + (isCompleted ? '#4EC9B0' : '#FFA500') + ';';
		detailItem.appendChild(icon);

		const nameEl = document.createElement('span');
		nameEl.style.cssText = 'color:var(--vscode-foreground);font-weight:500;flex-shrink:0;';
		nameEl.textContent = toolName;
		detailItem.appendChild(nameEl);

		if (toolTarget) {
			const targetEl = document.createElement('span');
			targetEl.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;opacity:0.55;padding-left:4px;';
			targetEl.textContent = toolTarget.split('/').pop() || toolTarget;
			targetEl.title = toolTarget;
			detailItem.appendChild(targetEl);
		}

		batch.detailsEl.appendChild(detailItem);

		this._scrollToBottom();
	}

	/** 关闭当前工具批次（新 AI 文本或用户消息出现时调用） */
	private _closeToolBatch(): void {
		this._currentToolBatch = null;
	}

	private _appendFileChangesSummary(text: string): void {
		if (!text) { return; }
		const container = this._getCurrentMsgContainer();

		// 尝试解析 JSON 格式的文件变更
		let written: string[] = [];
		let deleted: string[] = [];
		try {
			const parsed = JSON.parse(text);
			written = (parsed.written || []).map((f: string) => f.split('/').pop() || f);
			deleted = (parsed.deleted || []).map((f: string) => f.split('/').pop() || f);
		} catch {
			// 非 JSON 格式，跳过
			return;
		}

		if (written.length === 0 && deleted.length === 0) { return; }

		const row = document.createElement('div');
		row.className = 'solo-file-changes';
		row.style.cssText = `
			padding: 6px 10px;
			border-radius: 6px;
			background: rgba(128,128,128,0.04);
			border: 1px solid rgba(128,128,128,0.12);
			font-size: 11px;
			color: var(--vscode-descriptionForeground);
			display: flex;
			align-items: center;
			gap: 6px;
			flex-wrap: wrap;
		`;

		const icon = document.createElement('span');
		icon.className = 'codicon codicon-file';
		icon.style.cssText = 'font-size:11px;flex-shrink:0;opacity:0.6;';
		row.appendChild(icon);

		if (written.length > 0) {
			const span = document.createElement('span');
			span.textContent = `已修改 ${written.join('、')}`;
			row.appendChild(span);
		}
		if (deleted.length > 0) {
			const span = document.createElement('span');
			span.style.color = 'var(--vscode-errorForeground, #f44)';
			span.textContent = `已删除 ${deleted.join('、')}`;
			row.appendChild(span);
		}

		container.appendChild(row);
		this._scrollToBottom();
	}

	private _appendErrorBubble(text: string): void {
		const container = this._getCurrentMsgContainer();

		const row = document.createElement('div');
		row.className = 'solo-error';
		row.style.cssText = `
			padding: 8px 12px;
			border-radius: 6px;
			background: rgba(244,135,113,0.08);
			border: 1px solid rgba(244,135,113,0.25);
			font-size: 12px;
			color: var(--vscode-charts-red, #f48771);
			white-space: pre-wrap;
			word-break: break-word;
			display: flex;
			gap: 8px;
			align-items: flex-start;
		`;
		const errIcon = document.createElement('span');
		errIcon.className = 'codicon codicon-error';
		errIcon.style.cssText = 'font-size:13px;flex-shrink:0;margin-top:1px;';
		const errText = document.createElement('span');
		errText.textContent = text;
		row.appendChild(errIcon);
		row.appendChild(errText);
		container.appendChild(row);
		this._scrollToBottom();
	}

	/** 工具参数生成进度提示（流式更新，工具完成后自动消失） */
	private _progressHintEl: HTMLElement | null = null;

	// ── @mention 文件引用 ──────────────────────────────────────────────────

	/** 检测输入框中是否触发了 @ */
	private _checkMentionTrigger(): void {
		const sel = window.getSelection();
		if (!sel || sel.rangeCount === 0) { return; }
		const range = sel.getRangeAt(0);
		if (!range.collapsed) { this._hideMentionDropdown(); return; }

		const node = range.startContainer;
		if (node.nodeType !== Node.TEXT_NODE) { this._hideMentionDropdown(); return; }

		const text = node.textContent || '';
		const cursorPos = range.startOffset;

		// 找到光标前最近的 @
		const before = text.substring(0, cursorPos);
		const atIdx = before.lastIndexOf('@');
		if (atIdx === -1) { this._hideMentionDropdown(); return; }

		const query = before.substring(atIdx + 1);
		if (query.includes(' ') || query.includes('\n')) { this._hideMentionDropdown(); return; }

		// 使用 maxianService.getWorkspaceFiles（与 IDE 模式一致）
		this.maxianService.getWorkspaceFiles(query).then(files => {
			if (files.length === 0) { this._hideMentionDropdown(); return; }
			this._showMentionDropdown(files.slice(0, 20), node as Text, atIdx, cursorPos);
		}).catch(() => this._hideMentionDropdown());
	}

	/** 显示 @mention 下拉列表 */
	private _showMentionDropdown(files: string[], textNode: Text, atOffset: number, cursorOffset: number): void {
		this._mentionItems = files;
		this._mentionIndex = 0;

		if (!this._mentionDropdown) {
			this._mentionDropdown = document.createElement('div');
			this._mentionDropdown.style.cssText = `
				position: absolute;
				bottom: 100%;
				left: 12px;
				right: 12px;
				max-height: 200px;
				overflow-y: auto;
				background: var(--vscode-dropdown-background);
				border: 1px solid var(--vscode-dropdown-border, rgba(128,128,128,0.4));
				border-radius: 8px;
				box-shadow: 0 4px 16px rgba(0,0,0,0.2);
				z-index: 10000;
				padding: 4px 0;
			`;
			// 挂载到输入框的父容器
			const inputParent = this.inputEl.parentElement;
			if (inputParent) {
				inputParent.style.position = 'relative';
				inputParent.appendChild(this._mentionDropdown);
			}
		}

		// 渲染列表
		this._mentionDropdown.style.display = 'block';
		while (this._mentionDropdown.firstChild) {
			this._mentionDropdown.removeChild(this._mentionDropdown.firstChild);
		}

		files.forEach((file, idx) => {
			const item = document.createElement('div');
			item.style.cssText = `
				padding: 6px 12px;
				font-size: 12px;
				cursor: pointer;
				display: flex;
				align-items: center;
				gap: 6px;
				color: var(--vscode-foreground);
				${idx === this._mentionIndex ? 'background: var(--vscode-list-hoverBackground, rgba(128,128,128,0.15));' : ''}
			`;
			const icon = document.createElement('span');
			icon.className = 'codicon codicon-file';
			icon.style.cssText = 'font-size:12px;opacity:0.6;flex-shrink:0;';
			item.appendChild(icon);
			const nameEl = document.createElement('span');
			nameEl.textContent = file;
			item.appendChild(nameEl);

			item.addEventListener('mousedown', (e) => {
				e.preventDefault();
				this._insertMention(file, textNode, atOffset, cursorOffset);
			});
			item.addEventListener('mouseenter', () => {
				this._mentionIndex = idx;
				// 更新高亮
				Array.from(this._mentionDropdown!.children).forEach((child, i) => {
					(child as HTMLElement).style.background = i === idx
						? 'var(--vscode-list-hoverBackground, rgba(128,128,128,0.15))'
						: 'transparent';
				});
			});
			this._mentionDropdown!.appendChild(item);
		});

		// 键盘导航
		this.inputEl.addEventListener('keydown', this._mentionKeyHandler);
	}

	private _mentionKeyHandler = (e: KeyboardEvent): void => {
		if (!this._mentionDropdown || this._mentionDropdown.style.display === 'none') { return; }
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			this._mentionIndex = Math.min(this._mentionIndex + 1, this._mentionItems.length - 1);
			this._updateMentionHighlight();
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			this._mentionIndex = Math.max(this._mentionIndex - 1, 0);
			this._updateMentionHighlight();
		} else if (e.key === 'Enter' || e.key === 'Tab') {
			if (this._mentionItems.length > 0 && this._mentionIndex >= 0) {
				e.preventDefault();
				e.stopPropagation();
				// 需要重新获取当前文本节点和偏移
				const sel = window.getSelection();
				if (sel && sel.rangeCount > 0) {
					const range = sel.getRangeAt(0);
					const node = range.startContainer as Text;
					const text = node.textContent || '';
					const atIdx = text.lastIndexOf('@', range.startOffset - 1);
					this._insertMention(this._mentionItems[this._mentionIndex], node, atIdx, range.startOffset);
				}
			}
		} else if (e.key === 'Escape') {
			e.preventDefault();
			this._hideMentionDropdown();
		}
	};

	private _updateMentionHighlight(): void {
		if (!this._mentionDropdown) { return; }
		Array.from(this._mentionDropdown.children).forEach((child, i) => {
			(child as HTMLElement).style.background = i === this._mentionIndex
				? 'var(--vscode-list-hoverBackground, rgba(128,128,128,0.15))'
				: 'transparent';
		});
		// 滚动到可见
		const active = this._mentionDropdown.children[this._mentionIndex] as HTMLElement;
		if (active) { active.scrollIntoView({ block: 'nearest' }); }
	}

	/** 插入 @file 引用 */
	private _insertMention(filePath: string, textNode: Text, atOffset: number, cursorOffset: number): void {
		// 替换 @query 为 @filePath
		const text = textNode.textContent || '';
		const before = text.substring(0, atOffset);
		const after = text.substring(cursorOffset);

		// 创建 mention chip
		const chip = document.createElement('span');
		chip.contentEditable = 'false';
		chip.setAttribute('data-mention', filePath);
		chip.style.cssText = `
			display: inline-flex;
			align-items: center;
			gap: 3px;
			background: rgba(99,132,255,0.15);
			color: var(--vscode-textLink-foreground, #6384ff);
			border-radius: 4px;
			padding: 1px 6px;
			font-size: 12px;
			margin: 0 2px;
			cursor: default;
			vertical-align: baseline;
		`;
		const chipIcon = document.createElement('span');
		chipIcon.className = 'codicon codicon-file';
		chipIcon.style.cssText = 'font-size:11px;';
		chip.appendChild(chipIcon);
		chip.appendChild(document.createTextNode(filePath.split('/').pop() || filePath));

		// 替换文本节点
		const parent = textNode.parentNode!;
		const beforeNode = document.createTextNode(before);
		const afterNode = document.createTextNode(after.startsWith(' ') ? after : ' ' + after);

		parent.insertBefore(beforeNode, textNode);
		parent.insertBefore(chip, textNode);
		parent.insertBefore(afterNode, textNode);
		parent.removeChild(textNode);

		// 光标移到 chip 后面
		const sel = window.getSelection();
		const range = document.createRange();
		range.setStart(afterNode, afterNode.textContent?.startsWith(' ') ? 1 : 0);
		range.collapse(true);
		sel?.removeAllRanges();
		sel?.addRange(range);

		this._hideMentionDropdown();
	}

	private _hideMentionDropdown(): void {
		if (this._mentionDropdown) {
			this._mentionDropdown.style.display = 'none';
		}
		this.inputEl.removeEventListener('keydown', this._mentionKeyHandler);
	}

	private _updateProgressHint(text: string): void {
		const container = this._getCurrentMsgContainer();

		if (!this._progressHintEl) {
			this._progressHintEl = document.createElement('div');
			this._progressHintEl.style.cssText = `
				padding: 4px 10px;
				font-size: 11px;
				color: var(--vscode-descriptionForeground);
				opacity: 0.7;
				display: flex;
				align-items: center;
				gap: 6px;
			`;
			const spinner = document.createElement('span');
			spinner.className = 'codicon codicon-loading codicon-modifier-spin';
			spinner.style.cssText = 'font-size:11px;flex-shrink:0;';
			this._progressHintEl.appendChild(spinner);
			const label = document.createElement('span');
			label.setAttribute('data-role', 'progress-text');
			this._progressHintEl.appendChild(label);
			container.appendChild(this._progressHintEl);
		}

		const label = this._progressHintEl.querySelector('[data-role="progress-text"]') as HTMLSpanElement;
		if (label) { label.textContent = text; }
		this._scrollToBottom();
	}

	/** 工具完成后清除进度提示 */
	private _clearProgressHint(): void {
		if (this._progressHintEl) {
			this._progressHintEl.remove();
			this._progressHintEl = null;
		}
	}

	// ── Markdown 渲染 ──────────────────────────────────────────────────────────

	/**
	 * 将 markdown 文本渲染为 DOM 元素，追加到 parent 中
	 * CSP 安全：不使用 innerHTML，全部通过 DOM API 创建节点
	 */
	private _renderMarkdown(text: string, parent: HTMLElement): void {
		if (!text) { return; }

		const lines = text.split('\n');
		let i = 0;

		while (i < lines.length) {
			const line = lines[i];

			// 代码块 ```
			if (line.trimStart().startsWith('```')) {
				const lang = line.trimStart().slice(3).trim();
				const codeLines: string[] = [];
				i++;
				while (i < lines.length && !lines[i].trimStart().startsWith('```')) {
					codeLines.push(lines[i]);
					i++;
				}
				i++; // skip closing ```
				const pre = document.createElement('pre');
				pre.className = 'solo-md-code-block';
				pre.textContent = codeLines.join('\n');
				if (lang) { pre.setAttribute('data-lang', lang); }
				// 代码块复制按钮
				const codeCopyWrap = document.createElement('div');
				codeCopyWrap.className = 'solo-code-copy';
				const codeText = codeLines.join('\n');
				createCopyButton(codeCopyWrap, () => codeText);
				pre.appendChild(codeCopyWrap);
				parent.appendChild(pre);
				continue;
			}

			// H1 #
			if (/^# /.test(line)) {
				const h = document.createElement('div');
				h.className = 'solo-md-h1';
				this._renderInline(line.replace(/^# /, ''), h);
				parent.appendChild(h);
				i++;
				continue;
			}

			// H2 ##
			if (/^## /.test(line)) {
				const h = document.createElement('div');
				h.className = 'solo-md-h2';
				this._renderInline(line.replace(/^## /, ''), h);
				parent.appendChild(h);
				i++;
				continue;
			}

			// H3 ###
			if (/^### /.test(line)) {
				const h = document.createElement('div');
				h.className = 'solo-md-h3';
				this._renderInline(line.replace(/^### /, ''), h);
				parent.appendChild(h);
				i++;
				continue;
			}

			// H4 ####
			if (/^#### /.test(line)) {
				const h = document.createElement('div');
				h.style.cssText = 'font-weight:600;font-size:12px;margin:6px 0 3px;color:var(--vscode-foreground);';
				this._renderInline(line.replace(/^#### /, ''), h);
				parent.appendChild(h);
				i++;
				continue;
			}

			// H5 #####
			if (/^##### /.test(line)) {
				const h = document.createElement('div');
				h.style.cssText = 'font-weight:600;font-size:11px;margin:4px 0 2px;color:var(--vscode-foreground);opacity:0.9;';
				this._renderInline(line.replace(/^##### /, ''), h);
				parent.appendChild(h);
				i++;
				continue;
			}

			// 表格（| col | col |）
			if (/^\|/.test(line.trim()) && i + 1 < lines.length && /^\|[-| ]+\|/.test(lines[i + 1].trim())) {
				// 收集表头和分隔线
				const headerCells = line.trim().split('|').filter(c => c.trim() !== '');
				i += 2; // skip separator row
				const table = document.createElement('table');
				table.className = 'solo-md-table';
				const thead = document.createElement('thead');
				const headerRow = document.createElement('tr');
				for (const cell of headerCells) {
					const th = document.createElement('th');
					this._renderInline(cell.trim(), th);
					headerRow.appendChild(th);
				}
				thead.appendChild(headerRow);
				table.appendChild(thead);
				// 数据行
				const tbody = document.createElement('tbody');
				while (i < lines.length && /^\|/.test(lines[i].trim())) {
					const cells = lines[i].trim().split('|').filter(c => c.trim() !== '');
					const tr = document.createElement('tr');
					for (const cell of cells) {
						const td = document.createElement('td');
						this._renderInline(cell.trim(), td);
						tr.appendChild(td);
					}
					tbody.appendChild(tr);
					i++;
				}
				table.appendChild(tbody);
				parent.appendChild(table);
				continue;
			}

			// 表格数据行（上一行是分隔符但这里不是表头行的情况，直接跳过）
			if (/^\|[-| ]+\|/.test(line.trim())) {
				i++;
				continue;
			}

			// 无序列表 - / * / +
			if (/^(\s*[-*+]\s)/.test(line)) {
				const ul = document.createElement('ul');
				ul.className = 'solo-md-ul';
				ul.style.listStyleType = 'disc';
				while (i < lines.length && /^(\s*[-*+]\s)/.test(lines[i])) {
					const li = document.createElement('li');
					li.className = 'solo-md-li';
					this._renderInline(lines[i].replace(/^\s*[-*+]\s/, ''), li);
					ul.appendChild(li);
					i++;
				}
				parent.appendChild(ul);
				continue;
			}

			// 有序列表 1. 2.
			if (/^\d+\.\s/.test(line)) {
				const ol = document.createElement('ol');
				ol.className = 'solo-md-ul';
				ol.style.listStyleType = 'decimal';
				while (i < lines.length && /^\d+\.\s/.test(lines[i])) {
					const li = document.createElement('li');
					li.className = 'solo-md-li';
					this._renderInline(lines[i].replace(/^\d+\.\s/, ''), li);
					ol.appendChild(li);
					i++;
				}
				parent.appendChild(ol);
				continue;
			}

			// 水平分割线
			if (/^---+$/.test(line.trim()) || /^\*\*\*+$/.test(line.trim())) {
				const hr = document.createElement('hr');
				hr.style.cssText = 'border:none;border-top:1px solid rgba(128,128,128,0.2);margin:8px 0;';
				parent.appendChild(hr);
				i++;
				continue;
			}

			// 空行
			if (line.trim() === '') {
				i++;
				continue;
			}

			// 普通段落
			const p = document.createElement('div');
			p.className = 'solo-md-p';
			this._renderInline(line, p);
			parent.appendChild(p);
			i++;
		}
	}

	/**
	 * 渲染行内 markdown（bold, italic, code, links）
	 * 将渲染结果追加到 parent
	 */
	private _renderInline(text: string, parent: HTMLElement): void {
		// 简单的状态机解析：**bold**, *italic*, `code`
		const tokens = this._tokenizeInline(text);
		for (const token of tokens) {
			switch (token.type) {
				case 'text': {
					parent.appendChild(document.createTextNode(token.value));
					break;
				}
				case 'bold': {
					const b = document.createElement('strong');
					b.textContent = token.value;
					parent.appendChild(b);
					break;
				}
				case 'italic': {
					const em = document.createElement('em');
					em.textContent = token.value;
					parent.appendChild(em);
					break;
				}
				case 'code': {
					const code = document.createElement('code');
					code.className = 'solo-md-inline-code';
					code.textContent = token.value;
					parent.appendChild(code);
					break;
				}
			}
		}
	}

	private _tokenizeInline(text: string): Array<{ type: 'text' | 'bold' | 'italic' | 'code'; value: string }> {
		const tokens: Array<{ type: 'text' | 'bold' | 'italic' | 'code'; value: string }> = [];
		let i = 0;
		let buf = '';

		const flushBuf = () => {
			if (buf) {
				tokens.push({ type: 'text', value: buf });
				buf = '';
			}
		};

		while (i < text.length) {
			// Bold: **text** or __text__
			if ((text[i] === '*' && text[i + 1] === '*') || (text[i] === '_' && text[i + 1] === '_')) {
				const marker = text.slice(i, i + 2);
				const end = text.indexOf(marker, i + 2);
				if (end !== -1) {
					flushBuf();
					tokens.push({ type: 'bold', value: text.slice(i + 2, end) });
					i = end + 2;
					continue;
				}
			}

			// Italic: *text* or _text_ (single, not double)
			if ((text[i] === '*' && text[i + 1] !== '*') || (text[i] === '_' && text[i + 1] !== '_')) {
				const marker = text[i];
				const end = text.indexOf(marker, i + 1);
				if (end !== -1 && end > i + 1) {
					flushBuf();
					tokens.push({ type: 'italic', value: text.slice(i + 1, end) });
					i = end + 1;
					continue;
				}
			}

			// Inline code: `code`
			if (text[i] === '`') {
				const end = text.indexOf('`', i + 1);
				if (end !== -1) {
					flushBuf();
					tokens.push({ type: 'code', value: text.slice(i + 1, end) });
					i = end + 1;
					continue;
				}
			}

			buf += text[i];
			i++;
		}

		flushBuf();
		return tokens;
	}

	// ── 发送消息 ──────────────────────────────────────────────────────────────

	/** 从 File 对象添加图片（压缩后存入 _pendingImages） */
	private _addImageFromFile(file: File): void {
		const reader = new FileReader();
		reader.onload = () => {
			const img = new Image();
			img.onload = () => {
				// 压缩：最大 1024px，JPEG 质量 0.7
				const maxSize = 1024;
				let { width, height } = img;
				if (width > maxSize || height > maxSize) {
					const ratio = Math.min(maxSize / width, maxSize / height);
					width = Math.round(width * ratio);
					height = Math.round(height * ratio);
				}
				const canvas = document.createElement('canvas');
				canvas.width = width;
				canvas.height = height;
				const ctx = canvas.getContext('2d');
				if (!ctx) { return; }
				ctx.drawImage(img, 0, 0, width, height);
				const base64 = canvas.toDataURL('image/jpeg', 0.7).split(',')[1];
				this._pendingImages.push(base64);
				this._renderImagePreviews();
			};
			img.src = reader.result as string;
		};
		reader.readAsDataURL(file);
	}

	/** 渲染图片预览区 */
	private _renderImagePreviews(): void {
		if (!this._imagePreviewContainer) {
			this._imagePreviewContainer = document.createElement('div');
			this._imagePreviewContainer.style.cssText = `
				display: flex;
				gap: 6px;
				padding: 6px 12px;
				flex-wrap: wrap;
			`;
			// 插入到输入框之前
			this.inputEl.parentElement?.insertBefore(this._imagePreviewContainer, this.inputEl);
		}

		// 清空重建
		while (this._imagePreviewContainer.firstChild) {
			this._imagePreviewContainer.removeChild(this._imagePreviewContainer.firstChild);
		}

		if (this._pendingImages.length === 0) {
			this._imagePreviewContainer.style.display = 'none';
			return;
		}

		this._imagePreviewContainer.style.display = 'flex';

		this._pendingImages.forEach((base64, idx) => {
			const wrapper = document.createElement('div');
			wrapper.style.cssText = `
				position: relative;
				width: 60px;
				height: 60px;
				border-radius: 8px;
				overflow: hidden;
				border: 1px solid var(--vscode-input-border, rgba(128,128,128,0.3));
				flex-shrink: 0;
			`;

			const img = document.createElement('img');
			img.src = `data:image/jpeg;base64,${base64}`;
			img.style.cssText = 'width:100%;height:100%;object-fit:cover;';
			wrapper.appendChild(img);

			// 删除按钮
			const removeBtn = document.createElement('div');
			removeBtn.style.cssText = `
				position: absolute;
				top: 2px;
				right: 2px;
				width: 16px;
				height: 16px;
				background: rgba(0,0,0,0.6);
				border-radius: 50%;
				display: flex;
				align-items: center;
				justify-content: center;
				cursor: pointer;
				color: #fff;
				font-size: 10px;
			`;
			removeBtn.textContent = '×';
			removeBtn.onclick = () => {
				this._pendingImages.splice(idx, 1);
				this._renderImagePreviews();
			};
			wrapper.appendChild(removeBtn);

			this._imagePreviewContainer!.appendChild(wrapper);
		});
	}

	private async _sendMessage(): Promise<void> {
		// 收集 @mention 的文件路径
		const mentionChips = this.inputEl.querySelectorAll('[data-mention]');
		const mentionedFiles: string[] = [];
		mentionChips.forEach(chip => {
			const filePath = chip.getAttribute('data-mention');
			if (filePath) { mentionedFiles.push(filePath); }
		});

		// 用 innerText 而非 textContent，避免 contentEditable 内部 div/br 产生隐式换行
		let text = (this.inputEl.innerText || '').replace(/\n+$/, '').replace(/^\n+/, '').trim();
		if (!text) { return; }

		// 如果有 @mention 的文件，追加到消息末尾
		if (mentionedFiles.length > 0) {
			text += '\n\n<mentioned_files>\n' + mentionedFiles.map(f => `- ${f}`).join('\n') + '\n</mentioned_files>';
		}
		// 只阻止当前会话正在运行时的重复发送（其他会话并发运行不影响）
		const currentSession = this._sessions.find(s => s.id === this._currentSessionId);
		if (currentSession && currentSession.status === 'running') { return; }
		if (!this._currentSessionId && this.isRunning) { return; }

		// 清空输入框（用 textContent 避免 CSP TrustedHTML 限制）
		this.inputEl.textContent = '';

		// 如果当前有 pending ask，将输入作为 followup 回应（仍在当前会话内）
		if (this._pendingAskTs !== null) {
			const askTs = this._pendingAskTs;
			this._pendingAskTs = null;
			this._appendUserBubble(text);
			// followup 回应后任务重新恢复执行
			this._setRunning(true);
			this.maxianService.handleAskResponse(askTs, 'messageResponse', text, undefined, this._currentSessionId || undefined);
			return;
		}

		// 如果没有当前会话（首次发消息，或用户点了"新任务"），才创建新会话
		if (!this._currentSessionId) {
			const sessionTitle = text.length > 28 ? text.slice(0, 28) + '...' : text;
			this._createSession(sessionTitle);
		} else {
			// 复用当前会话：更新状态为 running（可能上一个任务已完成）
			this._updateSessionStatus(this._currentSessionId, 'running');
		}

		// 重置 AI 气泡指针（新一轮对话开始）
		this.lastAiBubble = null;
		this.lastAiBubbleText = null;
		this._lastAiAccText = '';

		// 收集待发送图片并清空预览
		const images = this._pendingImages.length > 0 ? [...this._pendingImages] : undefined;
		this._pendingImages = [];
		this._renderImagePreviews();

		// 发送到 maxianService（solo 模式，带图片）
		this.maxianService.sendMessage(text, 'solo', undefined, images, this._currentSessionId || undefined);
	}

	// ── 状态管理 ──────────────────────────────────────────────────────────────

	private _setRunning(running: boolean): void {
		this.isRunning = running;

		if (running) {
			this.sendBtn.style.opacity = '0.4';
			this.sendBtn.style.cursor = 'not-allowed';
			this.headerStopBtn.style.display = 'flex';
			this.startTime = Date.now();
			this._startElapsedTimer();

			// 更新当前会话状态
			if (this._currentSessionId) {
				this._updateSessionStatus(this._currentSessionId, 'running');
			}
		} else {
			this.sendBtn.style.opacity = '1';
			this.sendBtn.style.cursor = 'pointer';
			this.headerStopBtn.style.display = 'none';
			this._stopElapsedTimer();
			this.headerStatusText.textContent = '执行完成，可输入新任务';

			// 更新当前会话状态为完成，并持久化
			if (this._currentSessionId) {
				this._updateSessionStatus(this._currentSessionId, 'done');
				// 延迟保存（确保最后的消息已渲染）
				setTimeout(() => this._saveSessionsToStorage(), 500);
			}
		}
	}

	private _startElapsedTimer(): void {
		this._stopElapsedTimer();
		this.elapsedTimer = window.setInterval(() => {
			const elapsed = Math.floor((Date.now() - this.startTime) / 1000);
			const min = Math.floor(elapsed / 60);
			const sec = elapsed % 60;
			const label = min > 0 ? `${min}m ${sec}s` : `${sec}s`;
			this.taskElapsedText.textContent = `已用时：${label}`;
		}, 1000);
	}

	private _stopElapsedTimer(): void {
		if (this.elapsedTimer !== null) {
			window.clearInterval(this.elapsedTimer);
			this.elapsedTimer = null;
		}
	}

	private _scrollToBottom(): void {
		this.messageArea.scrollTop = this.messageArea.scrollHeight;
		// 每次有新消息追加时，2 秒内防抖保存，确保实时持久化
		if (this._saveDebounceTimer !== null) {
			clearTimeout(this._saveDebounceTimer);
		}
		this._saveDebounceTimer = setTimeout(() => {
			this._saveDebounceTimer = null;
			this._saveSessionsToStorage();
		}, 2000);
	}
}
