/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * UI 工具函数模块
 * 参考 OpenCode UI 组件设计
 */

import { $, append } from '../../../../base/browser/dom.js';

// ========== Diff 变更统计 ==========

/**
 * Diff 变更统计数据
 */
export interface DiffStats {
	additions: number;
	deletions: number;
}

/**
 * 计算文本差异的统计信息
 * @param originalContent 原始内容
 * @param newContent 新内容
 * @returns 变更统计
 */
export function calculateDiffStats(originalContent: string, newContent: string): DiffStats {
	const originalLines = originalContent.split('\n');
	const newLines = newContent.split('\n');

	// 使用简单的行级别对比
	const originalSet = new Set(originalLines);
	const newSet = new Set(newLines);

	let additions = 0;
	let deletions = 0;

	// 新增的行（在新内容中但不在原内容中）
	for (const line of newLines) {
		if (!originalSet.has(line)) {
			additions++;
		}
	}

	// 删除的行（在原内容中但不在新内容中）
	for (const line of originalLines) {
		if (!newSet.has(line)) {
			deletions++;
		}
	}

	return { additions, deletions };
}

/**
 * 从 SEARCH/REPLACE 格式的 diff 计算统计信息
 * @param diff SEARCH/REPLACE 格式的差异
 * @returns 变更统计
 */
export function calculateSearchReplaceDiffStats(diff: string): DiffStats {
	const searchReplaceRegex = /<<<<<<< SEARCH\n([\s\S]*?)\n=======\n([\s\S]*?)\n>>>>>>> REPLACE/g;

	let additions = 0;
	let deletions = 0;
	let match;

	while ((match = searchReplaceRegex.exec(diff)) !== null) {
		const searchText = match[1];
		const replaceText = match[2];

		const searchLines = searchText.split('\n').filter(l => l.trim()).length;
		const replaceLines = replaceText.split('\n').filter(l => l.trim()).length;

		if (replaceLines > searchLines) {
			additions += replaceLines - searchLines;
		} else if (searchLines > replaceLines) {
			deletions += searchLines - replaceLines;
		}
		// 修改的行算作 additions 和 deletions
		const modifiedLines = Math.min(searchLines, replaceLines);
		additions += modifiedLines;
		deletions += modifiedLines;
	}

	return { additions, deletions };
}

/**
 * 创建 Diff 变更统计 UI 元素
 * 参考 OpenCode DiffChanges 组件
 * @param parent 父元素
 * @param stats 变更统计
 * @param variant 显示变体：'default' 显示数字，'bars' 显示彩色条
 */
export function renderDiffStats(
	parent: HTMLElement,
	stats: DiffStats,
	variant: 'default' | 'bars' = 'default'
): HTMLElement {
	const container = append(parent, $('div'));
	container.style.display = 'flex';
	container.style.alignItems = 'center';
	container.style.gap = '8px';
	container.style.fontSize = '12px';
	container.style.fontFamily = 'var(--vscode-editor-font-family)';

	if (variant === 'default') {
		// 数字显示
		if (stats.additions > 0) {
			const addSpan = append(container, $('span'));
			addSpan.style.color = 'var(--vscode-gitDecoration-addedResourceForeground, #81b88b)';
			addSpan.style.fontWeight = '600';
			addSpan.textContent = `+${stats.additions}`;
		}

		if (stats.deletions > 0) {
			const delSpan = append(container, $('span'));
			delSpan.style.color = 'var(--vscode-gitDecoration-deletedResourceForeground, #c74e39)';
			delSpan.style.fontWeight = '600';
			delSpan.textContent = `-${stats.deletions}`;
		}

		if (stats.additions === 0 && stats.deletions === 0) {
			const noChangeSpan = append(container, $('span'));
			noChangeSpan.style.color = 'var(--vscode-descriptionForeground)';
			noChangeSpan.textContent = '无变更';
		}
	} else {
		// 彩色条显示
		renderDiffBars(container, stats);
	}

	return container;
}

/**
 * 渲染 Diff 彩色条
 * 参考 OpenCode DiffChanges 的 bars 变体
 */
function renderDiffBars(container: HTMLElement, stats: DiffStats): void {
	const TOTAL_BLOCKS = 5;
	const { additions, deletions } = stats;
	const total = additions + deletions;

	let addBlocks = 0;
	let delBlocks = 0;
	let neutralBlocks = TOTAL_BLOCKS;

	if (total > 0) {
		if (total < 5) {
			addBlocks = additions > 0 ? 1 : 0;
			delBlocks = deletions > 0 ? 1 : 0;
		} else {
			addBlocks = Math.max(1, Math.round((additions / total) * TOTAL_BLOCKS));
			delBlocks = Math.max(1, Math.round((deletions / total) * TOTAL_BLOCKS));

			// 限制块数
			if (addBlocks + delBlocks > TOTAL_BLOCKS) {
				if (additions > deletions) {
					addBlocks = TOTAL_BLOCKS - delBlocks;
				} else {
					delBlocks = TOTAL_BLOCKS - addBlocks;
				}
			}
		}
		neutralBlocks = Math.max(0, TOTAL_BLOCKS - addBlocks - delBlocks);
	}

	// 创建 SVG
	const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
	svg.setAttribute('width', '18');
	svg.setAttribute('height', '12');
	svg.setAttribute('viewBox', '0 0 18 12');
	svg.style.verticalAlign = 'middle';

	const colors = [
		...Array(addBlocks).fill('var(--vscode-gitDecoration-addedResourceForeground, #81b88b)'),
		...Array(delBlocks).fill('var(--vscode-gitDecoration-deletedResourceForeground, #c74e39)'),
		...Array(neutralBlocks).fill('var(--vscode-descriptionForeground, #888)')
	];

	colors.slice(0, TOTAL_BLOCKS).forEach((color, i) => {
		const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
		rect.setAttribute('x', String(i * 4));
		rect.setAttribute('width', '2');
		rect.setAttribute('height', '12');
		rect.setAttribute('rx', '1');
		rect.setAttribute('fill', color);
		svg.appendChild(rect);
	});

	container.appendChild(svg);
}

// ========== 文件路径美化 ==========

/**
 * 解析文件路径为目录和文件名
 * @param filePath 完整文件路径
 * @returns { directory, filename }
 */
export function parseFilePath(filePath: string): { directory: string; filename: string } {
	const parts = filePath.replace(/\\/g, '/').split('/');
	const filename = parts.pop() || '';
	const directory = parts.join('/');
	return { directory: directory ? directory + '/' : '', filename };
}

/**
 * 渲染美化的文件路径
 * 目录部分灰色，文件名高亮
 * @param parent 父元素
 * @param filePath 文件路径
 */
export function renderFilePath(parent: HTMLElement, filePath: string): HTMLElement {
	const container = append(parent, $('div'));
	container.style.display = 'flex';
	container.style.alignItems = 'center';
	container.style.gap = '6px';
	container.style.overflow = 'hidden';
	container.title = filePath; // 完整路径作为 tooltip

	// 文件图标
	const icon = append(container, $('span.codicon.codicon-file'));
	icon.style.color = 'var(--vscode-textLink-foreground)';
	icon.style.fontSize = '14px';
	icon.style.flexShrink = '0';

	const { directory, filename } = parseFilePath(filePath);

	// 路径容器
	const pathContainer = append(container, $('span'));
	pathContainer.style.fontFamily = 'var(--vscode-editor-font-family)';
	pathContainer.style.fontSize = '13px';
	pathContainer.style.overflow = 'hidden';
	pathContainer.style.textOverflow = 'ellipsis';
	pathContainer.style.whiteSpace = 'nowrap';

	// 目录部分（灰色）
	if (directory) {
		const dirSpan = append(pathContainer, $('span'));
		dirSpan.style.color = 'var(--vscode-descriptionForeground)';
		dirSpan.textContent = directory;
	}

	// 文件名（高亮）
	const fileSpan = append(pathContainer, $('span'));
	fileSpan.style.color = 'var(--vscode-textLink-foreground)';
	fileSpan.style.fontWeight = '600';
	fileSpan.textContent = filename;

	return container;
}

// ========== Token/成本显示 ==========

/**
 * Token 使用统计
 */
export interface TokenStats {
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens?: number;
	cacheWriteTokens?: number;
	cost?: number; // 成本（美元）
}

/**
 * 格式化 Token 数量（1000 -> 1k）
 */
export function formatTokenCount(count: number): string {
	if (count >= 1000000) {
		return (count / 1000000).toFixed(1) + 'M';
	}
	if (count >= 1000) {
		return (count / 1000).toFixed(1) + 'k';
	}
	return String(count);
}

/**
 * 格式化成本（美元）
 */
export function formatCost(cost: number): string {
	if (cost < 0.01) {
		return '<$0.01';
	}
	return '$' + cost.toFixed(2);
}

/**
 * 渲染 Token 统计 UI
 * @param parent 父元素
 * @param stats Token 统计
 */
export function renderTokenStats(parent: HTMLElement, stats: TokenStats): HTMLElement {
	const container = append(parent, $('div'));
	container.style.display = 'flex';
	container.style.alignItems = 'center';
	container.style.gap = '12px';
	container.style.fontSize = '11px';
	container.style.color = 'var(--vscode-descriptionForeground)';
	container.style.fontFamily = 'var(--vscode-editor-font-family)';

	// 输入 tokens
	const inputSpan = append(container, $('span'));
	inputSpan.style.display = 'flex';
	inputSpan.style.alignItems = 'center';
	inputSpan.style.gap = '2px';
	inputSpan.title = `输入: ${stats.inputTokens} tokens`;

	const inputArrow = append(inputSpan, $('span'));
	inputArrow.textContent = '↓';
	inputArrow.style.color = 'var(--vscode-charts-blue)';

	const inputCount = append(inputSpan, $('span'));
	inputCount.textContent = formatTokenCount(stats.inputTokens);

	// 输出 tokens
	const outputSpan = append(container, $('span'));
	outputSpan.style.display = 'flex';
	outputSpan.style.alignItems = 'center';
	outputSpan.style.gap = '2px';
	outputSpan.title = `输出: ${stats.outputTokens} tokens`;

	const outputArrow = append(outputSpan, $('span'));
	outputArrow.textContent = '↑';
	outputArrow.style.color = 'var(--vscode-charts-green)';

	const outputCount = append(outputSpan, $('span'));
	outputCount.textContent = formatTokenCount(stats.outputTokens);

	// 缓存（如果有）
	if (stats.cacheReadTokens && stats.cacheReadTokens > 0) {
		const cacheSpan = append(container, $('span'));
		cacheSpan.style.display = 'flex';
		cacheSpan.style.alignItems = 'center';
		cacheSpan.style.gap = '2px';
		cacheSpan.title = `缓存命中: ${stats.cacheReadTokens} tokens`;

		const cacheIcon = append(cacheSpan, $('span'));
		cacheIcon.textContent = '⚡';

		const cacheCount = append(cacheSpan, $('span'));
		cacheCount.textContent = formatTokenCount(stats.cacheReadTokens);
	}

	// 成本（如果有）
	if (stats.cost !== undefined && stats.cost > 0) {
		const costSpan = append(container, $('span'));
		costSpan.style.color = 'var(--vscode-charts-orange)';
		costSpan.title = `成本: $${stats.cost.toFixed(4)}`;
		costSpan.textContent = formatCost(stats.cost);
	}

	return container;
}

// ========== 工具图标映射 ==========

/**
 * 工具名称到 codicon 图标的映射
 */
export const TOOL_ICONS: Record<string, string> = {
	// 读取类
	'read_file': 'codicon-eye',
	'read': 'codicon-eye',
	'list_files': 'codicon-list-tree',
	'list': 'codicon-list-tree',
	'glob': 'codicon-search',
	'grep': 'codicon-search',
	'search_files': 'codicon-search',
	'codebase_search': 'codicon-search',

	// 编辑类
	'write_file': 'codicon-edit',
	'write': 'codicon-edit',
	'edit': 'codicon-edit',
	'apply_diff': 'codicon-diff',
	'appliedDiff': 'codicon-diff',
	'newFileCreated': 'codicon-new-file',
	'editedExistingFile': 'codicon-edit',
	'insertContent': 'codicon-insert',
	'searchAndReplace': 'codicon-replace-all',

	// 终端类
	'bash': 'codicon-terminal',
	'execute_command': 'codicon-terminal',
	'command': 'codicon-terminal',

	// Web 类
	'websearch': 'codicon-search',
	'browser_action': 'codicon-browser',

	// 任务类
	'task': 'codicon-tasklist',
	'todowrite': 'codicon-checklist',
	'todoread': 'codicon-checklist',

	// 其他
	'attempt_completion': 'codicon-check-all',
	'ask_followup_question': 'codicon-comment-discussion',
};

/**
 * 获取工具的 codicon 图标类名
 */
export function getToolIcon(toolName: string): string {
	return TOOL_ICONS[toolName] || 'codicon-tools';
}

// ========== 时间格式化 ==========

/**
 * 格式化时间戳为相对时间
 * @param timestamp 时间戳（毫秒）
 */
export function formatRelativeTime(timestamp: number): string {
	const now = Date.now();
	const diff = now - timestamp;

	if (diff < 60000) { // < 1 分钟
		return '刚刚';
	}
	if (diff < 3600000) { // < 1 小时
		const minutes = Math.floor(diff / 60000);
		return `${minutes}分钟前`;
	}
	if (diff < 86400000) { // < 1 天
		const hours = Math.floor(diff / 3600000);
		return `${hours}小时前`;
	}
	// > 1 天，显示具体时间
	const date = new Date(timestamp);
	return `${date.getMonth() + 1}/${date.getDate()} ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
}

/**
 * 格式化时间戳为 HH:MM:SS
 */
export function formatTime(timestamp: number): string {
	const date = new Date(timestamp);
	return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}:${date.getSeconds().toString().padStart(2, '0')}`;
}

// ========== 工具状态 ==========

/**
 * 工具执行状态
 */
export type ToolStatus = 'pending' | 'running' | 'completed' | 'error' | 'cancelled' | 'waiting_approval';

/**
 * 工具状态到显示文本的映射
 */
export const TOOL_STATUS_TEXT: Record<ToolStatus, string> = {
	pending: '等待中',
	running: '执行中',
	completed: '已完成',
	error: '执行失败',
	cancelled: '已取消',
	waiting_approval: '等待确认',
};

/**
 * 工具状态到颜色的映射
 */
export const TOOL_STATUS_COLOR: Record<ToolStatus, string> = {
	pending: 'var(--vscode-descriptionForeground)',
	running: 'var(--vscode-charts-blue)',
	completed: 'var(--vscode-charts-green)',
	error: 'var(--vscode-errorForeground)',
	cancelled: 'var(--vscode-charts-orange)',
	waiting_approval: 'var(--vscode-charts-yellow)',
};

// ========== 复制功能 ==========

/**
 * 复制文本到剪贴板
 */
export async function copyToClipboard(text: string): Promise<boolean> {
	try {
		await navigator.clipboard.writeText(text);
		return true;
	} catch {
		// 回退方案
		const textarea = document.createElement('textarea');
		textarea.value = text;
		textarea.style.position = 'fixed';
		textarea.style.opacity = '0';
		document.body.appendChild(textarea);
		textarea.select();
		try {
			document.execCommand('copy');
			return true;
		} catch {
			return false;
		} finally {
			document.body.removeChild(textarea);
		}
	}
}

/**
 * 创建复制按钮
 */
export function createCopyButton(parent: HTMLElement, getText: () => string): HTMLButtonElement {
	const button = append(parent, $('button')) as HTMLButtonElement;
	button.className = 'codicon codicon-copy';
	button.style.background = 'transparent';
	button.style.border = 'none';
	button.style.cursor = 'pointer';
	button.style.color = 'var(--vscode-descriptionForeground)';
	button.style.fontSize = '14px';
	button.style.padding = '4px';
	button.style.borderRadius = '4px';
	button.style.transition = 'all 0.2s ease';
	button.title = '复制';

	button.onmouseenter = () => {
		button.style.color = 'var(--vscode-foreground)';
		button.style.backgroundColor = 'var(--vscode-toolbar-hoverBackground)';
	};
	button.onmouseleave = () => {
		button.style.color = 'var(--vscode-descriptionForeground)';
		button.style.backgroundColor = 'transparent';
	};

	button.onclick = async () => {
		const success = await copyToClipboard(getText());
		if (success) {
			button.className = 'codicon codicon-check';
			button.style.color = 'var(--vscode-charts-green)';
			setTimeout(() => {
				button.className = 'codicon codicon-copy';
				button.style.color = 'var(--vscode-descriptionForeground)';
			}, 2000);
		}
	};

	return button;
}

// ========== 可折叠组件 ==========

/**
 * 创建可折叠组件
 * @param parent 父元素
 * @param options 选项
 */
export function createCollapsible(
	parent: HTMLElement,
	options: {
		title: string | HTMLElement;
		defaultOpen?: boolean;
		headerClass?: string;
		contentClass?: string;
	}
): { container: HTMLElement; header: HTMLElement; content: HTMLElement; toggle: () => void } {
	const container = append(parent, $('div'));
	container.style.border = '1px solid var(--vscode-widget-border)';
	container.style.borderRadius = '6px';
	container.style.overflow = 'hidden';

	// Header
	const header = append(container, $('div'));
	header.style.display = 'flex';
	header.style.alignItems = 'center';
	header.style.padding = '8px 12px';
	header.style.cursor = 'pointer';
	header.style.backgroundColor = 'var(--vscode-editor-background)';
	header.style.userSelect = 'none';
	header.style.gap = '8px';
	if (options.headerClass) {
		header.className = options.headerClass;
	}

	// 展开/折叠箭头
	const arrow = append(header, $('span.codicon.codicon-chevron-down'));
	arrow.style.transition = 'transform 0.2s ease';
	arrow.style.fontSize = '14px';
	arrow.style.flexShrink = '0';

	// 标题
	const titleContainer = append(header, $('div'));
	titleContainer.style.flex = '1';
	titleContainer.style.overflow = 'hidden';
	if (typeof options.title === 'string') {
		titleContainer.textContent = options.title;
	} else {
		titleContainer.appendChild(options.title);
	}

	// 内容区域
	const content = append(container, $('div'));
	content.style.padding = '0 12px 12px 12px';
	content.style.transition = 'max-height 0.2s ease';
	content.style.overflow = 'hidden';
	if (options.contentClass) {
		content.className = options.contentClass;
	}

	let isOpen = options.defaultOpen ?? false;

	const updateState = () => {
		if (isOpen) {
			arrow.style.transform = 'rotate(0deg)';
			// 使用 'none' 代替具体高度，避免初始化时 scrollHeight 为 0 的问题
			content.style.maxHeight = 'none';
			content.style.paddingTop = '8px';
			content.style.display = 'block';
		} else {
			arrow.style.transform = 'rotate(-90deg)';
			content.style.maxHeight = '0';
			content.style.paddingTop = '0';
			content.style.display = 'none';
		}
	};

	const toggle = () => {
		isOpen = !isOpen;
		updateState();
	};

	header.onclick = toggle;

	// 初始状态
	updateState();

	return { container, header, content, toggle };
}

// ========== 错误展示 ==========

/**
 * 创建错误卡片
 */
export function createErrorCard(
	parent: HTMLElement,
	options: {
		title?: string;
		message: string;
		details?: string;
	}
): HTMLElement {
	const card = append(parent, $('div'));
	card.style.marginBottom = '10px';
	card.style.padding = '12px 16px';
	card.style.backgroundColor = 'var(--vscode-inputValidation-errorBackground)';
	card.style.border = '1px solid var(--vscode-inputValidation-errorBorder)';
	card.style.borderRadius = '6px';
	card.style.borderLeft = '4px solid var(--vscode-errorForeground)';

	// 标题行
	const titleRow = append(card, $('div'));
	titleRow.style.display = 'flex';
	titleRow.style.alignItems = 'center';
	titleRow.style.gap = '8px';
	titleRow.style.marginBottom = '8px';

	// 错误图标
	const icon = append(titleRow, $('span.codicon.codicon-error'));
	icon.style.color = 'var(--vscode-errorForeground)';
	icon.style.fontSize = '16px';

	// 标题
	const title = append(titleRow, $('span'));
	title.style.fontWeight = '600';
	title.style.fontSize = '13px';
	title.style.color = 'var(--vscode-errorForeground)';
	title.textContent = options.title || '错误';

	// 消息
	const message = append(card, $('div'));
	message.style.color = 'var(--vscode-foreground)';
	message.style.fontSize = '13px';
	message.style.lineHeight = '1.5';
	message.style.whiteSpace = 'pre-wrap';
	message.style.wordBreak = 'break-word';
	message.textContent = options.message;

	// 详情（可选）
	if (options.details) {
		const details = append(card, $('div'));
		details.style.marginTop = '8px';
		details.style.padding = '8px';
		details.style.backgroundColor = 'var(--vscode-textCodeBlock-background)';
		details.style.borderRadius = '4px';
		details.style.fontFamily = 'var(--vscode-editor-font-family)';
		details.style.fontSize = '12px';
		details.style.color = 'var(--vscode-descriptionForeground)';
		details.style.whiteSpace = 'pre-wrap';
		details.style.wordBreak = 'break-word';
		details.style.maxHeight = '200px';
		details.style.overflow = 'auto';
		details.textContent = options.details;
	}

	return card;
}

// ========== 进度条 ==========

/**
 * 创建进度条
 */
export function createProgressBar(
	parent: HTMLElement,
	options: {
		current: number;
		total: number;
		showText?: boolean;
		height?: number;
	}
): { container: HTMLElement; update: (current: number, total?: number) => void } {
	const container = append(parent, $('div'));
	container.style.display = 'flex';
	container.style.alignItems = 'center';
	container.style.gap = '8px';

	// 进度条背景
	const barBg = append(container, $('div'));
	barBg.style.flex = '1';
	barBg.style.height = `${options.height || 4}px`;
	barBg.style.backgroundColor = 'var(--vscode-progressBar-background)';
	barBg.style.borderRadius = '2px';
	barBg.style.overflow = 'hidden';

	// 进度条填充
	const barFill = append(barBg, $('div'));
	barFill.style.height = '100%';
	barFill.style.backgroundColor = 'var(--vscode-progressBar-background)';
	barFill.style.background = 'linear-gradient(90deg, var(--vscode-charts-blue), var(--vscode-charts-green))';
	barFill.style.borderRadius = '2px';
	barFill.style.transition = 'width 0.3s ease';

	// 文本显示
	let textEl: HTMLElement | null = null;
	if (options.showText !== false) {
		textEl = append(container, $('span'));
		textEl.style.fontSize = '11px';
		textEl.style.color = 'var(--vscode-descriptionForeground)';
		textEl.style.minWidth = '40px';
		textEl.style.textAlign = 'right';
	}

	const update = (current: number, total?: number) => {
		const t = total ?? options.total;
		const percent = t > 0 ? (current / t) * 100 : 0;
		barFill.style.width = `${Math.min(100, percent)}%`;
		if (textEl) {
			textEl.textContent = `${current}/${t}`;
		}
	};

	update(options.current, options.total);

	return { container, update };
}

// ========== 重试状态显示 ==========

/**
 * 创建重试状态显示
 */
export function createRetryStatus(
	parent: HTMLElement,
	options: {
		attempt: number;
		maxAttempts?: number;
		delayMs: number;
		message?: string;
	}
): { container: HTMLElement; updateCountdown: (remainingMs: number) => void; remove: () => void } {
	const container = append(parent, $('div'));
	container.style.display = 'flex';
	container.style.alignItems = 'center';
	container.style.gap = '8px';
	container.style.padding = '8px 12px';
	container.style.backgroundColor = 'var(--vscode-inputValidation-warningBackground)';
	container.style.border = '1px solid var(--vscode-inputValidation-warningBorder)';
	container.style.borderRadius = '6px';
	container.style.fontSize = '12px';

	// 图标
	const icon = append(container, $('span.codicon.codicon-sync'));
	icon.style.color = 'var(--vscode-charts-orange)';
	icon.style.animation = 'spin 1s linear infinite';

	// 消息
	const messageEl = append(container, $('span'));
	messageEl.style.flex = '1';
	messageEl.textContent = options.message || `正在重试 (第${options.attempt}次)`;

	// 倒计时
	const countdownEl = append(container, $('span'));
	countdownEl.style.color = 'var(--vscode-descriptionForeground)';

	const updateCountdown = (remainingMs: number) => {
		const seconds = Math.ceil(remainingMs / 1000);
		countdownEl.textContent = `${seconds}秒后重试...`;
	};

	updateCountdown(options.delayMs);

	const remove = () => {
		container.remove();
	};

	return { container, updateCountdown, remove };
}

// ========== 压缩状态显示 ==========

/**
 * 创建压缩状态显示
 */
export function createCompactionStatus(
	parent: HTMLElement,
	options: {
		compactedParts: number;
		savedTokens: number;
	}
): HTMLElement {
	const container = append(parent, $('div'));
	container.style.display = 'flex';
	container.style.alignItems = 'center';
	container.style.gap = '6px';
	container.style.padding = '6px 10px';
	container.style.backgroundColor = 'var(--vscode-editor-inactiveSelectionBackground)';
	container.style.borderRadius = '4px';
	container.style.fontSize = '11px';
	container.style.color = 'var(--vscode-descriptionForeground)';

	// 图标
	const icon = append(container, $('span.codicon.codicon-archive'));
	icon.style.fontSize = '12px';

	// 文本
	const text = append(container, $('span'));
	text.textContent = `已压缩 ${options.compactedParts} 条工具输出，节省约 ${formatTokenCount(options.savedTokens)} tokens`;

	return container;
}

// ========== LSP 诊断信息 ==========

/**
 * LSP 诊断严重程度
 */
export type DiagnosticSeverity = 'error' | 'warning' | 'info' | 'hint';

/**
 * LSP 诊断信息
 */
export interface DiagnosticInfo {
	severity: DiagnosticSeverity;
	message: string;
	source?: string;
	code?: string | number;
	range?: {
		startLine: number;
		startColumn: number;
		endLine: number;
		endColumn: number;
	};
	relatedInformation?: Array<{
		message: string;
		location?: string;
	}>;
}

/**
 * 诊断严重程度到颜色的映射
 */
export const DIAGNOSTIC_SEVERITY_COLOR: Record<DiagnosticSeverity, string> = {
	error: 'var(--vscode-errorForeground, #f14c4c)',
	warning: 'var(--vscode-editorWarning-foreground, #cca700)',
	info: 'var(--vscode-editorInfo-foreground, #3794ff)',
	hint: 'var(--vscode-editorHint-foreground, #eeeeee)',
};

/**
 * 诊断严重程度到图标的映射
 */
export const DIAGNOSTIC_SEVERITY_ICON: Record<DiagnosticSeverity, string> = {
	error: 'codicon-error',
	warning: 'codicon-warning',
	info: 'codicon-info',
	hint: 'codicon-lightbulb',
};

/**
 * 诊断严重程度到标签的映射
 */
export const DIAGNOSTIC_SEVERITY_LABEL: Record<DiagnosticSeverity, string> = {
	error: '错误',
	warning: '警告',
	info: '信息',
	hint: '提示',
};

/**
 * 创建单条诊断信息的 UI 元素
 */
export function createDiagnosticItem(
	parent: HTMLElement,
	diagnostic: DiagnosticInfo
): HTMLElement {
	const container = append(parent, $('div.diagnostic-item'));
	container.style.cssText = `
		display: flex;
		flex-direction: column;
		gap: 4px;
		padding: 8px 12px;
		margin: 4px 0;
		background: var(--vscode-inputValidation-${diagnostic.severity === 'error' ? 'error' : diagnostic.severity === 'warning' ? 'warning' : 'info'}Background, rgba(0, 0, 0, 0.1));
		border-left: 3px solid ${DIAGNOSTIC_SEVERITY_COLOR[diagnostic.severity]};
		border-radius: 4px;
		font-size: 12px;
	`;

	// 头部行
	const headerRow = append(container, $('div.diagnostic-header'));
	headerRow.style.cssText = `
		display: flex;
		align-items: center;
		gap: 6px;
	`;

	// 严重程度图标
	const icon = append(headerRow, $(`span.codicon.${DIAGNOSTIC_SEVERITY_ICON[diagnostic.severity]}`));
	icon.style.cssText = `
		color: ${DIAGNOSTIC_SEVERITY_COLOR[diagnostic.severity]};
		font-size: 14px;
	`;

	// 严重程度标签
	const severityLabel = append(headerRow, $('span.diagnostic-severity'));
	severityLabel.style.cssText = `
		color: ${DIAGNOSTIC_SEVERITY_COLOR[diagnostic.severity]};
		font-weight: 600;
		text-transform: uppercase;
		font-size: 10px;
	`;
	severityLabel.textContent = DIAGNOSTIC_SEVERITY_LABEL[diagnostic.severity];

	// 来源
	if (diagnostic.source) {
		const source = append(headerRow, $('span.diagnostic-source'));
		source.style.cssText = `
			color: var(--vscode-descriptionForeground);
			font-size: 10px;
			margin-left: auto;
		`;
		source.textContent = diagnostic.source;
	}

	// 错误代码
	if (diagnostic.code) {
		const code = append(headerRow, $('span.diagnostic-code'));
		code.style.cssText = `
			color: var(--vscode-textLink-foreground);
			font-size: 10px;
			cursor: pointer;
		`;
		code.textContent = `[${diagnostic.code}]`;
	}

	// 消息内容
	const message = append(container, $('div.diagnostic-message'));
	message.style.cssText = `
		color: var(--vscode-foreground);
		line-height: 1.5;
		word-break: break-word;
	`;
	message.textContent = diagnostic.message;

	// 位置信息
	if (diagnostic.range) {
		const location = append(container, $('div.diagnostic-location'));
		location.style.cssText = `
			color: var(--vscode-descriptionForeground);
			font-size: 11px;
			font-family: var(--vscode-editor-font-family, monospace);
		`;
		location.textContent = `行 ${diagnostic.range.startLine}:${diagnostic.range.startColumn}`;
	}

	// 相关信息
	if (diagnostic.relatedInformation && diagnostic.relatedInformation.length > 0) {
		const relatedContainer = append(container, $('div.diagnostic-related'));
		relatedContainer.style.cssText = `
			margin-top: 4px;
			padding-top: 4px;
			border-top: 1px solid var(--vscode-widget-border);
		`;

		for (const related of diagnostic.relatedInformation) {
			const relatedItem = append(relatedContainer, $('div.related-item'));
			relatedItem.style.cssText = `
				color: var(--vscode-descriptionForeground);
				font-size: 11px;
				margin: 2px 0;
			`;
			relatedItem.textContent = `↳ ${related.message}`;
			if (related.location) {
				const locSpan = append(relatedItem, $('span'));
				locSpan.style.marginLeft = '8px';
				locSpan.textContent = `(${related.location})`;
			}
		}
	}

	return container;
}

/**
 * 创建诊断信息摘要卡片
 */
export function createDiagnosticsSummary(
	parent: HTMLElement,
	diagnostics: DiagnosticInfo[]
): HTMLElement {
	const container = append(parent, $('div.diagnostics-summary'));
	container.style.cssText = `
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 12px;
		background: var(--vscode-editor-background);
		border: 1px solid var(--vscode-widget-border);
		border-radius: 6px;
		margin: 8px 0;
	`;

	// 统计各类型数量
	const counts = {
		error: 0,
		warning: 0,
		info: 0,
		hint: 0,
	};

	for (const diag of diagnostics) {
		counts[diag.severity]++;
	}

	// 头部标题
	const header = append(container, $('div.diagnostics-header'));
	header.style.cssText = `
		display: flex;
		align-items: center;
		gap: 8px;
		padding-bottom: 8px;
		border-bottom: 1px solid var(--vscode-widget-border);
	`;

	const title = append(header, $('span.diagnostics-title'));
	title.style.cssText = `
		font-weight: 600;
		color: var(--vscode-foreground);
	`;
	title.textContent = '诊断信息';

	// 统计徽章
	const badges = append(header, $('div.diagnostics-badges'));
	badges.style.cssText = `
		display: flex;
		gap: 8px;
		margin-left: auto;
	`;

	if (counts.error > 0) {
		createCountBadge(badges, counts.error, 'error');
	}
	if (counts.warning > 0) {
		createCountBadge(badges, counts.warning, 'warning');
	}
	if (counts.info > 0) {
		createCountBadge(badges, counts.info, 'info');
	}
	if (counts.hint > 0) {
		createCountBadge(badges, counts.hint, 'hint');
	}

	// 诊断列表
	const list = append(container, $('div.diagnostics-list'));
	list.style.cssText = `
		max-height: 300px;
		overflow-y: auto;
	`;

	for (const diagnostic of diagnostics) {
		createDiagnosticItem(list, diagnostic);
	}

	return container;
}

/**
 * 创建计数徽章
 */
function createCountBadge(parent: HTMLElement, count: number, severity: DiagnosticSeverity): HTMLElement {
	const badge = append(parent, $('span.count-badge'));
	badge.style.cssText = `
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 2px 8px;
		border-radius: 10px;
		font-size: 11px;
		font-weight: 600;
		background: ${DIAGNOSTIC_SEVERITY_COLOR[severity]}20;
		color: ${DIAGNOSTIC_SEVERITY_COLOR[severity]};
	`;

	const icon = append(badge, $(`span.codicon.${DIAGNOSTIC_SEVERITY_ICON[severity]}`));
	icon.style.fontSize = '12px';

	const countSpan = append(badge, $('span'));
	countSpan.textContent = String(count);

	return badge;
}

/**
 * 创建内联诊断标记（用于代码中显示）
 */
export function createInlineDiagnosticMarker(
	parent: HTMLElement,
	diagnostic: DiagnosticInfo
): HTMLElement {
	const marker = append(parent, $('span.inline-diagnostic'));
	marker.style.cssText = `
		display: inline-flex;
		align-items: center;
		gap: 4px;
		padding: 0 4px;
		margin: 0 2px;
		background: ${DIAGNOSTIC_SEVERITY_COLOR[diagnostic.severity]}20;
		border-bottom: 2px ${diagnostic.severity === 'error' ? 'wavy' : diagnostic.severity === 'warning' ? 'dashed' : 'dotted'} ${DIAGNOSTIC_SEVERITY_COLOR[diagnostic.severity]};
		cursor: pointer;
	`;

	const icon = append(marker, $(`span.codicon.${DIAGNOSTIC_SEVERITY_ICON[diagnostic.severity]}`));
	icon.style.cssText = `
		font-size: 10px;
		color: ${DIAGNOSTIC_SEVERITY_COLOR[diagnostic.severity]};
	`;

	marker.title = `${DIAGNOSTIC_SEVERITY_LABEL[diagnostic.severity]}: ${diagnostic.message}`;

	return marker;
}

/**
 * 解析工具执行结果中的诊断信息
 * 支持多种编译器和工具的输出格式
 */
export function parseDiagnosticsFromToolResult(result: string): DiagnosticInfo[] {
	const diagnostics: DiagnosticInfo[] = [];
	const seenMessages = new Set<string>(); // 去重

	// 辅助函数：添加诊断信息并去重
	const addDiagnostic = (diag: DiagnosticInfo): void => {
		const key = `${diag.severity}:${diag.message}:${diag.range?.startLine || 0}`;
		if (!seenMessages.has(key)) {
			seenMessages.add(key);
			diagnostics.push(diag);
		}
	};

	let match;

	// TypeScript/ESLint 格式: filename(line,col): error TS1234: message
	const tsRegex = /^(.+?)\((\d+),(\d+)\):\s*(error|warning|info)\s*(\w+):\s*(.+)$/gm;
	while ((match = tsRegex.exec(result)) !== null) {
		addDiagnostic({
			severity: match[4] as DiagnosticSeverity,
			message: match[6],
			code: match[5],
			source: 'TypeScript',
			range: {
				startLine: parseInt(match[2]),
				startColumn: parseInt(match[3]),
				endLine: parseInt(match[2]),
				endColumn: parseInt(match[3]),
			},
		});
	}

	// ESLint/TSLint 格式: line:col  severity  message  rule
	const eslintRegex = /^\s*(\d+):(\d+)\s+(error|warning)\s+(.+?)\s{2,}(\S+)$/gm;
	while ((match = eslintRegex.exec(result)) !== null) {
		addDiagnostic({
			severity: match[3] as DiagnosticSeverity,
			message: match[4].trim(),
			code: match[5],
			source: 'ESLint',
			range: {
				startLine: parseInt(match[1]),
				startColumn: parseInt(match[2]),
				endLine: parseInt(match[1]),
				endColumn: parseInt(match[2]),
			},
		});
	}

	// GCC/Clang 格式: filename:line:col: error: message
	const gccRegex = /^(.+?):(\d+):(\d+):\s*(error|warning|note):\s*(.+)$/gm;
	while ((match = gccRegex.exec(result)) !== null) {
		addDiagnostic({
			severity: match[4] === 'note' ? 'info' : match[4] as DiagnosticSeverity,
			message: match[5],
			source: 'Compiler',
			range: {
				startLine: parseInt(match[2]),
				startColumn: parseInt(match[3]),
				endLine: parseInt(match[2]),
				endColumn: parseInt(match[3]),
			},
		});
	}

	// Rust 格式: error[E0123]: message --> filename:line:col
	const rustRegex = /^(error|warning)\[([^\]]+)\]:\s*(.+?)(?:\s*-->\s*(.+?):(\d+):(\d+))?$/gm;
	while ((match = rustRegex.exec(result)) !== null) {
		const diag: DiagnosticInfo = {
			severity: match[1] as DiagnosticSeverity,
			message: match[3],
			code: match[2],
			source: 'Rust',
		};
		if (match[5] && match[6]) {
			diag.range = {
				startLine: parseInt(match[5]),
				startColumn: parseInt(match[6]),
				endLine: parseInt(match[5]),
				endColumn: parseInt(match[6]),
			};
		}
		addDiagnostic(diag);
	}

	// Go 格式: filename:line:col: message
	const goRegex = /^(.+\.go):(\d+):(\d+):\s*(.+)$/gm;
	while ((match = goRegex.exec(result)) !== null) {
		// Go 编译器通常只输出错误
		addDiagnostic({
			severity: 'error',
			message: match[4],
			source: 'Go',
			range: {
				startLine: parseInt(match[2]),
				startColumn: parseInt(match[3]),
				endLine: parseInt(match[2]),
				endColumn: parseInt(match[3]),
			},
		});
	}

	// Python/MyPy 格式: filename:line: error: message
	const pyRegex = /^(.+\.py):(\d+):\s*(error|warning|note):\s*(.+)$/gm;
	while ((match = pyRegex.exec(result)) !== null) {
		addDiagnostic({
			severity: match[3] === 'note' ? 'info' : match[3] as DiagnosticSeverity,
			message: match[4],
			source: 'Python',
			range: {
				startLine: parseInt(match[2]),
				startColumn: 1,
				endLine: parseInt(match[2]),
				endColumn: 1,
			},
		});
	}

	// Java/Maven 格式: [ERROR] filename:[line,col] message
	const mavenRegex = /^\[(ERROR|WARNING|INFO)\]\s*(?:(.+?):)?(?:\[(\d+),(\d+)\])?\s*(.+)$/gm;
	while ((match = mavenRegex.exec(result)) !== null) {
		const severity = match[1].toLowerCase();
		if (severity === 'error' || severity === 'warning' || severity === 'info') {
			const diag: DiagnosticInfo = {
				severity: severity as DiagnosticSeverity,
				message: match[5],
				source: 'Maven',
			};
			if (match[3] && match[4]) {
				diag.range = {
					startLine: parseInt(match[3]),
					startColumn: parseInt(match[4]),
					endLine: parseInt(match[3]),
					endColumn: parseInt(match[4]),
				};
			}
			addDiagnostic(diag);
		}
	}

	// npm/yarn 错误格式: npm ERR! message 或 error message
	const npmRegex = /^(?:npm ERR!|yarn error|error)\s+(.+)$/gim;
	while ((match = npmRegex.exec(result)) !== null) {
		addDiagnostic({
			severity: 'error',
			message: match[1],
			source: 'npm/yarn',
		});
	}

	// Webpack 错误格式: ERROR in filename
	const webpackRegex = /^ERROR in (.+?)(?:\s+\((\d+),(\d+)\))?$/gm;
	while ((match = webpackRegex.exec(result)) !== null) {
		const diag: DiagnosticInfo = {
			severity: 'error',
			message: match[1],
			source: 'Webpack',
		};
		if (match[2] && match[3]) {
			diag.range = {
				startLine: parseInt(match[2]),
				startColumn: parseInt(match[3]),
				endLine: parseInt(match[2]),
				endColumn: parseInt(match[3]),
			};
		}
		addDiagnostic(diag);
	}

	// Jest/Mocha 测试错误格式
	const jestRegex = /^\s*●\s+(.+?)(?:\s*›\s*(.+))?$/gm;
	while ((match = jestRegex.exec(result)) !== null) {
		addDiagnostic({
			severity: 'error',
			message: match[2] ? `${match[1]} › ${match[2]}` : match[1],
			source: 'Test',
		});
	}

	// 简单的 Error/Warning/FAILURE 格式
	const simpleRegex = /^(Error|Warning|Info|FAILURE|FAILED):\s*(.+)$/gim;
	while ((match = simpleRegex.exec(result)) !== null) {
		const severity = match[1].toLowerCase();
		addDiagnostic({
			severity: (severity === 'failure' || severity === 'failed') ? 'error' : severity as DiagnosticSeverity,
			message: match[2],
		});
	}

	// 通用的 "X errors, Y warnings" 格式摘要（仅作为提示）
	const summaryRegex = /(\d+)\s+error(?:s)?(?:,\s*(\d+)\s+warning(?:s)?)?/gi;
	while ((match = summaryRegex.exec(result)) !== null) {
		const errorCount = parseInt(match[1]);
		const warningCount = match[2] ? parseInt(match[2]) : 0;
		if (errorCount > 0 && diagnostics.length === 0) {
			// 只有在没有解析到具体诊断信息时才添加摘要
			addDiagnostic({
				severity: 'error',
				message: `编译失败：${errorCount} 个错误${warningCount > 0 ? `，${warningCount} 个警告` : ''}`,
			});
		}
	}

	return diagnostics;
}
