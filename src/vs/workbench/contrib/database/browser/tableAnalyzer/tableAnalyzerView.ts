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
 * 表结构分析器视图ID
 */
export const TABLE_ANALYZER_VIEW_ID = 'workbench.view.database.tableAnalyzer';

/**
 * 表结构分析器视图
 * 用于分析现有表结构并提供优化建议
 */
export class TableAnalyzerView extends ViewPane {
	private container!: HTMLElement;
	private connectionSelect!: HTMLSelectElement;
	private schemaSelect!: HTMLSelectElement;
	private tableSelect!: HTMLSelectElement;
	private analyzeButton!: HTMLButtonElement;
	private resultArea!: HTMLElement;

	// 当前选择的连接、Schema和表
	private selectedConnectionId: string | null = null;
	private selectedSchema: string | null = null;
	private selectedTable: string | null = null;

	// 分析结果
	private analysisResult: any = null;
	private isAnalyzing: boolean = false;

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

		console.log('[TableAnalyzerView] Constructor called');
	}

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);
		this.container = container;
		this.container.classList.add('table-analyzer-view');

		// 添加内联样式
		this.container.style.padding = '20px';
		this.container.style.height = '100%';
		this.container.style.overflowY = 'auto';

		// 创建主容器
		this.createInputSection();
		this.createResultSection();

		// 加载数据库连接
		this.loadConnections();

		console.log('[TableAnalyzerView] Body rendered');
	}

	/**
	 * 创建输入部分
	 */
	private createInputSection(): void {
		const section = $('.input-section');

		// 标题
		const header = $('.section-header');
		const title = $('h3');
		title.textContent = localize('database.tableAnalyzer.title', '表结构分析器');
		header.appendChild(title);

		const subtitle = $('.subtitle');
		subtitle.textContent = localize(
			'database.tableAnalyzer.subtitle',
			'选择一个数据库表，AI将深度分析其结构设计并提供优化建议'
		);
		header.appendChild(subtitle);
		section.appendChild(header);

		// 数据库选择区域
		const selectArea = $('.db-select-area');

		// 连接选择
		const connectionLabel = $('label');
		connectionLabel.textContent = localize('database.tableAnalyzer.connection', '数据库连接');
		selectArea.appendChild(connectionLabel);

		this.connectionSelect = $<HTMLSelectElement>('select.connection-select');
		this._register(addDisposableListener(this.connectionSelect, EventType.CHANGE, () => {
			this.onConnectionChange();
		}));
		selectArea.appendChild(this.connectionSelect);

		// Schema选择
		const schemaLabel = $('label');
		schemaLabel.textContent = localize('database.tableAnalyzer.schema', '数据库');
		selectArea.appendChild(schemaLabel);

		this.schemaSelect = $<HTMLSelectElement>('select.schema-select');
		this.schemaSelect.disabled = true;
		this._register(addDisposableListener(this.schemaSelect, EventType.CHANGE, () => {
			this.onSchemaChange();
		}));
		selectArea.appendChild(this.schemaSelect);

		// 表选择
		const tableLabel = $('label');
		tableLabel.textContent = localize('database.tableAnalyzer.table', '数据表');
		selectArea.appendChild(tableLabel);

		this.tableSelect = $<HTMLSelectElement>('select.table-select');
		this.tableSelect.disabled = true;
		this._register(addDisposableListener(this.tableSelect, EventType.CHANGE, () => {
			this.onTableChange();
		}));
		selectArea.appendChild(this.tableSelect);

		section.appendChild(selectArea);

		// 按钮区域
		const buttonArea = $('.button-area');

		// 分析按钮
		this.analyzeButton = $<HTMLButtonElement>('button.analyze-button');
		this.analyzeButton.textContent = localize('database.tableAnalyzer.analyze', '开始分析');
		this.analyzeButton.disabled = true;
		this._register(addDisposableListener(this.analyzeButton, EventType.CLICK, () => {
			this.analyzeTable();
		}));
		buttonArea.appendChild(this.analyzeButton);

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
		title.textContent = localize('database.tableAnalyzer.result', '分析结果');
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
			defaultOption.textContent = localize('database.tableAnalyzer.selectConnection', '请选择数据库连接');
			this.connectionSelect.appendChild(defaultOption);

			// 添加连接选项
			connections.forEach(conn => {
				const option = $<HTMLOptionElement>('option');
				option.value = conn.id;
				option.textContent = `${conn.name} (${conn.host}:${conn.port})`;
				this.connectionSelect.appendChild(option);
			});

		} catch (error) {
			console.error('[TableAnalyzerView] Load connections error:', error);
		}
	}

	/**
	 * 连接改变事件
	 */
	private async onConnectionChange(): Promise<void> {
		this.selectedConnectionId = this.connectionSelect.value || null;
		this.selectedSchema = null;
		this.selectedTable = null;

		// 清空Schema选择
		while (this.schemaSelect.firstChild) {
			this.schemaSelect.removeChild(this.schemaSelect.firstChild);
		}

		// 清空表选择
		while (this.tableSelect.firstChild) {
			this.tableSelect.removeChild(this.tableSelect.firstChild);
		}

		this.tableSelect.disabled = true;

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
			defaultOption.textContent = localize('database.tableAnalyzer.selectSchema', '请选择数据库');
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
				localize('database.tableAnalyzer.loadSchemaError', '加载数据库列表失败: {0}', String(error))
			);
		}

		this.updateButtonState();
	}

	/**
	 * Schema改变事件
	 */
	private async onSchemaChange(): Promise<void> {
		this.selectedSchema = this.schemaSelect.value || null;
		this.selectedTable = null;

		// 清空表选择
		while (this.tableSelect.firstChild) {
			this.tableSelect.removeChild(this.tableSelect.firstChild);
		}

		if (!this.selectedConnectionId || !this.selectedSchema) {
			this.tableSelect.disabled = true;
			this.updateButtonState();
			return;
		}

		try {
			// 获取表列表
			const tables = await this.databaseService.getTables(this.selectedConnectionId, this.selectedSchema);

			// 添加默认选项
			const defaultOption = $<HTMLOptionElement>('option');
			defaultOption.value = '';
			defaultOption.textContent = localize('database.tableAnalyzer.selectTable', '请选择数据表');
			this.tableSelect.appendChild(defaultOption);

			// 添加表选项
			tables.forEach(table => {
				const option = $<HTMLOptionElement>('option');
				option.value = table.name;
				option.textContent = table.name + (table.comment ? ` (${table.comment})` : '');
				this.tableSelect.appendChild(option);
			});

			this.tableSelect.disabled = false;

		} catch (error) {
			this.notificationService.error(
				localize('database.tableAnalyzer.loadTablesError', '加载数据表列表失败: {0}', String(error))
			);
		}

		this.updateButtonState();
	}

	/**
	 * 表改变事件
	 */
	private onTableChange(): void {
		this.selectedTable = this.tableSelect.value || null;
		this.updateButtonState();
	}

	/**
	 * 更新按钮状态
	 */
	private updateButtonState(): void {
		this.analyzeButton.disabled =
			!this.selectedConnectionId ||
			!this.selectedSchema ||
			!this.selectedTable ||
			this.isAnalyzing;
	}

	/**
	 * 分析表结构
	 */
	private async analyzeTable(): Promise<void> {
		if (!this.selectedConnectionId || !this.selectedSchema || !this.selectedTable) {
			this.notificationService.warn(
				localize('database.tableAnalyzer.selectTableFirst', '请先选择要分析的数据表')
			);
			return;
		}

		// 设置分析状态
		this.isAnalyzing = true;
		this.analyzeButton.disabled = true;
		this.analyzeButton.textContent = localize('database.tableAnalyzer.analyzing', '分析中...');

		try {
			console.log('[TableAnalyzerView] 开始分析表结构:', this.selectedTable);

			// 获取表结构
			const tableStructure = await this.databaseService.getTableStructure(
				this.selectedConnectionId,
				this.selectedSchema,
				this.selectedTable
			);

			console.log('[TableAnalyzerView] 表结构:', tableStructure);

			// 获取数据库类型
			const connectionsJson = this.storageService.get('database.connections', StorageScope.PROFILE) || '[]';
			const connections: IDatabaseConnectionConfig[] = JSON.parse(connectionsJson);
			const config = connections.find(c => c.id === this.selectedConnectionId);
			const databaseType = config?.type || 'MySQL';

			// 调用后端接口渲染提示词模板
			console.log('[TableAnalyzerView] 渲染提示词模板');
			const renderedPrompt = await this.getRenderedPrompt(
				JSON.stringify(tableStructure, null, 2),
				databaseType,
				this.selectedTable
			);
			console.log('[TableAnalyzerView] 渲染后的提示词长度:', renderedPrompt.length);

			// 调用AI服务进行分析
			console.log('[TableAnalyzerView] 调用AI服务进行分析');
			const response = await this.aiService.completeWithUsage(renderedPrompt, {
				businessCode: 'IDE_DB_TABLE_ANALYZE',
				temperature: 0.1,
				maxTokens: 3000
			});

			console.log('[TableAnalyzerView] AI返回结果:', response);

			// 解析分析结果
			this.analysisResult = this.parseAnalysisResult(response.content);
			this.showResults();

			this.notificationService.info(
				localize('database.tableAnalyzer.analyzeSuccess', '表结构分析完成')
			);

		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			this.notificationService.error(
				localize('database.tableAnalyzer.analyzeError', '分析失败: {0}', errorMessage)
			);
			console.error('[TableAnalyzerView] Analyze error:', error);
		} finally {
			// 恢复按钮状态
			this.isAnalyzing = false;
			this.analyzeButton.disabled = false;
			this.analyzeButton.textContent = localize('database.tableAnalyzer.analyze', '开始分析');
		}
	}

	/**
	 * 获取渲染后的提示词
	 */
	private async getRenderedPrompt(tableStructure: string, databaseType: string, tableName: string): Promise<string> {
		try {
			console.log('[TableAnalyzerView] 调用提示词渲染接口');

			const response = await fetch('http://127.0.0.1:8088/system/ai/prompt/render', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({
					promptKey: 'IDE_DB_TABLE_ANALYZE',
					variables: {
						tableStructure: tableStructure,
						databaseType: databaseType,
						tableName: tableName
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
			console.error('[TableAnalyzerView] 获取提示词失败:', error);
			throw error;
		}
	}

	/**
	 * 解析分析结果
	 */
	private parseAnalysisResult(content: string): any {
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
				score: 0,
				rawContent: content
			};

		} catch (error) {
			console.error('[TableAnalyzerView] 解析分析结果失败:', error);
			// 返回原始内容
			return {
				score: 0,
				rawContent: content
			};
		}
	}

	/**
	 * 显示结果
	 */
	private showResults(): void {
		if (!this.analysisResult) {
			return;
		}

		const resultSection = this.container.querySelector('.result-section') as HTMLElement;
		resultSection.style.display = 'block';

		// 清空结果区域
		while (this.resultArea.firstChild) {
			this.resultArea.removeChild(this.resultArea.firstChild);
		}

		// 如果有原始内容,直接显示
		if (this.analysisResult.rawContent) {
			const rawContent = $('.raw-content');
			rawContent.textContent = this.analysisResult.rawContent;
			this.resultArea.appendChild(rawContent);
			return;
		}

		// 显示评分和摘要
		if (this.analysisResult.score !== undefined) {
			const scoreCard = $('.score-card');

			const scoreLabel = $('span.score-label');
			scoreLabel.textContent = localize('database.tableAnalyzer.score', '综合评分:');
			scoreCard.appendChild(scoreLabel);

			const scoreValue = $('span.score-value');
			scoreValue.textContent = `${this.analysisResult.score} / 100`;
			if (this.analysisResult.score >= 85) {
				scoreValue.classList.add('good');
			} else if (this.analysisResult.score >= 70) {
				scoreValue.classList.add('medium');
			} else {
				scoreValue.classList.add('bad');
			}
			scoreCard.appendChild(scoreValue);

			this.resultArea.appendChild(scoreCard);
		}

		// 显示总结
		if (this.analysisResult.summary) {
			const summarySection = $('.summary-section');
			const summaryTitle = $('h4');
			summaryTitle.textContent = localize('database.tableAnalyzer.summary', '分析总结');
			summarySection.appendChild(summaryTitle);

			const summaryText = $('p.summary-text');
			summaryText.textContent = this.analysisResult.summary;
			summarySection.appendChild(summaryText);

			this.resultArea.appendChild(summarySection);
		}

		// 显示问题列表
		if (this.analysisResult.issues && this.analysisResult.issues.length > 0) {
			const issuesSection = $('.issues-section');
			const issuesTitle = $('h4');
			issuesTitle.textContent = localize('database.tableAnalyzer.issues', '发现的问题');
			issuesSection.appendChild(issuesTitle);

			const issuesList = $('ul.issues-list');
			this.analysisResult.issues.forEach((issue: any) => {
				const li = $('li');
				li.classList.add(`severity-${issue.severity || 'medium'}`);

				const categorySpan = $('span.category');
				categorySpan.textContent = `[${issue.category || '其他'}]`;
				categorySpan.classList.add('issue-category');
				li.appendChild(categorySpan);

				const fieldSpan = $('span.field');
				if (issue.field) {
					fieldSpan.textContent = issue.field;
					fieldSpan.classList.add('issue-field');
					li.appendChild(fieldSpan);
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

				issuesList.appendChild(li);
			});
			issuesSection.appendChild(issuesList);
			this.resultArea.appendChild(issuesSection);
		}

		// 显示优化方案
		if (this.analysisResult.optimizations && this.analysisResult.optimizations.length > 0) {
			const optimizationsSection = $('.optimizations-section');
			const optimizationsTitle = $('h4');
			optimizationsTitle.textContent = localize('database.tableAnalyzer.optimizations', '优化方案');
			optimizationsSection.appendChild(optimizationsTitle);

			const optimizationsList = $('ul.optimizations-list');
			this.analysisResult.optimizations.forEach((opt: any) => {
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

				if (opt.reason) {
					const reasonDiv = $('div.opt-reason');
					reasonDiv.textContent = `📝 ${opt.reason}`;
					li.appendChild(reasonDiv);
				}

				if (opt.sql) {
					const sqlDiv = $('div.opt-sql');
					const sqlPre = $('pre');
					sqlPre.textContent = opt.sql;
					sqlDiv.appendChild(sqlPre);
					li.appendChild(sqlDiv);

					// 复制按钮
					const copyButton = $<HTMLButtonElement>('button.copy-sql-button-small');
					copyButton.textContent = localize('database.tableAnalyzer.copySql', '复制');
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

		// 显示最佳实践建议
		if (this.analysisResult.bestPractices && this.analysisResult.bestPractices.length > 0) {
			const practicesSection = $('.practices-section');
			const practicesTitle = $('h4');
			practicesTitle.textContent = localize('database.tableAnalyzer.bestPractices', '最佳实践建议');
			practicesSection.appendChild(practicesTitle);

			const practicesList = $('ul.practices-list');
			this.analysisResult.bestPractices.forEach((practice: string) => {
				const li = $('li');
				li.textContent = practice;
				practicesList.appendChild(li);
			});
			practicesSection.appendChild(practicesList);
			this.resultArea.appendChild(practicesSection);
		}
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
						localize('database.tableAnalyzer.sqlCopied', 'SQL 已复制到剪贴板')
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
					localize('database.tableAnalyzer.sqlCopied', 'SQL 已复制到剪贴板')
				);
			} else {
				this.notificationService.error(
					localize('database.tableAnalyzer.copyFailed', '复制失败，请手动选择并复制')
				);
			}
		} catch (error) {
			this.notificationService.error(
				localize('database.tableAnalyzer.copyFailed', '复制失败，请手动选择并复制')
			);
		}
	}

	override focus(): void {
		super.focus();
		this.connectionSelect?.focus();
	}
}
