/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { ITreeViewDataProvider, ITreeItem, TreeItemCollapsibleState } from '../../../common/views.js';
import { IDatabaseService } from '../common/databaseService.js';
import { IStorageService, StorageScope } from '../../../../platform/storage/common/storage.js';
import { IDatabaseConnectionConfig } from '../common/databaseConnection.js';
import { ThemeIcon } from '../../../../base/common/themables.js';

/**
 * 树节点类型
 */
enum NodeType {
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
 * 扩展的树节点接口 - 继承自ITreeItem并添加自定义数据
 */
interface TreeNode extends ITreeItem {
	type: NodeType;
	// 节点数据
	connectionId?: string;
	databaseName?: string;
	tableName?: string;
	data?: any;
}

/**
 * 数据库树形视图数据提供者
 */
export class DatabaseTreeViewDataProvider extends Disposable implements ITreeViewDataProvider {

	constructor(
		@IDatabaseService private readonly databaseService: IDatabaseService,
		@IStorageService private readonly storageService: IStorageService
	) {
		super();

		// 监听存储变化
		const storageDisposables = this._register(new DisposableStore());
		this._register(this.storageService.onDidChangeValue(StorageScope.PROFILE, 'database.connections', storageDisposables)((e: any) => {
			if (e.key === 'database.connections') {
				// refresh会被TreeView调用
			}
		}));

		// 监听数据库服务连接变化
		this._register(this.databaseService.onDidChangeConnections(() => {
			// refresh会被TreeView调用
		}));
	}

	async getChildren(element?: ITreeItem): Promise<ITreeItem[] | undefined> {
		if (!element) {
			// 根节点: 返回所有连接
			return this.getConnectionNodes();
		}

		const node = element as TreeNode;
		switch (node.type) {
			case NodeType.Connection:
				return this.getDatabaseNodes(node);
			case NodeType.Database:
				return this.getFolderNodes(node);
			case NodeType.TablesFolder:
				return this.getTableNodes(node, 'table');
			case NodeType.ViewsFolder:
				return this.getTableNodes(node, 'view');
			case NodeType.ProceduresFolder:
				return this.getProcedureNodes(node);
			case NodeType.Table:
			case NodeType.View:
				return this.getColumnNodes(node);
			default:
				return [];
		}
	}

	private async getConnectionNodes(): Promise<TreeNode[]> {
		const connectionsJson = this.storageService.get('database.connections', StorageScope.PROFILE) || '[]';
		const connections: IDatabaseConnectionConfig[] = JSON.parse(connectionsJson);

		return connections.map(config => ({
			type: NodeType.Connection,
			handle: `connection-${config.id}`,
			label: { label: config.name },
			description: `${config.host}:${config.port}`,
			themeIcon: ThemeIcon.fromId('database'),
			collapsibleState: TreeItemCollapsibleState.Collapsed,
			contextValue: 'databaseConnection',
			connectionId: config.id,
			data: config
		}));
	}

	private async getDatabaseNodes(connectionNode: TreeNode): Promise<TreeNode[]> {
		try {
			if (!connectionNode.connectionId) {
				return [];
			}

			const config = connectionNode.data as IDatabaseConnectionConfig;

			// 确保连接已添加
			await this.databaseService.addConnection(config);

			// 尝试连接
			const connection = await this.databaseService.getConnection(config.id);
			if (!connection || connection.status !== 'connected') {
				await this.databaseService.connect(config.id);
			}

			// 获取数据库列表
			const schemas = await this.databaseService.getSchemas(config.id);

			return schemas.map(schema => ({
				type: NodeType.Database,
				handle: `database-${config.id}-${schema.name}`,
				label: { label: schema.name },
				description: schema.tableCount !== undefined ? `${schema.tableCount} 表` : undefined,
				themeIcon: ThemeIcon.fromId('database'),
				collapsibleState: TreeItemCollapsibleState.Collapsed,
				contextValue: 'databaseSchema',
				connectionId: config.id,
				databaseName: schema.name,
				data: schema
			}));
		} catch (error) {
			console.error('[DatabaseTreeView] Failed to get databases:', error);
			return [];
		}
	}

	private async getFolderNodes(databaseNode: TreeNode): Promise<TreeNode[]> {
		const folders: TreeNode[] = [];

		// Tables 文件夹
		folders.push({
			type: NodeType.TablesFolder,
			handle: `tables-${databaseNode.handle}`,
			label: { label: '表' },
			themeIcon: ThemeIcon.fromId('folder'),
			collapsibleState: TreeItemCollapsibleState.Collapsed,
			contextValue: 'databaseTablesFolder',
			connectionId: databaseNode.connectionId,
			databaseName: databaseNode.databaseName
		});

		// Views 文件夹
		folders.push({
			type: NodeType.ViewsFolder,
			handle: `views-${databaseNode.handle}`,
			label: { label: '视图' },
			themeIcon: ThemeIcon.fromId('folder'),
			collapsibleState: TreeItemCollapsibleState.Collapsed,
			contextValue: 'databaseViewsFolder',
			connectionId: databaseNode.connectionId,
			databaseName: databaseNode.databaseName
		});

		// Procedures 文件夹
		folders.push({
			type: NodeType.ProceduresFolder,
			handle: `procedures-${databaseNode.handle}`,
			label: { label: '存储过程' },
			themeIcon: ThemeIcon.fromId('folder'),
			collapsibleState: TreeItemCollapsibleState.Collapsed,
			contextValue: 'databaseProceduresFolder',
			connectionId: databaseNode.connectionId,
			databaseName: databaseNode.databaseName
		});

		return folders;
	}

	private async getTableNodes(folderNode: TreeNode, type: 'table' | 'view'): Promise<TreeNode[]> {
		try {
			if (!folderNode.connectionId || !folderNode.databaseName) {
				return [];
			}

			const tables = await this.databaseService.getTables(folderNode.connectionId, folderNode.databaseName);

			return tables.map(table => ({
				type: type === 'table' ? NodeType.Table : NodeType.View,
				handle: `table-${folderNode.connectionId}-${folderNode.databaseName}-${table.name}`,
				label: { label: table.name },
				description: table.comment,
				themeIcon: ThemeIcon.fromId(type === 'table' ? 'table' : 'symbol-interface'),
				collapsibleState: TreeItemCollapsibleState.Collapsed,
				contextValue: type === 'table' ? 'databaseTable' : 'databaseView',
				connectionId: folderNode.connectionId,
				databaseName: folderNode.databaseName,
				tableName: table.name,
				data: table
			}));
		} catch (error) {
			console.error('[DatabaseTreeView] Failed to get tables:', error);
			return [];
		}
	}

	private async getProcedureNodes(folderNode: TreeNode): Promise<TreeNode[]> {
		try {
			if (!folderNode.connectionId || !folderNode.databaseName) {
				return [];
			}

			const procedures = await this.databaseService.getProcedures(folderNode.connectionId, folderNode.databaseName);

			return procedures.map(proc => ({
				type: NodeType.Procedure,
				handle: `procedure-${folderNode.connectionId}-${folderNode.databaseName}-${proc.name}`,
				label: { label: proc.name },
				description: proc.comment,
				themeIcon: ThemeIcon.fromId('symbol-method'),
				collapsibleState: TreeItemCollapsibleState.None,
				contextValue: 'databaseProcedure',
				connectionId: folderNode.connectionId,
				databaseName: folderNode.databaseName,
				data: proc
			}));
		} catch (error) {
			console.error('[DatabaseTreeView] Failed to get procedures:', error);
			return [];
		}
	}

	private async getColumnNodes(tableNode: TreeNode): Promise<TreeNode[]> {
		try {
			if (!tableNode.connectionId || !tableNode.databaseName || !tableNode.tableName) {
				return [];
			}

			const tableStructure = await this.databaseService.getTableStructure(
				tableNode.connectionId,
				tableNode.databaseName,
				tableNode.tableName
			);

			return tableStructure.columns.map(column => {
				// 判断是否为外键
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

				// 构建描述
				let description = column.dataType.toString();
				if (column.length) {
					description += `(${column.length})`;
				}
				if (!column.nullable) {
					description += ' NOT NULL';
				}

				return {
					type: NodeType.Column,
					handle: `column-${tableNode.connectionId}-${tableNode.databaseName}-${tableNode.tableName}-${column.name}`,
					label: { label: column.name },
					description,
					themeIcon: ThemeIcon.fromId(iconId),
					collapsibleState: TreeItemCollapsibleState.None,
					contextValue: 'databaseColumn',
					connectionId: tableNode.connectionId,
					databaseName: tableNode.databaseName,
					tableName: tableNode.tableName,
					data: column
				};
			});
		} catch (error) {
			console.error('[DatabaseTreeView] Failed to get columns:', error);
			return [];
		}
	}
}
