/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ITerminalService, ITerminalInstance } from '../../terminal/browser/terminal.js';
import { $, append } from '../../../../base/browser/dom.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { Dimension } from '../../../../base/browser/dom.js';
import { TerminalLocation } from '../../../../platform/terminal/common/terminal.js';

export interface ISoloTerminalTab {
	id: string;
	name: string;
	instance: ITerminalInstance;
	bodyEl: HTMLElement;
	tabEl: HTMLElement;
	isAi: boolean;
}

/**
 * Solo 模式内嵌终端面板
 * 使用 VSCode 原生 ITerminalInstance + attachToElement() 嵌入真实 xterm。
 * 兼容 Windows / macOS / Linux（shell 由 VSCode 的 defaultProfile 自动决定）。
 *
 * 关键：bodyEl 必须带有 terminal-editor 类，否则 terminal.css 里的
 * .terminal-wrapper / .xterm 等规则不生效，导致高度=0、无法输入。
 */
export class SoloTerminalPanel extends Disposable {

	private _tabs: ISoloTerminalTab[] = [];
	private _activeTabId = '';
	private _collapsed = false;
	private _panelHeight = 220;

	// DOM
	private _resizerEl!: HTMLElement;
	private _panelEl!: HTMLElement;
	private _tabBarEl!: HTMLElement;
	private _bodyEl!: HTMLElement;
	private _collapseBtnEl!: HTMLElement;

	// ResizeObserver：面板尺寸变化时刷新 xterm layout
	private _resizeObserver: ResizeObserver | undefined;

	constructor(
		private readonly terminalService: ITerminalService,
		private readonly workspaceRoot: string,
	) {
		super();
	}

	/**
	 * 构建 resizer + panel 并插入到 container（flex-col 容器）
	 */
	build(container: HTMLElement): void {
		// ── 水平分隔条（拖动调整面板高度）
		this._resizerEl = append(container, $('div.solo-terminal-resizer'));
		this._resizerEl.style.cssText = `
			height: 4px;
			flex-shrink: 0;
			cursor: row-resize;
			background: var(--vscode-panel-border, rgba(128,128,128,0.2));
			transition: background 0.15s;
			z-index: 5;
		`;
		this._resizerEl.onmouseenter = () => {
			this._resizerEl.style.background = 'var(--vscode-sash-hoverBorder, rgba(0,122,204,0.6))';
		};
		this._resizerEl.onmouseleave = () => {
			this._resizerEl.style.background = 'var(--vscode-panel-border, rgba(128,128,128,0.2))';
		};

		// ── 面板主体
		this._panelEl = append(container, $('div.solo-terminal-panel'));
		this._panelEl.style.cssText = `
			height: ${this._panelHeight}px;
			flex-shrink: 0;
			display: flex;
			flex-direction: column;
			background: var(--vscode-terminal-background, var(--vscode-editor-background));
			border-top: 1px solid var(--vscode-panel-border);
		`;

		this._buildHeader();
		this._buildBody();
		this._setupResizerDrag();
	}

	private _buildHeader(): void {
		const header = append(this._panelEl, $('div.solo-terminal-header'));
		header.style.cssText = `
			display: flex;
			align-items: center;
			height: 34px;
			flex-shrink: 0;
			padding: 0 6px 0 4px;
			gap: 4px;
			border-bottom: 1px solid var(--vscode-panel-border);
			background: var(--vscode-panel-background, var(--vscode-sideBar-background));
		`;

		// 标签栏（可横向滚动）
		this._tabBarEl = append(header, $('div.solo-terminal-tabbar'));
		this._tabBarEl.style.cssText = `
			display: flex;
			align-items: center;
			flex: 1;
			min-width: 0;
			overflow-x: auto;
			overflow-y: hidden;
			gap: 2px;
			scrollbar-width: none;
			-webkit-overflow-scrolling: touch;
		`;

		// 新建终端按钮
		const addBtn = append(header, $('span.solo-terminal-add'));
		addBtn.textContent = '+';
		addBtn.title = '新建终端（Windows 使用 PowerShell，macOS/Linux 使用默认 shell）';
		addBtn.style.cssText = `
			padding: 1px 7px;
			cursor: pointer;
			border-radius: 4px;
			font-size: 15px;
			line-height: 22px;
			color: var(--vscode-foreground);
			opacity: 0.55;
			flex-shrink: 0;
			user-select: none;
		`;
		addBtn.onmouseenter = () => { addBtn.style.opacity = '1'; addBtn.style.background = 'rgba(128,128,128,0.1)'; };
		addBtn.onmouseleave = () => { addBtn.style.opacity = '0.55'; addBtn.style.background = ''; };
		addBtn.onclick = () => this.createUserTerminal();

		// 折叠/展开按钮
		this._collapseBtnEl = append(header, $('span.solo-terminal-collapse'));
		this._collapseBtnEl.textContent = '⌃';
		this._collapseBtnEl.title = '折叠/展开终端';
		this._collapseBtnEl.style.cssText = `
			padding: 1px 6px;
			cursor: pointer;
			border-radius: 4px;
			font-size: 11px;
			color: var(--vscode-foreground);
			opacity: 0.5;
			flex-shrink: 0;
			user-select: none;
		`;
		this._collapseBtnEl.onmouseenter = () => { this._collapseBtnEl.style.opacity = '1'; };
		this._collapseBtnEl.onmouseleave = () => { this._collapseBtnEl.style.opacity = '0.5'; };
		this._collapseBtnEl.onclick = () => this._toggleCollapse();
	}

	private _buildBody(): void {
		// 注意：_bodyEl 必须有 terminal-editor 类，使 terminal.css 里的规则生效：
		//   .monaco-workbench .terminal-editor .terminal-wrapper { display:block; height:100% }
		//   .monaco-workbench .terminal-editor .xterm { position:absolute; bottom:0; left:0; right:0 }
		this._bodyEl = append(this._panelEl, $('div.solo-terminal-body.terminal-editor'));
		this._bodyEl.style.cssText = `
			flex: 1;
			min-height: 0;
			position: relative;
			overflow: hidden;
		`;

		// 点击空白区域时聚焦当前终端
		this._bodyEl.addEventListener('click', () => {
			const active = this._tabs.find(t => t.id === this._activeTabId);
			if (active && !this._collapsed) {
				active.instance.focus();
			}
		});

		// 当 _bodyEl 尺寸变化时，通知当前激活的 xterm 重新 layout
		this._resizeObserver = new ResizeObserver(() => {
			const active = this._tabs.find(t => t.id === this._activeTabId);
			if (active) {
				this._doLayout(active.instance);
			}
		});
		this._resizeObserver.observe(this._bodyEl);
		this._register({ dispose: () => this._resizeObserver?.disconnect() });

		// 空状态提示
		const hint = append(this._bodyEl, $('div.solo-terminal-hint'));
		hint.style.cssText = `
			display: flex;
			align-items: center;
			justify-content: center;
			height: 100%;
			color: var(--vscode-descriptionForeground);
			font-size: 13px;
			opacity: 0.45;
			pointer-events: none;
		`;
		hint.textContent = '点击 + 新建终端，或由 AI 自动打开';
		(this._bodyEl as any)._hint = hint;
	}

	// ── 公共 API ──────────────────────────────────────────────────────────────

	/**
	 * 用户点击 + 时新建终端
	 */
	async createUserTerminal(name?: string): Promise<ISoloTerminalTab> {
		const tabName = name || `终端 ${this._tabs.filter(t => !t.isAi).length + 1}`;
		return this._createTab(Date.now().toString(), tabName, false);
	}

	/**
	 * AI 执行命令时调用：在 [AI] Tab 中镜像显示命令
	 * @param command  AI 执行的命令
	 * @param cwd      工作目录
	 * @param sessionId  Solo 会话 ID（用于日志）
	 */
	async mirrorAiCommand(command: string, cwd?: string, _sessionId?: string): Promise<void> {
		// 展开面板（如果折叠中）
		if (this._collapsed) { this._toggleCollapse(); }

		const shortName = this._shortName(command);
		const tabName = `✦ ${shortName}`;

		// 查找现有 AI tab 复用
		let tab = this._tabs.find(t => t.isAi);

		if (!tab) {
			tab = await this._createTab(`ai_${Date.now()}`, tabName, true, cwd);
		} else {
			// 更新 tab 名
			(tab.tabEl as any)._nameSpan.textContent = tabName;
			tab.name = tabName;
			this._switchTab(tab.id);
		}

		// 在终端中发送并执行命令
		await tab.instance.focusWhenReady(true);
		tab.instance.sendText(command, true);
	}

	// ── 内部 Tab 管理 ─────────────────────────────────────────────────────────

	private async _createTab(id: string, name: string, isAi: boolean, cwd?: string): Promise<ISoloTerminalTab> {
		// 隐藏空状态提示
		const hint = (this._bodyEl as any)._hint as HTMLElement | undefined;
		if (hint) { hint.style.display = 'none'; }

		// xterm 宿主 div（绝对定位）
		// 同样带 terminal-editor 类，确保 CSS 规则继承正确
		const bodyEl = document.createElement('div');
		bodyEl.className = 'solo-terminal-xterm-host terminal-overflow-guard terminal-editor';
		bodyEl.style.cssText = `
			position: absolute;
			top: 0; left: 0; right: 0; bottom: 0;
			overflow: hidden;
		`;
		this._bodyEl.appendChild(bodyEl);

		// 把其他 tab 的 bodyEl 隐藏，当前这个保持可见供 xterm 初始化和测量尺寸
		for (const t of this._tabs) {
			t.bodyEl.style.display = 'none';
		}

		// 创建 VSCode 原生终端（hideFromUser=true 不出现在 VSCode 底部终端面板）
		const instance = await this.terminalService.createTerminal({
			config: {
				name,
				cwd: cwd || this.workspaceRoot,
				hideFromUser: true,
			},
			location: TerminalLocation.Panel,
		});

		// 将 xterm 渲染到我们的宿主 div（此时 bodyEl 是 display:block，xterm 可正常测量尺寸）
		instance.attachToElement(bodyEl);
		instance.setVisible(true);

		// 显式调用 layout，触发 _containerReadyBarrier 以启动 shell 进程（与 terminalEditor.ts 保持一致）
		this._doLayout(instance);

		// 构建 Tab 按钮
		const tabEl = this._buildTabEl(id, name, isAi);

		const tab: ISoloTerminalTab = { id, name, instance, bodyEl, tabEl, isAi };
		this._tabs.push(tab);

		// 终端退出时自动关闭 Tab
		const exitDisposable = instance.onExit(() => {
			exitDisposable.dispose();
			setTimeout(() => this._closeTab(id), 800);
		});
		this._register(exitDisposable);

		// 切换到新 tab（会激活当前，并再次 layout + focus）
		this._switchTab(id);
		return tab;
	}

	/**
	 * 用当前 _bodyEl 的实际尺寸调用 instance.layout()
	 * 这是让 xterm 正确渲染的关键（等同于 terminalEditor.layout()）
	 */
	private _doLayout(instance: ITerminalInstance): void {
		const w = this._bodyEl.clientWidth;
		const h = this._bodyEl.clientHeight;
		if (w > 0 && h > 0) {
			instance.layout(new Dimension(w, h));
		}
	}

	private _buildTabEl(id: string, name: string, isAi: boolean): HTMLElement {
		const tabEl = append(this._tabBarEl, $('div.solo-terminal-tab'));
		tabEl.style.cssText = `
			display: inline-flex;
			align-items: center;
			gap: 4px;
			padding: 2px 6px 2px 9px;
			border-radius: 4px 4px 0 0;
			cursor: pointer;
			flex-shrink: 0;
			border: 1px solid transparent;
			border-bottom: none;
			white-space: nowrap;
			max-width: 180px;
			user-select: none;
		`;

		if (isAi) {
			const dot = append(tabEl, $('span'));
			dot.textContent = '✦';
			dot.style.cssText = 'font-size:9px;color:#FFA500;flex-shrink:0;';
		}

		const nameSpan = append(tabEl, $('span'));
		nameSpan.textContent = name;
		nameSpan.style.cssText = `
			font-size: 12px;
			color: var(--vscode-foreground);
			opacity: 0.7;
			overflow: hidden;
			text-overflow: ellipsis;
			max-width: 130px;
		`;
		(tabEl as any)._nameSpan = nameSpan;

		const closeSpan = append(tabEl, $('span'));
		closeSpan.textContent = '×';
		closeSpan.style.cssText = `
			font-size: 14px;
			line-height: 1;
			opacity: 0;
			margin-left: 2px;
			flex-shrink: 0;
			border-radius: 3px;
			padding: 0 2px;
			transition: opacity 0.1s;
		`;
		tabEl.onmouseenter = () => { closeSpan.style.opacity = '0.6'; };
		tabEl.onmouseleave = () => { closeSpan.style.opacity = '0'; };
		closeSpan.onmouseenter = () => { closeSpan.style.opacity = '1'; closeSpan.style.background = 'rgba(255,80,80,0.2)'; };
		closeSpan.onmouseleave = () => { closeSpan.style.opacity = '0.6'; closeSpan.style.background = ''; };
		closeSpan.onclick = (e) => { e.stopPropagation(); this._closeTab(id); };

		tabEl.onclick = () => this._switchTab(id);
		return tabEl;
	}

	private _switchTab(id: string): void {
		// 隐藏上一个（如果不同）
		if (this._activeTabId && this._activeTabId !== id) {
			const prev = this._tabs.find(t => t.id === this._activeTabId);
			if (prev) {
				prev.bodyEl.style.display = 'none';
				prev.instance.setVisible(false);
				prev.tabEl.style.background = '';
				prev.tabEl.style.borderColor = 'transparent';
				(prev.tabEl as any)._nameSpan.style.opacity = '0.7';
			}
		}

		// 显示新的
		const next = this._tabs.find(t => t.id === id);
		if (!next) { return; }
		this._activeTabId = id;

		next.bodyEl.style.display = 'block';
		next.instance.setVisible(true);
		next.tabEl.style.background = 'rgba(128,128,128,0.10)';
		next.tabEl.style.borderColor = 'var(--vscode-panel-border)';
		(next.tabEl as any)._nameSpan.style.opacity = '1';

		// 显示后立即 layout，再 focus
		setTimeout(() => {
			if (!this._collapsed) {
				this._doLayout(next.instance);
				next.instance.focus();
			}
		}, 50);
	}

	private _closeTab(id: string): void {
		const idx = this._tabs.findIndex(t => t.id === id);
		if (idx === -1) { return; }
		const tab = this._tabs[idx];

		tab.tabEl.remove();
		tab.bodyEl.remove();
		try { tab.instance.dispose(); } catch { /* already disposed */ }
		this._tabs.splice(idx, 1);

		if (this._tabs.length > 0) {
			this._activeTabId = '';
			const next = this._tabs[Math.min(idx, this._tabs.length - 1)];
			this._switchTab(next.id);
		} else {
			this._activeTabId = '';
			const hint = (this._bodyEl as any)._hint as HTMLElement | undefined;
			if (hint) { hint.style.display = 'flex'; }
		}
	}

	private _toggleCollapse(): void {
		this._collapsed = !this._collapsed;
		if (this._collapsed) {
			this._panelEl.style.height = '34px';
			this._bodyEl.style.display = 'none';
			this._resizerEl.style.display = 'none';
			this._collapseBtnEl.textContent = '⌄';
		} else {
			this._panelEl.style.height = `${this._panelHeight}px`;
			this._bodyEl.style.display = '';
			this._resizerEl.style.display = '';
			this._collapseBtnEl.textContent = '⌃';
			// 刷新激活的终端
			const active = this._tabs.find(t => t.id === this._activeTabId);
			if (active) {
				active.instance.setVisible(true);
				setTimeout(() => {
					this._doLayout(active.instance);
					active.instance.focus();
				}, 50);
			}
		}
	}

	private _setupResizerDrag(): void {
		this._resizerEl.addEventListener('mousedown', (startEvt) => {
			startEvt.preventDefault();
			const startY = startEvt.clientY;
			const startH = this._panelEl.getBoundingClientRect().height;

			const onMove = (e: MouseEvent) => {
				if (this._collapsed) { return; }
				const delta = startY - e.clientY;   // 向上拖 = 变高
				const newH = Math.max(80, Math.min(700, startH + delta));
				this._panelHeight = newH;
				this._panelEl.style.height = `${newH}px`;
			};

			const onUp = () => {
				document.removeEventListener('mousemove', onMove);
				document.removeEventListener('mouseup', onUp);
				// 拖动完成后刷新 layout
				const active = this._tabs.find(t => t.id === this._activeTabId);
				if (active) { this._doLayout(active.instance); }
			};

			document.addEventListener('mousemove', onMove);
			document.addEventListener('mouseup', onUp);
		});
	}

	private _shortName(command: string): string {
		const trimmed = command.trim();
		const parts = trimmed.split(/\s+/);
		return parts.slice(0, 3).join(' ').substring(0, 32);
	}

	override dispose(): void {
		for (const tab of [...this._tabs]) {
			try { tab.instance.dispose(); } catch { /* ignore */ }
		}
		super.dispose();
	}
}
