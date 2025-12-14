/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { Action2, registerAction2, MenuId } from '../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { IQuickInputService, IQuickPickItem } from '../../../../platform/quickinput/common/quickInput.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { IDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { IDatabaseService } from '../common/databaseService.js';
import { DatabaseType, IDatabaseConnectionConfig } from '../common/databaseConnection.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { showDatabaseConnectionDialog } from './databaseConnectionDialog.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';

/**
 * 添加数据库连接 Action
 */
class AddDatabaseConnectionAction extends Action2 {
	static readonly ID = 'database.addConnection';

	constructor() {
		super({
			id: AddDatabaseConnectionAction.ID,
			title: {
				value: localize('database.addConnection', "添加数据库连接"),
				original: 'Add Database Connection'
			},
			icon: ThemeIcon.fromId('add'),
			f1: true,
			menu: [
				{
					id: MenuId.ViewTitle,
					when: ContextKeyExpr.equals('view', 'workbench.view.database.explorer'),
					group: 'navigation',
					order: 1
				}
			]
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const dialogService = accessor.get(IDialogService);
		const notificationService = accessor.get(INotificationService);
		const databaseService = accessor.get(IDatabaseService);
		const storageService = accessor.get(IStorageService);

		try {
			// 使用表单对话框
			const formData = await showDatabaseConnectionDialog(dialogService);

			if (!formData) {
				return; // 用户取消了
			}

			// 创建连接配置
			const config: IDatabaseConnectionConfig = {
				id: generateUuid(),
				name: formData.name,
				type: formData.type,
				host: formData.host,
				port: formData.port,
				username: formData.username,
				password: formData.password,
				database: formData.database,
				charset: formData.type === DatabaseType.MySQL ? 'utf8mb4' : 'UTF8',
				ssl: false,
				connectionTimeout: 10000,
				options: {}
			};

			// 测试连接
			notificationService.info(localize('database.testing', '正在测试连接...'));
			const testResult = await databaseService.testConnection(config);

			if (!testResult.success) {
				notificationService.error(
					localize('database.testFailed', '连接测试失败: {0}', testResult.error)
				);
				// 仍然保存连接,但提示用户
			} else {
				notificationService.info(
					localize('database.testSuccess', '连接测试成功! 响应时间: {0}ms', testResult.responseTime || 0)
				);
			}

			// 保存连接
			await databaseService.addConnection(config);

			// 保存到本地存储
			const connections = JSON.parse(storageService.get('database.connections', StorageScope.PROFILE) || '[]');
			connections.push(config);
			storageService.store('database.connections', JSON.stringify(connections), StorageScope.PROFILE, StorageTarget.USER);

			notificationService.info(
				localize('database.connectionAdded', '数据库连接 "{0}" 已添加', formData.name)
			);

		} catch (error) {
			notificationService.error(
				localize('database.addConnectionError', '添加连接失败: {0}', String(error))
			);
		}
	}
}

/**
 * 刷新数据库连接 Action
 */
class RefreshDatabaseConnectionAction extends Action2 {
	static readonly ID = 'database.refreshConnection';

	constructor() {
		super({
			id: RefreshDatabaseConnectionAction.ID,
			title: {
				value: localize('database.refreshConnection', "刷新"),
				original: 'Refresh'
			},
			icon: ThemeIcon.fromId('refresh'),
			f1: true,
			menu: [
				{
					id: MenuId.ViewTitle,
					when: ContextKeyExpr.equals('view', 'workbench.view.database.explorer'),
					group: 'navigation',
					order: 2
				}
			]
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const notificationService = accessor.get(INotificationService);

		// TODO: 实现刷新逻辑
		notificationService.info(
			localize('database.refreshing', '正在刷新数据库连接...')
		);
	}
}

/**
 * 测试数据库连接 Action
 */
class TestDatabaseConnectionAction extends Action2 {
	static readonly ID = 'database.testConnection';

	constructor() {
		super({
			id: TestDatabaseConnectionAction.ID,
			title: {
				value: localize('database.testConnection', "测试连接"),
				original: 'Test Connection'
			},
			icon: ThemeIcon.fromId('debug-start'),
			f1: true
		});
	}

	async run(accessor: ServicesAccessor, connectionId?: string): Promise<void> {
		const quickInputService = accessor.get(IQuickInputService);
		const notificationService = accessor.get(INotificationService);
		const databaseService = accessor.get(IDatabaseService);
		const storageService = accessor.get(IStorageService);

		try {
			// 从存储中加载所有连接
			const connectionsJson = storageService.get('database.connections', StorageScope.PROFILE) || '[]';
			const connections: IDatabaseConnectionConfig[] = JSON.parse(connectionsJson);

			if (connections.length === 0) {
				notificationService.warn(
					localize('database.noConnections', '还没有任何数据库连接，请先添加连接')
				);
				return;
			}

			let selectedConfig: IDatabaseConnectionConfig | undefined;

			if (connectionId) {
				// 如果提供了 connectionId，直接使用
				selectedConfig = connections.find(c => c.id === connectionId);
			} else {
				// 否则让用户选择要测试的连接
				const items: IQuickPickItem[] = connections.map(conn => ({
					label: conn.name,
					description: `${conn.type} - ${conn.host}:${conn.port}`,
					id: conn.id
				}));

				const selected = await quickInputService.pick(items, {
					placeHolder: localize('database.selectConnectionToTest', '选择要测试的连接'),
					canPickMany: false
				});

				if (!selected) {
					return;
				}

				selectedConfig = connections.find(c => c.id === (selected as any).id);
			}

			if (!selectedConfig) {
				notificationService.error(
					localize('database.connectionNotFound', '找不到指定的连接')
				);
				return;
			}

			// 开始测试
			notificationService.info(
				localize('database.testingConnection', '正在测试连接 "{0}"...', selectedConfig.name)
			);

			const result = await databaseService.testConnection(selectedConfig);

			if (result.success) {
				notificationService.info(
					localize('database.testConnectionSuccess',
						'连接测试成功!\n服务器版本: {0}\n响应时间: {1}ms',
						result.serverVersion || '未知',
						result.responseTime || 0
					)
				);
			} else {
				notificationService.error(
					localize('database.testConnectionFailed',
						'连接测试失败\n错误信息: {0}',
						result.error || '未知错误'
					)
				);
			}

		} catch (error) {
			notificationService.error(
				localize('database.testConnectionError', '测试连接时出错: {0}', String(error))
			);
		}
	}
}

/**
 * 连接到数据库 Action
 */
class ConnectToDatabaseAction extends Action2 {
	static readonly ID = 'database.connect';

	constructor() {
		super({
			id: ConnectToDatabaseAction.ID,
			title: {
				value: localize('database.connect', "连接"),
				original: 'Connect'
			},
			icon: ThemeIcon.fromId('plug'),
			f1: false
		});
	}

	async run(accessor: ServicesAccessor, connectionId?: string): Promise<void> {
		const quickInputService = accessor.get(IQuickInputService);
		const notificationService = accessor.get(INotificationService);
		const databaseService = accessor.get(IDatabaseService);
		const storageService = accessor.get(IStorageService);

		try {
			// 从存储中加载所有连接
			const connectionsJson = storageService.get('database.connections', StorageScope.PROFILE) || '[]';
			const connections: IDatabaseConnectionConfig[] = JSON.parse(connectionsJson);

			if (connections.length === 0) {
				notificationService.warn(
					localize('database.noConnections', '还没有任何数据库连接，请先添加连接')
				);
				return;
			}

			let selectedConfig: IDatabaseConnectionConfig | undefined;

			if (connectionId) {
				selectedConfig = connections.find(c => c.id === connectionId);
			} else {
				// 让用户选择要连接的数据库
				const items: IQuickPickItem[] = connections.map(conn => ({
					label: conn.name,
					description: `${conn.type} - ${conn.host}:${conn.port}/${conn.database}`,
					id: conn.id
				}));

				const selected = await quickInputService.pick(items, {
					placeHolder: localize('database.selectConnectionToConnect', '选择要连接的数据库'),
					canPickMany: false
				});

				if (!selected) {
					return;
				}

				selectedConfig = connections.find(c => c.id === (selected as any).id);
			}

			if (!selectedConfig) {
				notificationService.error(
					localize('database.connectionNotFound', '找不到指定的连接')
				);
				return;
			}

			// 先将连接添加到服务
			await databaseService.addConnection(selectedConfig);

			// 开始连接
			notificationService.info(
				localize('database.connecting', '正在连接到 "{0}"...', selectedConfig.name)
			);

			await databaseService.connect(selectedConfig.id);

			notificationService.info(
				localize('database.connectSuccess', '成功连接到 "{0}"', selectedConfig.name)
			);

		} catch (error) {
			notificationService.error(
				localize('database.connectError', '连接失败: {0}', String(error))
			);
		}
	}
}

/**
 * 断开数据库连接 Action
 */
class DisconnectDatabaseAction extends Action2 {
	static readonly ID = 'database.disconnect';

	constructor() {
		super({
			id: DisconnectDatabaseAction.ID,
			title: {
				value: localize('database.disconnect', "断开连接"),
				original: 'Disconnect'
			},
			icon: ThemeIcon.fromId('debug-disconnect'),
			f1: false
		});
	}

	async run(accessor: ServicesAccessor, connectionId?: string): Promise<void> {
		const quickInputService = accessor.get(IQuickInputService);
		const notificationService = accessor.get(INotificationService);
		const databaseService = accessor.get(IDatabaseService);

		try {
			// 获取所有连接
			const allConnections = await databaseService.getAllConnections();

			// 过滤出已连接的连接
			const connectedConnections: IDatabaseConnectionConfig[] = [];
			for (const config of allConnections) {
				const conn = await databaseService.getConnection(config.id);
				if (conn && conn.status === 'connected') {
					connectedConnections.push(config);
				}
			}

			if (connectedConnections.length === 0) {
				notificationService.warn(
					localize('database.noActiveConnections', '没有活动的数据库连接')
				);
				return;
			}

			let selectedConfig: IDatabaseConnectionConfig | undefined;

			if (connectionId) {
				selectedConfig = connectedConnections.find(c => c.id === connectionId);
			} else {
				// 让用户选择要断开的连接
				const items: IQuickPickItem[] = connectedConnections.map(conn => ({
					label: conn.name,
					description: `${conn.type} - ${conn.host}:${conn.port}/${conn.database}`,
					id: conn.id
				}));

				const selected = await quickInputService.pick(items, {
					placeHolder: localize('database.selectConnectionToDisconnect', '选择要断开的连接'),
					canPickMany: false
				});

				if (!selected) {
					return;
				}

				selectedConfig = connectedConnections.find(c => c.id === (selected as any).id);
			}

			if (!selectedConfig) {
				notificationService.error(
					localize('database.connectionNotFound', '找不到指定的连接')
				);
				return;
			}

			// 断开连接
			notificationService.info(
				localize('database.disconnecting', '正在断开连接 "{0}"...', selectedConfig.name)
			);

			await databaseService.disconnect(selectedConfig.id);

			notificationService.info(
				localize('database.disconnectSuccess', '已断开连接 "{0}"', selectedConfig.name)
			);

		} catch (error) {
			notificationService.error(
				localize('database.disconnectError', '断开连接失败: {0}', String(error))
			);
		}
	}
}

/**
 * 编辑数据库连接 Action
 */
class EditDatabaseConnectionAction extends Action2 {
	static readonly ID = 'database.editConnection';

	constructor() {
		super({
			id: EditDatabaseConnectionAction.ID,
			title: {
				value: localize('database.editConnection', "编辑连接"),
				original: 'Edit Connection'
			},
			icon: ThemeIcon.fromId('edit'),
			f1: false
		});
	}

	async run(accessor: ServicesAccessor, connectionId?: string): Promise<void> {
		const quickInputService = accessor.get(IQuickInputService);
		const dialogService = accessor.get(IDialogService);
		const notificationService = accessor.get(INotificationService);
		const databaseService = accessor.get(IDatabaseService);
		const storageService = accessor.get(IStorageService);

		try {
			// 从存储中加载所有连接
			const connectionsJson = storageService.get('database.connections', StorageScope.PROFILE) || '[]';
			const connections: IDatabaseConnectionConfig[] = JSON.parse(connectionsJson);

			if (connections.length === 0) {
				notificationService.warn(
					localize('database.noConnections', '还没有任何数据库连接，请先添加连接')
				);
				return;
			}

			let selectedConfig: IDatabaseConnectionConfig | undefined;

			if (connectionId) {
				selectedConfig = connections.find(c => c.id === connectionId);
			} else {
				// 让用户选择要编辑的连接
				const items: IQuickPickItem[] = connections.map(conn => ({
					label: conn.name,
					description: `${conn.type} - ${conn.host}:${conn.port}`,
					id: conn.id
				}));

				const selected = await quickInputService.pick(items, {
					placeHolder: localize('database.selectConnectionToEdit', '选择要编辑的连接'),
					canPickMany: false
				});

				if (!selected) {
					return;
				}

				selectedConfig = connections.find(c => c.id === (selected as any).id);
			}

			if (!selectedConfig) {
				notificationService.error(
					localize('database.connectionNotFound', '找不到指定的连接')
				);
				return;
			}

			// 使用表单对话框编辑连接
			const formData = await showDatabaseConnectionDialog(dialogService, selectedConfig);

			if (!formData) {
				return; // 用户取消了
			}

			// 更新配置
			const updatedConfig: IDatabaseConnectionConfig = {
				...selectedConfig,
				name: formData.name,
				type: formData.type,
				host: formData.host,
				port: formData.port,
				username: formData.username,
				password: formData.password,
				database: formData.database,
				charset: formData.type === DatabaseType.MySQL ? 'utf8mb4' : 'UTF8'
			};

			// 更新存储
			const index = connections.findIndex(c => c.id === selectedConfig!.id);
			if (index >= 0) {
				connections[index] = updatedConfig;
				storageService.store('database.connections', JSON.stringify(connections), StorageScope.PROFILE, StorageTarget.USER);
			}

			// 更新服务中的连接 - 如果服务中没有该连接,先添加
			try {
				const existingConnection = await databaseService.getConnection(selectedConfig.id);
				if (existingConnection) {
					await databaseService.updateConnection(selectedConfig.id, updatedConfig);
				} else {
					// 服务中没有该连接,先添加
					await databaseService.addConnection(updatedConfig);
				}
			} catch (updateError: any) {
				// 如果更新失败(连接不存在),尝试添加
				if (updateError.message && updateError.message.includes('not found')) {
					await databaseService.addConnection(updatedConfig);
				} else {
					throw updateError;
				}
			}

			notificationService.info(
				localize('database.connectionUpdated', '连接 "{0}" 已更新', updatedConfig.name)
			);

		} catch (error) {
			notificationService.error(
				localize('database.editConnectionError', '编辑连接失败: {0}', String(error))
			);
		}
	}
}

/**
 * 删除数据库连接 Action
 */
class DeleteDatabaseConnectionAction extends Action2 {
	static readonly ID = 'database.deleteConnection';

	constructor() {
		super({
			id: DeleteDatabaseConnectionAction.ID,
			title: {
				value: localize('database.deleteConnection', "删除连接"),
				original: 'Delete Connection'
			},
			icon: ThemeIcon.fromId('trash'),
			f1: false
		});
	}

	async run(accessor: ServicesAccessor, connectionId?: string): Promise<void> {
		const quickInputService = accessor.get(IQuickInputService);
		const dialogService = accessor.get(IDialogService);
		const notificationService = accessor.get(INotificationService);
		const databaseService = accessor.get(IDatabaseService);
		const storageService = accessor.get(IStorageService);

		try {
			// 从存储中加载所有连接
			const connectionsJson = storageService.get('database.connections', StorageScope.PROFILE) || '[]';
			const connections: IDatabaseConnectionConfig[] = JSON.parse(connectionsJson);

			if (connections.length === 0) {
				notificationService.warn(
					localize('database.noConnections', '还没有任何数据库连接')
				);
				return;
			}

			let selectedConfig: IDatabaseConnectionConfig | undefined;

			if (connectionId) {
				selectedConfig = connections.find(c => c.id === connectionId);
			} else {
				// 让用户选择要删除的连接
				const items: IQuickPickItem[] = connections.map(conn => ({
					label: conn.name,
					description: `${conn.type} - ${conn.host}:${conn.port}`,
					id: conn.id
				}));

				const selected = await quickInputService.pick(items, {
					placeHolder: localize('database.selectConnectionToDelete', '选择要删除的连接'),
					canPickMany: false
				});

				if (!selected) {
					return;
				}

				selectedConfig = connections.find(c => c.id === (selected as any).id);
			}

			if (!selectedConfig) {
				notificationService.error(
					localize('database.connectionNotFound', '找不到指定的连接')
				);
				return;
			}

			// 确认删除
			const result = await dialogService.confirm({
				type: 'warning',
				message: localize('database.confirmDelete.title', '确定要删除连接 "{0}" 吗?', selectedConfig.name),
				detail: localize('database.confirmDelete.detail', '此操作无法撤销'),
				primaryButton: localize('database.delete', '删除')
			});

			if (!result.confirmed) {
				return;
			}

			// 从存储中删除
			const filteredConnections = connections.filter(c => c.id !== selectedConfig!.id);
			storageService.store('database.connections', JSON.stringify(filteredConnections), StorageScope.PROFILE, StorageTarget.USER);

			// 从服务中删除 - 忽略服务中不存在的情况
			try {
				await databaseService.removeConnection(selectedConfig.id);
			} catch (removeError: any) {
				// 如果服务中不存在该连接,忽略错误(因为存储已删除)
				if (!removeError.message || !removeError.message.includes('not found')) {
					throw removeError;
				}
			}

			notificationService.info(
				localize('database.connectionDeleted', '已删除连接 "{0}"', selectedConfig.name)
			);

		} catch (error) {
			notificationService.error(
				localize('database.deleteConnectionError', '删除连接失败: {0}', String(error))
			);
		}
	}
}

/**
 * 查看表结构 Action
 */
class ViewTableStructureAction extends Action2 {
	static readonly ID = 'database.viewTableStructure';

	constructor() {
		super({
			id: ViewTableStructureAction.ID,
			title: {
				value: localize('database.viewTableStructure', "查看表结构"),
				original: 'View Table Structure'
			},
			icon: ThemeIcon.fromId('table'),
			f1: false
		});
	}

	async run(accessor: ServicesAccessor, args?: any): Promise<void> {
		const quickInputService = accessor.get(IQuickInputService);
		const notificationService = accessor.get(INotificationService);
		const databaseService = accessor.get(IDatabaseService);
		const storageService = accessor.get(IStorageService);

		try {
			// 从存储中加载所有连接
			const connectionsJson = storageService.get('database.connections', StorageScope.PROFILE) || '[]';
			const connections: IDatabaseConnectionConfig[] = JSON.parse(connectionsJson);

			if (connections.length === 0) {
				notificationService.warn(
					localize('database.noConnections', '还没有任何数据库连接，请先添加连接')
				);
				return;
			}

			// 步骤1: 选择连接
			const connectionItems: IQuickPickItem[] = connections.map(conn => ({
				label: conn.name,
				description: `${conn.type} - ${conn.host}:${conn.port}`,
				id: conn.id
			}));

			const selectedConnection = await quickInputService.pick(connectionItems, {
				placeHolder: localize('database.selectConnection', '选择数据库连接'),
				canPickMany: false
			});

			if (!selectedConnection) {
				return;
			}

			const connectionConfig = connections.find(c => c.id === (selectedConnection as any).id);
			if (!connectionConfig) {
				return;
			}

			// 确保连接已添加到服务
			await databaseService.addConnection(connectionConfig);

			// 尝试连接
			const connection = await databaseService.getConnection(connectionConfig.id);
			if (!connection || connection.status !== 'connected') {
				await databaseService.connect(connectionConfig.id);
			}

			// 步骤2: 获取并选择数据库/模式
			const schemas = await databaseService.getSchemas(connectionConfig.id);

			if (schemas.length === 0) {
				notificationService.warn(
					localize('database.noSchemas', '该连接没有可用的数据库')
				);
				return;
			}

			const schemaItems: IQuickPickItem[] = schemas.map(schema => ({
				label: schema.name,
				description: localize('database.schema', '数据库')
			}));

			const selectedSchema = await quickInputService.pick(schemaItems, {
				placeHolder: localize('database.selectSchema', '选择数据库'),
				canPickMany: false
			});

			if (!selectedSchema) {
				return;
			}

			// 步骤3: 获取并选择表
			const tables = await databaseService.getTables(connectionConfig.id, selectedSchema.label);

			if (tables.length === 0) {
				notificationService.warn(
					localize('database.noTables', '该数据库没有表')
				);
				return;
			}

			const tableItems: IQuickPickItem[] = tables.map(table => ({
				label: table.name,
				description: table.comment || ''
			}));

			const selectedTable = await quickInputService.pick(tableItems, {
				placeHolder: localize('database.selectTable', '选择表'),
				canPickMany: false
			});

			if (!selectedTable) {
				return;
			}

			// 步骤4: 获取表结构
			const tableStructure = await databaseService.getTableStructure(
				connectionConfig.id,
				selectedSchema.label,
				selectedTable.label
			);

			// 构建表结构信息
			let structureInfo = `表名: ${tableStructure.name}\n`;
			structureInfo += `数据库: ${tableStructure.schema}\n\n`;
			structureInfo += `字段 (${tableStructure.columns.length}):\n`;
			structureInfo += '─'.repeat(80) + '\n';

			tableStructure.columns.forEach((col, index) => {
				structureInfo += `${index + 1}. ${col.name}\n`;
				structureInfo += `   类型: ${col.dataType}${col.length ? `(${col.length})` : ''}\n`;
				structureInfo += `   允许空值: ${col.nullable ? '是' : '否'}\n`;
				if (col.defaultValue) {
					structureInfo += `   默认值: ${col.defaultValue}\n`;
				}
				if (col.isPrimaryKey) {
					structureInfo += `   主键: 是\n`;
				}
				if (col.isUnique) {
					structureInfo += `   唯一: 是\n`;
				}
				if (col.autoIncrement) {
					structureInfo += `   自动增长: 是\n`;
				}
				if (col.comment) {
					structureInfo += `   注释: ${col.comment}\n`;
				}
				structureInfo += '\n';
			});

			if (tableStructure.indexes && tableStructure.indexes.length > 0) {
				structureInfo += `\n索引 (${tableStructure.indexes.length}):\n`;
				structureInfo += '─'.repeat(80) + '\n';
				tableStructure.indexes.forEach((idx, index) => {
					structureInfo += `${index + 1}. ${idx.name}\n`;
					structureInfo += `   类型: ${idx.type}\n`;
					structureInfo += `   字段: ${idx.columns.join(', ')}\n\n`;
				});
			}

			// 显示表结构信息
			notificationService.info(
				localize('database.tableStructureInfo', '表结构信息:\n{0}', structureInfo)
			);

		} catch (error) {
			notificationService.error(
				localize('database.viewTableStructureError', '查看表结构失败: {0}', String(error))
			);
		}
	}
}

/**
 * 查看表数据 Action
 */
class ViewTableDataAction extends Action2 {
	static readonly ID = 'database.viewTableData';

	constructor() {
		super({
			id: ViewTableDataAction.ID,
			title: {
				value: localize('database.viewTableData', "查看数据"),
				original: 'View Data'
			},
			icon: ThemeIcon.fromId('table'),
			f1: false
		});
	}

	async run(accessor: ServicesAccessor, args?: any): Promise<void> {
		const quickInputService = accessor.get(IQuickInputService);
		const notificationService = accessor.get(INotificationService);
		const databaseService = accessor.get(IDatabaseService);
		const storageService = accessor.get(IStorageService);

		try {
			// 从存储中加载所有连接
			const connectionsJson = storageService.get('database.connections', StorageScope.PROFILE) || '[]';
			const connections: IDatabaseConnectionConfig[] = JSON.parse(connectionsJson);

			if (connections.length === 0) {
				notificationService.warn(
					localize('database.noConnections', '还没有任何数据库连接，请先添加连接')
				);
				return;
			}

			// 步骤1: 选择连接
			const connectionItems: IQuickPickItem[] = connections.map(conn => ({
				label: conn.name,
				description: `${conn.type} - ${conn.host}:${conn.port}`,
				id: conn.id
			}));

			const selectedConnection = await quickInputService.pick(connectionItems, {
				placeHolder: localize('database.selectConnection', '选择数据库连接'),
				canPickMany: false
			});

			if (!selectedConnection) {
				return;
			}

			const connectionConfig = connections.find(c => c.id === (selectedConnection as any).id);
			if (!connectionConfig) {
				return;
			}

			// 确保连接已添加到服务
			await databaseService.addConnection(connectionConfig);

			// 尝试连接
			const connection = await databaseService.getConnection(connectionConfig.id);
			if (!connection || connection.status !== 'connected') {
				await databaseService.connect(connectionConfig.id);
			}

			// 步骤2: 获取并选择数据库/模式
			const schemas = await databaseService.getSchemas(connectionConfig.id);

			if (schemas.length === 0) {
				notificationService.warn(
					localize('database.noSchemas', '该连接没有可用的数据库')
				);
				return;
			}

			const schemaItems: IQuickPickItem[] = schemas.map(schema => ({
				label: schema.name,
				description: localize('database.schema', '数据库')
			}));

			const selectedSchema = await quickInputService.pick(schemaItems, {
				placeHolder: localize('database.selectSchema', '选择数据库'),
				canPickMany: false
			});

			if (!selectedSchema) {
				return;
			}

			// 步骤3: 获取并选择表
			const tables = await databaseService.getTables(connectionConfig.id, selectedSchema.label);

			if (tables.length === 0) {
				notificationService.warn(
					localize('database.noTables', '该数据库没有表')
				);
				return;
			}

			const tableItems: IQuickPickItem[] = tables.map(table => ({
				label: table.name,
				description: table.comment || ''
			}));

			const selectedTable = await quickInputService.pick(tableItems, {
				placeHolder: localize('database.selectTable', '选择表'),
				canPickMany: false
			});

			if (!selectedTable) {
				return;
			}

			// 步骤4: 输入查询限制
			const limit = await quickInputService.input({
				prompt: localize('database.queryLimit', '查询记录数限制'),
				placeHolder: localize('database.queryLimit.placeholder', '默认100条'),
				value: '100',
				validateInput: async (value) => {
					const num = parseInt(value, 10);
					if (isNaN(num) || num <= 0 || num > 10000) {
						return localize('database.queryLimit.invalid', '记录数必须在 1-10000 之间');
					}
					return undefined;
				}
			});

			if (!limit) {
				return;
			}

			// 步骤5: 查询表数据
			const sql = `SELECT * FROM \`${selectedSchema.label}\`.\`${selectedTable.label}\` LIMIT ${limit}`;

			notificationService.info(
				localize('database.queryingData', '正在查询数据...')
			);

			const rows = await databaseService.executeQuery(connectionConfig.id, sql);

			if (rows.length === 0) {
				notificationService.info(
					localize('database.noDataFound', '表 "{0}" 没有数据', selectedTable.label)
				);
				return;
			}

			// 构建数据显示信息
			let dataInfo = `表: ${selectedTable.label}\n`;
			dataInfo += `数据库: ${selectedSchema.label}\n`;
			dataInfo += `查询到 ${rows.length} 条记录\n\n`;
			dataInfo += '─'.repeat(80) + '\n';

			// 获取列名
			const columns = Object.keys(rows[0]);
			dataInfo += `列: ${columns.join(', ')}\n`;
			dataInfo += '─'.repeat(80) + '\n\n';

			// 显示前10条数据
			const displayRows = rows.slice(0, 10);
			displayRows.forEach((row, index) => {
				dataInfo += `记录 ${index + 1}:\n`;
				columns.forEach(col => {
					const value = row[col];
					const displayValue = value === null ? 'NULL' :
						value === undefined ? 'undefined' :
						typeof value === 'object' ? JSON.stringify(value) :
						String(value);
					dataInfo += `  ${col}: ${displayValue}\n`;
				});
				dataInfo += '\n';
			});

			if (rows.length > 10) {
				dataInfo += `... 还有 ${rows.length - 10} 条记录\n`;
			}

			// 显示数据信息
			notificationService.info(
				localize('database.tableDataInfo', '表数据:\n{0}', dataInfo)
			);

		} catch (error) {
			notificationService.error(
				localize('database.viewTableDataError', '查看表数据失败: {0}', String(error))
			);
		}
	}
}

/**
 * AI辅助SQL生成 Action
 */
class GenerateSQLWithAIAction extends Action2 {
	static readonly ID = 'database.generateSQLWithAI';

	constructor() {
		super({
			id: GenerateSQLWithAIAction.ID,
			title: {
				value: localize('database.generateSQLWithAI', "AI辅助生成SQL"),
				original: 'Generate SQL with AI'
			},
			icon: ThemeIcon.fromId('sparkle'),
			f1: true
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const quickInputService = accessor.get(IQuickInputService);
		const notificationService = accessor.get(INotificationService);
		const databaseService = accessor.get(IDatabaseService);
		const storageService = accessor.get(IStorageService);

		try {
			// 从存储中加载所有连接
			const connectionsJson = storageService.get('database.connections', StorageScope.PROFILE) || '[]';
			const connections: IDatabaseConnectionConfig[] = JSON.parse(connectionsJson);

			if (connections.length === 0) {
				notificationService.warn(
					localize('database.noConnections', '还没有任何数据库连接，请先添加连接')
				);
				return;
			}

			// 步骤1: 选择连接
			const connectionItems: IQuickPickItem[] = connections.map(conn => ({
				label: conn.name,
				description: `${conn.type} - ${conn.host}:${conn.port}`,
				id: conn.id
			}));

			const selectedConnection = await quickInputService.pick(connectionItems, {
				placeHolder: localize('database.selectConnection', '选择数据库连接'),
				canPickMany: false
			});

			if (!selectedConnection) {
				return;
			}

			const connectionConfig = connections.find(c => c.id === (selectedConnection as any).id);
			if (!connectionConfig) {
				return;
			}

			// 确保连接已添加到服务
			await databaseService.addConnection(connectionConfig);

			// 尝试连接
			const connection = await databaseService.getConnection(connectionConfig.id);
			if (!connection || connection.status !== 'connected') {
				await databaseService.connect(connectionConfig.id);
			}

			// 步骤2: 选择数据库
			const schemas = await databaseService.getSchemas(connectionConfig.id);

			if (schemas.length === 0) {
				notificationService.warn(
					localize('database.noSchemas', '该连接没有可用的数据库')
				);
				return;
			}

			const schemaItems: IQuickPickItem[] = schemas.map(schema => ({
				label: schema.name,
				description: localize('database.schema', '数据库')
			}));

			const selectedSchema = await quickInputService.pick(schemaItems, {
				placeHolder: localize('database.selectSchema', '选择数据库'),
				canPickMany: false
			});

			if (!selectedSchema) {
				return;
			}

			// 步骤3: 输入自然语言描述
			const naturalLanguage = await quickInputService.input({
				prompt: localize('database.enterNaturalLanguage', '输入查询需求的自然语言描述'),
				placeHolder: localize('database.naturalLanguage.placeholder', '例如: 查询所有销售额大于10000的订单'),
				validateInput: async (value) => {
					if (!value || value.trim().length === 0) {
						return localize('database.naturalLanguage.required', '请输入查询需求描述');
					}
					return undefined;
				}
			});

			if (!naturalLanguage) {
				return;
			}

			// 步骤4: 使用AI生成SQL
			notificationService.info(
				localize('database.generatingSQL', '正在使用AI生成SQL...')
			);

			try {
				const sql = await databaseService.naturalLanguageToSQL(
					connectionConfig.id,
					selectedSchema.label,
					naturalLanguage.trim()
				);

				// 显示生成的SQL
				notificationService.info(
					localize('database.generatedSQL', 'AI生成的SQL:\n\n{0}\n\n提示: 您可以复制此SQL到查询编辑器中执行', sql)
				);

			} catch (aiError: any) {
				// AI服务未实现或出错,提供友好提示
				notificationService.warn(
					localize('database.aiNotAvailable',
						'AI SQL生成服务暂未配置\n\n输入的需求: {0}\n\n请确保已配置AI服务后再使用此功能',
						naturalLanguage.trim()
					)
				);
			}

		} catch (error) {
			notificationService.error(
				localize('database.generateSQLError', 'AI生成SQL失败: {0}', String(error))
			);
		}
	}
}

/**
 * SQL优化建议 Action
 */
class OptimizeSQLAction extends Action2 {
	static readonly ID = 'database.optimizeSQL';

	constructor() {
		super({
			id: OptimizeSQLAction.ID,
			title: {
				value: localize('database.optimizeSQL', "SQL优化建议"),
				original: 'Optimize SQL'
			},
			icon: ThemeIcon.fromId('lightbulb'),
			f1: true
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const quickInputService = accessor.get(IQuickInputService);
		const notificationService = accessor.get(INotificationService);
		const databaseService = accessor.get(IDatabaseService);
		const storageService = accessor.get(IStorageService);

		try {
			// 从存储中加载所有连接
			const connectionsJson = storageService.get('database.connections', StorageScope.PROFILE) || '[]';
			const connections: IDatabaseConnectionConfig[] = JSON.parse(connectionsJson);

			if (connections.length === 0) {
				notificationService.warn(
					localize('database.noConnections', '还没有任何数据库连接，请先添加连接')
				);
				return;
			}

			// 步骤1: 选择连接
			const connectionItems: IQuickPickItem[] = connections.map(conn => ({
				label: conn.name,
				description: `${conn.type} - ${conn.host}:${conn.port}`,
				id: conn.id
			}));

			const selectedConnection = await quickInputService.pick(connectionItems, {
				placeHolder: localize('database.selectConnection', '选择数据库连接'),
				canPickMany: false
			});

			if (!selectedConnection) {
				return;
			}

			const connectionConfig = connections.find(c => c.id === (selectedConnection as any).id);
			if (!connectionConfig) {
				return;
			}

			// 步骤2: 输入要优化的SQL
			const sql = await quickInputService.input({
				prompt: localize('database.enterSQLToOptimize', '输入要优化的SQL语句'),
				placeHolder: localize('database.sql.placeholder', '例如: SELECT * FROM users WHERE age > 18'),
				validateInput: async (value) => {
					if (!value || value.trim().length === 0) {
						return localize('database.sql.required', '请输入SQL语句');
					}
					return undefined;
				}
			});

			if (!sql) {
				return;
			}

			// 步骤3: 使用AI优化SQL
			notificationService.info(
				localize('database.optimizingSQL', '正在分析和优化SQL...')
			);

			try {
				// 调用 optimizeSQL 方法（使用新的参数格式）
				const result = await databaseService.optimizeSQL(sql.trim(), '', connectionConfig.type);

				// 构建优化建议信息
				let optimizationInfo = `原始SQL:\n${sql.trim()}\n\n`;
				optimizationInfo += '─'.repeat(80) + '\n\n';

				if (result.optimizedSql) {
					optimizationInfo += `优化后的SQL:\n${result.optimizedSql}\n\n`;
					optimizationInfo += '─'.repeat(80) + '\n\n';
				}

				optimizationInfo += `综合评分: ${result.score}/100\n`;
				optimizationInfo += `问题级别: ${result.level}\n\n`;

				if (result.issues && result.issues.length > 0) {
					optimizationInfo += `发现的问题:\n`;
					result.issues.forEach((issue, index) => {
						optimizationInfo += `${index + 1}. [${issue.severity}] ${issue.title}\n`;
						optimizationInfo += `   ${issue.description}\n`;
						optimizationInfo += `   建议: ${issue.suggestion}\n\n`;
					});
				}

				optimizationInfo += `优化要点:\n`;
				result.optimizationPoints.forEach((point, index) => {
					optimizationInfo += `${index + 1}. ${point}\n`;
				});

				if (result.estimatedImprovement) {
					optimizationInfo += `\n${result.estimatedImprovement}`;
				}

				// 显示优化建议
				notificationService.info(
					localize('database.optimizationResult', 'SQL优化建议:\n\n{0}', optimizationInfo)
				);

			} catch (aiError: any) {
				// AI服务未实现或出错,提供友好提示
				notificationService.warn(
					localize('database.optimizationNotAvailable',
						'SQL优化服务暂未配置\n\n输入的SQL: {0}\n\n请确保已配置AI服务后再使用此功能',
						sql.trim()
					)
				);
			}

		} catch (error) {
			notificationService.error(
				localize('database.optimizeSQLError', 'SQL优化失败: {0}', String(error))
			);
		}
	}
}

/**
 * 分析优化表结构 Action
 */
class AnalyzeTableStructureAction extends Action2 {
	static readonly ID = 'database.analyzeTableStructure';

	constructor() {
		super({
			id: AnalyzeTableStructureAction.ID,
			title: {
				value: localize('database.analyzeTableStructure', "分析优化表结构"),
				original: 'Analyze Table Structure'
			},
			icon: ThemeIcon.fromId('search'),
			f1: true
		});
	}

	async run(accessor: ServicesAccessor, args?: { connectionId?: string; schema?: string; tableName?: string }): Promise<void> {
		const quickInputService = accessor.get(IQuickInputService);
		const notificationService = accessor.get(INotificationService);
		const databaseService = accessor.get(IDatabaseService);
		const storageService = accessor.get(IStorageService);

		try {
			let connectionId = args?.connectionId;
			let schema = args?.schema;
			let tableName = args?.tableName;

			// 如果没有提供参数，通过交互获取
			if (!connectionId || !schema || !tableName) {
				// 从存储中加载所有连接
				const connectionsJson = storageService.get('database.connections', StorageScope.PROFILE) || '[]';
				const connections: IDatabaseConnectionConfig[] = JSON.parse(connectionsJson);

				if (connections.length === 0) {
					notificationService.warn(
						localize('database.noConnections', '还没有任何数据库连接，请先添加连接')
					);
					return;
				}

				// 选择连接
				const connectionItems: IQuickPickItem[] = connections.map(conn => ({
					label: conn.name,
					description: `${conn.type} - ${conn.host}:${conn.port}`,
					id: conn.id
				}));

				const selectedConnection = await quickInputService.pick(connectionItems, {
					placeHolder: localize('database.selectConnection', '选择数据库连接'),
					canPickMany: false
				});

				if (!selectedConnection) {
					return;
				}

				connectionId = (selectedConnection as any).id;
				const connectionConfig = connections.find(c => c.id === connectionId);
				if (!connectionConfig) {
					return;
				}

				// 确保连接
				await databaseService.addConnection(connectionConfig);
				const connection = await databaseService.getConnection(connectionId!);
				if (!connection || connection.status !== 'connected') {
					await databaseService.connect(connectionId!);
				}

				// 选择Schema
				const schemas = await databaseService.getSchemas(connectionId!);
				if (schemas.length === 0) {
					notificationService.warn(localize('database.noSchemas', '该连接没有可用的数据库'));
					return;
				}

				const schemaItems: IQuickPickItem[] = schemas.map(s => ({
					label: s.name,
					description: localize('database.schema', '数据库')
				}));

				const selectedSchema = await quickInputService.pick(schemaItems, {
					placeHolder: localize('database.selectSchema', '选择数据库'),
					canPickMany: false
				});

				if (!selectedSchema) {
					return;
				}

				schema = selectedSchema.label;

				// 选择表
				const tables = await databaseService.getTables(connectionId!, schema);
				if (tables.length === 0) {
					notificationService.warn(localize('database.noTables', '该数据库没有表'));
					return;
				}

				const tableItems: IQuickPickItem[] = tables.map(table => ({
					label: table.name,
					description: table.comment || ''
				}));

				const selectedTable = await quickInputService.pick(tableItems, {
					placeHolder: localize('database.selectTable', '选择要分析的表'),
					canPickMany: false
				});

				if (!selectedTable) {
					return;
				}

				tableName = selectedTable.label;
			}

			// 获取表结构
			notificationService.info(localize('database.analyzingTable', '正在分析表结构...'));

			await databaseService.getTableStructure(connectionId!, schema!, tableName!);

			// TODO: 调用AI分析表结构，生成优化建议
			// 这里需要创建后端提示词模板 IDE_DB_TABLE_ANALYZE

			notificationService.info(
				localize('database.analyzeComplete', '表结构分析功能开发中，请使用专门的分析视图')
			);

		} catch (error) {
			notificationService.error(
				localize('database.analyzeTableError', '分析表结构失败: {0}', String(error))
			);
		}
	}
}

// 注册所有 Actions
registerAction2(AddDatabaseConnectionAction);
registerAction2(RefreshDatabaseConnectionAction);
registerAction2(TestDatabaseConnectionAction);
registerAction2(ConnectToDatabaseAction);
registerAction2(DisconnectDatabaseAction);
registerAction2(EditDatabaseConnectionAction);
registerAction2(DeleteDatabaseConnectionAction);
registerAction2(ViewTableStructureAction);
registerAction2(ViewTableDataAction);
registerAction2(GenerateSQLWithAIAction);
registerAction2(OptimizeSQLAction);
registerAction2(AnalyzeTableStructureAction);
