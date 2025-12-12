/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * 数据库元数据相关接口定义
 */

/**
 * 列数据类型
 */
export enum ColumnDataType {
	// 数值类型
	INT = 'INT',
	BIGINT = 'BIGINT',
	SMALLINT = 'SMALLINT',
	TINYINT = 'TINYINT',
	DECIMAL = 'DECIMAL',
	NUMERIC = 'NUMERIC',
	FLOAT = 'FLOAT',
	DOUBLE = 'DOUBLE',
	REAL = 'REAL',

	// 字符串类型
	CHAR = 'CHAR',
	VARCHAR = 'VARCHAR',
	TEXT = 'TEXT',
	MEDIUMTEXT = 'MEDIUMTEXT',
	LONGTEXT = 'LONGTEXT',

	// 日期时间类型
	DATE = 'DATE',
	TIME = 'TIME',
	DATETIME = 'DATETIME',
	TIMESTAMP = 'TIMESTAMP',
	YEAR = 'YEAR',

	// 二进制类型
	BINARY = 'BINARY',
	VARBINARY = 'VARBINARY',
	BLOB = 'BLOB',
	MEDIUMBLOB = 'MEDIUMBLOB',
	LONGBLOB = 'LONGBLOB',

	// 其他类型
	BOOLEAN = 'BOOLEAN',
	JSON = 'JSON',
	XML = 'XML',
	ENUM = 'ENUM',
	SET = 'SET'
}

/**
 * 索引类型
 */
export enum IndexType {
	PRIMARY = 'PRIMARY',
	UNIQUE = 'UNIQUE',
	INDEX = 'INDEX',
	FULLTEXT = 'FULLTEXT',
	SPATIAL = 'SPATIAL'
}

/**
 * 外键动作类型
 */
export enum ForeignKeyAction {
	CASCADE = 'CASCADE',
	SET_NULL = 'SET NULL',
	SET_DEFAULT = 'SET DEFAULT',
	RESTRICT = 'RESTRICT',
	NO_ACTION = 'NO ACTION'
}

/**
 * 列定义接口
 */
export interface IColumnDefinition {
	/** 列名 */
	name: string;
	/** 数据类型 */
	dataType: ColumnDataType;
	/** 长度/精度 */
	length?: number;
	/** 小数位数 */
	scale?: number;
	/** 是否允许 NULL */
	nullable: boolean;
	/** 默认值 */
	defaultValue?: string;
	/** 是否自增 */
	autoIncrement?: boolean;
	/** 字符集 */
	charset?: string;
	/** 排序规则 */
	collation?: string;
	/** 列注释 */
	comment?: string;
	/** 是否为主键 */
	isPrimaryKey?: boolean;
	/** 是否唯一 */
	isUnique?: boolean;
	/** ENUM/SET 类型的可选值 */
	enumValues?: string[];
}

/**
 * 索引定义接口
 */
export interface IIndexDefinition {
	/** 索引名称 */
	name: string;
	/** 索引类型 */
	type: IndexType;
	/** 索引列（列名数组） */
	columns: string[];
	/** 索引方法（如 BTREE, HASH） */
	method?: string;
	/** 索引注释 */
	comment?: string;
}

/**
 * 外键定义接口
 */
export interface IForeignKeyDefinition {
	/** 外键名称 */
	name: string;
	/** 本表列名 */
	columns: string[];
	/** 引用表名 */
	referencedTable: string;
	/** 引用列名 */
	referencedColumns: string[];
	/** 删除时的动作 */
	onDelete: ForeignKeyAction;
	/** 更新时的动作 */
	onUpdate: ForeignKeyAction;
}

/**
 * 表结构定义接口
 */
export interface ITableStructure {
	/** 表名 */
	name: string;
	/** 数据库/模式名 */
	schema?: string;
	/** 列定义列表 */
	columns: IColumnDefinition[];
	/** 索引定义列表 */
	indexes: IIndexDefinition[];
	/** 外键定义列表 */
	foreignKeys?: IForeignKeyDefinition[];
	/** 存储引擎（MySQL） */
	engine?: string;
	/** 字符集 */
	charset?: string;
	/** 排序规则 */
	collation?: string;
	/** 表注释 */
	comment?: string;
	/** 创建时间 */
	createTime?: Date;
	/** 更新时间 */
	updateTime?: Date;
	/** 表大小（字节） */
	dataLength?: number;
	/** 索引大小（字节） */
	indexLength?: number;
	/** 行数（估算） */
	rowCount?: number;
}

/**
 * 数据库模式信息接口
 */
export interface ISchemaInfo {
	/** 模式/数据库名 */
	name: string;
	/** 字符集 */
	charset?: string;
	/** 排序规则 */
	collation?: string;
	/** 表数量 */
	tableCount?: number;
	/** 视图数量 */
	viewCount?: number;
	/** 存储过程数量 */
	procedureCount?: number;
	/** 函数数量 */
	functionCount?: number;
	/** 总大小（字节） */
	totalSize?: number;
}

/**
 * 视图定义接口
 */
export interface IViewDefinition {
	/** 视图名 */
	name: string;
	/** 数据库/模式名 */
	schema?: string;
	/** SQL 定义 */
	definition: string;
	/** 视图注释 */
	comment?: string;
	/** 是否可更新 */
	isUpdatable?: boolean;
}

/**
 * 存储过程定义接口
 */
export interface IProcedureDefinition {
	/** 存储过程名 */
	name: string;
	/** 数据库/模式名 */
	schema?: string;
	/** SQL 定义 */
	definition: string;
	/** 参数列表 */
	parameters?: IParameterDefinition[];
	/** 返回类型 */
	returnType?: string;
	/** 注释 */
	comment?: string;
}

/**
 * 参数定义接口
 */
export interface IParameterDefinition {
	/** 参数名 */
	name: string;
	/** 参数模式（IN, OUT, INOUT） */
	mode: 'IN' | 'OUT' | 'INOUT';
	/** 数据类型 */
	dataType: string;
	/** 默认值 */
	defaultValue?: string;
}

/**
 * 数据库对象类型
 */
export enum DatabaseObjectType {
	SCHEMA = 'schema',
	TABLE = 'table',
	VIEW = 'view',
	PROCEDURE = 'procedure',
	FUNCTION = 'function',
	TRIGGER = 'trigger',
	SEQUENCE = 'sequence'
}

/**
 * 数据库对象节点接口（用于树形视图）
 */
export interface IDatabaseObjectNode {
	/** 对象唯一标识 */
	id: string;
	/** 对象名称 */
	name: string;
	/** 对象类型 */
	type: DatabaseObjectType;
	/** 父节点ID */
	parentId?: string;
	/** 子节点 */
	children?: IDatabaseObjectNode[];
	/** 是否可展开 */
	collapsible?: boolean;
	/** 图标 */
	icon?: string;
	/** 附加数据 */
	metadata?: any;
}
