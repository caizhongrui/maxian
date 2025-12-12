/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { Event, Emitter } from '../../../../base/common/event.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { IDatabaseService } from '../common/databaseService.js';
import { IDatabaseConnectionConfig } from '../common/databaseConnection.js';
import { ISchemaInfo, ITableStructure } from '../common/databaseMetadata.js';
import { IStorageService, StorageScope } from '../../../../platform/storage/common/storage.js';

/**
 * 树节点类型
 */
export enum DatabaseTreeNodeType {
	Connection = 'connection',
	Database = 'database',
	TablesFolder = 'tablesFolder',
	ViewsFolder = 'viewsFolder',
	ProceduresFolder = 'proceduresFolder',
	Table = 'table',
	View = 'view',
	Procedure = 'procedure',
	Column = 'column'
}

/**
 * 数据库树节点接口
 */
export interface IDatabaseTreeNode {
	/** 节点类型 */
	type: DatabaseTreeNodeType;
	/** 节点ID */
	id: string;
	/** 节点标签 */
	label: string;
	/** 节点描述 */
	description?: string;
	/** 节点图标 */
	iconId?: string;
	/** 上下文值(用于命令的when条件) */
	contextValue?: string;
	/** 是否可折叠 */
	collapsibleState?: TreeItemCollapsibleState;
	/** 父节点 */
	parent?: IDatabaseTreeNode;
	/** 连接ID (所有节点都需要知道属于哪个连接) */
	connectionId?: string;
}

/**
 * 连接节点
 */
export interface IConnectionNode extends IDatabaseTreeNode {
	type: DatabaseTreeNodeType.Connection;
	config: IDatabaseConnectionConfig;
	connected: boolean;
}

/**
 * 数据库节点
 */
export interface IDatabaseNode extends IDatabaseTreeNode {
	type: DatabaseTreeNodeType.Database;
	schemaInfo: ISchemaInfo;
}

/**
 * 文件夹节点 (Tables/Views/Procedures)
 */
export interface IFolderNode extends IDatabaseTreeNode {
	type: DatabaseTreeNodeType.TablesFolder | DatabaseTreeNodeType.ViewsFolder | DatabaseTreeNodeType.ProceduresFolder;
	databaseName: string;
}

/**
 * 表节点
 */
export interface ITableNode extends IDatabaseTreeNode {
	type: DatabaseTreeNodeType.Table | DatabaseTreeNodeType.View;
	databaseName: string;
	tableInfo: ITableStructure;
}

/**
 * 字段节点
 */
export interface IColumnNode extends IDatabaseTreeNode {
	type: DatabaseTreeNodeType.Column;
	databaseName: string;
	tableName: string;
	columnInfo: {
		name: string;
		dataType: string;
		length?: number;
		nullable: boolean;
		isPrimaryKey?: boolean;
		isForeignKey?: boolean;
		comment?: string;
	};
}

/**
 * TreeItem 可折叠状态 (VS Code TreeView API)
 */
export enum TreeItemCollapsibleState {
	None = 0,
	Collapsed = 1,
	Expanded = 2
}

/**
 * TreeItem 接口 (VS Code TreeView API)
 */
export interface TreeItem {
	label: string;
	id?: string;
	iconPath?: ThemeIcon;
	description?: string;
	contextValue?: string;
	collapsibleState?: TreeItemCollapsibleState;
	command?: {
		id: string;
		title: string;
		arguments?: any[];
	};
}

/**
 * TreeDataProvider 接口 (VS Code TreeView API)
 */
export interface ITreeDataProvider<T> {
	onDidChangeTreeData: Event<T | undefined | null | void>;
	getTreeItem(element: T): TreeItem | Promise<TreeItem>;
	getChildren(element?: T): Promise<T[]>;
	getParent?(element: T): Promise<T | undefined>;
}

/**
 * 数据库树形数据提供者
 */
export class DatabaseTreeDataProvider extends Disposable implements ITreeDataProvider<IDatabaseTreeNode> {
	private readonly _onDidChangeTreeData = this._register(new Emitter<IDatabaseTreeNode | undefined | null | void>());
	readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

	constructor(
		@IDatabaseService private readonly databaseService: IDatabaseService,
		@IStorageService private readonly storageService: IStorageService
	) {
		super();

		// 监听存储变化,刷新树
		const storageDisposables = this._register(new DisposableStore());
		this._register(this.storageService.onDidChangeValue(StorageScope.PROFILE, 'database.connections', storageDisposables)((e: any) => {
			if (e.key === 'database.connections') {
				this.refresh();
			}
		}));

		// 监听数据库服务的连接变化事件
		this._register(this.databaseService.onDidChangeConnections(() => {
			this.refresh();
		}));
	}

	/**
	 * 刷新整个树
	 */
	refresh(element?: IDatabaseTreeNode): void {
		this._onDidChangeTreeData.fire(element);
	}

	/**
	 * 获取树节点项
	 */
	async getTreeItem(element: IDatabaseTreeNode): Promise<TreeItem> {
		const treeItem: TreeItem = {
			label: element.label,
			id: element.id,
			description: element.description,
			contextValue: element.contextValue,
			collapsibleState: element.collapsibleState
		};

		// 设置图标
		if (element.iconId) {
			treeItem.iconPath = ThemeIcon.fromId(element.iconId);
		}

		return treeItem;
	}

	/**
	 * 获取子节点
	 */
	async getChildren(element?: IDatabaseTreeNode): Promise<IDatabaseTreeNode[]> {
		if (!element) {
			// 根节点: 返回所有连接
			return this.getConnectionNodes();
		}

		switch (element.type) {
			case DatabaseTreeNodeType.Connection:
				return this.getDatabaseNodes(element as IConnectionNode);
			case DatabaseTreeNodeType.Database:
				return this.getFolderNodes(element as IDatabaseNode);
			case DatabaseTreeNodeType.TablesFolder:
				return this.getTableNodes(element as IFolderNode, 'table');
			case DatabaseTreeNodeType.ViewsFolder:
				return this.getTableNodes(element as IFolderNode, 'view');
			case DatabaseTreeNodeType.ProceduresFolder:
				return this.getProcedureNodes(element as IFolderNode);
			case DatabaseTreeNodeType.Table:
			case DatabaseTreeNodeType.View:
				return this.getColumnNodes(element as ITableNode);
			default:
				return [];
		}
	}

	/**
	 * 获取父节点
	 */
	async getParent(element: IDatabaseTreeNode): Promise<IDatabaseTreeNode | undefined> {
		return element.parent;
	}

	/**
	 * 获取所有连接节点
	 */
	private async getConnectionNodes(): Promise<IConnectionNode[]> {
		// 从存储中读取连接配置
		const connectionsJson = this.storageService.get('database.connections', StorageScope.PROFILE) || '[]';
		const connections: IDatabaseConnectionConfig[] = JSON.parse(connectionsJson);

		return connections.map(config => {
			// 检查连接状态
			const connected = false; // TODO: 从 databaseService 获取实际连接状态

			const node: IConnectionNode = {
				type: DatabaseTreeNodeType.Connection,
				id: `connection-${config.id}`,
				label: config.name,
				description: connected ? '已连接' : `${config.host}:${config.port}`,
				iconId: connected ? 'database' : 'debug-disconnect',
				contextValue: connected ? 'databaseConnection.connected' : 'databaseConnection.disconnected',
				collapsibleState: TreeItemCollapsibleState.Collapsed,
				config,
				connected,
				connectionId: config.id
			};

			return node;
		});
	}

	/**
	 * 获取数据库节点
	 */
	private async getDatabaseNodes(connectionNode: IConnectionNode): Promise<IDatabaseNode[]> {
		try {
			// 确保连接已添加到服务
			await this.databaseService.addConnection(connectionNode.config);

			// 尝试连接
			const connection = await this.databaseService.getConnection(connectionNode.config.id);
			if (!connection || connection.status !== 'connected') {
				await this.databaseService.connect(connectionNode.config.id);
			}

			// 获取数据库列表
			const schemas = await this.databaseService.getSchemas(connectionNode.config.id);

			return schemas.map(schema => {
				const node: IDatabaseNode = {
					type: DatabaseTreeNodeType.Database,
					id: `database-${connectionNode.config.id}-${schema.name}`,
					label: schema.name,
					description: schema.tableCount !== undefined ? `${schema.tableCount} 表` : undefined,
					iconId: 'database',
					contextValue: 'databaseSchema',
					collapsibleState: TreeItemCollapsibleState.Collapsed,
					schemaInfo: schema,
					parent: connectionNode,
					connectionId: connectionNode.config.id
				};

				return node;
			});
		} catch (error) {
			console.error('[DatabaseExplorer] Failed to get databases:', error);
			return [];
		}
	}

	/**
	 * 获取文件夹节点 (Tables/Views/Procedures)
	 */
	private async getFolderNodes(databaseNode: IDatabaseNode): Promise<IFolderNode[]> {
		const folders: IFolderNode[] = [];

		// Tables 文件夹
		folders.push({
			type: DatabaseTreeNodeType.TablesFolder,
			id: `tables-folder-${databaseNode.id}`,
			label: '表',
			iconId: 'folder',
			contextValue: 'databaseTablesFolder',
			collapsibleState: TreeItemCollapsibleState.Collapsed,
			databaseName: databaseNode.schemaInfo.name,
			parent: databaseNode,
			connectionId: databaseNode.connectionId
		});

		// Views 文件夹
		folders.push({
			type: DatabaseTreeNodeType.ViewsFolder,
			id: `views-folder-${databaseNode.id}`,
			label: '视图',
			iconId: 'folder',
			contextValue: 'databaseViewsFolder',
			collapsibleState: TreeItemCollapsibleState.Collapsed,
			databaseName: databaseNode.schemaInfo.name,
			parent: databaseNode,
			connectionId: databaseNode.connectionId
		});

		// Procedures 文件夹
		folders.push({
			type: DatabaseTreeNodeType.ProceduresFolder,
			id: `procedures-folder-${databaseNode.id}`,
			label: '存储过程',
			iconId: 'folder',
			contextValue: 'databaseProceduresFolder',
			collapsibleState: TreeItemCollapsibleState.Collapsed,
			databaseName: databaseNode.schemaInfo.name,
			parent: databaseNode,
			connectionId: databaseNode.connectionId
		});

		return folders;
	}

	/**
	 * 获取表/视图节点
	 */
	private async getTableNodes(folderNode: IFolderNode, type: 'table' | 'view'): Promise<ITableNode[]> {
		try {
			if (!folderNode.connectionId) {
				return [];
			}

			// 获取表列表
			const tables = await this.databaseService.getTables(folderNode.connectionId, folderNode.databaseName);

			return tables.map(table => {
				const node: ITableNode = {
					type: type === 'table' ? DatabaseTreeNodeType.Table : DatabaseTreeNodeType.View,
					id: `table-${folderNode.connectionId}-${folderNode.databaseName}-${table.name}`,
					label: table.name,
					description: table.comment,
					iconId: type === 'table' ? 'table' : 'symbol-interface',
					contextValue: type === 'table' ? 'databaseTable' : 'databaseView',
					collapsibleState: TreeItemCollapsibleState.Collapsed,
					databaseName: folderNode.databaseName,
					tableInfo: table,
					parent: folderNode,
					connectionId: folderNode.connectionId
				};

				return node;
			});
		} catch (error) {
			console.error('[DatabaseExplorer] Failed to get tables:', error);
			return [];
		}
	}

	/**
	 * 获取存储过程节点
	 */
	private async getProcedureNodes(folderNode: IFolderNode): Promise<IDatabaseTreeNode[]> {
		try {
			if (!folderNode.connectionId) {
				return [];
			}

			// 获取存储过程列表
			const procedures = await this.databaseService.getProcedures(folderNode.connectionId, folderNode.databaseName);

			return procedures.map(proc => {
				const node: IDatabaseTreeNode = {
					type: DatabaseTreeNodeType.Procedure,
					id: `procedure-${folderNode.connectionId}-${folderNode.databaseName}-${proc.name}`,
					label: proc.name,
					description: proc.comment,
					iconId: 'symbol-method',
					contextValue: 'databaseProcedure',
					collapsibleState: TreeItemCollapsibleState.None,
					parent: folderNode,
					connectionId: folderNode.connectionId
				};

				return node;
			});
		} catch (error) {
			console.error('[DatabaseExplorer] Failed to get procedures:', error);
			return [];
		}
	}

	/**
	 * 获取字段节点
	 */
	private async getColumnNodes(tableNode: ITableNode): Promise<IColumnNode[]> {
		try {
			if (!tableNode.connectionId) {
				return [];
			}

			// 获取表结构
			const tableStructure = await this.databaseService.getTableStructure(
				tableNode.connectionId,
				tableNode.databaseName,
				tableNode.tableInfo.name
			);

			return tableStructure.columns.map(column => {
				// 判断是否为外键 - 通过检查外键定义
				const isForeignKey = tableStructure.foreignKeys?.some(fk =>
					fk.columns.includes(column.name)
				) || false;

				// 确定图标
				let iconId = 'symbol-field';
				if (column.isPrimaryKey) {
					iconId = 'key';
				} else if (isForeignKey) {
					iconId = 'link';
				}

				// 构建描述 - dataType 是枚举类型,直接转为字符串
				let description = column.dataType.toString();
				if (column.length) {
					description += `(${column.length})`;
				}
				if (!column.nullable) {
					description += ' NOT NULL';
				}

				const node: IColumnNode = {
					type: DatabaseTreeNodeType.Column,
					id: `column-${tableNode.connectionId}-${tableNode.databaseName}-${tableNode.tableInfo.name}-${column.name}`,
					label: column.name,
					description,
					iconId,
					contextValue: 'databaseColumn',
					collapsibleState: TreeItemCollapsibleState.None,
					databaseName: tableNode.databaseName,
					tableName: tableNode.tableInfo.name,
					columnInfo: {
						name: column.name,
						dataType: column.dataType.toString(),
						length: column.length,
						nullable: column.nullable,
						isPrimaryKey: column.isPrimaryKey,
						isForeignKey,
						comment: column.comment
					},
					parent: tableNode,
					connectionId: tableNode.connectionId
				};

				return node;
			});
		} catch (error) {
			console.error('[DatabaseExplorer] Failed to get columns:', error);
			return [];
		}
	}
}
