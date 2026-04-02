/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../base/common/lifecycle.js';
import { ITextModel } from '../../../../../editor/common/model.js';
import { FormattingOptions, TextEdit, DocumentFormattingEditProvider, DocumentRangeFormattingEditProvider } from '../../../../../editor/common/languages.js';
import { Range } from '../../../../../editor/common/core/range.js';
import { MyBatisXmlParser } from '../mybatis/mybatisXmlParser.js';
import { createStructuredLogger } from '../../../../common/structuredLogger.js';

const log = createStructuredLogger('SQLFormatterProvider');

/**
 * SQL 格式化提供者
 * 为 SQL 文件和 MyBatis XML 文件提供格式化功能
 */
export class SQLFormatterProvider extends Disposable implements DocumentFormattingEditProvider, DocumentRangeFormattingEditProvider {

	constructor() {
		super();
		log.debug('initialized');
	}

	/**
	 * 提供文档格式化
	 */
	async provideDocumentFormattingEdits(model: ITextModel, options: FormattingOptions): Promise<TextEdit[] | null | undefined> {
		const uri = model.uri;
		const fileName = uri.path;
		const content = model.getValue();

		// 检查是否为 MyBatis XML 文件
		if (fileName.endsWith('.xml')) {
			if (MyBatisXmlParser.isMybatisXml(content)) {
				return this.formatMybatisXml(model, content, options);
			}
			return null;
		}

		// SQL 文件
		if (fileName.endsWith('.sql')) {
			return this.formatSQL(model, content, options);
		}

		return null;
	}

	/**
	 * 提供范围格式化
	 */
	async provideDocumentRangeFormattingEdits(model: ITextModel, range: Range, options: FormattingOptions): Promise<TextEdit[] | null | undefined> {
		const content = model.getValueInRange(range);
		const formatted = this.formatSQLContent(content, options);

		if (formatted === content) {
			return null;
		}

		return [{
			range,
			text: formatted
		}];
	}

	/**
	 * 格式化 MyBatis XML 文件
	 */
	private formatMybatisXml(model: ITextModel, content: string, options: FormattingOptions): TextEdit[] | null {
		const edits: TextEdit[] = [];

		try {
			const result = MyBatisXmlParser.parse(content);

			if (!result.isValid || !result.statements) {
				return null;
			}

			// 格式化每个 SQL 语句
			result.statements.forEach(statement => {
				const startLine = statement.startLine;
				const endLine = statement.endLine;

				// 获取原始 SQL 的缩进级别
				const firstLine = model.getLineContent(startLine);
				const indent = this.getIndentation(firstLine);

				// 格式化 SQL
				const formatted = this.formatSQLContent(statement.sql, options);

				// 为格式化后的 SQL 添加缩进
				const indentedSQL = this.indentSQL(formatted, indent + options.tabSize, options.insertSpaces);

				// 创建编辑
				const range = new Range(startLine, 1, endLine, model.getLineMaxColumn(endLine));
				edits.push({
					range,
					text: indentedSQL
				});
			});

			return edits.length > 0 ? edits : null;
		} catch (error) {
			log.error('format_mybatis_xml_failed', { error: String(error) });
			return null;
		}
	}

	/**
	 * 格式化 SQL 文件
	 */
	private formatSQL(model: ITextModel, content: string, options: FormattingOptions): TextEdit[] | null {
		const formatted = this.formatSQLContent(content, options);

		if (formatted === content) {
			return null;
		}

		const lineCount = model.getLineCount();
		const range = new Range(1, 1, lineCount, model.getLineMaxColumn(lineCount));

		return [{
			range,
			text: formatted
		}];
	}

	/**
	 * 格式化 SQL 内容
	 */
	private formatSQLContent(sql: string, options: FormattingOptions): string {
		// 1. 移除多余的空白
		let formatted = sql.trim();

		// 2. 标准化空格
		formatted = formatted.replace(/\s+/g, ' ');

		// 3. 格式化 SQL 关键字为大写
		formatted = this.formatKeywords(formatted);

		// 4. 格式化结构（换行和缩进）
		formatted = this.formatStructure(formatted, options);

		// 5. 格式化逗号后的空格
		formatted = formatted.replace(/,\s*/g, ', ');

		// 6. 格式化操作符周围的空格
		formatted = this.formatOperators(formatted);

		return formatted;
	}

	/**
	 * 格式化 SQL 关键字为大写
	 */
	private formatKeywords(sql: string): string {
		const keywords = [
			'SELECT', 'FROM', 'WHERE', 'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE',
			'JOIN', 'LEFT', 'RIGHT', 'INNER', 'OUTER', 'CROSS', 'ON', 'USING',
			'GROUP BY', 'ORDER BY', 'HAVING', 'LIMIT', 'OFFSET',
			'AS', 'AND', 'OR', 'NOT', 'IN', 'EXISTS', 'BETWEEN', 'LIKE', 'IS', 'NULL',
			'DISTINCT', 'ALL', 'UNION', 'INTERSECT', 'EXCEPT',
			'CASE', 'WHEN', 'THEN', 'ELSE', 'END',
			'COUNT', 'SUM', 'AVG', 'MAX', 'MIN',
			'CREATE', 'ALTER', 'DROP', 'TABLE', 'VIEW', 'INDEX', 'DATABASE', 'SCHEMA',
			'WITH', 'RECURSIVE', 'CTE'
		];

		let result = sql;

		keywords.forEach(keyword => {
			// 使用单词边界匹配，避免匹配表名或列名的一部分
			const regex = new RegExp('\\b' + keyword.replace(' ', '\\s+') + '\\b', 'gi');
			result = result.replace(regex, keyword);
		});

		return result;
	}

	/**
	 * 格式化 SQL 结构（换行和缩进）
	 */
	private formatStructure(sql: string, options: FormattingOptions): string {
		const indent = options.insertSpaces ? ' '.repeat(options.tabSize) : '\t';

		// 主要子句关键字
		const majorClauses = [
			'SELECT', 'FROM', 'WHERE', 'GROUP BY', 'HAVING', 'ORDER BY',
			'LIMIT', 'OFFSET', 'UNION', 'INTERSECT', 'EXCEPT'
		];

		// JOIN 关键字
		const joinClauses = [
			'LEFT JOIN', 'RIGHT JOIN', 'INNER JOIN', 'OUTER JOIN',
			'CROSS JOIN', 'FULL JOIN', 'LEFT OUTER JOIN', 'RIGHT OUTER JOIN'
		];

		let result = sql;

		// 在主要子句前添加换行
		majorClauses.forEach(clause => {
			const regex = new RegExp('\\s+' + clause + '\\b', 'gi');
			result = result.replace(regex, '\n' + clause);
		});

		// 在 JOIN 子句前添加换行和缩进
		joinClauses.forEach(clause => {
			const regex = new RegExp('\\s+' + clause.replace(' ', '\\s+') + '\\b', 'gi');
			result = result.replace(regex, '\n' + indent + clause);
		});

		// 在 AND/OR 前添加换行和缩进（在 WHERE/HAVING 子句中）
		result = result.replace(/\s+(AND|OR)\s+/gi, '\n' + indent + '$1 ');

		// 移除开头的空行
		result = result.replace(/^\n+/, '');

		// 标准化多个连续换行为单个换行
		result = result.replace(/\n\n+/g, '\n');

		return result;
	}

	/**
	 * 格式化操作符周围的空格
	 */
	private formatOperators(sql: string): string {
		let result = sql;

		// 为比较操作符添加空格
		const operators = ['=', '!=', '<>', '<', '>', '<=', '>='];
		operators.forEach(op => {
			// 转义特殊字符
			const escapedOp = op.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
			const regex = new RegExp('\\s*' + escapedOp + '\\s*', 'g');
			result = result.replace(regex, ' ' + op + ' ');
		});

		// 移除多余的空格
		result = result.replace(/\s+/g, ' ');

		return result;
	}

	/**
	 * 获取字符串的缩进级别
	 */
	private getIndentation(line: string): number {
		let count = 0;
		for (let i = 0; i < line.length; i++) {
			if (line[i] === ' ') {
				count++;
			} else if (line[i] === '\t') {
				count += 4; // 假设 tab 等于 4 个空格
			} else {
				break;
			}
		}
		return count;
	}

	/**
	 * 为 SQL 添加缩进
	 */
	private indentSQL(sql: string, indentSize: number, insertSpaces: boolean): string {
		const indentStr = insertSpaces ? ' '.repeat(indentSize) : '\t'.repeat(Math.ceil(indentSize / 4));
		const lines = sql.split('\n');

		return lines.map((line, index) => {
			if (index === 0) {
				return line; // 第一行保持原样（已有 XML 的缩进）
			}
			return indentStr + line;
		}).join('\n');
	}

	override dispose(): void {
		super.dispose();
	}
}
