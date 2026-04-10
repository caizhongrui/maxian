/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { EditorPane } from '../../../browser/parts/editor/editorPane.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { IEditorGroup } from '../../../services/editor/common/editorGroupsService.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { IEditorOptions } from '../../../../platform/editor/common/editor.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { Dimension, IDomPosition } from '../../../../base/browser/dom.js';
import { $, append } from '../../../../base/browser/dom.js';
import { IMaxianService, IMessageEvent, ITodoListEvent } from './maxianService.js';
import { SoloEditorInput } from './soloEditorInput.js';
import { ClineMessage } from '../common/task/taskTypes.js';

/**
 * Solo 模式编辑器面板
 *
 * 布局（两栏）：
 * ┌─────────────────────────────────────────────────────┐
 * │  ⚡ Solo 自主模式  [当前步骤]  ████░░  [停止]         │  ← 顶部状态栏
 * ├──────────────────┬──────────────────────────────────┤
 * │  左栏（35%）      │  右栏（65%）                      │
 * │  任务计划 + 进度  │  执行日志 / 对话 / 输入框          │
 * └──────────────────┴──────────────────────────────────┘
 */
export class SoloEditorPane extends EditorPane {

	static readonly ID = SoloEditorInput.EditorID;

	// ─── DOM 根节点 ────────────────────────────────────────
	private container!: HTMLElement;

	// ─── 顶部状态栏 ────────────────────────────────────────
	private headerBar!: HTMLElement;
	private headerStatusText!: HTMLElement;
	private headerProgressBar!: HTMLElement;
	private headerProgressFill!: HTMLElement;
	private headerStopBtn!: HTMLElement;
	private headerStepInfo!: HTMLElement;

	// ─── 左栏：任务计划 ────────────────────────────────────
	private leftPanel!: HTMLElement;
	private taskListEl!: HTMLElement;
	private taskStatsEl!: HTMLElement;
	private taskProgressText!: HTMLElement;
	private taskElapsedText!: HTMLElement;

	// ─── 右栏：执行日志 + 输入 ─────────────────────────────
	private rightPanel!: HTMLElement;
	private messageArea!: HTMLElement;
	private inputWrapper!: HTMLElement;
	private inputEl!: HTMLElement;
	private sendBtn!: HTMLElement;

	// ─── 状态 ──────────────────────────────────────────────
	private isRunning = false;
	private startTime = 0;
	private elapsedTimer: number | null = null;
	private todoTotal = 0;
	private todoDone = 0;

	// ─── 最后一条 AI 文本气泡（用于流式追加）──────────────
	private lastAiBubble: HTMLElement | null = null;
	private lastAiBubbleText: HTMLElement | null = null;

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@IMaxianService private readonly maxianService: IMaxianService,
	) {
		super(SoloEditorPane.ID, group, telemetryService, themeService, storageService);
	}

	// ── 生命周期 ──────────────────────────────────────────────────────────────

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

		this._buildHeader();
		this._buildBody();
		this._subscribeEvents();
	}

	override async setInput(input: EditorInput, options: IEditorOptions | undefined, context: any, token: CancellationToken): Promise<void> {
		await super.setInput(input, options, context, token);
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

	override dispose(): void {
		this._stopElapsedTimer();
		super.dispose();
	}

	// ── 构建 DOM ──────────────────────────────────────────────────────────────

	/** 顶部状态横幅 */
	private _buildHeader(): void {
		this.headerBar = append(this.container, $('div.solo-header'));
		this.headerBar.style.cssText = `
			display: flex;
			align-items: center;
			gap: 12px;
			padding: 0 16px;
			height: 44px;
			flex-shrink: 0;
			background: linear-gradient(90deg, rgba(255,140,0,0.12) 0%, rgba(255,140,0,0.04) 100%);
			border-bottom: 1px solid rgba(255,140,0,0.25);
		`;

		// 图标 + 标题
		const titleGroup = append(this.headerBar, $('div'));
		titleGroup.style.cssText = 'display:flex;align-items:center;gap:8px;flex-shrink:0;';

		const icon = append(titleGroup, $('span.codicon.codicon-rocket'));
		icon.style.cssText = 'font-size:16px;color:#FFA500;';

		const title = append(titleGroup, $('span'));
		title.style.cssText = 'font-weight:600;font-size:13px;color:#FFA500;letter-spacing:0.5px;white-space:nowrap;';
		title.textContent = 'Solo 自主模式';

		// 当前步骤文字
		this.headerStatusText = append(this.headerBar, $('span'));
		this.headerStatusText.style.cssText = `
			font-size: 12px;
			color: var(--vscode-descriptionForeground);
			flex: 1;
			white-space: nowrap;
			overflow: hidden;
			text-overflow: ellipsis;
		`;
		this.headerStatusText.textContent = '准备就绪，输入任务开始执行';

		// 步骤计数
		this.headerStepInfo = append(this.headerBar, $('span'));
		this.headerStepInfo.style.cssText = `
			font-size: 11px;
			color: rgba(255,140,0,0.8);
			flex-shrink: 0;
			font-weight: 500;
		`;
		this.headerStepInfo.style.display = 'none';

		// 进度条
		const progressWrapper = append(this.headerBar, $('div'));
		progressWrapper.style.cssText = 'width:100px;height:4px;background:rgba(255,140,0,0.15);border-radius:2px;flex-shrink:0;overflow:hidden;';
		this.headerProgressFill = append(progressWrapper, $('div'));
		this.headerProgressFill.style.cssText = 'height:100%;width:0%;background:#FFA500;border-radius:2px;transition:width 0.3s ease;';
		this.headerProgressBar = progressWrapper;
		this.headerProgressBar.style.display = 'none';

		// 运行时间
		this.headerStepInfo.style.display = 'none';

		// 停止按钮
		this.headerStopBtn = append(this.headerBar, $('button'));
		this.headerStopBtn.style.cssText = `
			display: none;
			align-items: center;
			gap: 4px;
			padding: 4px 10px;
			border: 1px solid rgba(255,100,100,0.5);
			border-radius: 6px;
			background: rgba(255,100,100,0.1);
			color: #ff6464;
			font-size: 11px;
			cursor: pointer;
			flex-shrink: 0;
			font-family: inherit;
			white-space: nowrap;
			transition: background 0.15s;
		`;
		this.headerStopBtn.innerHTML = '<span class="codicon codicon-stop-circle" style="font-size:12px;"></span> 停止';
		this.headerStopBtn.onmouseenter = () => { this.headerStopBtn.style.background = 'rgba(255,100,100,0.2)'; };
		this.headerStopBtn.onmouseleave = () => { this.headerStopBtn.style.background = 'rgba(255,100,100,0.1)'; };
		this.headerStopBtn.onclick = () => { this.maxianService.cancelTask(); };
	}

	/** 主体两栏布局 */
	private _buildBody(): void {
		const body = append(this.container, $('div.solo-body'));
		body.style.cssText = 'display:flex;flex:1;overflow:hidden;';

		this._buildLeftPanel(body);
		this._buildRightPanel(body);
	}

	/** 左栏：任务计划 */
	private _buildLeftPanel(parent: HTMLElement): void {
		this.leftPanel = append(parent, $('div.solo-left-panel'));
		this.leftPanel.style.cssText = `
			width: 35%;
			min-width: 220px;
			max-width: 380px;
			display: flex;
			flex-direction: column;
			border-right: 1px solid var(--vscode-sideBarSectionHeader-border, rgba(128,128,128,0.2));
			background: var(--vscode-sideBar-background, var(--vscode-editor-background));
			overflow: hidden;
		`;

		// 左栏标题
		const leftHeader = append(this.leftPanel, $('div'));
		leftHeader.style.cssText = `
			padding: 12px 16px 8px;
			font-size: 11px;
			font-weight: 600;
			text-transform: uppercase;
			letter-spacing: 0.8px;
			color: var(--vscode-sideBarSectionHeader-foreground, var(--vscode-descriptionForeground));
			border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border, rgba(128,128,128,0.15));
			display: flex;
			align-items: center;
			gap: 6px;
			flex-shrink: 0;
		`;
		leftHeader.innerHTML = '<span class="codicon codicon-checklist" style="font-size:13px;"></span> 执行计划';

		// 任务列表滚动区
		const taskScroll = append(this.leftPanel, $('div'));
		taskScroll.style.cssText = 'flex:1;overflow-y:auto;padding:8px 0;';

		this.taskListEl = append(taskScroll, $('div'));
		this.taskListEl.style.cssText = 'display:flex;flex-direction:column;gap:2px;';

		// 空态占位
		const emptyPlaceholder = append(this.taskListEl, $('div'));
		emptyPlaceholder.className = 'solo-task-empty';
		emptyPlaceholder.style.cssText = `
			padding: 24px 16px;
			text-align: center;
			color: var(--vscode-descriptionForeground);
			font-size: 12px;
			opacity: 0.6;
		`;
		emptyPlaceholder.textContent = '等待任务规划...';

		// 底部统计
		this.taskStatsEl = append(this.leftPanel, $('div'));
		this.taskStatsEl.style.cssText = `
			padding: 10px 16px;
			border-top: 1px solid var(--vscode-sideBarSectionHeader-border, rgba(128,128,128,0.15));
			display: flex;
			flex-direction: column;
			gap: 4px;
			flex-shrink: 0;
		`;

		this.taskProgressText = append(this.taskStatsEl, $('div'));
		this.taskProgressText.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);';
		this.taskProgressText.textContent = '尚未开始';

		this.taskElapsedText = append(this.taskStatsEl, $('div'));
		this.taskElapsedText.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);opacity:0.7;';
	}

	/** 右栏：对话日志 + 输入框 */
	private _buildRightPanel(parent: HTMLElement): void {
		this.rightPanel = append(parent, $('div.solo-right-panel'));
		this.rightPanel.style.cssText = `
			flex: 1;
			display: flex;
			flex-direction: column;
			overflow: hidden;
		`;

		// 消息区
		this.messageArea = append(this.rightPanel, $('div.solo-message-area'));
		this.messageArea.style.cssText = `
			flex: 1;
			overflow-y: auto;
			padding: 16px;
			display: flex;
			flex-direction: column;
			gap: 12px;
		`;

		// 输入区
		this._buildInputArea();
	}

	/** 底部输入区 */
	private _buildInputArea(): void {
		this.inputWrapper = append(this.rightPanel, $('div.solo-input-wrapper'));
		this.inputWrapper.style.cssText = `
			flex-shrink: 0;
			padding: 12px 16px;
			border-top: 1px solid var(--vscode-input-border, rgba(128,128,128,0.2));
			display: flex;
			flex-direction: column;
			gap: 8px;
			background: var(--vscode-editor-background);
		`;

		// Solo 指示标签
		const badge = append(this.inputWrapper, $('div'));
		badge.style.cssText = `
			display: flex;
			align-items: center;
			gap: 6px;
			font-size: 11px;
			color: rgba(255,140,0,0.8);
		`;
		badge.innerHTML = `
			<span class="codicon codicon-rocket" style="font-size:11px;"></span>
			<span>Solo 模式 — 所有操作将<strong>自动批准</strong>执行，无需确认</span>
		`;

		// 输入框行
		const inputRow = append(this.inputWrapper, $('div'));
		inputRow.style.cssText = 'display:flex;gap:8px;align-items:flex-end;';

		this.inputEl = append(inputRow, $('div'));
		this.inputEl.contentEditable = 'true';
		this.inputEl.style.cssText = `
			flex: 1;
			min-height: 36px;
			max-height: 160px;
			padding: 8px 12px;
			border: 1px solid var(--vscode-input-border, rgba(128,128,128,0.35));
			border-radius: 8px;
			background: var(--vscode-input-background);
			color: var(--vscode-input-foreground);
			font-size: 13px;
			font-family: inherit;
			outline: none;
			overflow-y: auto;
			word-break: break-word;
			line-height: 1.5;
			transition: border-color 0.15s;
		`;
		this.inputEl.setAttribute('data-placeholder', '描述你的任务，Solo 将自主完成...');

		// 占位符通过 CSS 伪元素实现，加 class
		this.inputEl.addEventListener('focus', () => {
			this.inputEl.style.borderColor = 'rgba(255,140,0,0.6)';
			this.inputEl.style.boxShadow = '0 0 0 1px rgba(255,140,0,0.3)';
		});
		this.inputEl.addEventListener('blur', () => {
			this.inputEl.style.borderColor = 'var(--vscode-input-border, rgba(128,128,128,0.35))';
			this.inputEl.style.boxShadow = 'none';
		});

		// Enter 发送，Shift+Enter 换行
		this.inputEl.addEventListener('keydown', (e) => {
			if (e.key === 'Enter' && !e.shiftKey) {
				e.preventDefault();
				this._sendMessage();
			}
		});

		// 发送按钮
		this.sendBtn = append(inputRow, $('button'));
		this.sendBtn.style.cssText = `
			padding: 8px 16px;
			border: none;
			border-radius: 8px;
			background: #FFA500;
			color: #000;
			font-size: 13px;
			font-weight: 600;
			cursor: pointer;
			flex-shrink: 0;
			font-family: inherit;
			display: flex;
			align-items: center;
			gap: 6px;
			transition: background 0.15s, opacity 0.15s;
			white-space: nowrap;
		`;
		this.sendBtn.innerHTML = '<span class="codicon codicon-send" style="font-size:13px;"></span> 执行';
		this.sendBtn.onmouseenter = () => { if (!this.isRunning) { this.sendBtn.style.background = '#FFB733'; } };
		this.sendBtn.onmouseleave = () => { if (!this.isRunning) { this.sendBtn.style.background = '#FFA500'; } };
		this.sendBtn.onclick = () => this._sendMessage();
	}

	// ── 事件订阅 ──────────────────────────────────────────────────────────────

	private _subscribeEvents(): void {
		// 消息流（用户/AI/错误）
		this._register(this.maxianService.onMessage((event: IMessageEvent) => {
			this._handleMessage(event);
		}));

		// Cline 完整消息（工具调用等）
		this._register(this.maxianService.onClineMessage((event) => {
			this._handleClineMessage(event.message);
		}));

		// Todo 列表更新
		this._register(this.maxianService.onTodoListUpdate((event: ITodoListEvent) => {
			this._handleTodoUpdate(event);
		}));
	}

	// ── 消息处理 ──────────────────────────────────────────────────────────────

	private _handleMessage(event: IMessageEvent): void {
		switch (event.type) {
			case 'user':
				this._appendUserBubble(event.content);
				this._setRunning(true);
				break;

			case 'assistant':
				if (event.isPartial) {
					// 流式文本追加
					this._appendOrUpdateAIText(event.content);
				} else {
					// 流结束
					this._finalizeAIText(event.content);
					if (!event.isPartial) {
						// 最后一条 assistant 事件（isPartial=false）意味着完成
						// 注意：task 完成由 TodoUpdate 判断，这里只更新状态文字
					}
				}
				break;

			case 'error':
				this._appendErrorBubble(event.content);
				this._setRunning(false);
				break;
		}
	}

	private _handleClineMessage(msg: ClineMessage): void {
		// Solo 模式下只渲染关键的 ClineMessage
		if (msg.type === 'say') {
			switch (msg.say) {
				case 'tool':
					// 工具调用 - Solo 模式显示紧凑日志行
					this._appendToolLog(msg);
					break;
				case 'completion_result':
					// 任务完成
					this._appendCompletionBubble(msg.text || '');
					this._setRunning(false);
					break;
				case 'file_changes':
					// 文件变更摘要
					this._appendFileChangesSummary(msg.text || '');
					break;
			}
		}
	}

	private _handleTodoUpdate(event: ITodoListEvent): void {
		const todos = event.todos;

		// 清空旧列表（保留空态占位符逻辑）
		while (this.taskListEl.firstChild) {
			this.taskListEl.removeChild(this.taskListEl.firstChild);
		}

		if (!todos || todos.length === 0) {
			// 空态
			const empty = append(this.taskListEl, $('div'));
			empty.style.cssText = 'padding:24px 16px;text-align:center;color:var(--vscode-descriptionForeground);font-size:12px;opacity:0.6;';
			empty.textContent = '等待任务规划...';
			this.todoTotal = 0;
			this.todoDone = 0;
			this._updateProgress();
			return;
		}

		this.todoTotal = todos.length;
		this.todoDone = todos.filter(t => t.status === 'completed').length;
		const currentIdx = todos.findIndex(t => t.status === 'in_progress');

		todos.forEach((todo, idx) => {
			const item = append(this.taskListEl, $('div.solo-task-item'));
			item.style.cssText = `
				display: flex;
				align-items: flex-start;
				gap: 8px;
				padding: 6px 16px;
				border-radius: 0;
				transition: background 0.15s;
				cursor: default;
			`;

			// 高亮当前执行项
			if (todo.status === 'in_progress') {
				item.style.background = 'rgba(255,140,0,0.08)';
				item.style.borderLeft = '2px solid #FFA500';
				item.style.paddingLeft = '14px';
			} else {
				item.style.borderLeft = '2px solid transparent';
			}

			// 状态图标
			const statusIcon = append(item, $('span.codicon'));
			statusIcon.style.cssText = 'font-size:14px;flex-shrink:0;margin-top:1px;';
			switch (todo.status) {
				case 'completed':
					statusIcon.classList.add('codicon-check');
					statusIcon.style.color = 'var(--vscode-charts-green, #4EC9B0)';
					break;
				case 'in_progress':
					statusIcon.classList.add('codicon-loading', 'codicon-modifier-spin');
					statusIcon.style.color = '#FFA500';
					break;
				case 'failed':
					statusIcon.classList.add('codicon-error');
					statusIcon.style.color = 'var(--vscode-charts-red, #f48771)';
					break;
				default:
					statusIcon.classList.add('codicon-circle-outline');
					statusIcon.style.color = 'var(--vscode-descriptionForeground)';
					statusIcon.style.opacity = '0.5';
			}

			// 序号 + 文本
			const textGroup = append(item, $('div'));
			textGroup.style.cssText = 'flex:1;min-width:0;';

			const label = append(textGroup, $('div'));
			label.style.cssText = `
				font-size: 12px;
				line-height: 1.5;
				color: ${todo.status === 'completed' ? 'var(--vscode-descriptionForeground)' :
					todo.status === 'in_progress' ? 'var(--vscode-foreground)' :
					'var(--vscode-descriptionForeground)'};
				${todo.status === 'completed' ? 'text-decoration:line-through;opacity:0.6;' : ''}
				word-break: break-word;
			`;
			label.textContent = `${idx + 1}. ${todo.content || todo.activeForm}`;
			void idx; void currentIdx;
		});

		// 更新顶部状态
		this._updateProgress();

		// 更新标题栏状态文字
		const current = todos.find(t => t.status === 'in_progress');
		if (current) {
			const shortText = (current.activeForm || current.content || '').slice(0, 60);
			this.headerStatusText.textContent = `正在执行：${shortText}`;
		} else if (this.todoDone === this.todoTotal && this.todoTotal > 0) {
			this.headerStatusText.textContent = '全部步骤已完成';
		}
	}

	// ── 气泡渲染 ──────────────────────────────────────────────────────────────

	private _appendUserBubble(text: string): void {
		this.lastAiBubble = null;
		this.lastAiBubbleText = null;

		const row = append(this.messageArea, $('div.solo-msg-row-user'));
		row.style.cssText = 'display:flex;justify-content:flex-end;';

		const bubble = append(row, $('div'));
		bubble.style.cssText = `
			max-width: 70%;
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

		this._scrollToBottom();
	}

	private _appendOrUpdateAIText(text: string): void {
		if (!this.lastAiBubble) {
			// 新建 AI 气泡
			const row = append(this.messageArea, $('div.solo-msg-row-ai'));
			row.style.cssText = 'display:flex;gap:8px;align-items:flex-start;';

			const avatar = append(row, $('div'));
			avatar.style.cssText = `
				width: 28px;height:28px;flex-shrink:0;
				border-radius:50%;
				background:linear-gradient(135deg,#FFA500,#FF6400);
				display:flex;align-items:center;justify-content:center;
				font-size:12px;font-weight:700;color:#fff;
				margin-top:2px;
			`;
			avatar.textContent = 'S';

			const bubble = append(row, $('div'));
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
				white-space: pre-wrap;
			`;

			this.lastAiBubble = row;
			this.lastAiBubbleText = bubble;
		}

		if (this.lastAiBubbleText) {
			this.lastAiBubbleText.textContent = text;
		}
		this._scrollToBottom();
	}

	private _finalizeAIText(text: string): void {
		if (this.lastAiBubbleText && text) {
			this.lastAiBubbleText.textContent = text;
		}
		this.lastAiBubble = null;
		this.lastAiBubbleText = null;
		this._scrollToBottom();
	}

	/** Solo 模式下工具调用显示为紧凑日志行 */
	private _appendToolLog(msg: ClineMessage): void {
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

		const row = append(this.messageArea, $('div.solo-tool-log'));
		row.style.cssText = `
			display: flex;
			align-items: center;
			gap: 8px;
			padding: 4px 8px;
			border-radius: 6px;
			background: ${isCompleted ? 'rgba(78,201,176,0.06)' : 'rgba(255,140,0,0.06)'};
			border: 1px solid ${isCompleted ? 'rgba(78,201,176,0.15)' : 'rgba(255,140,0,0.15)'};
			font-size: 11px;
			color: var(--vscode-descriptionForeground);
		`;

		const statusIcon = append(row, $('span.codicon'));
		statusIcon.style.cssText = 'font-size:12px;flex-shrink:0;';
		if (isCompleted) {
			statusIcon.classList.add('codicon-check');
			statusIcon.style.color = 'var(--vscode-charts-green, #4EC9B0)';
		} else {
			statusIcon.classList.add('codicon-loading', 'codicon-modifier-spin');
			statusIcon.style.color = '#FFA500';
		}

		const label = append(row, $('span'));
		label.style.cssText = 'color:rgba(255,140,0,0.9);font-weight:600;flex-shrink:0;';
		label.textContent = isCompleted ? '已执行' : '执行中';

		const toolLabel = append(row, $('span'));
		toolLabel.style.cssText = 'color:var(--vscode-foreground);font-weight:500;flex-shrink:0;';
		toolLabel.textContent = toolName ? ` ${toolName}` : '';

		if (toolTarget) {
			const targetEl = append(row, $('span'));
			targetEl.style.cssText = 'color:var(--vscode-descriptionForeground);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;opacity:0.8;';
			targetEl.textContent = ` → ${toolTarget}`;
		}

		this._scrollToBottom();
	}

	private _appendCompletionBubble(text: string): void {
		const row = append(this.messageArea, $('div.solo-completion'));
		row.style.cssText = `
			display: flex;
			flex-direction: column;
			gap: 8px;
			padding: 12px;
			border-radius: 8px;
			background: rgba(78,201,176,0.08);
			border: 1px solid rgba(78,201,176,0.25);
		`;

		const titleRow = append(row, $('div'));
		titleRow.style.cssText = 'display:flex;align-items:center;gap:8px;font-weight:600;color:var(--vscode-charts-green,#4EC9B0);font-size:13px;';
		titleRow.innerHTML = '<span class="codicon codicon-check-all" style="font-size:14px;"></span> 任务完成';

		if (text) {
			const desc = append(row, $('div'));
			desc.style.cssText = 'font-size:12px;color:var(--vscode-foreground);line-height:1.6;white-space:pre-wrap;word-break:break-word;';
			desc.textContent = text;
		}

		this._scrollToBottom();
	}

	private _appendFileChangesSummary(text: string): void {
		if (!text) { return; }
		const row = append(this.messageArea, $('div.solo-file-changes'));
		row.style.cssText = `
			padding: 8px 12px;
			border-radius: 6px;
			background: rgba(128,128,128,0.06);
			border: 1px solid rgba(128,128,128,0.15);
			font-size: 11px;
			color: var(--vscode-descriptionForeground);
			white-space: pre-wrap;
			word-break: break-word;
		`;
		row.textContent = text;
		this._scrollToBottom();
	}

	private _appendErrorBubble(text: string): void {
		const row = append(this.messageArea, $('div.solo-error'));
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
		row.innerHTML = `<span class="codicon codicon-error" style="font-size:13px;flex-shrink:0;margin-top:1px;"></span><span>${text.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</span>`;
		this._scrollToBottom();
	}

	// ── 发送消息 ──────────────────────────────────────────────────────────────

	private async _sendMessage(): Promise<void> {
		const text = (this.inputEl.textContent || '').trim();
		if (!text || this.isRunning) { return; }

		// 清空输入框
		this.inputEl.textContent = '';

		// 重置 AI 气泡指针
		this.lastAiBubble = null;
		this.lastAiBubbleText = null;

		// 发送到 maxianService（solo 模式）
		this.maxianService.sendMessage(text, 'solo');
	}

	// ── 状态管理 ──────────────────────────────────────────────────────────────

	private _setRunning(running: boolean): void {
		this.isRunning = running;

		if (running) {
			this.sendBtn.style.opacity = '0.5';
			this.sendBtn.style.cursor = 'not-allowed';
			this.headerStopBtn.style.display = 'flex';
			this.headerProgressBar.style.display = '';
			this.startTime = Date.now();
			this._startElapsedTimer();
		} else {
			this.sendBtn.style.opacity = '1';
			this.sendBtn.style.cursor = 'pointer';
			this.headerStopBtn.style.display = 'none';
			this._stopElapsedTimer();
			this.headerStatusText.textContent = '执行完成，可输入新任务';
		}
	}

	private _updateProgress(): void {
		const total = this.todoTotal;
		const done = this.todoDone;

		if (total === 0) {
			this.taskProgressText.textContent = '尚未开始';
			this.headerProgressFill.style.width = '0%';
			this.headerStepInfo.style.display = 'none';
			return;
		}

		const pct = Math.round((done / total) * 100);
		this.taskProgressText.textContent = `进度：${done} / ${total} 步（${pct}%）`;
		this.headerProgressFill.style.width = `${pct}%`;
		this.headerStepInfo.textContent = `${done}/${total}`;
		this.headerStepInfo.style.display = '';
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
	}
}
