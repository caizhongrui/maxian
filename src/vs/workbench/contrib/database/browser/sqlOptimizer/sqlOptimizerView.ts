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
 * SQL 优化器视图ID
 */
export const SQL_OPTIMIZER_VIEW_ID = 'workbench.view.database.sqlOptimizer';

/**
 * SQL 优化器视图
 * 用于优化 SQL 查询语句并提供优化建议
 */
export class SQLOptimizerView extends ViewPane {
	private container!: HTMLElement;
	private connectionSelect!: HTMLSelectElement;
	private schemaSelect!: HTMLSelectElement;
	private sqlInput!: HTMLTextAreaElement;
	private optimizeButton!: HTMLButtonElement;
	private charCountElement!: HTMLSpanElement;
	private resultArea!: HTMLElement;

	// 当前选择的连接和Schema
	private selectedConnectionId: string | null = null;
	private selectedSchema: string | null = null;

	// 优化结果
	private optimizationResult: any = null;
	private isOptimizing: boolean = false;

	// 常量
	private readonly MAX_CHARS = 5000;
	private readonly MIN_CHARS = 10;

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

		console.log('[SQLOptimizerView] Constructor called');
	}

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);
		this.container = container;
		this.container.classList.add('sql-optimizer-view');

		// 添加内联样式
		this.container.style.padding = '20px';
		this.container.style.height = '100%';
		this.container.style.overflowY = 'auto';

		// 创建主容器
		this.createInputSection();
		this.createResultSection();

		// 加载数据库连接
		this.loadConnections();

		console.log('[SQLOptimizerView] Body rendered');
	}

	/**
	 * 创建输入部分
	 */
	private createInputSection(): void {
		const section = $('.input-section');

		// 标题
		const header = $('.section-header');
		const title = $('h3');
		title.textContent = localize('database.sqlOptimizer.title', 'SQL 优化器');
		header.appendChild(title);

		const subtitle = $('.subtitle');
		subtitle.textContent = localize(
			'database.sqlOptimizer.subtitle',
			'粘贴或输入您的SQL语句,AI将为您分析性能问题并提供优化建议'
		);
		header.appendChild(subtitle);
		section.appendChild(header);

		// 数据库选择
		const dbSelectArea = $('.db-select-area');

		// 连接选择
		const connectionLabel = $('label');
		connectionLabel.textContent = localize('database.sqlOptimizer.connection', '数据库连接');
		dbSelectArea.appendChild(connectionLabel);

		this.connectionSelect = $<HTMLSelectElement>('select.connection-select');
		this._register(addDisposableListener(this.connectionSelect, EventType.CHANGE, () => {
			this.onConnectionChange();
		}));
		dbSelectArea.appendChild(this.connectionSelect);

		// Schema选择
		const schemaLabel = $('label');
		schemaLabel.textContent = localize('database.sqlOptimizer.schema', '数据库');
		dbSelectArea.appendChild(schemaLabel);

		this.schemaSelect = $<HTMLSelectElement>('select.schema-select');
		this.schemaSelect.disabled = true;
		this._register(addDisposableListener(this.schemaSelect, EventType.CHANGE, () => {
			this.onSchemaChange();
		}));
		dbSelectArea.appendChild(this.schemaSelect);

		section.appendChild(dbSelectArea);

		// SQL输入区域
		const inputArea = $('.input-area');

		const inputLabel = $('label');
		inputLabel.textContent = localize('database.sqlOptimizer.sql', 'SQL 语句');
		inputArea.appendChild(inputLabel);

		// 文本框
		this.sqlInput = $<HTMLTextAreaElement>('textarea.sql-input');
		this.sqlInput.placeholder = localize(
			'database.sqlOptimizer.placeholder',
			'例如:\nSELECT * FROM users WHERE YEAR(create_time) = 2024'
		);
		this.sqlInput.rows = 10;
		this.sqlInput.maxLength = this.MAX_CHARS;
		inputArea.appendChild(this.sqlInput);

		// 字数统计
		const charCount = $('.char-count');
		this.charCountElement = $<HTMLSpanElement>('span.count');
		this.charCountElement.textContent = `0 / ${this.MAX_CHARS}`;
		charCount.appendChild(this.charCountElement);
		inputArea.appendChild(charCount);

		// 监听输入变化
		this._register(addDisposableListener(this.sqlInput, EventType.INPUT, () => {
			this.updateCharCount();
			this.updateButtonState();
		}));

		section.appendChild(inputArea);

		// 按钮区域
		const buttonArea = $('.button-area');

		// 优化按钮
		this.optimizeButton = $<HTMLButtonElement>('button.optimize-button');
		this.optimizeButton.textContent = localize('database.sqlOptimizer.optimize', '分析优化');
		this.optimizeButton.disabled = true;
		this._register(addDisposableListener(this.optimizeButton, EventType.CLICK, () => {
			this.optimizeSQL();
		}));
		buttonArea.appendChild(this.optimizeButton);

		// 清空按钮
		const clearButton = $<HTMLButtonElement>('button.clear-button');
		clearButton.textContent = localize('database.sqlOptimizer.clear', '清空');
		this._register(addDisposableListener(clearButton, EventType.CLICK, () => {
			this.clearInput();
		}));
		buttonArea.appendChild(clearButton);

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
		title.textContent = localize('database.sqlOptimizer.result', '优化建议');
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
			defaultOption.textContent = localize('database.sqlOptimizer.selectConnection', '请选择数据库连接');
			this.connectionSelect.appendChild(defaultOption);

			// 添加连接选项
			connections.forEach(conn => {
				const option = $<HTMLOptionElement>('option');
				option.value = conn.id;
				option.textContent = `${conn.name} (${conn.host}:${conn.port})`;
				this.connectionSelect.appendChild(option);
			});

		} catch (error) {
			console.error('[SQLOptimizerView] Load connections error:', error);
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
			defaultOption.textContent = localize('database.sqlOptimizer.selectSchema', '请选择数据库');
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
				localize('database.sqlOptimizer.loadSchemaError', '加载数据库列表失败: {0}', String(error))
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
	 * 更新字数统计
	 */
	private updateCharCount(): void {
		const length = this.sqlInput.value.length;
		this.charCountElement.textContent = `${length} / ${this.MAX_CHARS}`;

		if (length > this.MAX_CHARS) {
			this.charCountElement.classList.add('error');
		} else {
			this.charCountElement.classList.remove('error');
		}
	}

	/**
	 * 更新按钮状态
	 */
	private updateButtonState(): void {
		const length = this.sqlInput.value.trim().length;

		this.optimizeButton.disabled =
			length < this.MIN_CHARS ||
			length > this.MAX_CHARS ||
			this.isOptimizing;
	}

	/**
	 * 清空输入
	 */
	private clearInput(): void {
		this.sqlInput.value = '';
		this.updateCharCount();
		this.updateButtonState();
		this.hideResults();
	}

	/**
	 * 优化SQL
	 */
	private async optimizeSQL(): Promise<void> {
		const sql = this.sqlInput.value.trim();

		if (sql.length < this.MIN_CHARS) {
			this.notificationService.warn(
				localize('database.sqlOptimizer.sqlTooShort', 'SQL语句至少需要 {0} 个字符', this.MIN_CHARS)
			);
			return;
		}

		// 设置优化状态
		this.isOptimizing = true;
		this.optimizeButton.disabled = true;
		this.optimizeButton.textContent = localize('database.sqlOptimizer.optimizing', '分析中...');

		try {
			console.log('[SQLOptimizerView] 开始优化SQL, sql:', sql);

			// 获取数据库信息（如果选择了连接和Schema）
			let databaseType = 'MySQL';
			let schemaInfo = '';

			if (this.selectedConnectionId && this.selectedSchema) {
				try {
					const tables = await this.databaseService.getTables(this.selectedConnectionId, this.selectedSchema);
					const tableSchemas: string[] = [];

					for (const table of tables.slice(0, 20)) { // 限制只获取前20个表
						const structure = await this.databaseService.getTableStructure(
							this.selectedConnectionId,
							this.selectedSchema,
							table.name
						);

						const columnDefs = structure.columns.map((col: any) => {
							let colDef = `  ${col.name} ${col.dataType}`;
							if (col.length) {
								colDef += `(${col.length})`;
							}
							if (col.isPrimaryKey) {
								colDef += ' PRIMARY KEY';
							}
							return colDef;
						}).join(',\n');

						tableSchemas.push(`表名: ${table.name}\n${columnDefs}`);
					}

					schemaInfo = tableSchemas.join('\n\n');
				} catch (error) {
					console.warn('[SQLOptimizerView] 获取数据库结构失败:', error);
				}
			}

			// 调用后端接口渲染提示词模板
			console.log('[SQLOptimizerView] 渲染提示词模板');
			const renderedPrompt = await this.getRenderedPrompt(sql, databaseType, schemaInfo);
			console.log('[SQLOptimizerView] 渲染后的提示词长度:', renderedPrompt.length);

			// 调用AI服务进行优化分析
			console.log('[SQLOptimizerView] 调用AI服务进行优化分析');
			const response = await this.aiService.completeWithUsage(renderedPrompt, {
				businessCode: 'IDE_DB_SQL_OPTIMIZE',
				temperature: 0.3,
				maxTokens: 2000
			});

			console.log('[SQLOptimizerView] AI返回结果:', response);

			// 解析优化结果
			this.optimizationResult = this.parseOptimizationResult(response.content);
			this.showResults();

			this.notificationService.info(
				localize('database.sqlOptimizer.optimizeSuccess', 'SQL 分析完成')
			);

		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			this.notificationService.error(
				localize('database.sqlOptimizer.optimizeError', '分析失败: {0}', errorMessage)
			);
			console.error('[SQLOptimizerView] Optimize error:', error);
		} finally {
			// 恢复按钮状态
			this.isOptimizing = false;
			this.optimizeButton.disabled = false;
			this.optimizeButton.textContent = localize('database.sqlOptimizer.optimize', '分析优化');
		}
	}

	/**
	 * 获取渲染后的提示词
	 */
	private async getRenderedPrompt(sql: string, databaseType: string, schemaInfo: string): Promise<string> {
		try {
			console.log('[SQLOptimizerView] 调用提示词渲染接口');

			const response = await fetch('http://127.0.0.1:8088/system/ai/prompt/render', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({
					promptKey: 'IDE_DB_SQL_OPTIMIZE',
					variables: {
						sql: sql,
						databaseType: databaseType,
						schemaInfo: schemaInfo || '无数据库结构信息'
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
			console.error('[SQLOptimizerView] 获取提示词失败:', error);
			throw error;
		}
	}

	/**
	 * 解析优化结果
	 */
	private parseOptimizationResult(content: string): any {
		try {
			// 尝试解析JSON格式的结果
			const jsonMatch = content.match(/```json\s*\n([\s\S]*?)\n```/);
			if (jsonMatch) {
				const parsedData = JSON.parse(jsonMatch[1]);

				// 转换AI返回的格式为我们期望的格式
				const result: any = {
					score: 0,
					issues: [],
					suggestions: [],
					tableSuggestions: [],
					optimizedSQL: parsedData.optimized || ''
				};

				// 如果有improvements数组，提取issue和suggestion
				if (parsedData.improvements && Array.isArray(parsedData.improvements)) {
					parsedData.improvements.forEach((item: any) => {
						if (item.issue) {
							result.issues.push(item.issue);
						}
						if (item.suggestion) {
							result.suggestions.push(item.suggestion + (item.benefit ? ` (${item.benefit})` : ''));
						}
					});
				}

				// 如果有indexSuggestions数组，提取索引建议
				if (parsedData.indexSuggestions && Array.isArray(parsedData.indexSuggestions)) {
					parsedData.indexSuggestions.forEach((item: any) => {
						if (typeof item === 'string') {
							result.tableSuggestions.push(item);
						} else if (item.suggestion) {
							result.tableSuggestions.push(item.suggestion);
						}
					});
				}

				// 如果有tableSuggestions数组，直接添加
				if (parsedData.tableSuggestions && Array.isArray(parsedData.tableSuggestions)) {
					parsedData.tableSuggestions.forEach((item: any) => {
						if (typeof item === 'string') {
							result.tableSuggestions.push(item);
						} else if (item.suggestion) {
							result.tableSuggestions.push(item.suggestion);
						}
					});
				}

				// 根据estimatedImprovement估算评分
				if (parsedData.estimatedImprovement) {
					const match = parsedData.estimatedImprovement.match(/(\d+)%/);
					if (match) {
						// 将提升百分比转换为评分 (提升越高，原SQL评分越低)
						const improvement = parseInt(match[1]);
						result.score = Math.max(0, Math.min(100, 100 - improvement));
					}
				}

				return result;
			}

			// 如果不是JSON格式,尝试解析文本格式
			const result: any = {
				score: 0,
				issues: [],
				suggestions: [],
				tableSuggestions: [],
				optimizedSQL: ''
			};

			// 提取评分
			const scoreMatch = content.match(/评分[：:]\s*(\d+)/);
			if (scoreMatch) {
				result.score = parseInt(scoreMatch[1]);
			}

			// 提取问题
			const issuesMatch = content.match(/问题[：:][\s\S]*?(?=建议|优化后的SQL|$)/);
			if (issuesMatch) {
				const issuesText = issuesMatch[0];
				const issuesList = issuesText.split('\n').filter(line =>
					line.trim().startsWith('-') || line.trim().startsWith('•') || /^\d+\./.test(line.trim())
				);
				result.issues = issuesList.map(item => item.replace(/^[-•\d.]\s*/, '').trim());
			}

			// 提取建议
			const suggestionsMatch = content.match(/建议[：:][\s\S]*?(?=表结构|索引|优化后的SQL|$)/);
			if (suggestionsMatch) {
				const suggestionsText = suggestionsMatch[0];
				const suggestionsList = suggestionsText.split('\n').filter(line =>
					line.trim().startsWith('-') || line.trim().startsWith('•') || /^\d+\./.test(line.trim())
				);
				result.suggestions = suggestionsList.map(item => item.replace(/^[-•\d.]\s*/, '').trim());
			}

			// 提取表结构/索引建议
			const tableSuggestionsMatch = content.match(/(表结构|索引).*?建议[：:][\s\S]*?(?=优化后的SQL|$)/);
			if (tableSuggestionsMatch) {
				const tableSuggestionsText = tableSuggestionsMatch[0];
				const tableSuggestionsList = tableSuggestionsText.split('\n').filter(line =>
					line.trim().startsWith('-') || line.trim().startsWith('•') || /^\d+\./.test(line.trim())
				);
				result.tableSuggestions = tableSuggestionsList.map(item => item.replace(/^[-•\d.]\s*/, '').trim());
			}

			// 提取优化后的SQL
			const sqlMatch = content.match(/```sql\s*\n([\s\S]*?)\n```/);
			if (sqlMatch) {
				result.optimizedSQL = sqlMatch[1].trim();
			}

			return result;

		} catch (error) {
			console.error('[SQLOptimizerView] 解析优化结果失败:', error);
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
		if (!this.optimizationResult) {
			return;
		}

		const resultSection = this.container.querySelector('.result-section') as HTMLElement;
		resultSection.style.display = 'block';

		// 清空结果区域
		while (this.resultArea.firstChild) {
			this.resultArea.removeChild(this.resultArea.firstChild);
		}

		// 如果有原始内容,直接显示
		if (this.optimizationResult.rawContent) {
			const rawContent = $('.raw-content');
			rawContent.textContent = this.optimizationResult.rawContent;
			this.resultArea.appendChild(rawContent);
			return;
		}

		// 显示评分
		if (this.optimizationResult.score !== undefined) {
			const scoreCard = $('.score-card');
			const scoreLabel = $('span.score-label');
			scoreLabel.textContent = localize('database.sqlOptimizer.score', '性能评分:');
			scoreCard.appendChild(scoreLabel);

			const scoreValue = $('span.score-value');
			scoreValue.textContent = `${this.optimizationResult.score} / 100`;
			if (this.optimizationResult.score >= 80) {
				scoreValue.classList.add('good');
			} else if (this.optimizationResult.score >= 60) {
				scoreValue.classList.add('medium');
			} else {
				scoreValue.classList.add('bad');
			}
			scoreCard.appendChild(scoreValue);
			this.resultArea.appendChild(scoreCard);
		}

		// 显示问题列表
		if (this.optimizationResult.issues && this.optimizationResult.issues.length > 0) {
			const issuesSection = $('.issues-section');
			const issuesTitle = $('h4');
			issuesTitle.textContent = localize('database.sqlOptimizer.issues', '发现的问题');
			issuesSection.appendChild(issuesTitle);

			const issuesList = $('ul.issues-list');
			this.optimizationResult.issues.forEach((issue: string) => {
				const li = $('li');
				li.textContent = issue;
				issuesList.appendChild(li);
			});
			issuesSection.appendChild(issuesList);
			this.resultArea.appendChild(issuesSection);
		}

		// 显示优化建议
		if (this.optimizationResult.suggestions && this.optimizationResult.suggestions.length > 0) {
			const suggestionsSection = $('.suggestions-section');
			const suggestionsTitle = $('h4');
			suggestionsTitle.textContent = localize('database.sqlOptimizer.suggestions', '优化建议');
			suggestionsSection.appendChild(suggestionsTitle);

			const suggestionsList = $('ul.suggestions-list');
			this.optimizationResult.suggestions.forEach((suggestion: string) => {
				const li = $('li');
				li.textContent = suggestion;
				suggestionsList.appendChild(li);
			});
			suggestionsSection.appendChild(suggestionsList);
			this.resultArea.appendChild(suggestionsSection);
		}

		// 显示表结构优化建议
		if (this.optimizationResult.tableSuggestions && this.optimizationResult.tableSuggestions.length > 0) {
			const tableSuggestionsSection = $('.table-suggestions-section');
			const tableSuggestionsTitle = $('h4');
			tableSuggestionsTitle.textContent = localize('database.sqlOptimizer.tableSuggestions', '表结构优化建议');
			tableSuggestionsSection.appendChild(tableSuggestionsTitle);

			const tableSuggestionsList = $('ul.table-suggestions-list');
			this.optimizationResult.tableSuggestions.forEach((suggestion: string) => {
				const li = $('li');
				li.textContent = suggestion;
				tableSuggestionsList.appendChild(li);
			});
			tableSuggestionsSection.appendChild(tableSuggestionsList);
			this.resultArea.appendChild(tableSuggestionsSection);
		}

		// 显示优化后的SQL
		if (this.optimizationResult.optimizedSQL) {
			const sqlSection = $('.optimized-sql-section');
			const sqlTitle = $('h4');
			sqlTitle.textContent = localize('database.sqlOptimizer.optimizedSQL', '优化后的SQL');
			sqlSection.appendChild(sqlTitle);

			const sqlTextarea = $<HTMLTextAreaElement>('textarea.optimized-sql');
			sqlTextarea.value = this.optimizationResult.optimizedSQL;
			sqlTextarea.readOnly = true;
			sqlTextarea.rows = Math.min(15, this.optimizationResult.optimizedSQL.split('\n').length + 1);
			sqlSection.appendChild(sqlTextarea);

			// 复制按钮
			const copyButton = $<HTMLButtonElement>('button.copy-sql-button');
			copyButton.textContent = localize('database.sqlOptimizer.copySql', '复制 SQL');
			this._register(addDisposableListener(copyButton, EventType.CLICK, () => {
				this.copySQL(this.optimizationResult.optimizedSQL);
			}));
			sqlSection.appendChild(copyButton);

			this.resultArea.appendChild(sqlSection);
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
						localize('database.sqlOptimizer.sqlCopied', 'SQL 已复制到剪贴板')
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
					localize('database.sqlOptimizer.sqlCopied', 'SQL 已复制到剪贴板')
				);
			} else {
				this.notificationService.error(
					localize('database.sqlOptimizer.copyFailed', '复制失败，请手动选择并复制')
				);
			}
		} catch (error) {
			this.notificationService.error(
				localize('database.sqlOptimizer.copyFailed', '复制失败，请手动选择并复制')
			);
		}
	}

	/**
	 * 隐藏结果
	 */
	private hideResults(): void {
		const resultSection = this.container.querySelector('.result-section') as HTMLElement;
		resultSection.style.display = 'none';
		this.optimizationResult = null;
	}

	override focus(): void {
		super.focus();
		this.sqlInput?.focus();
	}
}
