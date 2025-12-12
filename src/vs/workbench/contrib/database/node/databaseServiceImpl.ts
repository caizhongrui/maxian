/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { Event, Emitter } from '../../../../base/common/event.js';
import { IDatabaseService } from '../common/databaseService.js';
import {
	IDatabaseConnection,
	IDatabaseConnectionConfig,
	IConnectionTestResult,
	IDatabaseConnectionEvent,
	ConnectionStatus,
	DatabaseType
} from '../common/databaseConnection.js';
import {
	ITableStructure,
	ISchemaInfo,
	IViewDefinition,
	IProcedureDefinition,
	IDatabaseObjectNode,
	IColumnDefinition,
	ColumnDataType,
	IndexType
} from '../common/databaseMetadata.js';
import * as mysql from 'mysql2/promise';
import { Pool as PgPool, Client as PgClient } from 'pg';

/**
 * MySQL 连接池接口
 */
interface IMySQLPool {
	query(sql: string, values?: any[]): Promise<any>;
	end(): Promise<void>;
}

/**
 * 数据库服务实现类
 * 支持 MySQL, PostgreSQL, Oracle, SQL Server
 */
export class DatabaseServiceImpl extends Disposable implements IDatabaseService {
	readonly _serviceBrand: undefined;

	private readonly _onDidChangeConnections = this._register(new Emitter<IDatabaseConnectionEvent>());
	readonly onDidChangeConnections: Event<IDatabaseConnectionEvent> = this._onDidChangeConnections.event;

	// 连接池映射 (connectionId -> pool)
	private connectionPools: Map<string, any> = new Map();

	// 连接配置映射
	private connections: Map<string, IDatabaseConnection> = new Map();

	constructor() {
		super();
	}

	// ==================== 连接管理 ====================

	async getAllConnections(): Promise<IDatabaseConnectionConfig[]> {
		return Array.from(this.connections.values()).map(conn => conn.config);
	}

	async getConnection(connectionId: string): Promise<IDatabaseConnection | undefined> {
		return this.connections.get(connectionId);
	}

	async addConnection(config: IDatabaseConnectionConfig): Promise<void> {
		const connection: IDatabaseConnection = {
			config,
			status: ConnectionStatus.Disconnected
		};
		this.connections.set(config.id, connection);

		this._onDidChangeConnections.fire({
			connectionId: config.id,
			type: 'connected',
			timestamp: new Date()
		});
	}

	async updateConnection(connectionId: string, config: Partial<IDatabaseConnectionConfig>): Promise<void> {
		const connection = this.connections.get(connectionId);
		if (!connection) {
			throw new Error(`Connection ${connectionId} not found`);
		}

		// 如果连接是活动的,先断开
		if (connection.status === ConnectionStatus.Connected) {
			await this.disconnect(connectionId);
		}

		// 更新配置
		connection.config = { ...connection.config, ...config };
	}

	async removeConnection(connectionId: string): Promise<void> {
		// 先断开连接
		if (this.connections.get(connectionId)?.status === ConnectionStatus.Connected) {
			await this.disconnect(connectionId);
		}

		this.connections.delete(connectionId);

		this._onDidChangeConnections.fire({
			connectionId,
			type: 'disconnected',
			timestamp: new Date()
		});
	}

	async testConnection(config: IDatabaseConnectionConfig): Promise<IConnectionTestResult> {
		const startTime = Date.now();

		try {
			// 根据数据库类型选择不同的测试方式
			switch (config.type) {
				case DatabaseType.MySQL:
					return await this.testMySQLConnection(config, startTime);
				case DatabaseType.PostgreSQL:
					return await this.testPostgreSQLConnection(config, startTime);
				case DatabaseType.Oracle:
					return await this.testOracleConnection(config, startTime);
				case DatabaseType.SQLServer:
					return await this.testSQLServerConnection(config, startTime);
				case DatabaseType.SQLite:
					return await this.testSQLiteConnection(config, startTime);
				default:
					throw new Error(`Unsupported database type: ${config.type}`);
			}
		} catch (error: any) {
			return {
				success: false,
				error: error.message || String(error),
				responseTime: Date.now() - startTime
			};
		}
	}

	async connect(connectionId: string): Promise<void> {
		const connection = this.connections.get(connectionId);
		if (!connection) {
			throw new Error(`Connection ${connectionId} not found`);
		}

		if (connection.status === ConnectionStatus.Connected) {
			return; // 已经连接
		}

		connection.status = ConnectionStatus.Connecting;

		try {
			// 根据数据库类型创建连接池
			const pool = await this.createConnectionPool(connection.config);
			this.connectionPools.set(connectionId, pool);

			connection.status = ConnectionStatus.Connected;
			connection.connectedAt = new Date();
			connection.lastActiveAt = new Date();

			this._onDidChangeConnections.fire({
				connectionId,
				type: 'connected',
				timestamp: new Date()
			});
		} catch (error) {
			connection.status = ConnectionStatus.Error;
			connection.error = String(error);

			this._onDidChangeConnections.fire({
				connectionId,
				type: 'error',
				timestamp: new Date(),
				data: error
			});

			throw error;
		}
	}

	async disconnect(connectionId: string): Promise<void> {
		const connection = this.connections.get(connectionId);
		if (!connection) {
			throw new Error(`Connection ${connectionId} not found`);
		}

		// 关闭连接池
		const pool = this.connectionPools.get(connectionId);
		if (pool) {
			await this.closeConnectionPool(connection.config.type, pool);
			this.connectionPools.delete(connectionId);
		}

		connection.status = ConnectionStatus.Disconnected;
		connection.connectedAt = undefined;

		this._onDidChangeConnections.fire({
			connectionId,
			type: 'disconnected',
			timestamp: new Date()
		});
	}

	async disconnectAll(): Promise<void> {
		const promises = Array.from(this.connections.keys()).map(id => this.disconnect(id));
		await Promise.all(promises);
	}

	// ==================== 元数据查询 ====================

	async getSchemas(connectionId: string): Promise<ISchemaInfo[]> {
		const connection = this.connections.get(connectionId);
		if (!connection) {
			throw new Error(`Connection ${connectionId} not found`);
		}

		const pool = this.connectionPools.get(connectionId);
		if (!pool) {
			throw new Error('Not connected');
		}

		switch (connection.config.type) {
			case DatabaseType.MySQL:
				return await this.getMySQLSchemas(pool);
			case DatabaseType.PostgreSQL:
				return await this.getPostgreSQLSchemas(pool);
			default:
				throw new Error(`getSchemas not implemented for ${connection.config.type}`);
		}
	}

	async getTables(connectionId: string, schemaName: string): Promise<ITableStructure[]> {
		const connection = this.connections.get(connectionId);
		if (!connection) {
			throw new Error(`Connection ${connectionId} not found`);
		}

		const pool = this.connectionPools.get(connectionId);
		if (!pool) {
			throw new Error('Not connected');
		}

		switch (connection.config.type) {
			case DatabaseType.MySQL:
				return await this.getMySQLTables(pool, schemaName);
			case DatabaseType.PostgreSQL:
				return await this.getPostgreSQLTables(pool, schemaName);
			default:
				throw new Error(`getTables not implemented for ${connection.config.type}`);
		}
	}

	async getTableStructure(connectionId: string, schemaName: string, tableName: string): Promise<ITableStructure> {
		const connection = this.connections.get(connectionId);
		if (!connection) {
			throw new Error(`Connection ${connectionId} not found`);
		}

		const pool = this.connectionPools.get(connectionId);
		if (!pool) {
			throw new Error('Not connected');
		}

		switch (connection.config.type) {
			case DatabaseType.MySQL:
				return await this.getMySQLTableStructure(pool, schemaName, tableName);
			case DatabaseType.PostgreSQL:
				return await this.getPostgreSQLTableStructure(pool, schemaName, tableName);
			default:
				throw new Error(`getTableStructure not implemented for ${connection.config.type}`);
		}
	}

	async getViews(connectionId: string, schemaName: string): Promise<IViewDefinition[]> {
		const connection = this.connections.get(connectionId);
		if (!connection) {
			throw new Error(`Connection ${connectionId} not found`);
		}

		const pool = this.connectionPools.get(connectionId);
		if (!pool) {
			throw new Error('Not connected');
		}

		switch (connection.config.type) {
			case DatabaseType.MySQL:
				return await this.getMySQLViews(pool, schemaName);
			case DatabaseType.PostgreSQL:
				return await this.getPostgreSQLViews(pool, schemaName);
			default:
				throw new Error(`getViews not implemented for ${connection.config.type}`);
		}
	}

	async getProcedures(connectionId: string, schemaName: string): Promise<IProcedureDefinition[]> {
		const connection = this.connections.get(connectionId);
		if (!connection) {
			throw new Error(`Connection ${connectionId} not found`);
		}

		const pool = this.connectionPools.get(connectionId);
		if (!pool) {
			throw new Error('Not connected');
		}

		switch (connection.config.type) {
			case DatabaseType.MySQL:
				return await this.getMySQLProcedures(pool, schemaName);
			case DatabaseType.PostgreSQL:
				return await this.getPostgreSQLProcedures(pool, schemaName);
			default:
				throw new Error(`getProcedures not implemented for ${connection.config.type}`);
		}
	}

	async getDatabaseObjectTree(connectionId: string): Promise<IDatabaseObjectNode[]> {
		// TODO: 实现对象树查询
		return [];
	}

	// ==================== SQL 执行 ====================

	async executeQuery(connectionId: string, sql: string): Promise<any[]> {
		const pool = this.connectionPools.get(connectionId);
		if (!pool) {
			throw new Error('Not connected');
		}

		const result = await pool.query(sql);
		return Array.isArray(result) ? result : result.rows || [];
	}

	async executeNonQuery(connectionId: string, sql: string): Promise<{ affectedRows: number }> {
		const pool = this.connectionPools.get(connectionId);
		if (!pool) {
			throw new Error('Not connected');
		}

		const result = await pool.query(sql);
		return {
			affectedRows: result.affectedRows || result.rowCount || 0
		};
	}

	// ==================== AI 辅助功能 (暂时返回占位) ====================

	async naturalLanguageToSQL(connectionId: string, schemaName: string, naturalLanguage: string): Promise<string> {
		// TODO: 调用 AI 服务
		throw new Error('naturalLanguageToSQL not implemented yet');
	}

	async optimizeSQL(sql: string, schemaInfo: string, databaseType: string): Promise<{
		score: number;
		level: 'info' | 'warning' | 'error' | 'critical';
		issues: Array<{
			type: 'index' | 'query' | 'syntax' | 'performance' | 'other';
			severity: 'low' | 'medium' | 'high' | 'critical';
			title: string;
			description: string;
			suggestion: string;
			impact: string;
		}>;
		optimizedSql?: string;
		optimizationPoints: string[];
		estimatedImprovement?: string;
	}> {
		try {
			// 调用后端 AI 服务进行 SQL 优化分析
			const response = await fetch('http://localhost:8080/api/ai/prompt/execute', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({
					promptKey: 'IDE_DB_SQL_OPTIMIZE',
					variables: {
						sqlStatement: sql,
						schemaInfo: schemaInfo,
						databaseType: databaseType
					}
				})
			});

			if (!response.ok) {
				throw new Error(`后端API调用失败: ${response.status} ${response.statusText}`);
			}

			const data = await response.json();

			console.log('[DatabaseServiceImpl] SQL优化分析结果:', data);

			// 解析 AI 返回的 JSON 结果
			const result = typeof data.data === 'string' ? JSON.parse(data.data) : data.data;

			return result;
		} catch (error) {
			console.error('[DatabaseServiceImpl] SQL优化分析失败:', error);
			throw error;
		}
	}

	async getTableDesignSuggestions(tableStructure: ITableStructure): Promise<{ issues: Array<{ severity: 'error' | 'warning' | 'info'; message: string; column?: string }>; suggestions: string[] }> {
		// TODO: 调用 AI 服务
		throw new Error('getTableDesignSuggestions not implemented yet');
	}

	async generateTableStructure(description: string): Promise<ITableStructure> {
		// TODO: 调用 AI 服务
		throw new Error('generateTableStructure not implemented yet');
	}

	async suggestIndexes(connectionId: string, schemaName: string, tableName: string): Promise<{ recommended: Array<{ columns: string[]; reason: string; estimatedImpact: string }> }> {
		// TODO: 实现索引建议
		throw new Error('suggestIndexes not implemented yet');
	}

	async healthCheck(connectionId: string): Promise<{ overall: 'good' | 'warning' | 'critical'; issues: Array<{ category: string; severity: 'info' | 'warning' | 'critical'; message: string; suggestion?: string }> }> {
		// TODO: 实现健康检查
		throw new Error('healthCheck not implemented yet');
	}

	// ==================== 私有方法: MySQL ====================

	private async testMySQLConnection(config: IDatabaseConnectionConfig, startTime: number): Promise<IConnectionTestResult> {
		try {
			const connection = await mysql.createConnection({
				host: config.host,
				port: config.port,
				user: config.username,
				password: config.password,
				database: config.database,
				connectTimeout: config.connectionTimeout || 10000
			});

			// 获取服务器版本
			const [rows] = await connection.query('SELECT VERSION() as version');
			const version = (rows as any)[0]?.version;

			await connection.end();

			return {
				success: true,
				responseTime: Date.now() - startTime,
				serverVersion: version
			};
		} catch (error: any) {
			return {
				success: false,
				error: error.message,
				responseTime: Date.now() - startTime
			};
		}
	}

	private async createConnectionPool(config: IDatabaseConnectionConfig): Promise<any> {
		switch (config.type) {
			case DatabaseType.MySQL: {
				return mysql.createPool({
					host: config.host,
					port: config.port,
					user: config.username,
					password: config.password,
					database: config.database,
					waitForConnections: true,
					connectionLimit: 10,
					queueLimit: 0,
					charset: config.charset || 'utf8mb4'
				});
			}
			case DatabaseType.PostgreSQL: {
				return new PgPool({
					host: config.host,
					port: config.port,
					user: config.username,
					password: config.password,
					database: config.database,
					max: 10
				});
			}
			default:
				throw new Error(`Connection pool not implemented for ${config.type}`);
		}
	}

	private async closeConnectionPool(type: DatabaseType, pool: any): Promise<void> {
		if (type === DatabaseType.MySQL) {
			await pool.end();
		} else if (type === DatabaseType.PostgreSQL) {
			await pool.end();
		}
	}

	private async getMySQLSchemas(pool: IMySQLPool): Promise<ISchemaInfo[]> {
		const [rows] = await pool.query('SHOW DATABASES');
		return (rows as any[]).map((row: any) => ({
			name: row.Database || row.database
		}));
	}

	private async getMySQLTables(pool: IMySQLPool, schemaName: string): Promise<ITableStructure[]> {
		const [rows] = await pool.query(`SHOW TABLES FROM \`${schemaName}\``);
		const tableKey = `Tables_in_${schemaName}`;

		return (rows as any[]).map((row: any) => ({
			name: row[tableKey],
			schema: schemaName,
			columns: [],
			indexes: []
		}));
	}

	private async getMySQLTableStructure(pool: IMySQLPool, schemaName: string, tableName: string): Promise<ITableStructure> {
		// 获取列信息
		const [columns] = await pool.query(`SHOW FULL COLUMNS FROM \`${schemaName}\`.\`${tableName}\``);

		// 获取索引信息
		const [indexes] = await pool.query(`SHOW INDEX FROM \`${schemaName}\`.\`${tableName}\``);

		// 解析列
		const columnList: IColumnDefinition[] = (columns as any[]).map((col: any) => ({
			name: col.Field,
			dataType: this.parseMySQLDataType(col.Type),
			length: this.parseMySQLLength(col.Type),
			nullable: col.Null === 'YES',
			defaultValue: col.Default,
			comment: col.Comment,
			isPrimaryKey: col.Key === 'PRI',
			isUnique: col.Key === 'UNI',
			autoIncrement: col.Extra?.includes('auto_increment')
		}));

		// 解析索引
		const indexMap = new Map();
		(indexes as any[]).forEach((idx: any) => {
			if (!indexMap.has(idx.Key_name)) {
				indexMap.set(idx.Key_name, {
					name: idx.Key_name,
					type: idx.Key_name === 'PRIMARY' ? IndexType.PRIMARY :
						idx.Non_unique === 0 ? IndexType.UNIQUE : IndexType.INDEX,
					columns: []
				});
			}
			indexMap.get(idx.Key_name).columns.push(idx.Column_name);
		});

		return {
			name: tableName,
			schema: schemaName,
			columns: columnList,
			indexes: Array.from(indexMap.values()),
			foreignKeys: []
		};
	}

	private parseMySQLDataType(typeString: string): ColumnDataType {
		const type = typeString.split('(')[0].toUpperCase();
		return (ColumnDataType as any)[type] || ColumnDataType.VARCHAR;
	}

	private parseMySQLLength(typeString: string): number | undefined {
		const match = typeString.match(/\((\d+)\)/);
		return match ? parseInt(match[1]) : undefined;
	}

	private async getMySQLViews(pool: IMySQLPool, schemaName: string): Promise<IViewDefinition[]> {
		const [rows] = await pool.query(
			`SELECT TABLE_NAME, VIEW_DEFINITION
			 FROM information_schema.VIEWS
			 WHERE TABLE_SCHEMA = ?`,
			[schemaName]
		);
		return (rows as any[]).map((row: any) => ({
			name: row.TABLE_NAME,
			schema: schemaName,
			definition: row.VIEW_DEFINITION
		}));
	}

	private async getMySQLProcedures(pool: IMySQLPool, schemaName: string): Promise<IProcedureDefinition[]> {
		const [rows] = await pool.query(
			`SELECT ROUTINE_NAME, ROUTINE_DEFINITION, ROUTINE_COMMENT
			 FROM information_schema.ROUTINES
			 WHERE ROUTINE_SCHEMA = ? AND ROUTINE_TYPE = 'PROCEDURE'`,
			[schemaName]
		);
		return (rows as any[]).map((row: any) => ({
			name: row.ROUTINE_NAME,
			schema: schemaName,
			definition: row.ROUTINE_DEFINITION || '',
			comment: row.ROUTINE_COMMENT
		}));
	}

	// ==================== 私有方法: PostgreSQL ====================

	private async testPostgreSQLConnection(config: IDatabaseConnectionConfig, startTime: number): Promise<IConnectionTestResult> {
		try {
			const client = new PgClient({
				host: config.host,
				port: config.port,
				user: config.username,
				password: config.password,
				database: config.database,
				connectionTimeoutMillis: config.connectionTimeout || 10000
			});

			await client.connect();
			const result = await client.query('SELECT version()');
			const version = result.rows[0]?.version;
			await client.end();

			return {
				success: true,
				responseTime: Date.now() - startTime,
				serverVersion: version
			};
		} catch (error: any) {
			return {
				success: false,
				error: error.message,
				responseTime: Date.now() - startTime
			};
		}
	}

	private async getPostgreSQLSchemas(pool: any): Promise<ISchemaInfo[]> {
		const result = await pool.query(
			'SELECT schema_name FROM information_schema.schemata WHERE schema_name NOT IN (\'pg_catalog\', \'information_schema\')'
		);
		return result.rows.map((row: any) => ({ name: row.schema_name }));
	}

	private async getPostgreSQLTables(pool: any, schemaName: string): Promise<ITableStructure[]> {
		const result = await pool.query(
			'SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_type = \'BASE TABLE\'',
			[schemaName]
		);
		return result.rows.map((row: any) => ({
			name: row.table_name,
			schema: schemaName,
			columns: [],
			indexes: []
		}));
	}

	private async getPostgreSQLTableStructure(pool: any, schemaName: string, tableName: string): Promise<ITableStructure> {
		// 获取列信息
		const columnResult = await pool.query(
			`SELECT column_name, data_type, character_maximum_length, is_nullable, column_default
			FROM information_schema.columns
			WHERE table_schema = $1 AND table_name = $2
			ORDER BY ordinal_position`,
			[schemaName, tableName]
		);

		const columns: IColumnDefinition[] = columnResult.rows.map((col: any) => ({
			name: col.column_name,
			dataType: this.parsePostgreSQLDataType(col.data_type),
			length: col.character_maximum_length,
			nullable: col.is_nullable === 'YES',
			defaultValue: col.column_default,
			comment: undefined
		}));

		return {
			name: tableName,
			schema: schemaName,
			columns,
			indexes: [],
			foreignKeys: []
		};
	}

	private parsePostgreSQLDataType(typeString: string): ColumnDataType {
		const typeMap: Record<string, ColumnDataType> = {
			'integer': ColumnDataType.INT,
			'bigint': ColumnDataType.BIGINT,
			'smallint': ColumnDataType.SMALLINT,
			'character varying': ColumnDataType.VARCHAR,
			'text': ColumnDataType.TEXT,
			'timestamp without time zone': ColumnDataType.TIMESTAMP,
			'boolean': ColumnDataType.BOOLEAN
		};
		return typeMap[typeString] || ColumnDataType.VARCHAR;
	}

	private async getPostgreSQLViews(pool: any, schemaName: string): Promise<IViewDefinition[]> {
		const result = await pool.query(
			`SELECT table_name, view_definition
			 FROM information_schema.views
			 WHERE table_schema = $1`,
			[schemaName]
		);
		return result.rows.map((row: any) => ({
			name: row.table_name,
			schema: schemaName,
			definition: row.view_definition
		}));
	}

	private async getPostgreSQLProcedures(pool: any, schemaName: string): Promise<IProcedureDefinition[]> {
		const result = await pool.query(
			`SELECT p.proname as name, pg_get_functiondef(p.oid) as definition
			 FROM pg_proc p
			 JOIN pg_namespace n ON p.pronamespace = n.oid
			 WHERE n.nspname = $1 AND p.prokind = 'p'`,
			[schemaName]
		);
		return result.rows.map((row: any) => ({
			name: row.name,
			schema: schemaName,
			definition: row.definition || ''
		}));
	}

	// ==================== 私有方法: Oracle (占位) ====================

	private async testOracleConnection(config: IDatabaseConnectionConfig, startTime: number): Promise<IConnectionTestResult> {
		return {
			success: false,
			error: 'Oracle support not implemented yet',
			responseTime: Date.now() - startTime
		};
	}

	// ==================== 私有方法: SQL Server (占位) ====================

	private async testSQLServerConnection(config: IDatabaseConnectionConfig, startTime: number): Promise<IConnectionTestResult> {
		return {
			success: false,
			error: 'SQL Server support not implemented yet',
			responseTime: Date.now() - startTime
		};
	}

	// ==================== 私有方法: SQLite (占位) ====================

	private async testSQLiteConnection(config: IDatabaseConnectionConfig, startTime: number): Promise<IConnectionTestResult> {
		return {
			success: false,
			error: 'SQLite support not implemented yet',
			responseTime: Date.now() - startTime
		};
	}

	override dispose(): void {
		// 断开所有连接
		this.disconnectAll().catch(console.error);
		super.dispose();
	}
}
