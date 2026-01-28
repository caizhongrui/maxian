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
import { ISkillService } from '../common/skillService.js';
import { $, append, clearNode } from '../../../../base/browser/dom.js';
import { ISkill, SkillCategory } from '../common/skillTypes.js';
import { getSkillUsageStats } from '../../maxian/common/tools/skillTool.js';
import { SkillDetailsPanel } from './skillDetailsPanel.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { URI } from '../../../../base/common/uri.js';

/**
 * Skills 管理视图
 *
 * 功能：
 * - 显示所有已安装的Skills
 * - 提供搜索和过滤功能
 * - 显示使用统计
 * - 提供创建/编辑/删除操作
 */
export class SkillsView extends ViewPane {
	private container!: HTMLElement;
	private searchInput!: HTMLInputElement;
	private categoryFilter!: HTMLSelectElement;
	private skillsList!: HTMLElement;
	private detailsContainer!: HTMLElement;
	private detailsPanel?: SkillDetailsPanel;
	private skills: ISkill[] = [];
	private filteredSkills: ISkill[] = [];

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
		@ISkillService private readonly skillService: ISkillService,
		@IEditorService private readonly editorService: IEditorService
	) {
		super(
			options,
			keybindingService,
			contextMenuService,
			configurationService,
			contextKeyService,
			viewDescriptorService,
			instantiationService,
			openerService,
			themeService,
			telemetryService,
			hoverService
		);
	}

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);

		this.container = container;
		this.container.style.display = 'flex';
		this.container.style.flexDirection = 'column';
		this.container.style.height = '100%';
		this.container.style.padding = '12px';
		this.container.style.overflow = 'hidden';

		// 添加样式
		this.addStyles();

		// 创建主内容区域（左侧）
		const mainContent = append(this.container, $('div.skills-main-content'));
		mainContent.style.display = 'flex';
		mainContent.style.flexDirection = 'column';
		mainContent.style.flex = '1';
		mainContent.style.overflow = 'auto';
		mainContent.style.minWidth = '0';

		// 创建标题
		this.createHeader(mainContent);

		// 创建搜索和过滤区域
		this.createFilters(mainContent);

		// 创建Skills列表
		this.createSkillsList(mainContent);

		// 创建详情面板（右侧，初始隐藏）
		this.detailsContainer = append(this.container, $('div.skills-details-container'));
		this.detailsContainer.style.display = 'none';
		this.detailsContainer.style.flex = '0 0 400px';
		this.detailsContainer.style.borderLeft = '1px solid var(--vscode-panel-border)';
		this.detailsContainer.style.overflow = 'auto';
		this.detailsContainer.style.marginLeft = '12px';

		// 初始化详情面板
		this.detailsPanel = new SkillDetailsPanel(this.detailsContainer, this.openerService);

		// 加载Skills
		this.loadSkills();

		// 监听Skills变化
		this._register(this.skillService.onDidChange(() => {
			console.log('[SkillsView] Skills changed, reloading...');
			this.loadSkills();
		}));
	}

	private addStyles(): void {
		const style = document.createElement('style');
		style.textContent = `
			.skills-view {
				font-family: var(--vscode-font-family);
				color: var(--vscode-foreground);
			}

			.skills-header {
				margin-bottom: 16px;
			}

			.skills-header h2 {
				font-size: 18px;
				font-weight: 600;
				margin: 0 0 4px 0;
			}

			.skills-header p {
				font-size: 12px;
				color: var(--vscode-descriptionForeground);
				margin: 0;
			}

			.skills-filters {
				display: flex;
				gap: 8px;
				margin-bottom: 16px;
			}

			.skills-search {
				flex: 1;
				padding: 6px 8px;
				border: 1px solid var(--vscode-input-border);
				background: var(--vscode-input-background);
				color: var(--vscode-input-foreground);
				border-radius: 4px;
				font-size: 13px;
			}

			.skills-search:focus {
				outline: 1px solid var(--vscode-focusBorder);
			}

			.skills-category-filter {
				padding: 6px 8px;
				border: 1px solid var(--vscode-input-border);
				background: var(--vscode-dropdown-background);
				color: var(--vscode-dropdown-foreground);
				border-radius: 4px;
				font-size: 13px;
				cursor: pointer;
			}

			.skill-card {
				border: 1px solid var(--vscode-panel-border);
				border-radius: 6px;
				padding: 12px;
				margin-bottom: 12px;
				background: var(--vscode-editor-background);
				transition: all 0.2s;
			}

			.skill-card:hover {
				border-color: var(--vscode-focusBorder);
				box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
			}

			.skill-card-header {
				display: flex;
				justify-content: space-between;
				align-items: start;
				margin-bottom: 8px;
			}

			.skill-card-title {
				display: flex;
				align-items: center;
				gap: 8px;
			}

			.skill-card-icon {
				font-size: 20px;
			}

			.skill-card-name {
				font-size: 14px;
				font-weight: 600;
			}

			.skill-card-badge {
				display: inline-block;
				padding: 2px 6px;
				border-radius: 3px;
				font-size: 11px;
				background: var(--vscode-badge-background);
				color: var(--vscode-badge-foreground);
			}

			.skill-card-description {
				font-size: 12px;
				color: var(--vscode-descriptionForeground);
				margin-bottom: 8px;
				line-height: 1.5;
			}

			.skill-card-meta {
				display: flex;
				gap: 12px;
				font-size: 11px;
				color: var(--vscode-descriptionForeground);
				margin-bottom: 8px;
			}

			.skill-card-meta-item {
				display: flex;
				align-items: center;
				gap: 4px;
			}

			.skill-card-actions {
				display: flex;
				gap: 8px;
			}

			.skill-action-btn {
				padding: 4px 12px;
				border: 1px solid var(--vscode-button-border);
				background: var(--vscode-button-secondaryBackground);
				color: var(--vscode-button-secondaryForeground);
				border-radius: 4px;
				font-size: 12px;
				cursor: pointer;
				transition: all 0.2s;
			}

			.skill-action-btn:hover {
				background: var(--vscode-button-secondaryHoverBackground);
			}

			.skill-action-btn-primary {
				background: var(--vscode-button-background);
				color: var(--vscode-button-foreground);
			}

			.skill-action-btn-primary:hover {
				background: var(--vscode-button-hoverBackground);
			}

			.skills-empty {
				text-align: center;
				padding: 40px 20px;
				color: var(--vscode-descriptionForeground);
			}

			.skills-empty-icon {
				font-size: 48px;
				margin-bottom: 16px;
				opacity: 0.5;
			}

			.skills-empty-text {
				font-size: 14px;
				margin-bottom: 20px;
			}
		`;
		this.container.appendChild(style);
	}

	private createHeader(container: HTMLElement): void {
		const header = append(container, $('.skills-header'));
		const title = append(header, $('h2'));
		title.textContent = 'Skills Management';

		const subtitle = append(header, $('p'));
		subtitle.textContent = 'Manage your AI assistant\'s professional knowledge base';
	}

	private createFilters(container: HTMLElement): void {
		const filtersContainer = append(container, $('.skills-filters'));

		// 搜索框
		this.searchInput = append(filtersContainer, $<HTMLInputElement>('input.skills-search'));
		this.searchInput.type = 'text';
		this.searchInput.placeholder = 'Search skills...';
		this.searchInput.addEventListener('input', () => this.filterSkills());

		// 分类过滤
		this.categoryFilter = append(filtersContainer, $<HTMLSelectElement>('select.skills-category-filter'));
		const allOption = append(this.categoryFilter, $<HTMLOptionElement>('option'));
		allOption.value = 'all';
		allOption.textContent = 'All Categories';

		// 添加分类选项
		Object.values(SkillCategory).forEach(category => {
			const option = append(this.categoryFilter, $<HTMLOptionElement>('option'));
			option.value = category;
			option.textContent = this.getCategoryName(category);
		});

		this.categoryFilter.addEventListener('change', () => this.filterSkills());
	}

	private createSkillsList(container: HTMLElement): void {
		this.skillsList = append(container, $('.skills-list'));
	}

	private async loadSkills(): Promise<void> {
		try {
			// 通过IPC调用的方法都是异步的
			const skills = await Promise.resolve(this.skillService.search({}));
			this.skills = Array.isArray(skills) ? skills : [];
			this.filteredSkills = [...this.skills];
			this.renderSkills();
		} catch (error) {
			console.error('[SkillsView] Failed to load skills:', error);
			this.renderError();
		}
	}

	private filterSkills(): void {
		const searchTerm = this.searchInput.value.toLowerCase();
		const category = this.categoryFilter.value;

		this.filteredSkills = this.skills.filter(skill => {
			const matchesSearch =
				!searchTerm ||
				skill.name.toLowerCase().includes(searchTerm) ||
				skill.description.toLowerCase().includes(searchTerm) ||
				skill.slug.toLowerCase().includes(searchTerm);

			const matchesCategory = category === 'all' || skill.category === category;

			return matchesSearch && matchesCategory;
		});

		this.renderSkills();
	}

	private renderSkills(): void {
		clearNode(this.skillsList);

		if (this.filteredSkills.length === 0) {
			this.renderEmpty();
			return;
		}

		// 获取使用统计
		const usageStats = getSkillUsageStats();
		const usageMap = new Map(usageStats.map(s => [s.skillName, s]));

		this.filteredSkills.forEach(skill => {
			const stats = usageMap.get(skill.slug);
			this.renderSkillCard(skill, stats);
		});
	}

	private renderSkillCard(skill: ISkill, stats?: { activationCount: number; totalTokens: number }): void {
		const card = append(this.skillsList, $('.skill-card'));

		// Header
		const header = append(card, $('.skill-card-header'));
		const titleSection = append(header, $('.skill-card-title'));

		const icon = append(titleSection, $('.skill-card-icon'));
		icon.textContent = this.getCategoryIcon(skill.category);

		const nameContainer = append(titleSection, $('div'));
		const name = append(nameContainer, $('.skill-card-name'));
		name.textContent = skill.name;

		if (skill.official) {
			const badge = append(nameContainer, $('.skill-card-badge'));
			badge.textContent = 'Official';
		}

		// Description
		const description = append(card, $('.skill-card-description'));
		description.textContent = skill.description;

		// Meta information
		const meta = append(card, $('.skill-card-meta'));

		const categoryItem = append(meta, $('.skill-card-meta-item'));
		categoryItem.textContent = `📁 ${this.getCategoryName(skill.category)}`;

		const tokensItem = append(meta, $('.skill-card-meta-item'));
		tokensItem.textContent = `💬 ${skill.estimatedTokens} tokens`;

		const versionItem = append(meta, $('.skill-card-meta-item'));
		versionItem.textContent = `🏷️ v${skill.version}`;

		if (stats) {
			const usageItem = append(meta, $('.skill-card-meta-item'));
			usageItem.textContent = `📊 Used ${stats.activationCount} times`;
		}

		// Actions
		const actions = append(card, $('.skill-card-actions'));

		const viewBtn = append(actions, $<HTMLButtonElement>('button.skill-action-btn.skill-action-btn-primary'));
		viewBtn.textContent = 'View Details';
		viewBtn.addEventListener('click', () => this.viewSkillDetails(skill));

		const editBtn = append(actions, $<HTMLButtonElement>('button.skill-action-btn'));
		editBtn.textContent = 'Edit';
		editBtn.addEventListener('click', () => this.editSkill(skill));
	}

	private renderEmpty(): void {
		const empty = append(this.skillsList, $('.skills-empty'));

		const icon = append(empty, $('.skills-empty-icon'));
		icon.textContent = '📚';

		const text = append(empty, $('.skills-empty-text'));
		text.textContent = this.searchInput.value || this.categoryFilter.value !== 'all'
			? 'No skills found matching your criteria'
			: 'No skills available';
	}

	private renderError(): void {
		clearNode(this.skillsList);
		const error = append(this.skillsList, $('.skills-empty'));

		const icon = append(error, $('.skills-empty-icon'));
		icon.textContent = '⚠️';

		const text = append(error, $('.skills-empty-text'));
		text.textContent = 'Failed to load skills. Please try again.';
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

	private viewSkillDetails(skill: ISkill): void {
		console.log('[SkillsView] View skill details:', skill.slug);

		// 显示详情面板
		if (this.detailsPanel && this.detailsContainer) {
			this.detailsContainer.style.display = 'block';
			this.detailsPanel.show(skill);
		}
	}

	private async editSkill(skill: ISkill): Promise<void> {
		console.log('[SkillsView] Edit skill:', skill.slug);

		// 获取Skill文件路径
		const skillsDir = this.skillService.skillsDirectory;
		const skillFilePath = `${skillsDir}/${skill.slug}/skill.md`;

		try {
			// 打开文件编辑器
			await this.editorService.openEditor({
				resource: URI.file(skillFilePath),
				options: {
					pinned: true
				}
			});
		} catch (error) {
			console.error('[SkillsView] Failed to open skill editor:', error);
		}
	}
}
