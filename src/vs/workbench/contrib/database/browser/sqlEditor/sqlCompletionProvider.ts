/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../base/common/lifecycle.js';
import { Position } from '../../../../../editor/common/core/position.js';
import { IRange, Range } from '../../../../../editor/common/core/range.js';
import { ITextModel } from '../../../../../editor/common/model.js';
import {
	CompletionItem,
	CompletionItemKind,
	CompletionItemProvider,
	CompletionList,
	CompletionContext
} from '../../../../../editor/common/languages.js';
import { IDatabaseService } from '../../common/databaseService.js';

/**
 * SQL 关键字列表
 */
const SQL_KEYWORDS = [
	'SELECT', 'FROM', 'WHERE', 'INSERT', 'UPDATE', 'DELETE', 'CREATE', 'DROP', 'ALTER',
	'TABLE', 'DATABASE', 'INDEX', 'VIEW', 'TRIGGER', 'PROCEDURE', 'FUNCTION',
	'JOIN', 'INNER', 'LEFT', 'RIGHT', 'OUTER', 'CROSS', 'ON', 'USING',
	'GROUP', 'BY', 'HAVING', 'ORDER', 'ASC', 'DESC', 'LIMIT', 'OFFSET',
	'DISTINCT', 'AS', 'AND', 'OR', 'NOT', 'IN', 'BETWEEN', 'LIKE', 'IS', 'NULL',
	'TRUE', 'FALSE', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END',
	'UNION', 'INTERSECT', 'EXCEPT', 'EXISTS', 'ALL', 'ANY', 'SOME',
	'PRIMARY', 'KEY', 'FOREIGN', 'REFERENCES', 'UNIQUE', 'CHECK', 'DEFAULT',
	'AUTO_INCREMENT', 'NOT NULL', 'CONSTRAINT', 'CASCADE'
];

/**
 * SQL 聚合函数
 */
interface SQLFunction {
	name: string;
	detail: string;
	documentation: string;
	insertText: string;
}

const AGGREGATE_FUNCTIONS: SQLFunction[] = [
	{
		name: 'COUNT',
		detail: '计数',
		documentation: 'COUNT(*) 或 COUNT(column) - 计算行数或非NULL值的数量',
		insertText: 'COUNT($0)'
	},
	{
		name: 'SUM',
		detail: '求和',
		documentation: 'SUM(column) - 计算数值列的总和',
		insertText: 'SUM($0)'
	},
	{
		name: 'AVG',
		detail: '平均值',
		documentation: 'AVG(column) - 计算数值列的平均值',
		insertText: 'AVG($0)'
	},
	{
		name: 'MAX',
		detail: '最大值',
		documentation: 'MAX(column) - 返回列中的最大值',
		insertText: 'MAX($0)'
	},
	{
		name: 'MIN',
		detail: '最小值',
		documentation: 'MIN(column) - 返回列中的最小值',
		insertText: 'MIN($0)'
	},
	{
		name: 'GROUP_CONCAT',
		detail: '分组连接',
		documentation: 'GROUP_CONCAT(column) - 将分组中的值连接成字符串',
		insertText: 'GROUP_CONCAT($0)'
	}
];

/**
 * 字符串函数
 */
const STRING_FUNCTIONS: SQLFunction[] = [
	{
		name: 'CONCAT',
		detail: '连接字符串',
		documentation: 'CONCAT(str1, str2, ...) - 连接多个字符串',
		insertText: 'CONCAT($0)'
	},
	{
		name: 'SUBSTRING',
		detail: '截取子字符串',
		documentation: 'SUBSTRING(str, pos, len) - 从字符串中截取子串',
		insertText: 'SUBSTRING($0)'
	},
	{
		name: 'LENGTH',
		detail: '字符串长度',
		documentation: 'LENGTH(str) - 返回字符串的长度',
		insertText: 'LENGTH($0)'
	},
	{
		name: 'UPPER',
		detail: '转大写',
		documentation: 'UPPER(str) - 将字符串转换为大写',
		insertText: 'UPPER($0)'
	},
	{
		name: 'LOWER',
		detail: '转小写',
		documentation: 'LOWER(str) - 将字符串转换为小写',
		insertText: 'LOWER($0)'
	},
	{
		name: 'TRIM',
		detail: '去除空格',
		documentation: 'TRIM(str) - 去除字符串首尾空格',
		insertText: 'TRIM($0)'
	},
	{
		name: 'REPLACE',
		detail: '替换字符串',
		documentation: 'REPLACE(str, from_str, to_str) - 替换字符串中的内容',
		insertText: 'REPLACE($0)'
	},
	{
		name: 'LEFT',
		detail: '左侧字符',
		documentation: 'LEFT(str, len) - 返回字符串左侧指定长度的字符',
		insertText: 'LEFT($0)'
	},
	{
		name: 'RIGHT',
		detail: '右侧字符',
		documentation: 'RIGHT(str, len) - 返回字符串右侧指定长度的字符',
		insertText: 'RIGHT($0)'
	}
];

/**
 * 日期函数
 */
const DATE_FUNCTIONS: SQLFunction[] = [
	{
		name: 'NOW',
		detail: '当前时间',
		documentation: 'NOW() - 返回当前日期和时间',
		insertText: 'NOW()'
	},
	{
		name: 'CURDATE',
		detail: '当前日期',
		documentation: 'CURDATE() - 返回当前日期',
		insertText: 'CURDATE()'
	},
	{
		name: 'CURTIME',
		detail: '当前时间',
		documentation: 'CURTIME() - 返回当前时间',
		insertText: 'CURTIME()'
	},
	{
		name: 'DATE_ADD',
		detail: '日期加法',
		documentation: 'DATE_ADD(date, INTERVAL expr unit) - 在日期上添加时间间隔',
		insertText: 'DATE_ADD($0, INTERVAL 1 DAY)'
	},
	{
		name: 'DATE_SUB',
		detail: '日期减法',
		documentation: 'DATE_SUB(date, INTERVAL expr unit) - 从日期减去时间间隔',
		insertText: 'DATE_SUB($0, INTERVAL 1 DAY)'
	},
	{
		name: 'DATEDIFF',
		detail: '日期差',
		documentation: 'DATEDIFF(date1, date2) - 返回两个日期之间的天数',
		insertText: 'DATEDIFF($0)'
	},
	{
		name: 'DATE_FORMAT',
		detail: '格式化日期',
		documentation: 'DATE_FORMAT(date, format) - 格式化日期',
		insertText: 'DATE_FORMAT($0, \'%Y-%m-%d\')'
	},
	{
		name: 'YEAR',
		detail: '年份',
		documentation: 'YEAR(date) - 返回日期的年份',
		insertText: 'YEAR($0)'
	},
	{
		name: 'MONTH',
		detail: '月份',
		documentation: 'MONTH(date) - 返回日期的月份',
		insertText: 'MONTH($0)'
	},
	{
		name: 'DAY',
		detail: '日',
		documentation: 'DAY(date) - 返回日期的天数',
		insertText: 'DAY($0)'
	},
	{
		name: 'HOUR',
		detail: '小时',
		documentation: 'HOUR(time) - 返回时间的小时数',
		insertText: 'HOUR($0)'
	},
	{
		name: 'MINUTE',
		detail: '分钟',
		documentation: 'MINUTE(time) - 返回时间的分钟数',
		insertText: 'MINUTE($0)'
	}
];

/**
 * 数学函数
 */
const MATH_FUNCTIONS: SQLFunction[] = [
	{
		name: 'ABS',
		detail: '绝对值',
		documentation: 'ABS(n) - 返回数值的绝对值',
		insertText: 'ABS($0)'
	},
	{
		name: 'ROUND',
		detail: '四舍五入',
		documentation: 'ROUND(n, d) - 四舍五入到指定小数位',
		insertText: 'ROUND($0, 2)'
	},
	{
		name: 'CEIL',
		detail: '向上取整',
		documentation: 'CEIL(n) - 向上取整',
		insertText: 'CEIL($0)'
	},
	{
		name: 'FLOOR',
		detail: '向下取整',
		documentation: 'FLOOR(n) - 向下取整',
		insertText: 'FLOOR($0)'
	},
	{
		name: 'MOD',
		detail: '取模',
		documentation: 'MOD(n, m) - 返回 n 除以 m 的余数',
		insertText: 'MOD($0)'
	},
	{
		name: 'POWER',
		detail: '幂运算',
		documentation: 'POWER(n, m) - 返回 n 的 m 次方',
		insertText: 'POWER($0)'
	},
	{
		name: 'SQRT',
		detail: '平方根',
		documentation: 'SQRT(n) - 返回数值的平方根',
		insertText: 'SQRT($0)'
	}
];

/**
 * SQL 智能补全提供者
 */
export class SQLCompletionProvider extends Disposable implements CompletionItemProvider {

	readonly _debugDisplayName = 'sqlCompletions';

	// 缓存：连接ID -> 表列表
	private tablesCache: Map<string, string[]> = new Map();
	// 缓存：表名 -> 字段列表
	private columnsCache: Map<string, { name: string; type: string }[]> = new Map();
	// 缓存过期时间（5分钟）
	private cacheExpiry: Map<string, number> = new Map();
	private readonly CACHE_TTL = 5 * 60 * 1000;

	constructor(
		private readonly databaseService: IDatabaseService
	) {
		super();
		console.log('[SQLCompletionProvider] Initialized');
	}

	/**
	 * 提供补全项
	 */
	async provideCompletionItems(
		model: ITextModel,
		position: Position,
		context: CompletionContext
	): Promise<CompletionList> {
		const suggestions: CompletionItem[] = [];

		// 获取光标前的文本
		const lineContent = model.getLineContent(position.lineNumber);
		const textBeforeCursor = lineContent.substring(0, position.column - 1);
		const word = model.getWordAtPosition(position) ?? {
			startColumn: position.column,
			endColumn: position.column,
			word: ''
		};

		// 创建补全项的范围
		const range: IRange = Range.fromPositions(
			{ lineNumber: position.lineNumber, column: word.startColumn },
			{ lineNumber: position.lineNumber, column: word.endColumn }
		);

		// 1. SQL 关键字补全
		for (const keyword of SQL_KEYWORDS) {
			if (keyword.toLowerCase().startsWith(word.word.toLowerCase())) {
				suggestions.push({
					label: { label: keyword },
					kind: CompletionItemKind.Keyword,
					insertText: keyword,
					range: range,
					sortText: '0_' + keyword,
					detail: 'SQL Keyword'
				});
			}
		}

		// 2. 函数补全
		const allFunctions = [
			...AGGREGATE_FUNCTIONS,
			...STRING_FUNCTIONS,
			...DATE_FUNCTIONS,
			...MATH_FUNCTIONS
		];

		for (const func of allFunctions) {
			if (func.name.toLowerCase().startsWith(word.word.toLowerCase())) {
				suggestions.push({
					label: { label: func.name, description: func.detail },
					kind: CompletionItemKind.Function,
					insertText: func.insertText,
					range: range,
					sortText: '1_' + func.name,
					detail: func.detail,
					documentation: func.documentation
				});
			}
		}

		// 3. 表名补全（如果在 FROM/JOIN/UPDATE/INSERT 后）
		if (this.shouldCompleteTableName(textBeforeCursor)) {
			const tables = await this.getAvailableTables();
			for (const tableName of tables) {
				if (tableName.toLowerCase().includes(word.word.toLowerCase())) {
					suggestions.push({
						label: { label: tableName },
						kind: CompletionItemKind.Class,
						insertText: tableName,
						range: range,
						sortText: '2_' + tableName,
						detail: 'Table'
					});
				}
			}
		}

		// 4. 字段名补全（根据上下文推断表）
		const tableName = this.inferTableName(textBeforeCursor);
		if (tableName) {
			const columns = await this.getTableColumns(tableName);
			for (const column of columns) {
				if (column.name.toLowerCase().includes(word.word.toLowerCase())) {
					suggestions.push({
						label: { label: column.name, description: column.type },
						kind: CompletionItemKind.Field,
						insertText: column.name,
						range: range,
						sortText: '3_' + column.name,
						detail: `Column (${column.type})`
					});
				}
			}
		}

		return {
			suggestions,
			incomplete: false
		};
	}

	/**
	 * 判断是否应该补全表名
	 */
	private shouldCompleteTableName(textBeforeCursor: string): boolean {
		// 在 FROM、JOIN、UPDATE、INSERT INTO 后补全表名
		return /\b(FROM|JOIN|UPDATE|INTO)\s+\w*$/i.test(textBeforeCursor);
	}

	/**
	 * 从上下文推断表名
	 */
	private inferTableName(textBeforeCursor: string): string | null {
		// 尝试匹配 FROM table_name 或 JOIN table_name
		const fromMatch = /\bFROM\s+([a-zA-Z_][a-zA-Z0-9_]*)/i.exec(textBeforeCursor);
		if (fromMatch) {
			return fromMatch[1];
		}

		// 尝试匹配 JOIN table_name
		const joinMatch = /\bJOIN\s+([a-zA-Z_][a-zA-Z0-9_]*)/i.exec(textBeforeCursor);
		if (joinMatch) {
			return joinMatch[1];
		}

		// 尝试匹配 UPDATE table_name
		const updateMatch = /\bUPDATE\s+([a-zA-Z_][a-zA-Z0-9_]*)/i.exec(textBeforeCursor);
		if (updateMatch) {
			return updateMatch[1];
		}

		// 尝试匹配 INSERT INTO table_name
		const insertMatch = /\bINSERT\s+INTO\s+([a-zA-Z_][a-zA-Z0-9_]*)/i.exec(textBeforeCursor);
		if (insertMatch) {
			return insertMatch[1];
		}

		return null;
	}

	/**
	 * 获取可用的表列表
	 */
	private async getAvailableTables(): Promise<string[]> {
		try {
			const connections = await this.databaseService.getAllConnections();
			if (connections.length === 0) {
				return [];
			}

			// 使用第一个激活的连接
			const activeConnection = connections.find((c: any) => c.isActive) || connections[0];
			const cacheKey = `${activeConnection.id}_tables`;

			// 检查缓存
			if (this.isCacheValid(cacheKey)) {
				return this.tablesCache.get(cacheKey) || [];
			}

			// 获取表列表
			const tables: string[] = [];

			// 模拟：从数据库获取表列表
			// TODO: 实际实现需要调用数据库服务的 API
			// const result = await this.databaseService.query(activeConnection.id, 'SHOW TABLES');
			// tables = result.rows.map(row => row[0]);

			// 临时返回空数组，等待实际实现
			this.updateCache(cacheKey, tables);
			return tables;
		} catch (error) {
			console.error('[SQLCompletionProvider] Failed to get tables:', error);
			return [];
		}
	}

	/**
	 * 获取表的字段列表
	 */
	private async getTableColumns(tableName: string): Promise<{ name: string; type: string }[]> {
		try {
			const cacheKey = `columns_${tableName}`;

			// 检查缓存
			if (this.isCacheValid(cacheKey)) {
				return this.columnsCache.get(cacheKey) || [];
			}

			const columns: { name: string; type: string }[] = [];

			// 模拟：从数据库获取字段列表
			// TODO: 实际实现需要调用数据库服务的 API
			// const result = await this.databaseService.query(connectionId, `DESCRIBE ${tableName}`);
			// columns = result.rows.map(row => ({ name: row[0], type: row[1] }));

			// 临时返回空数组，等待实际实现
			this.updateCache(cacheKey, columns);
			return columns;
		} catch (error) {
			console.error('[SQLCompletionProvider] Failed to get columns:', error);
			return [];
		}
	}

	/**
	 * 检查缓存是否有效
	 */
	private isCacheValid(key: string): boolean {
		const expiry = this.cacheExpiry.get(key);
		if (!expiry) {
			return false;
		}
		return Date.now() < expiry;
	}

	/**
	 * 更新缓存
	 */
	private updateCache<T>(key: string, data: T): void {
		if (key.startsWith('columns_')) {
			this.columnsCache.set(key, data as any);
		} else {
			this.tablesCache.set(key, data as any);
		}
		this.cacheExpiry.set(key, Date.now() + this.CACHE_TTL);
	}

	/**
	 * 解析补全项（提供详细信息）
	 */
	resolveCompletionItem(item: CompletionItem): CompletionItem {
		return item;
	}

	override dispose(): void {
		this.tablesCache.clear();
		this.columnsCache.clear();
		this.cacheExpiry.clear();
		super.dispose();
	}
}
