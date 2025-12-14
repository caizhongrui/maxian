/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * 数据库设计规则配置
 * 用于规范数据库表结构设计
 */

/**
 * 命名规范类型
 */
export enum NamingConvention {
	/** 下划线命名 (snake_case) */
	SNAKE_CASE = 'snake_case',
	/** 驼峰命名 (camelCase) */
	CAMEL_CASE = 'camelCase',
	/** 帕斯卡命名 (PascalCase) */
	PASCAL_CASE = 'PascalCase'
}

/**
 * 字段类型偏好
 */
export interface IFieldTypePreference {
	/** 主键类型 */
	primaryKeyType: 'BIGINT' | 'INT' | 'VARCHAR' | 'UUID';
	/** 主键是否自增 */
	primaryKeyAutoIncrement: boolean;
	/** 时间戳类型 */
	timestampType: 'DATETIME' | 'TIMESTAMP';
	/** 布尔类型 */
	booleanType: 'TINYINT' | 'BOOLEAN' | 'BIT';
	/** 文本类型偏好 */
	textTypePreference: 'VARCHAR' | 'TEXT';
	/** VARCHAR默认长度 */
	defaultVarcharLength: number;
	/** 金额字段类型 */
	moneyType: 'DECIMAL' | 'BIGINT';
	/** 金额字段精度 */
	moneyPrecision?: { precision: number; scale: number };
}

/**
 * 索引规则
 */
export interface IIndexRules {
	/** 是否要求所有表必须有主键 */
	requirePrimaryKey: boolean;
	/** 外键字段是否自动创建索引 */
	autoIndexForeignKey: boolean;
	/** 状态字段是否自动创建索引 */
	autoIndexStatusField: boolean;
	/** 联合索引最大列数 */
	maxColumnsInIndex: number;
}

/**
 * 标准字段配置
 */
export interface IStandardField {
	/** 字段名 */
	name: string;
	/** 字段类型 */
	dataType: string;
	/** 字段长度 */
	length?: number;
	/** 是否允许NULL */
	nullable: boolean;
	/** 默认值 */
	defaultValue?: string;
	/** 字段注释 */
	comment: string;
	/** 是否自动维护(created_at, updated_at等) */
	autoMaintained?: boolean;
}

/**
 * 表结构规范
 */
export interface ITableStructureRules {
	/** 是否要求表注释 */
	requireTableComment: boolean;
	/** 是否要求字段注释 */
	requireColumnComment: boolean;
	/** 是否要求创建时间字段 */
	requireCreatedAt: boolean;
	/** 是否要求更新时间字段 */
	requireUpdatedAt: boolean;
	/** 是否要求软删除字段 */
	requireSoftDelete: boolean;
	/** 软删除字段类型 */
	softDeleteType: 'DELETED_AT' | 'IS_DELETED';
	/** 是否要求版本号字段(乐观锁) */
	requireVersion: boolean;
	/** 标准字段列表 */
	standardFields: IStandardField[];
}

/**
 * 字段约束规则
 */
export interface IFieldConstraintRules {
	/** 字符串字段默认是否NOT NULL */
	stringDefaultNotNull: boolean;
	/** 数值字段默认是否NOT NULL */
	numberDefaultNotNull: boolean;
	/** 是否禁止使用TEXT/BLOB */
	forbidTextBlob: boolean;
	/** 是否要求ENUM字段有注释说明 */
	requireEnumComment: boolean;
	/** 单表最大字段数 */
	maxColumnsPerTable: number;
}

/**
 * 存储引擎规则
 */
export interface IStorageEngineRules {
	/** 默认存储引擎 */
	defaultEngine: 'InnoDB' | 'MyISAM';
	/** 默认字符集 */
	defaultCharset: string;
	/** 默认排序规则 */
	defaultCollation: string;
}

/**
 * 设计规则配置
 */
export interface IDesignRulesConfig {
	/** 配置名称 */
	name: string;
	/** 配置描述 */
	description?: string;
	/** 是否启用 */
	enabled: boolean;
	/** 命名规范 */
	naming: {
		/** 表名命名规范 */
		tableNamingConvention: NamingConvention;
		/** 字段名命名规范 */
		columnNamingConvention: NamingConvention;
		/** 索引名命名规范 */
		indexNamingConvention: NamingConvention;
		/** 表名前缀 */
		tablePrefix?: string;
		/** 是否禁止使用保留字 */
		forbidReservedWords: boolean;
	};
	/** 字段类型偏好 */
	fieldTypes: IFieldTypePreference;
	/** 索引规则 */
	indexRules: IIndexRules;
	/** 表结构规范 */
	tableStructure: ITableStructureRules;
	/** 字段约束规则 */
	fieldConstraints: IFieldConstraintRules;
	/** 存储引擎规则 */
	storageEngine: IStorageEngineRules;
	/** 创建时间 */
	createdAt?: Date;
	/** 更新时间 */
	updatedAt?: Date;
}

/**
 * 默认设计规则配置
 */
export const DEFAULT_DESIGN_RULES: IDesignRulesConfig = {
	name: '默认规范',
	description: '通用数据库设计规范',
	enabled: true,
	naming: {
		tableNamingConvention: NamingConvention.SNAKE_CASE,
		columnNamingConvention: NamingConvention.SNAKE_CASE,
		indexNamingConvention: NamingConvention.SNAKE_CASE,
		tablePrefix: '',
		forbidReservedWords: true
	},
	fieldTypes: {
		primaryKeyType: 'BIGINT',
		primaryKeyAutoIncrement: true,
		timestampType: 'DATETIME',
		booleanType: 'TINYINT',
		textTypePreference: 'VARCHAR',
		defaultVarcharLength: 255,
		moneyType: 'DECIMAL',
		moneyPrecision: { precision: 10, scale: 2 }
	},
	indexRules: {
		requirePrimaryKey: true,
		autoIndexForeignKey: true,
		autoIndexStatusField: true,
		maxColumnsInIndex: 5
	},
	tableStructure: {
		requireTableComment: true,
		requireColumnComment: true,
		requireCreatedAt: true,
		requireUpdatedAt: true,
		requireSoftDelete: false,
		softDeleteType: 'DELETED_AT',
		requireVersion: false,
		standardFields: [
			{
				name: 'id',
				dataType: 'BIGINT',
				nullable: false,
				comment: '主键ID',
				autoMaintained: false
			},
			{
				name: 'created_at',
				dataType: 'DATETIME',
				nullable: false,
				defaultValue: 'CURRENT_TIMESTAMP',
				comment: '创建时间',
				autoMaintained: true
			},
			{
				name: 'updated_at',
				dataType: 'DATETIME',
				nullable: false,
				defaultValue: 'CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP',
				comment: '更新时间',
				autoMaintained: true
			}
		]
	},
	fieldConstraints: {
		stringDefaultNotNull: true,
		numberDefaultNotNull: true,
		forbidTextBlob: false,
		requireEnumComment: true,
		maxColumnsPerTable: 50
	},
	storageEngine: {
		defaultEngine: 'InnoDB',
		defaultCharset: 'utf8mb4',
		defaultCollation: 'utf8mb4_unicode_ci'
	}
};

/**
 * 规则验证结果
 */
export interface IRuleValidationResult {
	/** 是否通过验证 */
	passed: boolean;
	/** 违反的规则 */
	violations: IRuleViolation[];
	/** 警告信息 */
	warnings: string[];
	/** 建议 */
	suggestions: string[];
}

/**
 * 规则违反记录
 */
export interface IRuleViolation {
	/** 规则类型 */
	ruleType: 'naming' | 'fieldType' | 'index' | 'structure' | 'constraint' | 'storage';
	/** 严重程度 */
	severity: 'error' | 'warning' | 'info';
	/** 字段名(如果适用) */
	field?: string;
	/** 违反说明 */
	message: string;
	/** 建议修复方案 */
	suggestion?: string;
}
