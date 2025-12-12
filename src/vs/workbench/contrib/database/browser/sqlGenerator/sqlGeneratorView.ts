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
 * SQL 生成器视图ID
 */
export const SQL_GENERATOR_VIEW_ID = 'workbench.view.database.sqlGenerator';

/**
 * SQL 生成器视图
 * 用于通过自然语言生成 SQL 查询语句
 */
export class SQLGeneratorView extends ViewPane {
	private container!: HTMLElement;
	private connectionSelect!: HTMLSelectElement;
	private schemaSelect!: HTMLSelectElement;
	private requirementInput!: HTMLTextAreaElement;
	private generateButton!: HTMLButtonElement;
	private executeButton!: HTMLButtonElement;
	private charCountElement!: HTMLSpanElement;
	private sqlResultArea!: HTMLElement;
	private queryResultArea!: HTMLElement;

	// 当前选择的连接和Schema
	private selectedConnectionId: string | null = null;
	private selectedSchema: string | null = null;

	// 生成的SQL
	private generatedSQL: string | null = null;
	private isGenerating: boolean = false;
	// @ts-expect-error - isExecuting is used in executeSQL method (false positive)
	private isExecuting: boolean = false;

	// 常量
	private readonly MAX_CHARS = 500;
	private readonly MIN_CHARS = 5;

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

		console.log('[SQLGeneratorView] Constructor called');
	}

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);
		this.container = container;
		this.container.classList.add('sql-generator-view');

		// 添加内联样式
		this.container.style.padding = '20px';
		this.container.style.height = '100%';
		this.container.style.overflowY = 'auto';

		// 创建主容器
		this.createInputSection();
		this.createResultSection();

		// 加载数据库连接
		this.loadConnections();

		console.log('[SQLGeneratorView] Body rendered');
	}

	/**
	 * 创建输入部分
	 */
	private createInputSection(): void {
		const section = $('.input-section');

		// 标题
		const header = $('.section-header');
		const title = $('h3');
		title.textContent = localize('database.sqlGenerator.title', 'SQL 生成器');
		header.appendChild(title);

		const subtitle = $('.subtitle');
		subtitle.textContent = localize(
			'database.sqlGenerator.subtitle',
			'使用自然语言描述您的查询需求,AI 将为您生成SQL语句'
		);
		header.appendChild(subtitle);
		section.appendChild(header);

		// 数据库选择
		const dbSelectArea = $('.db-select-area');

		// 连接选择
		const connectionLabel = $('label');
		connectionLabel.textContent = localize('database.sqlGenerator.connection', '数据库连接');
		dbSelectArea.appendChild(connectionLabel);

		this.connectionSelect = $<HTMLSelectElement>('select.connection-select');
		this._register(addDisposableListener(this.connectionSelect, EventType.CHANGE, () => {
			this.onConnectionChange();
		}));
		dbSelectArea.appendChild(this.connectionSelect);

		// Schema选择
		const schemaLabel = $('label');
		schemaLabel.textContent = localize('database.sqlGenerator.schema', '数据库');
		dbSelectArea.appendChild(schemaLabel);

		this.schemaSelect = $<HTMLSelectElement>('select.schema-select');
		this.schemaSelect.disabled = true;
		this._register(addDisposableListener(this.schemaSelect, EventType.CHANGE, () => {
			this.onSchemaChange();
		}));
		dbSelectArea.appendChild(this.schemaSelect);

		section.appendChild(dbSelectArea);

		// 需求输入区域
		const inputArea = $('.input-area');

		const inputLabel = $('label');
		inputLabel.textContent = localize('database.sqlGenerator.requirement', '查询需求');
		inputArea.appendChild(inputLabel);

		// 文本框
		this.requirementInput = $<HTMLTextAreaElement>('textarea.requirement-input');
		this.requirementInput.placeholder = localize(
			'database.sqlGenerator.placeholder',
			'例如: 查询销售额大于10000的所有订单'
		);
		this.requirementInput.rows = 6;
		this.requirementInput.maxLength = this.MAX_CHARS;
		inputArea.appendChild(this.requirementInput);

		// 字数统计
		const charCount = $('.char-count');
		this.charCountElement = $<HTMLSpanElement>('span.count');
		this.charCountElement.textContent = `0 / ${this.MAX_CHARS}`;
		charCount.appendChild(this.charCountElement);
		inputArea.appendChild(charCount);

		// 监听输入变化
		this._register(addDisposableListener(this.requirementInput, EventType.INPUT, () => {
			this.updateCharCount();
			this.updateButtonState();
		}));

		section.appendChild(inputArea);

		// 按钮区域
		const buttonArea = $('.button-area');

		// 生成按钮
		this.generateButton = $<HTMLButtonElement>('button.generate-button');
		this.generateButton.textContent = localize('database.sqlGenerator.generate', '生成 SQL');
		this.generateButton.disabled = true;
		this._register(addDisposableListener(this.generateButton, EventType.CLICK, () => {
			this.generateSQL();
		}));
		buttonArea.appendChild(this.generateButton);

		// 清空按钮
		const clearButton = $<HTMLButtonElement>('button.clear-button');
		clearButton.textContent = localize('database.sqlGenerator.clear', '清空');
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
		title.textContent = localize('database.sqlGenerator.result', '生成结果');
		header.appendChild(title);
		section.appendChild(header);

		// SQL展示区域
		this.sqlResultArea = $('.sql-result-area');
		section.appendChild(this.sqlResultArea);

		// 执行按钮
		this.executeButton = $<HTMLButtonElement>('button.execute-button');
		this.executeButton.textContent = localize('database.sqlGenerator.execute', '执行查询');
		this._register(addDisposableListener(this.executeButton, EventType.CLICK, () => {
			this.executeSQL();
		}));
		section.appendChild(this.executeButton);

		// 查询结果区域
		this.queryResultArea = $('.query-result-area');
		section.appendChild(this.queryResultArea);

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
			defaultOption.textContent = localize('database.sqlGenerator.selectConnection', '请选择数据库连接');
			this.connectionSelect.appendChild(defaultOption);

			// 添加连接选项
			connections.forEach(conn => {
				const option = $<HTMLOptionElement>('option');
				option.value = conn.id;
				option.textContent = `${conn.name} (${conn.host}:${conn.port})`;
				this.connectionSelect.appendChild(option);
			});

		} catch (error) {
			console.error('[SQLGeneratorView] Load connections error:', error);
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
			defaultOption.textContent = localize('database.sqlGenerator.selectSchema', '请选择数据库');
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
				localize('database.sqlGenerator.loadSchemaError', '加载数据库列表失败: {0}', String(error))
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
		const length = this.requirementInput.value.length;
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
		const length = this.requirementInput.value.trim().length;
		const hasConnection = !!this.selectedConnectionId;
		const hasSchema = !!this.selectedSchema;

		this.generateButton.disabled =
			!hasConnection ||
			!hasSchema ||
			length < this.MIN_CHARS ||
			length > this.MAX_CHARS ||
			this.isGenerating;
	}

	/**
	 * 清空输入
	 */
	private clearInput(): void {
		this.requirementInput.value = '';
		this.updateCharCount();
		this.updateButtonState();
		this.hideResults();
	}

	/**
	 * 生成SQL
	 */
	private async generateSQL(): Promise<void> {
		const requirement = this.requirementInput.value.trim();

		if (!this.selectedConnectionId || !this.selectedSchema) {
			this.notificationService.warn(
				localize('database.sqlGenerator.selectDbFirst', '请先选择数据库连接和数据库')
			);
			return;
		}

		if (requirement.length < this.MIN_CHARS) {
			this.notificationService.warn(
				localize('database.sqlGenerator.requirementTooShort', '查询需求至少需要 {0} 个字符', this.MIN_CHARS)
			);
			return;
		}

		// 设置生成状态
		this.isGenerating = true;
		this.generateButton.disabled = true;
		this.generateButton.textContent = localize('database.sqlGenerator.generating', '生成中...');

		try {
			console.log('[SQLGeneratorView] 开始生成SQL, requirement:', requirement);

			// 步骤1: 获取数据库表结构信息并构建schemaInfo
			const tables = await this.databaseService.getTables(this.selectedConnectionId, this.selectedSchema);
			console.log('[SQLGeneratorView] 获取到 {0} 个表', tables.length);

			// 获取所有表的列信息
			const tableSchemas: string[] = [];
			for (const table of tables) {
				const structure = await this.databaseService.getTableStructure(
					this.selectedConnectionId,
					this.selectedSchema,
					table.name
				);

				// 构建列定义字符串
				const columnDefs = structure.columns.map((col: any) => {
					let colDef = `  ${col.name} ${col.dataType}`;
					if (col.length) {
						colDef += `(${col.length}${col.scale ? `,${col.scale}` : ''})`;
					}
					if (!col.nullable) {
						colDef += ' NOT NULL';
					}
					if (col.isPrimaryKey) {
						colDef += ' PRIMARY KEY';
					}
					if (col.autoIncrement) {
						colDef += ' AUTO_INCREMENT';
					}
					if (col.comment) {
						colDef += ` COMMENT '${col.comment}'`;
					}
					return colDef;
				}).join(',\n');

				tableSchemas.push(`表名: ${table.name}${table.comment ? ` (${table.comment})` : ''}\n${columnDefs}`);
			}

			const schemaInfo = tableSchemas.join('\n\n');
			console.log('[SQLGeneratorView] 数据库结构信息长度:', schemaInfo.length, '表数量:', tables.length);

			// 步骤2: 调用后端接口渲染提示词模板
			console.log('[SQLGeneratorView] 步骤2: 渲染提示词模板');
			const renderedPrompt = await this.getRenderedPrompt(requirement, schemaInfo, this.selectedSchema);
			console.log('[SQLGeneratorView] 渲染后的提示词长度:', renderedPrompt.length);

			// 步骤3: 调用AI服务生成SQL
			console.log('[SQLGeneratorView] 步骤3: 调用AI服务生成SQL');
			const response = await this.aiService.completeWithUsage(renderedPrompt, {
				businessCode: 'IDE_DB_NL_TO_SQL',
				temperature: 0.15,
				maxTokens: 1000
			});

			console.log('[SQLGeneratorView] AI返回结果:', response);

			// 提取SQL
			let sql = response.content.trim();

			// 去除markdown代码块标记
			const codeBlockMatch = sql.match(/```(?:sql)?\s*\n([\s\S]*?)```/);
			if (codeBlockMatch) {
				sql = codeBlockMatch[1].trim();
			}
			sql = sql.replace(/```/g, '').trim();

			// 去除多余的空行
			sql = sql.replace(/\n\n+/g, '\n');

			this.generatedSQL = sql;
			this.showResults();

			this.notificationService.info(
				localize('database.sqlGenerator.generateSuccess', 'SQL 生成成功')
			);

		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			this.notificationService.error(
				localize('database.sqlGenerator.generateError', '生成失败: {0}', errorMessage)
			);
			console.error('[SQLGeneratorView] Generate error:', error);
		} finally {
			// 恢复按钮状态
			this.isGenerating = false;
			this.generateButton.disabled = false;
			this.generateButton.textContent = localize('database.sqlGenerator.generate', '生成 SQL');
		}
	}

	/**
	 * 获取渲染后的提示词
	 * 调用后端接口,将提示词模板中的变量替换为实际值
	 */
	private async getRenderedPrompt(requirement: string, schemaInfo: string, databaseName: string): Promise<string> {
		try {
			console.log('[SQLGeneratorView] 调用提示词渲染接口, requirement:', requirement.substring(0, 50) + '...');

			const response = await fetch('http://127.0.0.1:8088/system/ai/prompt/render', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({
					promptKey: 'IDE_DB_NL_TO_SQL',
					variables: {
						requirement: requirement,
						schemaInfo: schemaInfo,
						databaseName: databaseName
					}
				})
			});

			console.log('[SQLGeneratorView] HTTP 状态码:', response.status);

			if (!response.ok) {
				const errorText = await response.text();
				console.error('[SQLGeneratorView] HTTP 错误响应:', errorText);
				throw new Error(`获取提示词失败: HTTP ${response.status}`);
			}

			const result = await response.json();
			console.log('[SQLGeneratorView] 响应结构:', {
				code: result.code,
				hasMsg: !!result.msg,
				msgLength: typeof result.msg === 'string' ? result.msg.length : 0,
				hasData: !!result.data,
				dataLength: typeof result.data === 'string' ? result.data.length : 0
			});

			if (result.code !== 200) {
				console.error('[SQLGeneratorView] 业务错误:', result.msg);
				throw new Error(`获取提示词失败: ${result.msg}`);
			}

			// 渲染后的提示词在 msg 字段中（而不是 data 字段）
			if (!result.msg) {
				console.error('[SQLGeneratorView] 返回数据为空');
				throw new Error('获取提示词失败: 返回数据为空');
			}

			console.log('[SQLGeneratorView] 成功获取渲染后的提示词, 长度:', result.msg.length);
			return result.msg;

		} catch (error) {
			console.error('[SQLGeneratorView] 获取提示词失败:', error);
			throw error;
		}
	}

	/**
	 * 显示结果
	 */
	private showResults(): void {
		if (!this.generatedSQL) {
			return;
		}

		const resultSection = this.container.querySelector('.result-section') as HTMLElement;
		resultSection.style.display = 'block';

		// 清空SQL结果区域
		while (this.sqlResultArea.firstChild) {
			this.sqlResultArea.removeChild(this.sqlResultArea.firstChild);
		}

		// 显示生成的SQL - 使用textarea以便用户可以选择文本
		const sqlTextarea = $<HTMLTextAreaElement>('textarea.sql-code');
		sqlTextarea.value = this.generatedSQL;
		sqlTextarea.readOnly = true;
		sqlTextarea.rows = Math.min(15, this.generatedSQL.split('\n').length + 1);
		this.sqlResultArea.appendChild(sqlTextarea);

		// 复制按钮
		const copyButton = $<HTMLButtonElement>('button.copy-sql-button');
		copyButton.textContent = localize('database.sqlGenerator.copySql', '复制 SQL');
		this._register(addDisposableListener(copyButton, EventType.CLICK, () => {
			this.copySQL();
		}));
		this.sqlResultArea.appendChild(copyButton);
	}

	/**
	 * 复制SQL到剪贴板
	 */
	private copySQL(): void {
		if (!this.generatedSQL) {
			return;
		}

		try {
			// 方法1: 尝试使用现代的 Clipboard API
			if (navigator.clipboard && navigator.clipboard.writeText) {
				navigator.clipboard.writeText(this.generatedSQL).then(() => {
					this.notificationService.info(
						localize('database.sqlGenerator.sqlCopied', 'SQL 已复制到剪贴板')
					);
				}).catch(err => {
					console.error('[SQLGeneratorView] Clipboard API failed:', err);
					// 如果失败，使用备用方法
					this.copyUsingExecCommand();
				});
			} else {
				// 如果不支持 Clipboard API，使用备用方法
				this.copyUsingExecCommand();
			}
		} catch (error) {
			console.error('[SQLGeneratorView] Copy failed:', error);
			this.copyUsingExecCommand();
		}
	}

	/**
	 * 使用 execCommand 备用方法复制
	 */
	private copyUsingExecCommand(): void {
		try {
			// 创建临时textarea
			const textarea = document.createElement('textarea');
			textarea.value = this.generatedSQL || '';
			textarea.style.position = 'fixed';
			textarea.style.opacity = '0';
			document.body.appendChild(textarea);

			// 选择并复制
			textarea.select();
			textarea.setSelectionRange(0, textarea.value.length);

			const successful = document.execCommand('copy');
			document.body.removeChild(textarea);

			if (successful) {
				this.notificationService.info(
					localize('database.sqlGenerator.sqlCopied', 'SQL 已复制到剪贴板')
				);
			} else {
				this.notificationService.error(
					localize('database.sqlGenerator.copyFailed', '复制失败，请手动选择并复制')
				);
			}
		} catch (error) {
			console.error('[SQLGeneratorView] execCommand copy failed:', error);
			this.notificationService.error(
				localize('database.sqlGenerator.copyFailed', '复制失败，请手动选择并复制')
			);
		}
	}

	/**
	 * 隐藏结果
	 */
	private hideResults(): void {
		const resultSection = this.container.querySelector('.result-section') as HTMLElement;
		resultSection.style.display = 'none';
		this.generatedSQL = null;

		// 清空查询结果
		while (this.queryResultArea.firstChild) {
			this.queryResultArea.removeChild(this.queryResultArea.firstChild);
		}
	}

	/**
	 * 执行SQL
	 */
	private async executeSQL(): Promise<void> {
		if (!this.generatedSQL || !this.selectedConnectionId || !this.selectedSchema) {
			return;
		}

		this.isExecuting = true;
		this.executeButton.disabled = true;
		this.executeButton.textContent = localize('database.sqlGenerator.executing', '执行中...');

		try {
			console.log('[SQLGeneratorView] 执行SQL:', this.generatedSQL);

			// 先切换到目标数据库
			await this.databaseService.executeQuery(this.selectedConnectionId, `USE \`${this.selectedSchema}\``);

			// 再执行生成的SQL查询
			const result = await this.databaseService.executeQuery(this.selectedConnectionId, this.generatedSQL);

			console.log('[SQLGeneratorView] 原始查询结果:', result);
			console.log('[SQLGeneratorView] 结果是否为数组:', Array.isArray(result));
			console.log('[SQLGeneratorView] 结果长度:', result?.length);

			// MySQL2返回的结果是 [rows, fields]，我们只需要第一个元素（实际数据行）
			let rows = result;
			if (Array.isArray(result) && result.length === 2 && Array.isArray(result[0])) {
				rows = result[0];
				console.log('[SQLGeneratorView] 提取实际数据行，行数:', rows.length);
			}

			// 显示查询结果
			this.showQueryResults(rows);

			this.notificationService.info(
				localize('database.sqlGenerator.executeSuccess', '查询执行成功,返回 {0} 行记录', rows.length)
			);

		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			this.notificationService.error(
				localize('database.sqlGenerator.executeError', '执行失败: {0}', errorMessage)
			);
			console.error('[SQLGeneratorView] Execute error:', error);
		} finally {
			this.isExecuting = false;
			this.executeButton.disabled = false;
			this.executeButton.textContent = localize('database.sqlGenerator.execute', '执行查询');
		}
	}

	/**
	 * 显示查询结果
	 */
	private showQueryResults(rows: any[]): void {
		// 清空查询结果区域
		while (this.queryResultArea.firstChild) {
			this.queryResultArea.removeChild(this.queryResultArea.firstChild);
		}

		console.log('[SQLGeneratorView] 查询结果:', rows);
		console.log('[SQLGeneratorView] 结果数量:', rows.length);
		if (rows.length > 0) {
			console.log('[SQLGeneratorView] 第一行数据:', rows[0]);
			console.log('[SQLGeneratorView] 第一行数据类型:', typeof rows[0]);
		}

		if (rows.length === 0) {
			const emptyMessage = $('div.empty-message');
			emptyMessage.textContent = localize('database.sqlGenerator.noResults', '查询未返回任何记录');
			this.queryResultArea.appendChild(emptyMessage);
			return;
		}

		// 创建表格
		const table = $('table.results-table');
		const thead = $('thead');
		const headerRow = $('tr');

		// 表头
		const columns = Object.keys(rows[0]);
		console.log('[SQLGeneratorView] 列名:', columns);
		columns.forEach(col => {
			const th = $('th');
			th.textContent = col;
			headerRow.appendChild(th);
		});
		thead.appendChild(headerRow);
		table.appendChild(thead);

		// 表体
		const tbody = $('tbody');
		rows.slice(0, 100).forEach((row, rowIndex) => {  // 只显示前100行
			const tr = $('tr');
			columns.forEach(col => {
				const td = $('td');
				const value = row[col];
				console.log(`[SQLGeneratorView] 行${rowIndex} 列${col} 值:`, value, '类型:', typeof value);

				// 处理不同类型的值
				if (value === null || value === undefined) {
					td.textContent = 'NULL';
				} else if (typeof value === 'object') {
					// 如果是对象,尝试JSON序列化
					try {
						td.textContent = JSON.stringify(value);
					} catch {
						td.textContent = String(value);
					}
				} else {
					td.textContent = String(value);
				}

				tr.appendChild(td);
			});
			tbody.appendChild(tr);
		});
		table.appendChild(tbody);

		this.queryResultArea.appendChild(table);

		// 如果结果超过100行,显示提示
		if (rows.length > 100) {
			const moreMessage = $('div.more-message');
			moreMessage.textContent = localize(
				'database.sqlGenerator.moreResults',
				'还有 {0} 行未显示...',
				rows.length - 100
			);
			this.queryResultArea.appendChild(moreMessage);
		}
	}

	override focus(): void {
		super.focus();
		this.requirementInput?.focus();
	}
}
