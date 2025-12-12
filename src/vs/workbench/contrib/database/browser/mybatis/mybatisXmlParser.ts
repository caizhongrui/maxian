/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * MyBatis XML 解析器
 * 用于从 MyBatis/MyBatis-Plus 的 XML mapper 文件中提取 SQL 语句
 */

/**
 * SQL 语句信息
 */
export interface SQLStatement {
	/** SQL 语句ID */
	id: string;
	/** SQL 语句类型 (select, insert, update, delete) */
	type: 'select' | 'insert' | 'update' | 'delete';
	/** SQL 语句内容 */
	sql: string;
	/** 起始行号 */
	startLine: number;
	/** 结束行号 */
	endLine: number;
	/** 所属 namespace */
	namespace?: string;
	/** 结果类型 */
	resultType?: string;
	/** 参数类型 */
	parameterType?: string;
}

/**
 * MyBatis XML 解析结果
 */
export interface MyBatisXMLParseResult {
	/** 是否为有效的 MyBatis XML */
	isValid: boolean;
	/** namespace */
	namespace?: string;
	/** 提取的 SQL 语句列表 */
	statements: SQLStatement[];
	/** 解析错误信息 */
	error?: string;
}

/**
 * MyBatis XML 解析器类
 */
export class MyBatisXmlParser {

	/**
	 * 判断文件是否为 MyBatis XML 文件
	 * @param content 文件内容
	 */
	public static isMybatisXml(content: string): boolean {
		// 检查是否包含 MyBatis 的 DOCTYPE 或 mapper 标签
		return content.includes('<!DOCTYPE mapper') ||
			content.includes('<mapper') ||
			content.includes('mybatis.org/dtd/mybatis');
	}

	/**
	 * 解析 MyBatis XML 文件
	 * @param content XML 文件内容
	 * @returns 解析结果
	 */
	public static parse(content: string): MyBatisXMLParseResult {
		const result: MyBatisXMLParseResult = {
			isValid: false,
			statements: []
		};

		try {
			// 检查是否为有效的 MyBatis XML
			if (!this.isMybatisXml(content)) {
				result.error = '不是有效的 MyBatis XML 文件';
				return result;
			}

			result.isValid = true;

			// 提取 namespace
			const namespaceMatch = content.match(/<mapper[^>]*namespace\s*=\s*["']([^"']+)["']/);
			if (namespaceMatch) {
				result.namespace = namespaceMatch[1];
			}

			// 提取 SQL 语句
			const sqlTypes = ['select', 'insert', 'update', 'delete'];
			const lines = content.split('\n');

			for (const type of sqlTypes) {
				const statements = this.extractStatements(content, lines, type as any);
				result.statements.push(...statements);
			}

			console.log(`[MyBatisXmlParser] 解析完成，共提取 ${result.statements.length} 条 SQL 语句`);

		} catch (error) {
			result.error = error instanceof Error ? error.message : String(error);
			console.error('[MyBatisXmlParser] 解析错误:', error);
		}

		return result;
	}

	/**
	 * 提取指定类型的 SQL 语句
	 * @param content 完整内容
	 * @param lines 按行分割的内容
	 * @param type SQL 类型
	 */
	private static extractStatements(
		content: string,
		lines: string[],
		type: 'select' | 'insert' | 'update' | 'delete'
	): SQLStatement[] {
		const statements: SQLStatement[] = [];

		// 使用正则表达式匹配 <select>, <insert>, <update>, <delete> 标签
		const tagPattern = new RegExp(`<${type}[^>]*>([\\s\\S]*?)</${type}>`, 'gi');
		let match: RegExpExecArray | null;

		while ((match = tagPattern.exec(content)) !== null) {
			const fullMatch = match[0];
			const sqlContent = match[1];

			// 提取标签属性
			const idMatch = fullMatch.match(/\bid\s*=\s*["']([^"']+)["']/i);
			const resultTypeMatch = fullMatch.match(/\bresultType\s*=\s*["']([^"']+)["']/i);
			const parameterTypeMatch = fullMatch.match(/\bparameterType\s*=\s*["']([^"']+)["']/i);

			// 计算行号
			const beforeMatch = content.substring(0, match.index);
			const startLine = (beforeMatch.match(/\n/g) || []).length + 1;
			const sqlLines = fullMatch.match(/\n/g) || [];
			const endLine = startLine + sqlLines.length;

			// 清理 SQL 内容
			const cleanedSql = this.cleanSQL(sqlContent);

			if (cleanedSql.trim()) {
				statements.push({
					id: idMatch ? idMatch[1] : 'unknown',
					type: type,
					sql: cleanedSql,
					startLine: startLine,
					endLine: endLine,
					resultType: resultTypeMatch ? resultTypeMatch[1] : undefined,
					parameterType: parameterTypeMatch ? parameterTypeMatch[1] : undefined
				});
			}
		}

		return statements;
	}

	/**
	 * 清理 SQL 语句
	 * 移除 MyBatis 标签、注释等
	 * @param sql 原始 SQL
	 */
	private static cleanSQL(sql: string): string {
		let cleaned = sql;

		// 移除 XML 注释
		cleaned = cleaned.replace(/<!--[\s\S]*?-->/g, '');

		// 移除 MyBatis 动态 SQL 标签但保留内容
		// <if>, <where>, <set>, <choose>, <when>, <otherwise>, <trim>, <foreach>
		const dynamicTags = [
			'if', 'where', 'set', 'choose', 'when', 'otherwise',
			'trim', 'foreach', 'bind', 'sql', 'include'
		];

		for (const tag of dynamicTags) {
			// 移除开始标签
			cleaned = cleaned.replace(new RegExp(`<${tag}[^>]*>`, 'gi'), ' ');
			// 移除结束标签
			cleaned = cleaned.replace(new RegExp(`</${tag}>`, 'gi'), ' ');
		}

		// 移除 MyBatis 参数占位符的特殊语法，但保留参数名
		// #{param} -> :param
		cleaned = cleaned.replace(/#\{([^}]+)\}/g, ':$1');
		// ${param} -> :param
		cleaned = cleaned.replace(/\$\{([^}]+)\}/g, ':$1');

		// 移除 CDATA 标记
		cleaned = cleaned.replace(/<!\[CDATA\[/g, '');
		cleaned = cleaned.replace(/\]\]>/g, '');

		// 规范化空白字符
		cleaned = cleaned.replace(/\s+/g, ' ');
		cleaned = cleaned.trim();

		return cleaned;
	}

	/**
	 * 从文件路径获取 SQL 语句
	 * @param filePath 文件路径
	 * @param fileContent 文件内容
	 * @param lineNumber 可选：指定行号，只返回包含该行的 SQL 语句
	 */
	public static getSQLFromFile(
		filePath: string,
		fileContent: string,
		lineNumber?: number
	): SQLStatement | SQLStatement[] | null {
		const parseResult = this.parse(fileContent);

		if (!parseResult.isValid || parseResult.statements.length === 0) {
			return null;
		}

		// 如果指定了行号，返回包含该行的 SQL 语句
		if (lineNumber !== undefined) {
			const statement = parseResult.statements.find(
				stmt => stmt.startLine <= lineNumber && stmt.endLine >= lineNumber
			);
			return statement || null;
		}

		// 否则返回所有 SQL 语句
		return parseResult.statements;
	}

	/**
	 * 获取光标位置的 SQL 语句
	 * @param content 文件内容
	 * @param cursorLine 光标所在行号（从1开始）
	 */
	public static getSQLAtCursor(content: string, cursorLine: number): SQLStatement | null {
		const parseResult = this.parse(content);

		if (!parseResult.isValid) {
			return null;
		}

		// 查找包含光标位置的 SQL 语句
		const statement = parseResult.statements.find(
			stmt => stmt.startLine <= cursorLine && stmt.endLine >= cursorLine
		);

		return statement || null;
	}

	/**
	 * 检查文件扩展名是否为 XML
	 * @param fileName 文件名或路径
	 */
	public static isXmlFile(fileName: string): boolean {
		return fileName.toLowerCase().endsWith('.xml');
	}

	/**
	 * 构建完整的 SQL 语句 ID（包含 namespace）
	 * @param namespace 命名空间
	 * @param id SQL ID
	 */
	public static buildFullId(namespace: string | undefined, id: string): string {
		if (namespace) {
			return `${namespace}.${id}`;
		}
		return id;
	}
}
