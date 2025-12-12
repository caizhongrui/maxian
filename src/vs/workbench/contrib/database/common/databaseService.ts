/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { Event } from '../../../../base/common/event.js';
import {
	IDatabaseConnection,
	IDatabaseConnectionConfig,
	IConnectionTestResult,
	IDatabaseConnectionEvent
} from './databaseConnection.js';
import {
	ITableStructure,
	ISchemaInfo,
	IViewDefinition,
	IProcedureDefinition,
	IDatabaseObjectNode
} from './databaseMetadata.js';

export const IDatabaseService = createDecorator<IDatabaseService>('databaseService');

/**
 * 数据库服务接口
 * 负责管理数据库连接和元数据操作
 */
export interface IDatabaseService {
	readonly _serviceBrand: undefined;

	/**
	 * 连接变化事件
	 */
	readonly onDidChangeConnections: Event<IDatabaseConnectionEvent>;

	// ==================== 连接管理 ====================

	/**
	 * 获取所有连接配置
	 */
	getAllConnections(): Promise<IDatabaseConnectionConfig[]>;

	/**
	 * 获取指定连接
	 * @param connectionId 连接ID
	 */
	getConnection(connectionId: string): Promise<IDatabaseConnection | undefined>;

	/**
	 * 添加新连接
	 * @param config 连接配置
	 */
	addConnection(config: IDatabaseConnectionConfig): Promise<void>;

	/**
	 * 更新连接配置
	 * @param connectionId 连接ID
	 * @param config 新的连接配置
	 */
	updateConnection(connectionId: string, config: Partial<IDatabaseConnectionConfig>): Promise<void>;

	/**
	 * 删除连接
	 * @param connectionId 连接ID
	 */
	removeConnection(connectionId: string): Promise<void>;

	/**
	 * 测试连接
	 * @param config 连接配置
	 */
	testConnection(config: IDatabaseConnectionConfig): Promise<IConnectionTestResult>;

	/**
	 * 连接到数据库
	 * @param connectionId 连接ID
	 */
	connect(connectionId: string): Promise<void>;

	/**
	 * 断开连接
	 * @param connectionId 连接ID
	 */
	disconnect(connectionId: string): Promise<void>;

	/**
	 * 断开所有连接
	 */
	disconnectAll(): Promise<void>;

	// ==================== 元数据查询 ====================

	/**
	 * 获取数据库列表
	 * @param connectionId 连接ID
	 */
	getSchemas(connectionId: string): Promise<ISchemaInfo[]>;

	/**
	 * 获取表列表
	 * @param connectionId 连接ID
	 * @param schemaName 数据库/模式名
	 */
	getTables(connectionId: string, schemaName: string): Promise<ITableStructure[]>;

	/**
	 * 获取表结构详情
	 * @param connectionId 连接ID
	 * @param schemaName 数据库/模式名
	 * @param tableName 表名
	 */
	getTableStructure(connectionId: string, schemaName: string, tableName: string): Promise<ITableStructure>;

	/**
	 * 获取视图列表
	 * @param connectionId 连接ID
	 * @param schemaName 数据库/模式名
	 */
	getViews(connectionId: string, schemaName: string): Promise<IViewDefinition[]>;

	/**
	 * 获取存储过程列表
	 * @param connectionId 连接ID
	 * @param schemaName 数据库/模式名
	 */
	getProcedures(connectionId: string, schemaName: string): Promise<IProcedureDefinition[]>;

	/**
	 * 获取数据库对象树
	 * @param connectionId 连接ID
	 */
	getDatabaseObjectTree(connectionId: string): Promise<IDatabaseObjectNode[]>;

	// ==================== SQL 执行 ====================

	/**
	 * 执行 SQL 查询
	 * @param connectionId 连接ID
	 * @param sql SQL 语句
	 */
	executeQuery(connectionId: string, sql: string): Promise<any[]>;

	/**
	 * 执行 SQL 语句（非查询）
	 * @param connectionId 连接ID
	 * @param sql SQL 语句
	 */
	executeNonQuery(connectionId: string, sql: string): Promise<{ affectedRows: number }>;

	// ==================== AI 辅助功能 ====================

	/**
	 * 自然语言转 SQL
	 * @param connectionId 连接ID
	 * @param schemaName 数据库/模式名
	 * @param naturalLanguage 自然语言描述
	 */
	naturalLanguageToSQL(connectionId: string, schemaName: string, naturalLanguage: string): Promise<string>;

	/**
	 * SQL 优化建议
	 * @param sql SQL 语句
	 * @param schemaInfo 数据库结构信息
	 * @param databaseType 数据库类型
	 */
	optimizeSQL(sql: string, schemaInfo: string, databaseType: string): Promise<{
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
	}>;

	/**
	 * 表设计建议
	 * @param tableStructure 表结构
	 */
	getTableDesignSuggestions(tableStructure: ITableStructure): Promise<{
		issues: Array<{
			severity: 'error' | 'warning' | 'info';
			message: string;
			column?: string;
		}>;
		suggestions: string[];
	}>;

	/**
	 * 根据自然语言生成表结构
	 * @param description 表描述（自然语言）
	 */
	generateTableStructure(description: string): Promise<ITableStructure>;

	/**
	 * 生成索引建议
	 * @param connectionId 连接ID
	 * @param schemaName 数据库/模式名
	 * @param tableName 表名
	 */
	suggestIndexes(connectionId: string, schemaName: string, tableName: string): Promise<{
		recommended: Array<{
			columns: string[];
			reason: string;
			estimatedImpact: string;
		}>;
	}>;

	/**
	 * 数据库健康检查
	 * @param connectionId 连接ID
	 */
	healthCheck(connectionId: string): Promise<{
		overall: 'good' | 'warning' | 'critical';
		issues: Array<{
			category: string;
			severity: 'info' | 'warning' | 'critical';
			message: string;
			suggestion?: string;
		}>;
	}>;
}
