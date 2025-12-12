/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { IDatabaseService } from '../common/databaseService.js';
import { IDatabaseConnectionConfig, DatabaseType } from '../common/databaseConnection.js';
import { IDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { localize } from '../../../../nls.js';

const STORAGE_KEY_CONNECTIONS = 'database.connections';

/**
 * 连接管理视图
 * 负责管理数据库连接的增删改查
 */
export class DatabaseConnectionManager extends Disposable {
	private connections: IDatabaseConnectionConfig[] = [];

	constructor(
		private readonly databaseService: IDatabaseService,
		private readonly storageService: IStorageService,
		private readonly dialogService: IDialogService,
		private readonly notificationService: INotificationService
	) {
		super();
		this.loadConnections();
	}

	/**
	 * 从存储加载连接
	 */
	private loadConnections(): void {
		const stored = this.storageService.get(STORAGE_KEY_CONNECTIONS, StorageScope.PROFILE);
		if (stored) {
			try {
				this.connections = JSON.parse(stored);
			} catch (error) {
				console.error('[DatabaseConnectionManager] Failed to parse connections:', error);
				this.connections = [];
			}
		}
	}

	/**
	 * 保存连接到存储
	 */
	private saveConnections(): void {
		this.storageService.store(
			STORAGE_KEY_CONNECTIONS,
			JSON.stringify(this.connections),
			StorageScope.PROFILE,
			StorageTarget.USER
		);
	}

	/**
	 * 获取所有连接
	 */
	getAllConnections(): IDatabaseConnectionConfig[] {
		return [...this.connections];
	}

	/**
	 * 获取单个连接
	 */
	getConnection(id: string): IDatabaseConnectionConfig | undefined {
		return this.connections.find(c => c.id === id);
	}

	/**
	 * 添加新连接
	 */
	async addConnection(config: Omit<IDatabaseConnectionConfig, 'id'>): Promise<string> {
		// 生成唯一ID
		const id = generateUuid();

		const newConnection: IDatabaseConnectionConfig = {
			...config,
			id
		};

		// 验证配置
		if (!this.validateConnection(newConnection)) {
			throw new Error('Invalid connection configuration');
		}

		this.connections.push(newConnection);
		this.saveConnections();

		// 添加到数据库服务
		await this.databaseService.addConnection(newConnection);

		this.notificationService.info(
			localize('database.connectionAdded', '数据库连接 "{0}" 已添加', config.name)
		);

		return id;
	}

	/**
	 * 更新连接
	 */
	async updateConnection(id: string, updates: Partial<IDatabaseConnectionConfig>): Promise<void> {
		const index = this.connections.findIndex(c => c.id === id);
		if (index === -1) {
			throw new Error(`Connection ${id} not found`);
		}

		const updatedConnection = {
			...this.connections[index],
			...updates,
			id // 确保ID不被修改
		};

		// 验证配置
		if (!this.validateConnection(updatedConnection)) {
			throw new Error('Invalid connection configuration');
		}

		this.connections[index] = updatedConnection;
		this.saveConnections();

		// 更新数据库服务
		await this.databaseService.updateConnection(id, updates);

		this.notificationService.info(
			localize('database.connectionUpdated', '数据库连接 "{0}" 已更新', updatedConnection.name)
		);
	}

	/**
	 * 删除连接
	 */
	async removeConnection(id: string): Promise<void> {
		const connection = this.getConnection(id);
		if (!connection) {
			throw new Error(`Connection ${id} not found`);
		}

		// 确认删除
		const result = await this.dialogService.confirm({
			type: 'warning',
			message: localize('database.confirmDelete', '确定要删除连接 "{0}" 吗?', connection.name),
			detail: localize('database.confirmDeleteDetail', '此操作无法撤销'),
			primaryButton: localize('database.delete', '删除')
		});

		if (!result.confirmed) {
			return;
		}

		// 从列表移除
		const index = this.connections.findIndex(c => c.id === id);
		if (index >= 0) {
			this.connections.splice(index, 1);
			this.saveConnections();
		}

		// 从数据库服务移除
		await this.databaseService.removeConnection(id);

		this.notificationService.info(
			localize('database.connectionRemoved', '数据库连接 "{0}" 已删除', connection.name)
		);
	}

	/**
	 * 测试连接
	 */
	async testConnection(config: IDatabaseConnectionConfig): Promise<boolean> {
		try {
			this.notificationService.info(
				localize('database.testingConnection', '正在测试连接 "{0}"...', config.name)
			);

			const result = await this.databaseService.testConnection(config);

			if (result.success) {
				this.notificationService.info(
					localize(
						'database.connectionSuccess',
						'连接成功! 服务器版本: {0}, 响应时间: {1}ms',
						result.serverVersion || '未知',
						result.responseTime || 0
					)
				);
				return true;
			} else {
				this.notificationService.error(
					localize('database.connectionFailed', '连接失败: {0}', result.error || '未知错误')
				);
				return false;
			}
		} catch (error) {
			this.notificationService.error(
				localize('database.connectionError', '连接测试失败: {0}', String(error))
			);
			return false;
		}
	}

	/**
	 * 连接到数据库
	 */
	async connect(id: string): Promise<void> {
		const connection = this.getConnection(id);
		if (!connection) {
			throw new Error(`Connection ${id} not found`);
		}

		try {
			this.notificationService.info(
				localize('database.connecting', '正在连接到 "{0}"...', connection.name)
			);

			await this.databaseService.connect(id);

			this.notificationService.info(
				localize('database.connected', '已连接到 "{0}"', connection.name)
			);
		} catch (error) {
			this.notificationService.error(
				localize('database.connectError', '连接失败: {0}', String(error))
			);
			throw error;
		}
	}

	/**
	 * 断开连接
	 */
	async disconnect(id: string): Promise<void> {
		const connection = this.getConnection(id);
		if (!connection) {
			throw new Error(`Connection ${id} not found`);
		}

		try {
			await this.databaseService.disconnect(id);

			this.notificationService.info(
				localize('database.disconnected', '已断开连接 "{0}"', connection.name)
			);
		} catch (error) {
			this.notificationService.error(
				localize('database.disconnectError', '断开连接失败: {0}', String(error))
			);
			throw error;
		}
	}

	/**
	 * 验证连接配置
	 */
	private validateConnection(config: IDatabaseConnectionConfig): boolean {
		// 验证必填字段
		if (!config.name || !config.type || !config.host || !config.username) {
			return false;
		}

		// 验证端口号
		if (config.port <= 0 || config.port > 65535) {
			return false;
		}

		// 验证数据库类型
		if (!Object.values(DatabaseType).includes(config.type)) {
			return false;
		}

		return true;
	}

	/**
	 * 获取默认端口号
	 */
	static getDefaultPort(type: DatabaseType): number {
		switch (type) {
			case DatabaseType.MySQL:
				return 3306;
			case DatabaseType.PostgreSQL:
				return 5432;
			case DatabaseType.Oracle:
				return 1521;
			case DatabaseType.SQLServer:
				return 1433;
			case DatabaseType.SQLite:
				return 0; // SQLite不需要端口
			default:
				return 3306;
		}
	}

	/**
	 * 创建默认连接配置
	 */
	static createDefaultConfig(type: DatabaseType): Omit<IDatabaseConnectionConfig, 'id'> {
		return {
			name: `新建${type}连接`,
			type,
			host: 'localhost',
			port: DatabaseConnectionManager.getDefaultPort(type),
			database: '',
			username: 'root',
			password: '',
			charset: 'utf8mb4',
			ssl: false,
			connectionTimeout: 10000,
			options: {}
		};
	}
}

/**
 * 连接表单数据
 */
export interface IConnectionFormData {
	name: string;
	type: DatabaseType;
	host: string;
	port: number;
	database: string;
	username: string;
	password: string;
	charset?: string;
	ssl?: boolean;
	connectionTimeout?: number;
}

/**
 * 连接表单验证结果
 */
export interface IConnectionFormValidation {
	valid: boolean;
	errors: {
		field: keyof IConnectionFormData;
		message: string;
	}[];
}

/**
 * 连接表单验证器
 */
export class ConnectionFormValidator {
	/**
	 * 验证连接表单
	 */
	static validate(data: IConnectionFormData): IConnectionFormValidation {
		const errors: IConnectionFormValidation['errors'] = [];

		// 验证连接名称
		if (!data.name || data.name.trim().length === 0) {
			errors.push({
				field: 'name',
				message: localize('database.validation.nameRequired', '连接名称不能为空')
			});
		}

		// 验证主机地址
		if (!data.host || data.host.trim().length === 0) {
			errors.push({
				field: 'host',
				message: localize('database.validation.hostRequired', '主机地址不能为空')
			});
		}

		// 验证端口号
		if (data.port <= 0 || data.port > 65535) {
			errors.push({
				field: 'port',
				message: localize('database.validation.portInvalid', '端口号必须在 1-65535 之间')
			});
		}

		// 验证用户名
		if (!data.username || data.username.trim().length === 0) {
			errors.push({
				field: 'username',
				message: localize('database.validation.usernameRequired', '用户名不能为空')
			});
		}

		// SQLite特殊处理
		if (data.type === DatabaseType.SQLite) {
			if (!data.database || data.database.trim().length === 0) {
				errors.push({
					field: 'database',
					message: localize('database.validation.sqlitePath', 'SQLite 需要指定数据库文件路径')
				});
			}
		}

		return {
			valid: errors.length === 0,
			errors
		};
	}

	/**
	 * 验证单个字段
	 */
	static validateField(field: keyof IConnectionFormData, value: any, formData: IConnectionFormData): string | undefined {
		const fullValidation = this.validate(formData);
		const fieldError = fullValidation.errors.find(e => e.field === field);
		return fieldError?.message;
	}
}
