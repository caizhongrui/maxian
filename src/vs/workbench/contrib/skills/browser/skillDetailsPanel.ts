/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append, clearNode } from '../../../../base/browser/dom.js';
import { ISkill } from '../common/skillTypes.js';
import { MarkdownString } from '../../../../base/common/htmlContent.js';
import { renderMarkdown } from '../../../../base/browser/markdownRenderer.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';

/**
 * Skill详情面板
 *
 * 显示Skill的完整信息：
 * - Metadata（名称、版本、作者等）
 * - 完整内容（Markdown渲染）
 * - 使用统计
 * - 操作按钮
 */
export class SkillDetailsPanel {
	private container: HTMLElement;
	private skill: ISkill | null = null;

	constructor(
		container: HTMLElement,
		private readonly openerService: IOpenerService
	) {
		this.container = container;
		this.initializePanel();
	}

	private initializePanel(): void {
		this.container.style.display = 'flex';
		this.container.style.flexDirection = 'column';
		this.container.style.height = '100%';
		this.container.style.overflow = 'auto';
		this.container.style.padding = '16px';

		this.addStyles();
	}

	private addStyles(): void {
		const style = document.createElement('style');
		style.textContent = `
			.skill-details-panel {
				font-family: var(--vscode-font-family);
				color: var(--vscode-foreground);
			}

			.skill-details-header {
				border-bottom: 1px solid var(--vscode-panel-border);
				padding-bottom: 16px;
				margin-bottom: 16px;
			}

			.skill-details-title {
				display: flex;
				align-items: center;
				gap: 12px;
				margin-bottom: 8px;
			}

			.skill-details-icon {
				font-size: 32px;
			}

			.skill-details-name {
				font-size: 24px;
				font-weight: 600;
			}

			.skill-details-badges {
				display: flex;
				gap: 8px;
				margin-bottom: 12px;
			}

			.skill-badge {
				display: inline-block;
				padding: 4px 10px;
				border-radius: 4px;
				font-size: 12px;
				background: var(--vscode-badge-background);
				color: var(--vscode-badge-foreground);
			}

			.skill-details-description {
				font-size: 14px;
				color: var(--vscode-descriptionForeground);
				line-height: 1.6;
			}

			.skill-details-metadata {
				display: grid;
				grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
				gap: 12px;
				margin-bottom: 24px;
			}

			.skill-metadata-item {
				padding: 12px;
				border: 1px solid var(--vscode-panel-border);
				border-radius: 6px;
				background: var(--vscode-editor-background);
			}

			.skill-metadata-label {
				font-size: 11px;
				color: var(--vscode-descriptionForeground);
				text-transform: uppercase;
				margin-bottom: 4px;
			}

			.skill-metadata-value {
				font-size: 14px;
				font-weight: 500;
			}

			.skill-details-content {
				border: 1px solid var(--vscode-panel-border);
				border-radius: 6px;
				padding: 16px;
				background: var(--vscode-editor-background);
				margin-bottom: 16px;
			}

			.skill-details-content h1,
			.skill-details-content h2,
			.skill-details-content h3,
			.skill-details-content h4 {
				margin-top: 16px;
				margin-bottom: 8px;
			}

			.skill-details-content h1:first-child,
			.skill-details-content h2:first-child,
			.skill-details-content h3:first-child {
				margin-top: 0;
			}

			.skill-details-content code {
				background: var(--vscode-textCodeBlock-background);
				padding: 2px 4px;
				border-radius: 3px;
				font-family: var(--vscode-editor-font-family);
			}

			.skill-details-content pre {
				background: var(--vscode-textCodeBlock-background);
				padding: 12px;
				border-radius: 6px;
				overflow-x: auto;
			}

			.skill-details-actions {
				display: flex;
				gap: 12px;
				padding-top: 16px;
				border-top: 1px solid var(--vscode-panel-border);
			}

			.skill-action-button {
				padding: 8px 16px;
				border: 1px solid var(--vscode-button-border);
				border-radius: 4px;
				font-size: 13px;
				cursor: pointer;
				transition: all 0.2s;
			}

			.skill-action-button-primary {
				background: var(--vscode-button-background);
				color: var(--vscode-button-foreground);
				border-color: var(--vscode-button-background);
			}

			.skill-action-button-primary:hover {
				background: var(--vscode-button-hoverBackground);
			}

			.skill-action-button-secondary {
				background: var(--vscode-button-secondaryBackground);
				color: var(--vscode-button-secondaryForeground);
			}

			.skill-action-button-secondary:hover {
				background: var(--vscode-button-secondaryHoverBackground);
			}

			.skill-details-empty {
				display: flex;
				flex-direction: column;
				align-items: center;
				justify-content: center;
				height: 100%;
				color: var(--vscode-descriptionForeground);
			}

			.skill-details-empty-icon {
				font-size: 64px;
				margin-bottom: 16px;
				opacity: 0.5;
			}

			.skill-details-empty-text {
				font-size: 14px;
			}
		`;
		this.container.appendChild(style);
	}

	public show(skill: ISkill): void {
		this.skill = skill;
		this.render();
	}

	public hide(): void {
		this.skill = null;
		this.renderEmpty();
	}

	private render(): void {
		if (!this.skill) {
			this.renderEmpty();
			return;
		}

		clearNode(this.container);

		const panel = append(this.container, $('.skill-details-panel'));

		// Header
		this.renderHeader(panel);

		// Metadata
		this.renderMetadata(panel);

		// Content
		this.renderContent(panel);

		// Actions
		this.renderActions(panel);
	}

	private renderHeader(panel: HTMLElement): void {
		const header = append(panel, $('.skill-details-header'));

		// Title with icon
		const title = append(header, $('.skill-details-title'));
		const icon = append(title, $('.skill-details-icon'));
		icon.textContent = this.getCategoryIcon(this.skill!.category);

		const name = append(title, $('.skill-details-name'));
		name.textContent = this.skill!.name;

		// Badges
		const badges = append(header, $('.skill-details-badges'));

		if (this.skill!.official) {
			const officialBadge = append(badges, $('.skill-badge'));
			officialBadge.textContent = '✓ Official';
		}

		const categoryBadge = append(badges, $('.skill-badge'));
		categoryBadge.textContent = this.getCategoryName(this.skill!.category);

		const versionBadge = append(badges, $('.skill-badge'));
		versionBadge.textContent = `v${this.skill!.version}`;

		// Description
		const description = append(header, $('.skill-details-description'));
		description.textContent = this.skill!.description;
	}

	private renderMetadata(panel: HTMLElement): void {
		const metadata = append(panel, $('.skill-details-metadata'));

		// Author
		this.createMetadataItem(metadata, 'Author', this.skill!.author || 'Unknown');

		// Tokens
		this.createMetadataItem(metadata, 'Estimated Tokens', `${this.skill!.estimatedTokens || 'N/A'}`);

		// Created/Updated
		if (this.skill!.createdAt) {
			this.createMetadataItem(metadata, 'Created', this.formatDate(this.skill!.createdAt));
		}

		if (this.skill!.updatedAt) {
			this.createMetadataItem(metadata, 'Updated', this.formatDate(this.skill!.updatedAt));
		}

		// Tags
		if (this.skill!.tags && this.skill!.tags.length > 0) {
			this.createMetadataItem(metadata, 'Tags', this.skill!.tags.join(', '));
		}
	}

	private createMetadataItem(container: HTMLElement, label: string, value: string): void {
		const item = append(container, $('.skill-metadata-item'));
		const labelEl = append(item, $('.skill-metadata-label'));
		labelEl.textContent = label;

		const valueEl = append(item, $('.skill-metadata-value'));
		valueEl.textContent = value;
	}

	private renderContent(panel: HTMLElement): void {
		const contentContainer = append(panel, $('.skill-details-content'));

		// Render markdown content
		const markdownString = new MarkdownString(this.skill!.content);
		const rendered = renderMarkdown(markdownString, {
			actionHandler: {
				callback: (content) => {
					this.openerService.open(content, { allowCommands: true });
				},
				disposables: new DisposableStore()
			}
		});

		contentContainer.appendChild(rendered.element);
	}

	private renderActions(panel: HTMLElement): void {
		const actions = append(panel, $('.skill-details-actions'));

		const editBtn = append(actions, $<HTMLButtonElement>('button.skill-action-button.skill-action-button-primary'));
		editBtn.textContent = 'Edit Skill';
		editBtn.addEventListener('click', () => this.onEdit());

		const copyBtn = append(actions, $<HTMLButtonElement>('button.skill-action-button.skill-action-button-secondary'));
		copyBtn.textContent = 'Copy Content';
		copyBtn.addEventListener('click', () => this.onCopy());

		const closeBtn = append(actions, $<HTMLButtonElement>('button.skill-action-button.skill-action-button-secondary'));
		closeBtn.textContent = 'Close';
		closeBtn.addEventListener('click', () => this.onClose());
	}

	private renderEmpty(): void {
		clearNode(this.container);

		const empty = append(this.container, $('.skill-details-empty'));
		const icon = append(empty, $('.skill-details-empty-icon'));
		icon.textContent = '📄';

		const text = append(empty, $('.skill-details-empty-text'));
		text.textContent = 'Select a skill to view details';
	}

	private getCategoryIcon(category: string): string {
		const icons: Record<string, string> = {
			'code-quality': '📝',
			'development': '🔧',
			'testing': '🧪',
			'debugging': '🐛',
			'security': '🔒',
			'performance': '⚡',
			'documentation': '📚',
			'architecture': '🏗️',
			'api': '🌐',
			'database': '💾',
		};
		return icons[category] || '📋';
	}

	private getCategoryName(category: string): string {
		const names: Record<string, string> = {
			'code-quality': 'Code Quality',
			'development': 'Development',
			'testing': 'Testing',
			'debugging': 'Debugging',
			'security': 'Security',
			'performance': 'Performance',
			'documentation': 'Documentation',
			'architecture': 'Architecture',
			'api': 'API',
			'database': 'Database',
		};
		return names[category] || category;
	}

	private formatDate(dateString: string): string {
		try {
			const date = new Date(dateString);
			return date.toLocaleDateString(undefined, {
				year: 'numeric',
				month: 'short',
				day: 'numeric'
			});
		} catch {
			return dateString;
		}
	}

	private onEdit(): void {
		// TODO: Open skill editor
		console.log('[SkillDetailsPanel] Edit skill:', this.skill?.slug);
	}

	private onCopy(): void {
		if (this.skill) {
			navigator.clipboard.writeText(this.skill.content);
			console.log('[SkillDetailsPanel] Copied skill content');
		}
	}

	private onClose(): void {
		this.hide();
	}
}
