/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * 数据库类型枚举
 */
export enum DatabaseType {
	MySQL = 'mysql',
	PostgreSQL = 'postgresql',
	Oracle = 'oracle',
	SQLServer = 'sqlserver',
	SQLite = 'sqlite'
}

/**
 * 连接状态枚举
 */
export enum ConnectionStatus {
	Disconnected = 'disconnected',
	Connecting = 'connecting',
	Connected = 'connected',
	Error = 'error'
}

/**
 * 数据库连接配置接口
 */
export interface IDatabaseConnectionConfig {
	/** 连接唯一标识 */
	id: string;
	/** 连接名称 */
	name: string;
	/** 数据库类型 */
	type: DatabaseType;
	/** 主机地址 */
	host: string;
	/** 端口号 */
	port: number;
	/** 数据库名称 */
	database: string;
	/** 用户名 */
	username: string;
	/** 密码（加密存储） */
	password?: string;
	/** 字符集 */
	charset?: string;
	/** SSL 配置 */
	ssl?: boolean;
	/** 连接超时时间（毫秒） */
	connectionTimeout?: number;
	/** 其他连接参数 */
	options?: Record<string, any>;
}

/**
 * 数据库连接实例接口
 */
export interface IDatabaseConnection {
	/** 连接配置 */
	config: IDatabaseConnectionConfig;
	/** 连接状态 */
	status: ConnectionStatus;
	/** 错误信息 */
	error?: string;
	/** 连接时间 */
	connectedAt?: Date;
	/** 最后活动时间 */
	lastActiveAt?: Date;
}

/**
 * 连接测试结果接口
 */
export interface IConnectionTestResult {
	/** 是否成功 */
	success: boolean;
	/** 错误信息 */
	error?: string;
	/** 响应时间（毫秒） */
	responseTime?: number;
	/** 服务器版本 */
	serverVersion?: string;
}

/**
 * 数据库连接事件接口
 */
export interface IDatabaseConnectionEvent {
	/** 连接ID */
	connectionId: string;
	/** 事件类型 */
	type: 'connected' | 'disconnected' | 'error';
	/** 时间戳 */
	timestamp: Date;
	/** 附加数据 */
	data?: any;
}
