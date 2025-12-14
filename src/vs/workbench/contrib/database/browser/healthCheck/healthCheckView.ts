/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IViewDescriptorService } from '../../../../common/views.js';
import { IViewPaneOptions, ViewPane } from '../../../../browser/parts/views/viewPane.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { IThemeService } from '../../../../../platform/theme/common/themeService.js';
import { ITelemetryService } from '../../../../../platform/telemetry/common/telemetry.js';
import { IContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { IContextMenuService } from '../../../../../platform/contextview/browser/contextView.js';
import { IKeybindingService } from '../../../../../platform/keybinding/common/keybinding.js';
import { IOpenerService } from '../../../../../platform/opener/common/opener.js';
import { IHoverService } from '../../../../../platform/hover/browser/hover.js';
import { IDatabaseService } from '../../common/databaseService.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { IAIService } from '../../../../../platform/ai/common/ai.js';
import { IStorageService, StorageScope } from '../../../../../platform/storage/common/storage.js';
import { IDatabaseConnectionConfig } from '../../common/databaseConnection.js';
import { localize } from '../../../../../nls.js';
import { $, addDisposableListener, EventType } from '../../../../../base/browser/dom.js';

/**
 * 数据库健康检查视图ID
 */
export const HEALTH_CHECK_VIEW_ID = 'workbench.view.database.healthCheck';

/**
 * 数据库健康检查视图
 * 用于对整个数据库进行全面的健康检查
 */
export class HealthCheckView extends ViewPane {
	private container!: HTMLElement;
	private connectionSelect!: HTMLSelectElement;
	private schemaSelect!: HTMLSelectElement;
	private checkButton!: HTMLButtonElement;
	private resultArea!: HTMLElement;

	// 当前选择的连接和Schema
	private selectedConnectionId: string | null = null;
	private selectedSchema: string | null = null;

	// 健康检查结果
	private checkResult: any = null;
	private isChecking: boolean = false;

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
		@IDatabaseService readonly databaseService: IDatabaseService,
		@INotificationService private readonly notificationService: INotificationService,
		@IAIService private readonly aiService: IAIService,
		@IStorageService private readonly storageService: IStorageService
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

		console.log('[HealthCheckView] Constructor called');
	}

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);
		this.container = container;
		this.container.classList.add('health-check-view');

		// 添加内联样式
		this.container.style.padding = '20px';
		this.container.style.height = '100%';
		this.container.style.overflowY = 'auto';

		// 创建主容器
		this.createInputSection();
		this.createResultSection();

		// 加载数据库连接
		this.loadConnections();

		console.log('[HealthCheckView] Body rendered');
	}

	/**
	 * 创建输入部分
	 */
	private createInputSection(): void {
		const section = $('.input-section');

		// 标题
		const header = $('.section-header');
		const title = $('h3');
		title.textContent = localize('database.healthCheck.title', '数据库健康检查');
		header.appendChild(title);

		const subtitle = $('.subtitle');
		subtitle.textContent = localize(
			'database.healthCheck.subtitle',
			'选择一个数据库，AI将全面分析其健康状况，包括架构、性能、安全、可维护性等多个维度'
		);
		header.appendChild(subtitle);
		section.appendChild(header);

		// 数据库选择区域
		const selectArea = $('.db-select-area');

		// 连接选择
		const connectionLabel = $('label');
		connectionLabel.textContent = localize('database.healthCheck.connection', '数据库连接');
		selectArea.appendChild(connectionLabel);

		this.connectionSelect = $<HTMLSelectElement>('select.connection-select');
		this._register(addDisposableListener(this.connectionSelect, EventType.CHANGE, () => {
			this.onConnectionChange();
		}));
		selectArea.appendChild(this.connectionSelect);

		// Schema选择
		const schemaLabel = $('label');
		schemaLabel.textContent = localize('database.healthCheck.schema', '数据库');
		selectArea.appendChild(schemaLabel);

		this.schemaSelect = $<HTMLSelectElement>('select.schema-select');
		this.schemaSelect.disabled = true;
		this._register(addDisposableListener(this.schemaSelect, EventType.CHANGE, () => {
			this.onSchemaChange();
		}));
		selectArea.appendChild(this.schemaSelect);

		section.appendChild(selectArea);

		// 按钮区域
		const buttonArea = $('.button-area');

		// 开始检查按钮
		this.checkButton = $<HTMLButtonElement>('button.check-button');
		this.checkButton.textContent = localize('database.healthCheck.check', '开始检查');
		this.checkButton.disabled = true;
		this._register(addDisposableListener(this.checkButton, EventType.CLICK, () => {
			this.performHealthCheck();
		}));
		buttonArea.appendChild(this.checkButton);

		section.appendChild(buttonArea);

		this.container.appendChild(section);
	}

	/**
	 * 创建结果展示部分
	 */
	private createResultSection(): void {
		const section = $('.result-section');
		section.style.display = 'none'; // 初始隐藏

		// 标题
		const header = $('.section-header');
		const title = $('h3');
		title.textContent = localize('database.healthCheck.result', '检查结果');
		header.appendChild(title);
		section.appendChild(header);

		// 结果展示区域
		this.resultArea = $('.result-area');
		section.appendChild(this.resultArea);

		this.container.appendChild(section);
	}

	/**
	 * 加载数据库连接
	 */
	private async loadConnections(): Promise<void> {
		try {
			const connectionsJson = this.storageService.get('database.connections', StorageScope.PROFILE) || '[]';
			const connections: IDatabaseConnectionConfig[] = JSON.parse(connectionsJson);

			// 清空现有选项
			while (this.connectionSelect.firstChild) {
				this.connectionSelect.removeChild(this.connectionSelect.firstChild);
			}

			// 添加默认选项
			const defaultOption = $<HTMLOptionElement>('option');
			defaultOption.value = '';
			defaultOption.textContent = localize('database.healthCheck.selectConnection', '请选择数据库连接');
			this.connectionSelect.appendChild(defaultOption);

			// 添加连接选项
			connections.forEach(conn => {
				const option = $<HTMLOptionElement>('option');
				option.value = conn.id;
				option.textContent = `${conn.name} (${conn.host}:${conn.port})`;
				this.connectionSelect.appendChild(option);
			});

		} catch (error) {
			console.error('[HealthCheckView] Load connections error:', error);
		}
	}

	/**
	 * 连接改变事件
	 */
	private async onConnectionChange(): Promise<void> {
		this.selectedConnectionId = this.connectionSelect.value || null;
		this.selectedSchema = null;

		// 清空Schema选择
		while (this.schemaSelect.firstChild) {
			this.schemaSelect.removeChild(this.schemaSelect.firstChild);
		}

		if (!this.selectedConnectionId) {
			this.schemaSelect.disabled = true;
			this.updateButtonState();
			return;
		}

		try {
			// 获取连接配置
			const connectionsJson = this.storageService.get('database.connections', StorageScope.PROFILE) || '[]';
			const connections: IDatabaseConnectionConfig[] = JSON.parse(connectionsJson);
			const config = connections.find(c => c.id === this.selectedConnectionId);

			if (!config) {
				return;
			}

			// 确保连接
			await this.databaseService.addConnection(config);
			const connection = await this.databaseService.getConnection(config.id);
			if (!connection || connection.status !== 'connected') {
				await this.databaseService.connect(config.id);
			}

			// 获取Schema列表
			const schemas = await this.databaseService.getSchemas(config.id);

			// 添加默认选项
			const defaultOption = $<HTMLOptionElement>('option');
			defaultOption.value = '';
			defaultOption.textContent = localize('database.healthCheck.selectSchema', '请选择数据库');
			this.schemaSelect.appendChild(defaultOption);

			// 添加Schema选项
			schemas.forEach(schema => {
				const option = $<HTMLOptionElement>('option');
				option.value = schema.name;
				option.textContent = schema.name;
				this.schemaSelect.appendChild(option);
			});

			this.schemaSelect.disabled = false;

		} catch (error) {
			this.notificationService.error(
				localize('database.healthCheck.loadSchemaError', '加载数据库列表失败: {0}', String(error))
			);
		}

		this.updateButtonState();
	}

	/**
	 * Schema改变事件
	 */
	private onSchemaChange(): void {
		this.selectedSchema = this.schemaSelect.value || null;
		this.updateButtonState();
	}

	/**
	 * 更新按钮状态
	 */
	private updateButtonState(): void {
		this.checkButton.disabled =
			!this.selectedConnectionId ||
			!this.selectedSchema ||
			this.isChecking;
	}

	/**
	 * 执行健康检查
	 */
	private async performHealthCheck(): Promise<void> {
		if (!this.selectedConnectionId || !this.selectedSchema) {
			this.notificationService.warn(
				localize('database.healthCheck.selectSchemaFirst', '请先选择要检查的数据库')
			);
			return;
		}

		// 设置检查状态
		this.isChecking = true;
		this.checkButton.disabled = true;
		this.checkButton.textContent = localize('database.healthCheck.checking', '检查中...');

		try {
			console.log('[HealthCheckView] 开始健康检查:', this.selectedSchema);

			// 获取数据库统计信息
			const databaseStats = await this.getDatabaseStats();
			console.log('[HealthCheckView] 数据库统计信息:', databaseStats);

			// 获取所有表的结构信息
			const allTablesStructure = await this.getAllTablesStructure();
			console.log('[HealthCheckView] 所有表结构信息:', allTablesStructure);

			// 获取数据库类型
			const connectionsJson = this.storageService.get('database.connections', StorageScope.PROFILE) || '[]';
			const connections: IDatabaseConnectionConfig[] = JSON.parse(connectionsJson);
			const config = connections.find(c => c.id === this.selectedConnectionId);
			const databaseType = config?.type || 'MySQL';

			// 调用后端接口渲染提示词模板
			console.log('[HealthCheckView] 渲染提示词模板');
			const renderedPrompt = await this.getRenderedPrompt(
				databaseType,
				this.selectedSchema,
				JSON.stringify(databaseStats, null, 2),
				JSON.stringify(allTablesStructure, null, 2)
			);
			console.log('[HealthCheckView] 渲染后的提示词长度:', renderedPrompt.length);

			// 调用AI服务进行分析
			console.log('[HealthCheckView] 调用AI服务进行健康检查');
			const response = await this.aiService.completeWithUsage(renderedPrompt, {
				businessCode: 'IDE_DB_HEALTH_CHECK',
				temperature: 0.1,
				maxTokens: 16000  // 健康检查输出内容较多,需要更大的token限制
			});

			console.log('[HealthCheckView] AI返回结果:', response);

			// 解析检查结果
			this.checkResult = this.parseCheckResult(response.content);
			this.showResults();

			this.notificationService.info(
				localize('database.healthCheck.checkSuccess', '健康检查完成')
			);

		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			this.notificationService.error(
				localize('database.healthCheck.checkError', '检查失败: {0}', errorMessage)
			);
			console.error('[HealthCheckView] Check error:', error);
		} finally {
			// 恢复按钮状态
			this.isChecking = false;
			this.checkButton.disabled = false;
			this.checkButton.textContent = localize('database.healthCheck.check', '开始检查');
		}
	}

	/**
	 * 获取数据库统计信息
	 */
	private async getDatabaseStats(): Promise<any> {
		if (!this.selectedConnectionId || !this.selectedSchema) {
			return {};
		}

		try {
			// 获取所有表
			const tables = await this.databaseService.getTables(this.selectedConnectionId, this.selectedSchema);

			// 统计信息
			const stats = {
				totalTables: tables.length,
				totalFields: 0,
				totalIndexes: 0,
				tableNames: tables.map(t => t.name)
			};

			// 遍历所有表获取详细统计
			for (const table of tables) {
				try {
					const structure = await this.databaseService.getTableStructure(
						this.selectedConnectionId,
						this.selectedSchema,
						table.name
					);

					if (structure.columns) {
						stats.totalFields += structure.columns.length;
					}

					if (structure.indexes) {
						stats.totalIndexes += structure.indexes.length;
					}
				} catch (error) {
					console.warn(`[HealthCheckView] 获取表 ${table.name} 的结构失败:`, error);
				}
			}

			return stats;

		} catch (error) {
			console.error('[HealthCheckView] 获取数据库统计信息失败:', error);
			return {};
		}
	}

	/**
	 * 获取所有表的结构信息
	 */
	private async getAllTablesStructure(): Promise<any[]> {
		if (!this.selectedConnectionId || !this.selectedSchema) {
			return [];
		}

		try {
			// 获取所有表
			const tables = await this.databaseService.getTables(this.selectedConnectionId, this.selectedSchema);

			// 获取每个表的结构
			const structures = [];
			for (const table of tables) {
				try {
					const structure = await this.databaseService.getTableStructure(
						this.selectedConnectionId,
						this.selectedSchema,
						table.name
					);
					structures.push({
						tableName: table.name,
						tableComment: table.comment || '',
						...structure
					});
				} catch (error) {
					console.warn(`[HealthCheckView] 获取表 ${table.name} 的结构失败:`, error);
				}
			}

			return structures;

		} catch (error) {
			console.error('[HealthCheckView] 获取所有表结构失败:', error);
			return [];
		}
	}

	/**
	 * 获取渲染后的提示词
	 */
	private async getRenderedPrompt(
		databaseType: string,
		databaseName: string,
		databaseStats: string,
		allTablesStructure: string
	): Promise<string> {
		try {
			console.log('[HealthCheckView] 调用提示词渲染接口');

			const response = await fetch('http://127.0.0.1:8088/system/ai/prompt/render', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({
					promptKey: 'IDE_DB_HEALTH_CHECK',
					variables: {
						databaseType: databaseType,
						databaseName: databaseName,
						databaseStats: databaseStats,
						allTablesStructure: allTablesStructure
					}
				})
			});

			if (!response.ok) {
				throw new Error(`获取提示词失败: HTTP ${response.status}`);
			}

			const result = await response.json();

			if (result.code !== 200) {
				throw new Error(`获取提示词失败: ${result.msg}`);
			}

			if (!result.msg) {
				throw new Error('获取提示词失败: 返回数据为空');
			}

			return result.msg;

		} catch (error) {
			console.error('[HealthCheckView] 获取提示词失败:', error);
			throw error;
		}
	}

	/**
	 * 解析检查结果
	 */
	private parseCheckResult(content: string): any {
		try {
			// 尝试解析JSON格式的结果
			const jsonMatch = content.match(/```json\s*\n([\s\S]*?)\n```/);
			if (jsonMatch) {
				return JSON.parse(jsonMatch[1]);
			}

			// 尝试直接解析JSON
			try {
				return JSON.parse(content);
			} catch {
				// 不是纯JSON
			}

			// 如果不是JSON格式,返回原始内容
			return {
				overallScore: 0,
				rawContent: content
			};

		} catch (error) {
			console.error('[HealthCheckView] 解析检查结果失败:', error);
			// 返回原始内容
			return {
				overallScore: 0,
				rawContent: content
			};
		}
	}

	/**
	 * 显示结果
	 */
	private showResults(): void {
		if (!this.checkResult) {
			return;
		}

		const resultSection = this.container.querySelector('.result-section') as HTMLElement;
		resultSection.style.display = 'block';

		// 清空结果区域
		while (this.resultArea.firstChild) {
			this.resultArea.removeChild(this.resultArea.firstChild);
		}

		// 如果有原始内容,直接显示
		if (this.checkResult.rawContent) {
			const rawContent = $('.raw-content');
			rawContent.textContent = this.checkResult.rawContent;
			this.resultArea.appendChild(rawContent);
			return;
		}

		// 显示综合评分
		if (this.checkResult.overallScore !== undefined) {
			const scoreCard = $('.score-card');

			const scoreLabel = $('span.score-label');
			scoreLabel.textContent = localize('database.healthCheck.overallScore', '综合评分:');
			scoreCard.appendChild(scoreLabel);

			const scoreValue = $('span.score-value');
			scoreValue.textContent = `${this.checkResult.overallScore} / 100`;

			// 健康等级颜色
			const healthLevel = this.checkResult.healthLevel || 'warning';
			if (healthLevel === 'excellent' || healthLevel === 'good') {
				scoreValue.classList.add('good');
			} else if (healthLevel === 'warning') {
				scoreValue.classList.add('medium');
			} else {
				scoreValue.classList.add('bad');
			}
			scoreCard.appendChild(scoreValue);

			// 健康等级标签
			const healthLevelLabel = $('span.health-level');
			healthLevelLabel.textContent = this.getHealthLevelText(healthLevel);
			healthLevelLabel.classList.add(`level-${healthLevel}`);
			scoreCard.appendChild(healthLevelLabel);

			this.resultArea.appendChild(scoreCard);
		}

		// 显示统计信息
		if (this.checkResult.statistics) {
			this.showStatistics(this.checkResult.statistics);
		}

		// 显示总结
		if (this.checkResult.summary) {
			const summarySection = $('.summary-section');
			const summaryTitle = $('h4');
			summaryTitle.textContent = localize('database.healthCheck.summary', '检查总结');
			summarySection.appendChild(summaryTitle);

			const summaryText = $('p.summary-text');
			summaryText.textContent = this.checkResult.summary;
			summarySection.appendChild(summaryText);

			this.resultArea.appendChild(summarySection);
		}

		// 显示各维度评分
		if (this.checkResult.dimensionScores && this.checkResult.dimensionScores.length > 0) {
			this.showDimensionScores(this.checkResult.dimensionScores);
		}

		// 显示问题列表
		if (this.checkResult.issues && this.checkResult.issues.length > 0) {
			this.showIssues(this.checkResult.issues);
		}

		// 显示优化方案
		if (this.checkResult.optimizations && this.checkResult.optimizations.length > 0) {
			this.showOptimizations(this.checkResult.optimizations);
		}

		// 显示最佳实践建议
		if (this.checkResult.bestPractices && this.checkResult.bestPractices.length > 0) {
			this.showBestPractices(this.checkResult.bestPractices);
		}

		// 显示建议
		if (this.checkResult.recommendations && this.checkResult.recommendations.length > 0) {
			this.showRecommendations(this.checkResult.recommendations);
		}
	}

	/**
	 * 获取健康等级文本
	 */
	private getHealthLevelText(level: string): string {
		const levelMap: { [key: string]: string } = {
			excellent: localize('database.healthCheck.level.excellent', '优秀'),
			good: localize('database.healthCheck.level.good', '良好'),
			warning: localize('database.healthCheck.level.warning', '需要关注'),
			poor: localize('database.healthCheck.level.poor', '较差'),
			critical: localize('database.healthCheck.level.critical', '危险')
		};
		return levelMap[level] || level;
	}

	/**
	 * 显示统计信息
	 */
	private showStatistics(statistics: any): void {
		const statsSection = $('.stats-section');
		const statsTitle = $('h4');
		statsTitle.textContent = localize('database.healthCheck.statistics', '统计信息');
		statsSection.appendChild(statsTitle);

		const statsGrid = $('.stats-grid');

		// 表数量
		if (statistics.totalTables !== undefined) {
			const statItem = $('.stat-item');
			const statLabel = $('span.stat-label');
			statLabel.textContent = localize('database.healthCheck.totalTables', '表数量:');
			statItem.appendChild(statLabel);

			const statValue = $('span.stat-value');
			statValue.textContent = String(statistics.totalTables);
			statItem.appendChild(statValue);

			statsGrid.appendChild(statItem);
		}

		// 字段数量
		if (statistics.totalFields !== undefined) {
			const statItem = $('.stat-item');
			const statLabel = $('span.stat-label');
			statLabel.textContent = localize('database.healthCheck.totalFields', '字段数量:');
			statItem.appendChild(statLabel);

			const statValue = $('span.stat-value');
			statValue.textContent = String(statistics.totalFields);
			statItem.appendChild(statValue);

			statsGrid.appendChild(statItem);
		}

		// 索引数量
		if (statistics.totalIndexes !== undefined) {
			const statItem = $('.stat-item');
			const statLabel = $('span.stat-label');
			statLabel.textContent = localize('database.healthCheck.totalIndexes', '索引数量:');
			statItem.appendChild(statLabel);

			const statValue = $('span.stat-value');
			statValue.textContent = String(statistics.totalIndexes);
			statItem.appendChild(statValue);

			statsGrid.appendChild(statItem);
		}

		// 问题统计
		if (statistics.issueCount) {
			const issueCountItem = $('.stat-item-wide');
			const issueCountLabel = $('span.stat-label');
			issueCountLabel.textContent = localize('database.healthCheck.issueCount', '问题统计:');
			issueCountItem.appendChild(issueCountLabel);

			const issueCountGrid = $('.issue-count-grid');

			if (statistics.issueCount.critical !== undefined) {
				const badge = $('span.issue-badge.critical');
				badge.textContent = `严重: ${statistics.issueCount.critical}`;
				issueCountGrid.appendChild(badge);
			}

			if (statistics.issueCount.high !== undefined) {
				const badge = $('span.issue-badge.high');
				badge.textContent = `高: ${statistics.issueCount.high}`;
				issueCountGrid.appendChild(badge);
			}

			if (statistics.issueCount.medium !== undefined) {
				const badge = $('span.issue-badge.medium');
				badge.textContent = `中: ${statistics.issueCount.medium}`;
				issueCountGrid.appendChild(badge);
			}

			if (statistics.issueCount.low !== undefined) {
				const badge = $('span.issue-badge.low');
				badge.textContent = `低: ${statistics.issueCount.low}`;
				issueCountGrid.appendChild(badge);
			}

			issueCountItem.appendChild(issueCountGrid);
			statsGrid.appendChild(issueCountItem);
		}

		statsSection.appendChild(statsGrid);
		this.resultArea.appendChild(statsSection);
	}

	/**
	 * 显示维度评分
	 */
	private showDimensionScores(dimensionScores: any[]): void {
		const dimensionSection = $('.dimension-section');
		const dimensionTitle = $('h4');
		dimensionTitle.textContent = localize('database.healthCheck.dimensionScores', '各维度评分');
		dimensionSection.appendChild(dimensionTitle);

		const dimensionList = $('.dimension-list');
		dimensionScores.forEach((dimension: any) => {
			const dimensionItem = $('.dimension-item');

			const dimensionHeader = $('.dimension-header');

			const dimensionName = $('span.dimension-name');
			dimensionName.textContent = dimension.dimension;
			dimensionHeader.appendChild(dimensionName);

			const dimensionScore = $('span.dimension-score');
			dimensionScore.textContent = `${dimension.score} / 100`;

			// 根据等级设置颜色
			const level = dimension.level || 'warning';
			if (level === 'excellent' || level === 'good') {
				dimensionScore.classList.add('good');
			} else if (level === 'warning') {
				dimensionScore.classList.add('medium');
			} else {
				dimensionScore.classList.add('bad');
			}
			dimensionHeader.appendChild(dimensionScore);

			dimensionItem.appendChild(dimensionHeader);

			if (dimension.summary) {
				const dimensionSummary = $('div.dimension-summary');
				dimensionSummary.textContent = dimension.summary;
				dimensionItem.appendChild(dimensionSummary);
			}

			dimensionList.appendChild(dimensionItem);
		});

		dimensionSection.appendChild(dimensionList);
		this.resultArea.appendChild(dimensionSection);
	}

	/**
	 * 显示问题列表
	 */
	private showIssues(issues: any[]): void {
		const issuesSection = $('.issues-section');
		const issuesTitle = $('h4');
		issuesTitle.textContent = localize('database.healthCheck.issues', '发现的问题');
		issuesSection.appendChild(issuesTitle);

		const issuesList = $('ul.issues-list');
		issues.forEach((issue: any) => {
			const li = $('li');
			li.classList.add(`severity-${issue.severity || 'medium'}`);

			const categorySpan = $('span.category');
			categorySpan.textContent = `[${issue.category || '其他'}]`;
			categorySpan.classList.add('issue-category');
			li.appendChild(categorySpan);

			if (issue.table) {
				const tableSpan = $('span.table');
				tableSpan.textContent = issue.table;
				tableSpan.classList.add('issue-table');
				li.appendChild(tableSpan);

				if (issue.field) {
					li.appendChild(document.createTextNode('.'));
					const fieldSpan = $('span.field');
					fieldSpan.textContent = issue.field;
					fieldSpan.classList.add('issue-field');
					li.appendChild(fieldSpan);
				}

				li.appendChild(document.createTextNode(': '));
			}

			const problemText = document.createTextNode(issue.problem);
			li.appendChild(problemText);

			if (issue.suggestion) {
				const suggestionDiv = $('div.issue-suggestion');
				suggestionDiv.textContent = `💡 ${issue.suggestion}`;
				li.appendChild(suggestionDiv);
			}

			if (issue.impact) {
				const impactDiv = $('div.issue-impact');
				impactDiv.textContent = `📊 ${issue.impact}`;
				li.appendChild(impactDiv);
			}

			if (issue.sql) {
				const sqlDiv = $('div.issue-sql');
				const sqlPre = $('pre');
				sqlPre.textContent = issue.sql;
				sqlDiv.appendChild(sqlPre);
				li.appendChild(sqlDiv);

				// 复制按钮
				const copyButton = $<HTMLButtonElement>('button.copy-sql-button-small');
				copyButton.textContent = localize('database.healthCheck.copySql', '复制');
				this._register(addDisposableListener(copyButton, EventType.CLICK, () => {
					this.copySQL(issue.sql);
				}));
				li.appendChild(copyButton);
			}

			issuesList.appendChild(li);
		});
		issuesSection.appendChild(issuesList);
		this.resultArea.appendChild(issuesSection);
	}

	/**
	 * 显示优化方案
	 */
	private showOptimizations(optimizations: any[]): void {
		const optimizationsSection = $('.optimizations-section');
		const optimizationsTitle = $('h4');
		optimizationsTitle.textContent = localize('database.healthCheck.optimizations', '优化方案');
		optimizationsSection.appendChild(optimizationsTitle);

		const optimizationsList = $('ul.optimizations-list');
		optimizations.forEach((opt: any) => {
			const li = $('li');
			li.classList.add(`priority-${opt.priority || '中'}`);

			const typeSpan = $('span.opt-type');
			typeSpan.textContent = `[${opt.type || '优化'}]`;
			typeSpan.classList.add('optimization-type');
			li.appendChild(typeSpan);

			const prioritySpan = $('span.opt-priority');
			prioritySpan.textContent = `优先级: ${opt.priority || '中'}`;
			prioritySpan.classList.add('optimization-priority');
			li.appendChild(prioritySpan);

			if (opt.table) {
				const tableSpan = $('span.opt-table');
				tableSpan.textContent = ` - ${opt.table}`;
				tableSpan.classList.add('optimization-table');
				li.appendChild(tableSpan);
			}

			if (opt.reason) {
				const reasonDiv = $('div.opt-reason');
				reasonDiv.textContent = `📝 ${opt.reason}`;
				li.appendChild(reasonDiv);
			}

			if (opt.suggestion) {
				const suggestionDiv = $('div.opt-suggestion');
				suggestionDiv.textContent = `💡 ${opt.suggestion}`;
				li.appendChild(suggestionDiv);
			}

			if (opt.sql) {
				const sqlDiv = $('div.opt-sql');
				const sqlPre = $('pre');
				sqlPre.textContent = opt.sql;
				sqlDiv.appendChild(sqlPre);
				li.appendChild(sqlDiv);

				// 复制按钮
				const copyButton = $<HTMLButtonElement>('button.copy-sql-button-small');
				copyButton.textContent = localize('database.healthCheck.copySql', '复制');
				this._register(addDisposableListener(copyButton, EventType.CLICK, () => {
					this.copySQL(opt.sql);
				}));
				li.appendChild(copyButton);
			}

			if (opt.benefit) {
				const benefitDiv = $('div.opt-benefit');
				benefitDiv.textContent = `✅ ${opt.benefit}`;
				li.appendChild(benefitDiv);
			}

			optimizationsList.appendChild(li);
		});
		optimizationsSection.appendChild(optimizationsList);
		this.resultArea.appendChild(optimizationsSection);
	}

	/**
	 * 显示最佳实践建议
	 */
	private showBestPractices(bestPractices: string[]): void {
		const practicesSection = $('.practices-section');
		const practicesTitle = $('h4');
		practicesTitle.textContent = localize('database.healthCheck.bestPractices', '最佳实践建议');
		practicesSection.appendChild(practicesTitle);

		const practicesList = $('ul.practices-list');
		bestPractices.forEach((practice: string) => {
			const li = $('li');
			li.textContent = practice;
			practicesList.appendChild(li);
		});
		practicesSection.appendChild(practicesList);
		this.resultArea.appendChild(practicesSection);
	}

	/**
	 * 显示建议
	 */
	private showRecommendations(recommendations: any[]): void {
		const recommendationsSection = $('.recommendations-section');
		const recommendationsTitle = $('h4');
		recommendationsTitle.textContent = localize('database.healthCheck.recommendations', '改进建议');
		recommendationsSection.appendChild(recommendationsTitle);

		const recommendationsList = $('.recommendations-list');
		recommendations.forEach((rec: any) => {
			const recItem = $('.recommendation-item');

			const recHeader = $('.recommendation-header');

			const recTitle = $('span.recommendation-title');
			recTitle.textContent = rec.title;
			recHeader.appendChild(recTitle);

			const recPriority = $('span.recommendation-priority');
			recPriority.textContent = rec.priority || '中';
			recPriority.classList.add(`priority-${rec.priority || '中'}`);
			recHeader.appendChild(recPriority);

			recItem.appendChild(recHeader);

			if (rec.description) {
				const recDesc = $('div.recommendation-description');
				recDesc.textContent = rec.description;
				recItem.appendChild(recDesc);
			}

			recommendationsList.appendChild(recItem);
		});

		recommendationsSection.appendChild(recommendationsList);
		this.resultArea.appendChild(recommendationsSection);
	}

	/**
	 * 复制SQL到剪贴板
	 */
	private copySQL(sql: string): void {
		if (!sql) {
			return;
		}

		try {
			if (navigator.clipboard && navigator.clipboard.writeText) {
				navigator.clipboard.writeText(sql).then(() => {
					this.notificationService.info(
						localize('database.healthCheck.sqlCopied', 'SQL 已复制到剪贴板')
					);
				}).catch(() => {
					this.copyUsingExecCommand(sql);
				});
			} else {
				this.copyUsingExecCommand(sql);
			}
		} catch (error) {
			this.copyUsingExecCommand(sql);
		}
	}

	/**
	 * 使用 execCommand 备用方法复制
	 */
	private copyUsingExecCommand(sql: string): void {
		try {
			const textarea = document.createElement('textarea');
			textarea.value = sql;
			textarea.style.position = 'fixed';
			textarea.style.opacity = '0';
			document.body.appendChild(textarea);

			textarea.select();
			textarea.setSelectionRange(0, textarea.value.length);

			const successful = document.execCommand('copy');
			document.body.removeChild(textarea);

			if (successful) {
				this.notificationService.info(
					localize('database.healthCheck.sqlCopied', 'SQL 已复制到剪贴板')
				);
			} else {
				this.notificationService.error(
					localize('database.healthCheck.copyFailed', '复制失败，请手动选择并复制')
				);
			}
		} catch (error) {
			this.notificationService.error(
				localize('database.healthCheck.copyFailed', '复制失败，请手动选择并复制')
			);
		}
	}

	override focus(): void {
		super.focus();
		this.connectionSelect?.focus();
	}
}
