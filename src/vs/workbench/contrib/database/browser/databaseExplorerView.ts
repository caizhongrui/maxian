/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { ITreeViewDataProvider, ITreeItem, TreeItemCollapsibleState } from '../../../common/views.js';
import { IDatabaseService } from '../common/databaseService.js';
import { IDatabaseConnection, ConnectionStatus } from '../common/databaseConnection.js';
import { Event, Emitter } from '../../../../base/common/event.js';
import { ThemeIcon } from '../../../../base/common/themables.js';

/**
 * 数据库树节点类型
 */
export enum DatabaseTreeNodeType {
	Connection = 'connection',
	Schema = 'schema',
	Tables = 'tables',
	Table = 'table',
	Columns = 'columns',
	Column = 'column',
	Indexes = 'indexes',
	Index = 'index',
	Views = 'views',
	View = 'view',
	Procedures = 'procedures',
	Procedure = 'procedure'
}

/**
 * 数据库树节点
 */
export class DatabaseTreeNode {
	constructor(
		public readonly id: string,
		public readonly label: string,
		public readonly type: DatabaseTreeNodeType,
		public readonly parent?: DatabaseTreeNode,
		public readonly metadata?: any
	) { }

	/**
	 * 获取完整路径ID
	 */
	getFullId(): string {
		if (this.parent) {
			return `${this.parent.getFullId()}/${this.id}`;
		}
		return this.id;
	}
}

/**
 * 数据库浏览器树形数据提供者
 */
export class DatabaseExplorerDataProvider extends Disposable implements ITreeViewDataProvider {
	private _onDidChangeTreeData = this._register(new Emitter<DatabaseTreeNode | undefined | null>());
	readonly onDidChangeTreeData: Event<DatabaseTreeNode | undefined | null> = this._onDidChangeTreeData.event;

	private connections: IDatabaseConnection[] = [];

	constructor(
		private readonly databaseService: IDatabaseService
	) {
		super();
		this.loadConnections();
	}

	/**
	 * 加载所有连接
	 */
	private async loadConnections(): Promise<void> {
		const configs = await this.databaseService.getAllConnections();
		// 将配置转换为连接对象
		this.connections = configs.map(config => ({
			config,
			status: ConnectionStatus.Disconnected
		}));
		this.refresh();
	}

	/**
	 * 刷新树
	 */
	refresh(node?: DatabaseTreeNode): void {
		this._onDidChangeTreeData.fire(node);
	}

	/**
	 * 获取树节点
	 */
	async getTreeItem(element: DatabaseTreeNode): Promise<ITreeItem> {
		const treeItem: ITreeItem = {
			handle: element.getFullId(),
			label: { label: element.label },
			collapsibleState: this.getCollapsibleState(element),
			themeIcon: this.getIcon(element),
			contextValue: element.type
		};

		return treeItem;
	}

	/**
	 * 获取子节点
	 */
	// @ts-ignore - TypeScript 类型检查问题，getChildren 签名在运行时是正确的
	async getChildren(element?: DatabaseTreeNode): Promise<DatabaseTreeNode[]> {
		if (!element) {
			// 根节点：返回所有连接
			return this.connections.map(conn =>
				new DatabaseTreeNode(
					conn.config.id,
					conn.config.name,
					DatabaseTreeNodeType.Connection,
					undefined,
					conn
				)
			);
		}

		switch (element.type) {
			case DatabaseTreeNodeType.Connection:
				return this.getConnectionChildren(element);
			case DatabaseTreeNodeType.Schema:
				return this.getSchemaChildren(element);
			case DatabaseTreeNodeType.Tables:
				return this.getTablesChildren(element);
			case DatabaseTreeNodeType.Table:
				return this.getTableChildren(element);
			case DatabaseTreeNodeType.Views:
				return this.getViewsChildren(element);
			case DatabaseTreeNodeType.Procedures:
				return this.getProceduresChildren(element);
			default:
				return [];
		}
	}

	/**
	 * 获取连接的子节点
	 */
	private async getConnectionChildren(element: DatabaseTreeNode): Promise<DatabaseTreeNode[]> {
		const connection = element.metadata as IDatabaseConnection;

		// 检查连接状态
		if (connection.status !== ConnectionStatus.Connected) {
			return [];
		}

		try {
			// 获取数据库列表
			const schemas = await this.databaseService.getSchemas(connection.config.id);

			return schemas.map(schema =>
				new DatabaseTreeNode(
					schema.name,
					schema.name,
					DatabaseTreeNodeType.Schema,
					element,
					schema
				)
			);
		} catch (error) {
			console.error('[DatabaseExplorer] Failed to get schemas:', error);
			return [];
		}
	}

	/**
	 * 获取数据库/模式的子节点
	 */
	private getSchemaChildren(element: DatabaseTreeNode): DatabaseTreeNode[] {
		return [
			new DatabaseTreeNode(
				'tables',
				'表',
				DatabaseTreeNodeType.Tables,
				element
			),
			new DatabaseTreeNode(
				'views',
				'视图',
				DatabaseTreeNodeType.Views,
				element
			),
			new DatabaseTreeNode(
				'procedures',
				'存储过程',
				DatabaseTreeNodeType.Procedures,
				element
			)
		];
	}

	/**
	 * 获取表列表
	 */
	private async getTablesChildren(element: DatabaseTreeNode): Promise<DatabaseTreeNode[]> {
		const schemaNode = element.parent!;
		const connectionNode = schemaNode.parent!;
		const connection = connectionNode.metadata as IDatabaseConnection;

		try {
			const tables = await this.databaseService.getTables(
				connection.config.id,
				schemaNode.id
			);

			return tables.map(table =>
				new DatabaseTreeNode(
					table.name,
					table.name + (table.comment ? ` (${table.comment})` : ''),
					DatabaseTreeNodeType.Table,
					element,
					table
				)
			);
		} catch (error) {
			console.error('[DatabaseExplorer] Failed to get tables:', error);
			return [];
		}
	}

	/**
	 * 获取表的子节点（字段、索引等）
	 */
	private async getTableChildren(element: DatabaseTreeNode): Promise<DatabaseTreeNode[]> {
		const tablesNode = element.parent!;
		const schemaNode = tablesNode.parent!;
		const connectionNode = schemaNode.parent!;
		const connection = connectionNode.metadata as IDatabaseConnection;

		try {
			const tableStructure = await this.databaseService.getTableStructure(
				connection.config.id,
				schemaNode.id,
				element.id
			);

			const children: DatabaseTreeNode[] = [];

			// 添加 Columns 节点
			const columnsNode = new DatabaseTreeNode(
				'columns',
				`字段 (${tableStructure.columns.length})`,
				DatabaseTreeNodeType.Columns,
				element,
				tableStructure.columns
			);
			children.push(columnsNode);

			// 添加 Indexes 节点
			if (tableStructure.indexes.length > 0) {
				const indexesNode = new DatabaseTreeNode(
					'indexes',
					`索引 (${tableStructure.indexes.length})`,
					DatabaseTreeNodeType.Indexes,
					element,
					tableStructure.indexes
				);
				children.push(indexesNode);
			}

			return children;
		} catch (error) {
			console.error('[DatabaseExplorer] Failed to get table structure:', error);
			return [];
		}
	}


	/**
	 * 获取视图列表
	 */
	private async getViewsChildren(element: DatabaseTreeNode): Promise<DatabaseTreeNode[]> {
		const schemaNode = element.parent!;
		const connectionNode = schemaNode.parent!;
		const connection = connectionNode.metadata as IDatabaseConnection;

		try {
			const views = await this.databaseService.getViews(
				connection.config.id,
				schemaNode.id
			);

			return views.map(view =>
				new DatabaseTreeNode(
					view.name,
					view.name,
					DatabaseTreeNodeType.View,
					element,
					view
				)
			);
		} catch (error) {
			console.error('[DatabaseExplorer] Failed to get views:', error);
			return [];
		}
	}

	/**
	 * 获取存储过程列表
	 */
	private async getProceduresChildren(element: DatabaseTreeNode): Promise<DatabaseTreeNode[]> {
		const schemaNode = element.parent!;
		const connectionNode = schemaNode.parent!;
		const connection = connectionNode.metadata as IDatabaseConnection;

		try {
			const procedures = await this.databaseService.getProcedures(
				connection.config.id,
				schemaNode.id
			);

			return procedures.map(procedure =>
				new DatabaseTreeNode(
					procedure.name,
					procedure.name,
					DatabaseTreeNodeType.Procedure,
					element,
					procedure
				)
			);
		} catch (error) {
			console.error('[DatabaseExplorer] Failed to get procedures:', error);
			return [];
		}
	}

	/**
	 * 获取节点的折叠状态
	 */
	private getCollapsibleState(element: DatabaseTreeNode): TreeItemCollapsibleState {
		switch (element.type) {
			case DatabaseTreeNodeType.Connection:
			case DatabaseTreeNodeType.Schema:
			case DatabaseTreeNodeType.Tables:
			case DatabaseTreeNodeType.Table:
			case DatabaseTreeNodeType.Columns:
			case DatabaseTreeNodeType.Indexes:
			case DatabaseTreeNodeType.Views:
			case DatabaseTreeNodeType.Procedures:
				return TreeItemCollapsibleState.Collapsed;
			default:
				return TreeItemCollapsibleState.None;
		}
	}

	/**
	 * 获取节点图标
	 */
	private getIcon(element: DatabaseTreeNode): ThemeIcon {
		switch (element.type) {
			case DatabaseTreeNodeType.Connection:
				const conn = element.metadata as IDatabaseConnection;
				return conn.status === ConnectionStatus.Connected
					? ThemeIcon.fromId('database')
					: ThemeIcon.fromId('debug-disconnect');
			case DatabaseTreeNodeType.Schema:
				return ThemeIcon.fromId('database');
			case DatabaseTreeNodeType.Tables:
				return ThemeIcon.fromId('symbol-folder');
			case DatabaseTreeNodeType.Table:
				return ThemeIcon.fromId('table');
			case DatabaseTreeNodeType.Columns:
				return ThemeIcon.fromId('symbol-folder');
			case DatabaseTreeNodeType.Column:
				const column = element.metadata;
				return column?.isPrimaryKey
					? ThemeIcon.fromId('key')
					: ThemeIcon.fromId('symbol-field');
			case DatabaseTreeNodeType.Indexes:
				return ThemeIcon.fromId('symbol-folder');
			case DatabaseTreeNodeType.Index:
				return ThemeIcon.fromId('index');
			case DatabaseTreeNodeType.Views:
				return ThemeIcon.fromId('symbol-folder');
			case DatabaseTreeNodeType.View:
				return ThemeIcon.fromId('symbol-interface');
			case DatabaseTreeNodeType.Procedures:
				return ThemeIcon.fromId('symbol-folder');
			case DatabaseTreeNodeType.Procedure:
				return ThemeIcon.fromId('symbol-method');
			default:
				return ThemeIcon.fromId('circle-outline');
		}
	}

	/**
	 * 添加连接
	 */
	async addConnection(connection: IDatabaseConnection): Promise<void> {
		this.connections.push(connection);
		this.refresh();
	}

	/**
	 * 移除连接
	 */
	async removeConnection(connectionId: string): Promise<void> {
		const index = this.connections.findIndex(c => c.config.id === connectionId);
		if (index >= 0) {
			this.connections.splice(index, 1);
			this.refresh();
		}
	}

	/**
	 * 更新连接状态
	 */
	async updateConnectionStatus(connectionId: string, status: ConnectionStatus): Promise<void> {
		const connection = this.connections.find(c => c.config.id === connectionId);
		if (connection) {
			connection.status = status;
			this.refresh();
		}
	}
}
