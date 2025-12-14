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
import { IQuickInputService, IQuickPickItem } from '../../../../../platform/quickinput/common/quickInput.js';
import { IDialogService } from '../../../../../platform/dialogs/common/dialogs.js';
import { IStorageService, StorageScope } from '../../../../../platform/storage/common/storage.js';
import { IDatabaseConnectionConfig } from '../../common/databaseConnection.js';
import { localize } from '../../../../../nls.js';
import { ITableStructure, IColumnDefinition, ColumnDataType, IndexType } from '../../common/databaseMetadata.js';
import { IDesignRulesService } from '../../common/designRulesService.js';
import { $, addDisposableListener, EventType } from '../../../../../base/browser/dom.js';

/**
 * 表结构设计器视图ID
 */
export const TABLE_DESIGNER_VIEW_ID = 'workbench.view.database.tableDesigner';

/**
 * 表结构设计器视图
 * 用于通过自然语言描述生成表结构
 */
export class TableDesignerView extends ViewPane {
	private container!: HTMLElement;
	private requirementInput!: HTMLTextAreaElement;
	private generateButton!: HTMLButtonElement;
	private clearButton!: HTMLButtonElement;
	private charCountElement!: HTMLSpanElement;
	private resultContainer!: HTMLElement;
	private tableStructureArea!: HTMLElement;
	private sqlPreviewArea!: HTMLElement;
	private applyButton!: HTMLButtonElement;

	// 生成的表结构
	private generatedTable: ITableStructure | null = null;
	private isGenerating: boolean = false;

	// 常量
	private readonly MAX_CHARS = 2000;
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
		@IQuickInputService private readonly quickInputService: IQuickInputService,
		@IDialogService private readonly dialogService: IDialogService,
		@IStorageService private readonly storageService: IStorageService,
		@IDesignRulesService private readonly designRulesService: IDesignRulesService
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

		console.log('[TableDesignerView] Constructor called');
	}

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);
		this.container = container;
		this.container.classList.add('table-designer-view');

		// 添加内联样式
		this.container.style.padding = '20px';
		this.container.style.height = '100%';
		this.container.style.overflowY = 'auto';

		// 创建主容器
		this.createRequirementSection();
		this.createResultSection();

		console.log('[TableDesignerView] Body rendered');
	}

	/**
	 * 创建需求描述部分
	 */
	private createRequirementSection(): void {
		const section = $('.requirement-section');

		// 标题
		const header = $('.section-header');
		const title = $('h3');
		title.textContent = localize('database.tableDesigner.requirementTitle', '需求描述');
		header.appendChild(title);

		const subtitle = $('.subtitle');
		subtitle.textContent = localize(
			'database.tableDesigner.requirementSubtitle',
			'描述您想要创建的表结构，AI 将为您生成完整的设计方案'
		);
		header.appendChild(subtitle);

		section.appendChild(header);

		// 输入区域
		const inputArea = $('.input-area');

		// 文本框
		this.requirementInput = $<HTMLTextAreaElement>('textarea');
		this.requirementInput.placeholder = localize(
			'database.tableDesigner.placeholder',
			'例如: 创建一个用户表，包含用户名、邮箱、密码、注册时间等字段...'
		);
		this.requirementInput.rows = 8;
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
			this.updateGenerateButtonState();
		}));

		section.appendChild(inputArea);

		// 按钮区域
		const buttonArea = $('.button-area');

		// 生成按钮
		this.generateButton = $<HTMLButtonElement>('button.generate-button');
		this.generateButton.textContent = localize('database.tableDesigner.generate', '生成表结构');
		this.generateButton.disabled = true;
		this._register(addDisposableListener(this.generateButton, EventType.CLICK, () => {
			this.generateTableStructure();
		}));
		buttonArea.appendChild(this.generateButton);

		// 清空按钮
		this.clearButton = $<HTMLButtonElement>('button.clear-button');
		this.clearButton.textContent = localize('database.tableDesigner.clear', '清空');
		this._register(addDisposableListener(this.clearButton, EventType.CLICK, () => {
			this.clearInput();
		}));
		buttonArea.appendChild(this.clearButton);

		section.appendChild(buttonArea);

		this.container.appendChild(section);
	}

	/**
	 * 创建结果展示部分
	 */
	private createResultSection(): void {
		this.resultContainer = $('.result-section');
		this.resultContainer.style.display = 'none'; // 初始隐藏

		// 标题
		const header = $('.section-header');
		const title = $('h3');
		title.textContent = localize('database.tableDesigner.resultTitle', '生成结果');
		header.appendChild(title);
		this.resultContainer.appendChild(header);

		// Tab 容器
		const tabContainer = $('.tab-container');

		// Tab 按钮
		const tabButtons = $('.tab-buttons');
		const structureTab = $<HTMLButtonElement>('button.tab-button.active');
		structureTab.textContent = localize('database.tableDesigner.tableStructure', '表结构');
		structureTab.dataset['tab'] = 'structure';
		tabButtons.appendChild(structureTab);

		const sqlTab = $<HTMLButtonElement>('button.tab-button');
		sqlTab.textContent = localize('database.tableDesigner.sqlPreview', 'SQL 预览');
		sqlTab.dataset['tab'] = 'sql';
		tabButtons.appendChild(sqlTab);

		tabContainer.appendChild(tabButtons);

		// Tab 内容
		const tabContent = $('.tab-content');

		// 表结构展示区域
		this.tableStructureArea = $('.tab-pane.active');
		this.tableStructureArea.dataset['tab'] = 'structure';
		tabContent.appendChild(this.tableStructureArea);

		// SQL 预览区域
		this.sqlPreviewArea = $('.tab-pane');
		this.sqlPreviewArea.dataset['tab'] = 'sql';
		tabContent.appendChild(this.sqlPreviewArea);

		tabContainer.appendChild(tabContent);
		this.resultContainer.appendChild(tabContainer);

		// 操作按钮区域
		const actionArea = $('.action-area');

		// 应用到数据库按钮
		this.applyButton = $<HTMLButtonElement>('button.apply-button');
		this.applyButton.textContent = localize('database.tableDesigner.applyToDatabase', '应用到数据库');
		this.applyButton.disabled = true;
		this._register(addDisposableListener(this.applyButton, EventType.CLICK, () => {
			this.applyToDatabase();
		}));
		actionArea.appendChild(this.applyButton);

		this.resultContainer.appendChild(actionArea);

		// Tab 切换事件
		this._register(addDisposableListener(structureTab, EventType.CLICK, () => {
			this.switchTab('structure');
		}));

		this._register(addDisposableListener(sqlTab, EventType.CLICK, () => {
			this.switchTab('sql');
		}));

		this.container.appendChild(this.resultContainer);
	}

	/**
	 * 更新字数统计
	 */
	private updateCharCount(): void {
		const length = this.requirementInput.value.length;
		this.charCountElement.textContent = `${length} / ${this.MAX_CHARS}`;

		// 超出限制时变红
		if (length > this.MAX_CHARS) {
			this.charCountElement.classList.add('error');
		} else {
			this.charCountElement.classList.remove('error');
		}
	}

	/**
	 * 更新生成按钮状态
	 */
	private updateGenerateButtonState(): void {
		const length = this.requirementInput.value.trim().length;
		this.generateButton.disabled = length < this.MIN_CHARS || length > this.MAX_CHARS || this.isGenerating;
	}

	/**
	 * 清空输入
	 */
	private clearInput(): void {
		this.requirementInput.value = '';
		this.updateCharCount();
		this.updateGenerateButtonState();
		this.hideResults();
	}

	/**
	 * 生成表结构
	 */
	private async generateTableStructure(): Promise<void> {
		const requirement = this.requirementInput.value.trim();

		if (requirement.length < this.MIN_CHARS) {
			this.notificationService.warn(
				localize('database.tableDesigner.requirementTooShort', '需求描述至少需要 {0} 个字符', this.MIN_CHARS)
			);
			return;
		}

		// 设置生成状态
		this.isGenerating = true;
		this.generateButton.disabled = true;
		this.generateButton.textContent = localize('database.tableDesigner.generating', '生成中...');

		try {
			console.log('[TableDesignerView] 开始生成表结构');

			// 步骤1: 调用提示词渲染接口，获取完整的提示词
			console.log('[TableDesignerView] 步骤1: 获取渲染后的提示词');
			const renderedPrompt = await this.getRenderedPrompt(requirement);
			console.log('[TableDesignerView] 渲染后的提示词长度:', renderedPrompt.length);

			// 步骤2: 调用 AI 代理接口
			console.log('[TableDesignerView] 步骤2: 调用 AI 服务');
			const response = await this.aiService.completeWithUsage(renderedPrompt, {
				businessCode: 'IDE_DB_TABLE_DESIGN',
				temperature: 0.15,
				maxTokens: 2000
			});

			console.log('[TableDesignerView] AI 响应:', response);

			// 解析 JSON 响应
			const tableStructure = this.parseTableStructureResponse(response.content);

			// 验证表结构
			this.validateTableStructure(tableStructure);

			// 保存生成的表结构
			this.generatedTable = tableStructure;

			this.notificationService.info(
				localize('database.tableDesigner.generateSuccess', '表结构生成成功')
			);

			// 显示结果
			this.showResults();
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			this.notificationService.error(
				localize('database.tableDesigner.generateError', '生成失败: {0}', errorMessage)
			);
			console.error('[TableDesignerView] Generate error:', error);
		} finally {
			// 恢复按钮状态
			this.isGenerating = false;
			this.generateButton.disabled = false;
			this.generateButton.textContent = localize('database.tableDesigner.generate', '生成表结构');
		}
	}

	/**
	 * 获取渲染后的提示词
	 */
	private async getRenderedPrompt(requirement: string): Promise<string> {
		try {
			console.log('[TableDesignerView] 调用提示词渲染接口, requirement:', requirement.substring(0, 50) + '...');

			const response = await fetch('http://127.0.0.1:8088/system/ai/prompt/render', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({
					promptKey: 'IDE_DB_TABLE_DESIGN',
					variables: {
						requirement: requirement
					}
				})
			});

			console.log('[TableDesignerView] HTTP 状态码:', response.status);

			if (!response.ok) {
				const errorText = await response.text();
				console.error('[TableDesignerView] HTTP 错误响应:', errorText);
				throw new Error(`获取提示词失败: HTTP ${response.status}`);
			}

			const result = await response.json();
			console.log('[TableDesignerView] 响应结构:', {
				code: result.code,
				hasMsg: !!result.msg,
				msgLength: typeof result.msg === 'string' ? result.msg.length : 0,
				hasData: !!result.data,
				dataType: typeof result.data
			});

			// 根据后端实际返回的格式解析
			// 发现后端 R.ok(rendered) 把提示词放在了 msg 字段，而不是 data 字段
			if (result.code === 200) {
				// 优先使用 data 字段，如果没有则使用 msg 字段
				const promptContent = result.data || result.msg;
				if (!promptContent) {
					throw new Error('提示词数据为空');
				}
				console.log('[TableDesignerView] 成功获取提示词, 长度:', promptContent.length);
				return promptContent;
			} else {
				throw new Error(result.msg || '获取提示词失败');
			}
		} catch (error) {
			console.error('[TableDesignerView] 获取提示词异常:', error);
			throw new Error(`获取提示词失败: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	/**
	 * 解析 AI 返回的表结构 JSON
	 */
	private parseTableStructureResponse(content: string): ITableStructure {
		try {
			// 移除可能的 markdown 代码块标记
			let jsonStr = content.trim();
			if (jsonStr.startsWith('```json')) {
				jsonStr = jsonStr.substring(7);
			} else if (jsonStr.startsWith('```')) {
				jsonStr = jsonStr.substring(3);
			}
			if (jsonStr.endsWith('```')) {
				jsonStr = jsonStr.substring(0, jsonStr.length - 3);
			}
			jsonStr = jsonStr.trim();

			console.log('[TableDesignerView] 解析 JSON:', jsonStr.substring(0, 200));

			// 解析 JSON
			const data = JSON.parse(jsonStr);

			// 转换数据类型
			const tableStructure: ITableStructure = {
				name: data.tableName,
				comment: data.comment,
				columns: data.columns.map((col: any) => {
					const column: IColumnDefinition = {
						name: col.name,
						dataType: this.parseDataType(col.dataType),
						nullable: col.nullable,
						comment: col.comment,
						length: col.length,
						defaultValue: col.defaultValue,
						isPrimaryKey: col.isPrimaryKey || false,
						autoIncrement: col.autoIncrement || false,
						isUnique: col.isUnique || false
					};
					return column;
				}),
				indexes: data.indexes?.map((idx: any) => ({
					name: idx.name,
					type: this.parseIndexType(idx.type),
					columns: idx.columns
				})) || [],
				foreignKeys: []
			};

			return tableStructure;
		} catch (error) {
			console.error('[TableDesignerView] JSON 解析失败:', error);
			throw new Error(`JSON 解析失败: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	/**
	 * 解析数据类型字符串
	 */
	private parseDataType(typeStr: string): ColumnDataType {
		const upperType = typeStr.toUpperCase();
		// 检查是否是有效的枚举值
		if (Object.values(ColumnDataType).includes(upperType as ColumnDataType)) {
			return upperType as ColumnDataType;
		}
		console.warn('[TableDesignerView] 未知的数据类型:', typeStr, '使用 VARCHAR');
		return ColumnDataType.VARCHAR;
	}

	/**
	 * 解析索引类型字符串
	 */
	private parseIndexType(typeStr: string): IndexType {
		const upperType = typeStr.toUpperCase();
		// 检查是否是有效的枚举值
		if (Object.values(IndexType).includes(upperType as IndexType)) {
			return upperType as IndexType;
		}
		console.warn('[TableDesignerView] 未知的索引类型:', typeStr, '使用 INDEX');
		return IndexType.INDEX;
	}

	/**
	 * 验证表结构
	 */
	private validateTableStructure(table: ITableStructure): void {
		// 验证表名
		if (!table.name || table.name.trim().length === 0) {
			throw new Error('表名不能为空');
		}

		// 验证至少有一个字段
		if (!table.columns || table.columns.length === 0) {
			throw new Error('表至少需要一个字段');
		}

		// 验证主键
		const primaryKeys = table.columns.filter(c => c.isPrimaryKey);
		if (primaryKeys.length === 0) {
			console.warn('[TableDesignerView] 警告: 表没有主键');
		}

		// 验证字段名唯一性
		const columnNames = new Set<string>();
		for (const column of table.columns) {
			if (!column.name || column.name.trim().length === 0) {
				throw new Error('字段名不能为空');
			}
			if (columnNames.has(column.name)) {
				throw new Error(`重复的字段名: ${column.name}`);
			}
			columnNames.add(column.name);
		}

		// 验证索引
		if (table.indexes) {
			for (const index of table.indexes) {
				if (!index.name || index.name.trim().length === 0) {
					throw new Error('索引名不能为空');
				}
				if (!index.columns || index.columns.length === 0) {
					throw new Error(`索引 ${index.name} 至少需要一个字段`);
				}
				// 检查索引字段是否存在
				for (const colName of index.columns) {
					if (!columnNames.has(colName)) {
						throw new Error(`索引 ${index.name} 引用了不存在的字段: ${colName}`);
					}
				}
			}
		}

		console.log('[TableDesignerView] 表结构验证通过');
	}

	/**
	 * 显示结果
	 */
	private showResults(): void {
		if (!this.generatedTable) {
			return;
		}

		// 显示结果容器
		this.resultContainer.style.display = 'block';

		// 渲染表结构
		this.renderTableStructure();

		// 渲染 SQL 预览
		this.renderSQLPreview();

		// 启用应用按钮
		this.applyButton.disabled = false;
	}

	/**
	 * 隐藏结果
	 */
	private hideResults(): void {
		this.resultContainer.style.display = 'none';
		this.generatedTable = null;
		this.applyButton.disabled = true;
	}

	/**
	 * 渲染表结构
	 */
	private renderTableStructure(): void {
		if (!this.generatedTable) {
			return;
		}

		// 清空内容
		while (this.tableStructureArea.firstChild) {
			this.tableStructureArea.removeChild(this.tableStructureArea.firstChild);
		}

		// 表基本信息 - 可编辑
		const tableInfo = $('.table-info');

		// 表名编辑
		const tableName = $('div.table-name');
		const nameLabel = $('strong');
		nameLabel.textContent = localize('database.tableDesigner.tableName', '表名') + ': ';
		tableName.appendChild(nameLabel);

		const tableNameInput = $<HTMLInputElement>('input.table-name-input');
		tableNameInput.type = 'text';
		tableNameInput.value = this.generatedTable.name;
		tableNameInput.placeholder = localize('database.tableDesigner.tableNamePlaceholder', '请输入表名');
		this._register(addDisposableListener(tableNameInput, EventType.INPUT, () => {
			if (this.generatedTable) {
				this.generatedTable.name = tableNameInput.value;
				this.renderSQLPreview(); // 更新 SQL 预览
			}
		}));
		tableName.appendChild(tableNameInput);
		tableInfo.appendChild(tableName);

		// 表注释编辑
		const tableComment = $('div.table-comment');
		const commentLabel = $('strong');
		commentLabel.textContent = localize('database.tableDesigner.tableComment', '说明') + ': ';
		tableComment.appendChild(commentLabel);

		const tableCommentInput = $<HTMLInputElement>('input.table-comment-input');
		tableCommentInput.type = 'text';
		tableCommentInput.value = this.generatedTable.comment || '';
		tableCommentInput.placeholder = localize('database.tableDesigner.tableCommentPlaceholder', '请输入表说明');
		this._register(addDisposableListener(tableCommentInput, EventType.INPUT, () => {
			if (this.generatedTable) {
				this.generatedTable.comment = tableCommentInput.value;
				this.renderSQLPreview(); // 更新 SQL 预览
			}
		}));
		tableComment.appendChild(tableCommentInput);
		tableInfo.appendChild(tableComment);

		this.tableStructureArea.appendChild(tableInfo);

		// 字段列表标题和添加按钮
		const columnsTitleRow = $('div.columns-title-row');
		const columnsTitle = $('h4');
		columnsTitle.textContent = localize('database.tableDesigner.columns', '字段列表');
		columnsTitleRow.appendChild(columnsTitle);

		const addColumnButton = $<HTMLButtonElement>('button.add-column-button');
		addColumnButton.textContent = localize('database.tableDesigner.addColumn', '+ 添加字段');
		this._register(addDisposableListener(addColumnButton, EventType.CLICK, () => {
			this.addNewColumn();
		}));
		columnsTitleRow.appendChild(addColumnButton);

		this.tableStructureArea.appendChild(columnsTitleRow);

		// 创建表格包装器支持横向滚动
		const tableWrapper = $('.table-wrapper');
		const columnsTable = $('table.columns-table');
		const thead = $('thead');
		const headerRow = $('tr');

		const headers = [
			localize('database.tableDesigner.columnName', '字段名'),
			localize('database.tableDesigner.dataType', '类型'),
			localize('database.tableDesigner.nullable', '允许空'),
			localize('database.tableDesigner.default', '默认值'),
			localize('database.tableDesigner.comment', '说明'),
			localize('database.tableDesigner.actions', '操作')
		];

		headers.forEach(text => {
			const th = $('th');
			th.textContent = text;
			headerRow.appendChild(th);
		});
		thead.appendChild(headerRow);
		columnsTable.appendChild(thead);

		const tbody = $('tbody');
		this.generatedTable.columns.forEach((column, index) => {
			const tr = $('tr');
			tr.dataset['columnIndex'] = String(index);

			// 字段名列 - 可编辑输入框
			const nameTd = $('td.editable-cell');
			const nameInput = $<HTMLInputElement>('input.column-name-input');
			nameInput.type = 'text';
			nameInput.value = column.name;
			nameInput.placeholder = localize('database.tableDesigner.columnNamePlaceholder', '字段名');
			this._register(addDisposableListener(nameInput, EventType.INPUT, () => {
				if (this.generatedTable) {
					this.generatedTable.columns[index].name = nameInput.value;
					this.renderSQLPreview();
				}
			}));
			nameTd.appendChild(nameInput);
			tr.appendChild(nameTd);

			// 类型列 - 下拉选择 + 长度输入
			const typeTd = $('td.editable-cell');
			const typeContainer = $('div.type-container');

			const typeSelect = $<HTMLSelectElement>('select.column-type-select');
			Object.values(ColumnDataType).forEach(type => {
				const option = $<HTMLOptionElement>('option');
				option.value = type;
				option.textContent = type;
				if (type === column.dataType) {
					option.selected = true;
				}
				typeSelect.appendChild(option);
			});
			this._register(addDisposableListener(typeSelect, EventType.CHANGE, () => {
				if (this.generatedTable) {
					this.generatedTable.columns[index].dataType = typeSelect.value as ColumnDataType;
					this.renderSQLPreview();
				}
			}));
			typeContainer.appendChild(typeSelect);

			// 长度输入框（仅对需要长度的类型显示）
			const needsLength = ['VARCHAR', 'CHAR', 'DECIMAL'].includes(column.dataType);
			if (needsLength) {
				const lengthInput = $<HTMLInputElement>('input.column-length-input');
				lengthInput.type = 'number';
				lengthInput.value = String(column.length || '');
				lengthInput.placeholder = '长度';
				this._register(addDisposableListener(lengthInput, EventType.INPUT, () => {
					if (this.generatedTable) {
						this.generatedTable.columns[index].length = parseInt(lengthInput.value) || undefined;
						this.renderSQLPreview();
					}
				}));
				typeContainer.appendChild(lengthInput);
			}

			typeTd.appendChild(typeContainer);
			tr.appendChild(typeTd);

			// 允许空列 - 复选框
			const nullableTd = $('td.editable-cell');
			const nullableCheckbox = $<HTMLInputElement>('input.column-nullable-checkbox');
			nullableCheckbox.type = 'checkbox';
			nullableCheckbox.checked = column.nullable;
			this._register(addDisposableListener(nullableCheckbox, EventType.CHANGE, () => {
				if (this.generatedTable) {
					this.generatedTable.columns[index].nullable = nullableCheckbox.checked;
					this.renderSQLPreview();
				}
			}));
			nullableTd.appendChild(nullableCheckbox);
			tr.appendChild(nullableTd);

			// 默认值列 - 可编辑输入框
			const defaultTd = $('td.editable-cell');
			const defaultInput = $<HTMLInputElement>('input.column-default-input');
			defaultInput.type = 'text';
			defaultInput.value = column.defaultValue || '';
			defaultInput.placeholder = localize('database.tableDesigner.defaultValuePlaceholder', '默认值');
			this._register(addDisposableListener(defaultInput, EventType.INPUT, () => {
				if (this.generatedTable) {
					this.generatedTable.columns[index].defaultValue = defaultInput.value || undefined;
					this.renderSQLPreview();
				}
			}));
			defaultTd.appendChild(defaultInput);
			tr.appendChild(defaultTd);

			// 说明列 - 可编辑输入框
			const commentTd = $('td.editable-cell');
			const commentInput = $<HTMLInputElement>('input.column-comment-input');
			commentInput.type = 'text';
			commentInput.value = column.comment || '';
			commentInput.placeholder = localize('database.tableDesigner.commentPlaceholder', '说明');
			this._register(addDisposableListener(commentInput, EventType.INPUT, () => {
				if (this.generatedTable) {
					this.generatedTable.columns[index].comment = commentInput.value || undefined;
					this.renderSQLPreview();
				}
			}));
			commentTd.appendChild(commentInput);
			tr.appendChild(commentTd);

			// 操作列
			const actionsTd = $('td.actions-cell');
			const deleteButton = $<HTMLButtonElement>('button.delete-column-button');
			deleteButton.textContent = localize('database.tableDesigner.delete', '删除');
			this._register(addDisposableListener(deleteButton, EventType.CLICK, () => {
				this.deleteColumn(index);
			}));
			actionsTd.appendChild(deleteButton);
			tr.appendChild(actionsTd);

			tbody.appendChild(tr);
		});
		columnsTable.appendChild(tbody);
		tableWrapper.appendChild(columnsTable);
		this.tableStructureArea.appendChild(tableWrapper);

		// 索引列表
		if (this.generatedTable.indexes && this.generatedTable.indexes.length > 0) {
			const indexesTitle = $('h4');
			indexesTitle.textContent = localize('database.tableDesigner.indexes', '索引');
			this.tableStructureArea.appendChild(indexesTitle);

			const indexesList = $('ul.indexes-list');
			this.generatedTable.indexes.forEach(index => {
				const li = $('li');
				li.textContent = `${index.name} (${index.columns.join(', ')})${index.type === IndexType.UNIQUE ? ' [唯一]' : ''}`;
				indexesList.appendChild(li);
			});
			this.tableStructureArea.appendChild(indexesList);
		}
	}

	/**
	 * 格式化数据类型
	 */
	private formatDataType(column: IColumnDefinition): string {
		let type = column.dataType.toString();
		if (column.length) {
			type += `(${column.length})`;
		}
		return type;
	}

	/**
	 * 渲染 SQL 预览
	 */
	private renderSQLPreview(): void {
		if (!this.generatedTable) {
			return;
		}

		// 清空内容
		while (this.sqlPreviewArea.firstChild) {
			this.sqlPreviewArea.removeChild(this.sqlPreviewArea.firstChild);
		}

		// 生成 CREATE TABLE SQL
		const sql = this.generateCreateTableSQL(this.generatedTable);

		const pre = $('pre.sql-code');
		const code = $('code');
		code.textContent = sql;
		pre.appendChild(code);

		this.sqlPreviewArea.appendChild(pre);

		// 复制按钮
		const copyButton = $<HTMLButtonElement>('button.copy-sql-button');
		copyButton.textContent = localize('database.tableDesigner.copySql', '复制 SQL');
		this._register(addDisposableListener(copyButton, EventType.CLICK, () => {
			navigator.clipboard.writeText(sql);
			this.notificationService.info(
				localize('database.tableDesigner.sqlCopied', 'SQL 已复制到剪贴板')
			);
		}));
		this.sqlPreviewArea.appendChild(copyButton);
	}

	/**
	 * 生成 CREATE TABLE SQL
	 */
	private generateCreateTableSQL(table: ITableStructure): string {
		const lines: string[] = [];

		// 获取设计规则配置
		const designRules = this.designRulesService.getConfig();
		const engineRules = designRules.storageEngine;

		// CREATE TABLE
		lines.push(`CREATE TABLE \`${table.name}\` (`);

		// 字段定义
		const columnDefs: string[] = [];
		table.columns.forEach(column => {
			let def = `  \`${column.name}\` ${this.formatDataType(column)}`;

			if (!column.nullable) {
				def += ' NOT NULL';
			}

			if (column.autoIncrement) {
				def += ' AUTO_INCREMENT';
			}

			if (column.defaultValue) {
				def += ` DEFAULT ${column.defaultValue}`;
			}

			if (column.comment) {
				def += ` COMMENT '${column.comment}'`;
			}

			columnDefs.push(def);
		});

		// 主键
		const primaryKeys = table.columns.filter(c => c.isPrimaryKey).map(c => c.name);
		if (primaryKeys.length > 0) {
			columnDefs.push(`  PRIMARY KEY (\`${primaryKeys.join('`, `')}\`)`);
		}

		// 唯一键
		table.indexes?.forEach(index => {
			if (index.type === IndexType.UNIQUE) {
				columnDefs.push(`  UNIQUE KEY \`${index.name}\` (\`${index.columns.join('`, `')}\`)`);
			} else {
				columnDefs.push(`  KEY \`${index.name}\` (\`${index.columns.join('`, `')}\`)`);
			}
		});

		lines.push(columnDefs.join(',\n'));

		// 表选项: 应用设计规则
		const tableOptions: string[] = [];

		// 存储引擎
		if (designRules.enabled && engineRules.defaultEngine) {
			tableOptions.push(`ENGINE=${engineRules.defaultEngine}`);
		}

		// 字符集
		if (designRules.enabled && engineRules.defaultCharset) {
			tableOptions.push(`DEFAULT CHARSET=${engineRules.defaultCharset}`);
		}

		// 排序规则
		if (designRules.enabled && engineRules.defaultCollation) {
			tableOptions.push(`COLLATE=${engineRules.defaultCollation}`);
		}

		// 表注释
		if (table.comment) {
			tableOptions.push(`COMMENT='${table.comment}'`);
		}

		lines.push(`) ${tableOptions.join(' ')};`);

		return lines.join('\n');
	}

	/**
	 * 切换 Tab
	 */
	private switchTab(tabName: string): void {
		console.log('[TableDesignerView] Switching to tab:', tabName);

		// 更新按钮状态
		const buttons = this.resultContainer.querySelectorAll('.tab-button');
		console.log('[TableDesignerView] Found buttons:', buttons.length);
		buttons.forEach(button => {
			const btn = button as HTMLButtonElement;
			const btnTab = btn.dataset['tab'];
			console.log('[TableDesignerView] Button tab:', btnTab, 'target:', tabName, 'match:', btnTab === tabName);
			if (btnTab === tabName) {
				btn.classList.add('active');
			} else {
				btn.classList.remove('active');
			}
		});

		// 更新内容显示
		const panes = this.resultContainer.querySelectorAll('.tab-pane');
		console.log('[TableDesignerView] Found panes:', panes.length);
		panes.forEach(pane => {
			const p = pane as HTMLElement;
			const paneTab = p.dataset['tab'];
			console.log('[TableDesignerView] Pane tab:', paneTab, 'target:', tabName, 'match:', paneTab === tabName);
			if (paneTab === tabName) {
				p.classList.add('active');
				p.style.display = 'block';
			} else {
				p.classList.remove('active');
				p.style.display = 'none';
			}
		});

		console.log('[TableDesignerView] Tab switch complete');
	}

	/**
	 * 添加新字段
	 */
	private addNewColumn(): void {
		if (!this.generatedTable) {
			return;
		}

		// 创建新字段
		const newColumn: IColumnDefinition = {
			name: 'new_column',
			dataType: ColumnDataType.VARCHAR,
			length: 255,
			nullable: true,
			comment: '新字段',
			isPrimaryKey: false,
			autoIncrement: false,
			isUnique: false
		};

		// 添加到表结构
		this.generatedTable.columns.push(newColumn);

		// 重新渲染
		this.renderTableStructure();
		this.renderSQLPreview();

		this.notificationService.info(
			localize('database.tableDesigner.columnAdded', '已添加新字段，请修改字段属性')
		);
	}

	/**
	 * 删除字段
	 */
	private deleteColumn(index: number): void {
		if (!this.generatedTable || index < 0 || index >= this.generatedTable.columns.length) {
			return;
		}

		const columnName = this.generatedTable.columns[index].name;

		// 删除字段
		this.generatedTable.columns.splice(index, 1);

		// 重新渲染
		this.renderTableStructure();
		this.renderSQLPreview();

		this.notificationService.info(
			localize('database.tableDesigner.columnDeleted', '已删除字段: {0}', columnName)
		);
	}

	/**
	 * 应用到数据库
	 */
	private async applyToDatabase(): Promise<void> {
		if (!this.generatedTable) {
			return;
		}

		try {
			// 步骤 1: 获取所有已保存的连接
			const connectionsJson = this.storageService.get('database.connections', StorageScope.PROFILE) || '[]';
			const connections: IDatabaseConnectionConfig[] = JSON.parse(connectionsJson);

			if (connections.length === 0) {
				this.notificationService.warn(
					localize('database.tableDesigner.noConnections', '没有可用的数据库连接，请先添加连接')
				);
				return;
			}

			// 步骤 2: 让用户选择连接
			const connectionItems: IQuickPickItem[] = connections.map(conn => ({
				label: conn.name,
				description: `${conn.type} - ${conn.host}:${conn.port}`,
				id: conn.id
			}));

			const selectedConnection = await this.quickInputService.pick(connectionItems, {
				placeHolder: localize('database.tableDesigner.selectConnection', '选择目标数据库连接'),
				canPickMany: false
			});

			if (!selectedConnection) {
				return; // 用户取消
			}

			const connectionConfig = connections.find(c => c.id === (selectedConnection as any).id);
			if (!connectionConfig) {
				return;
			}

			// 步骤 3: 确保连接已添加到服务并已连接
			await this.databaseService.addConnection(connectionConfig);

			const connection = await this.databaseService.getConnection(connectionConfig.id);
			if (!connection || connection.status !== 'connected') {
				this.notificationService.info(
					localize('database.tableDesigner.connecting', '正在连接到数据库...')
				);
				await this.databaseService.connect(connectionConfig.id);
			}

			// 步骤 4: 获取并选择 Schema
			const schemas = await this.databaseService.getSchemas(connectionConfig.id);

			if (schemas.length === 0) {
				this.notificationService.warn(
					localize('database.tableDesigner.noSchemas', '该连接没有可用的数据库')
				);
				return;
			}

			const schemaItems: IQuickPickItem[] = schemas.map(schema => ({
				label: schema.name,
				description: schema.tableCount !== undefined ? `${schema.tableCount} 表` : ''
			}));

			const selectedSchema = await this.quickInputService.pick(schemaItems, {
				placeHolder: localize('database.tableDesigner.selectSchema', '选择目标数据库'),
				canPickMany: false
			});

			if (!selectedSchema) {
				return; // 用户取消
			}

			// 步骤 5: 生成 SQL
			const sql = this.generateCreateTableSQL(this.generatedTable);

			// 步骤 6: 显示确认对话框
			const result = await this.dialogService.confirm({
				type: 'question',
				title: localize('database.tableDesigner.confirmExecution', '确认执行'),
				message: localize(
					'database.tableDesigner.confirmExecutionMessage',
					'确定要在数据库 "{0}" 中创建表 "{1}" 吗?',
					selectedSchema.label,
					this.generatedTable.name
				),
				detail: localize(
					'database.tableDesigner.confirmExecutionDetail',
					'将执行以下 SQL:\n\n{0}',
					sql.length > 500 ? sql.substring(0, 500) + '...' : sql
				),
				primaryButton: localize('database.tableDesigner.execute', '执行')
			});

			if (!result.confirmed) {
				return; // 用户取消
			}

			// 步骤 7: 执行 SQL
			this.notificationService.info(
				localize('database.tableDesigner.executing', '正在执行 SQL...')
			);

			const startTime = Date.now();

			// 先切换到目标 schema
			await this.databaseService.executeNonQuery(connectionConfig.id, `USE \`${selectedSchema.label}\`;`);

			// 执行 CREATE TABLE
			await this.databaseService.executeNonQuery(connectionConfig.id, sql);

			const duration = Date.now() - startTime;

			// 步骤 8: 显示成功消息
			this.notificationService.info(
				localize(
					'database.tableDesigner.executeSuccess',
					'表 "{0}" 创建成功! (耗时 {1}ms)',
					this.generatedTable.name,
					duration
				)
			);

			// 步骤 9: 刷新数据库浏览器
			// 通过触发 onDidChangeConnections 事件来刷新树视图
			// 注意: databaseService.onDidChangeConnections 事件会被 DatabaseTreeViewDataProvider 监听
			// 但我们需要手动触发一次，因为我们没有添加/删除连接，只是修改了数据库内容
			// 这里简单的做法是重新添加一次连接来触发事件
			await this.databaseService.addConnection(connectionConfig);

			console.log('[TableDesignerView] Table created successfully in database');

		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			this.notificationService.error(
				localize('database.tableDesigner.executeError', '执行失败: {0}', errorMessage)
			);
			console.error('[TableDesignerView] Apply to database error:', error);
		}
	}

	override focus(): void {
		super.focus();
		this.requirementInput?.focus();
	}
}
