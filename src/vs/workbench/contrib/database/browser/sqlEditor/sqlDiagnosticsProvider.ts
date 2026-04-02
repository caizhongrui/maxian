/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../base/common/lifecycle.js';
import { IModelService } from '../../../../../editor/common/services/model.js';
import { IMarkerService, IMarkerData, MarkerSeverity } from '../../../../../platform/markers/common/markers.js';
import { ITextModel } from '../../../../../editor/common/model.js';
import { URI } from '../../../../../base/common/uri.js';
import { MyBatisXmlParser } from '../mybatis/mybatisXmlParser.js';
import { createStructuredLogger } from '../../../../common/structuredLogger.js';

const log = createStructuredLogger('SQLDiagnosticsProvider');

/**
 * SQL 语法检查提供者
 * 为 SQL 文件和 MyBatis XML 文件提供语法检查
 */
export class SQLDiagnosticsProvider extends Disposable {

	private readonly diagnosticsOwner = 'sqlDiagnostics';

	constructor(
		@IModelService private readonly modelService: IModelService,
		@IMarkerService private readonly markerService: IMarkerService
	) {
		super();
		log.debug('initialized');

		// 监听模型添加事件
		this._register(this.modelService.onModelAdded(model => {
			this.validateModel(model);
		}));

		// 初始化时验证所有已存在的模型
		this.modelService.getModels().forEach(model => {
			this.validateModel(model);
		});
	}

	/**
	 * 验证模型
	 */
	private validateModel(model: ITextModel): void {
		const uri = model.uri;
		const fileName = uri.path;

		// 仅处理 .sql 文件和 .xml 文件
		if (!fileName.endsWith('.sql') && !fileName.endsWith('.xml')) {
			return;
		}

		const content = model.getValue();

		// 如果是 XML 文件，检查是否为 MyBatis XML
		if (fileName.endsWith('.xml')) {
			if (!MyBatisXmlParser.isMybatisXml(content)) {
				return;
			}
			this.validateMybatisXml(uri, content, model);
		} else {
			// SQL 文件
			this.validateSQL(uri, content, model);
		}
	}

	/**
	 * 验证 MyBatis XML 文件
	 */
	private validateMybatisXml(uri: URI, content: string, model: ITextModel): void {
		const markers: IMarkerData[] = [];

		try {
			// 解析 MyBatis XML
			const result = MyBatisXmlParser.parse(content);

			if (!result.isValid) {
				markers.push({
					severity: MarkerSeverity.Error,
					message: `MyBatis XML 解析失败: ${result.error}`,
					startLineNumber: 1,
					startColumn: 1,
					endLineNumber: 1,
					endColumn: 100
				});
			} else {
				// 检查每个 SQL 语句
				result.statements?.forEach(statement => {
					const sqlMarkers = this.validateSQLContent(statement.sql, statement.startLine);
					markers.push(...sqlMarkers);
				});
			}
		} catch (error) {
			markers.push({
				severity: MarkerSeverity.Error,
				message: `MyBatis XML 验证失败: ${error instanceof Error ? error.message : String(error)}`,
				startLineNumber: 1,
				startColumn: 1,
				endLineNumber: 1,
				endColumn: 100
			});
		}

		this.markerService.changeOne(this.diagnosticsOwner, uri, markers);
	}

	/**
	 * 验证 SQL 文件
	 */
	private validateSQL(uri: URI, content: string, model: ITextModel): void {
		const markers = this.validateSQLContent(content, 1);
		this.markerService.changeOne(this.diagnosticsOwner, uri, markers);
	}

	/**
	 * 验证 SQL 内容
	 */
	private validateSQLContent(sql: string, startLine: number = 1): IMarkerData[] {
		const markers: IMarkerData[] = [];
		const lines = sql.split('\n');

		lines.forEach((line, index) => {
			const lineNumber = startLine + index;
			const trimmedLine = line.trim();

			// 跳过空行和注释
			if (!trimmedLine || trimmedLine.startsWith('--') || trimmedLine.startsWith('#')) {
				return;
			}

			// 1. 检查括号匹配
			const bracketMarkers = this.checkBracketMatching(line, lineNumber);
			markers.push(...bracketMarkers);

			// 2. 检查引号匹配
			const quoteMarkers = this.checkQuoteMatching(line, lineNumber);
			markers.push(...quoteMarkers);

			// 3. 检查常见的 SQL 语法问题（不包括 SELECT * 检查）
			const syntaxMarkers = this.checkCommonSyntaxIssues(line, lineNumber);
			markers.push(...syntaxMarkers);

			// 4. 不再检查关键字大小写
			// const keywordMarkers = this.checkKeywordCase(line, lineNumber);
			// markers.push(...keywordMarkers);
		});

		return markers;
	}

	/**
	 * 检查括号匹配
	 */
	private checkBracketMatching(line: string, lineNumber: number): IMarkerData[] {
		const markers: IMarkerData[] = [];
		const stack: Array<{ char: string; index: number }> = [];
		const pairs: Record<string, string> = { '(': ')', '[': ']', '{': '}' };

		for (let i = 0; i < line.length; i++) {
			const char = line[i];

			if (char === '(' || char === '[' || char === '{') {
				stack.push({ char, index: i });
			} else if (char === ')' || char === ']' || char === '}') {
				if (stack.length === 0) {
					markers.push({
						severity: MarkerSeverity.Error,
						message: `未匹配的 '${char}'`,
						startLineNumber: lineNumber,
						startColumn: i + 1,
						endLineNumber: lineNumber,
						endColumn: i + 2
					});
				} else {
					const last = stack.pop()!;
					if (pairs[last.char] !== char) {
						markers.push({
							severity: MarkerSeverity.Error,
							message: `括号不匹配: '${last.char}' 与 '${char}'`,
							startLineNumber: lineNumber,
							startColumn: i + 1,
							endLineNumber: lineNumber,
							endColumn: i + 2
						});
					}
				}
			}
		}

		// 检查未闭合的括号
		stack.forEach(item => {
			markers.push({
				severity: MarkerSeverity.Error,
				message: `未闭合的 '${item.char}'`,
				startLineNumber: lineNumber,
				startColumn: item.index + 1,
				endLineNumber: lineNumber,
				endColumn: item.index + 2
			});
		});

		return markers;
	}

	/**
	 * 检查引号匹配
	 */
	private checkQuoteMatching(line: string, lineNumber: number): IMarkerData[] {
		const markers: IMarkerData[] = [];
		let singleQuoteOpen = false;
		let doubleQuoteOpen = false;
		let singleQuoteIndex = -1;
		let doubleQuoteIndex = -1;

		for (let i = 0; i < line.length; i++) {
			const char = line[i];

			// 检查是否为转义字符
			if (i > 0 && line[i - 1] === '\\') {
				continue;
			}

			if (char === "'") {
				if (!doubleQuoteOpen) {
					if (singleQuoteOpen) {
						singleQuoteOpen = false;
					} else {
						singleQuoteOpen = true;
						singleQuoteIndex = i;
					}
				}
			} else if (char === '"') {
				if (!singleQuoteOpen) {
					if (doubleQuoteOpen) {
						doubleQuoteOpen = false;
					} else {
						doubleQuoteOpen = true;
						doubleQuoteIndex = i;
					}
				}
			}
		}

		if (singleQuoteOpen) {
			markers.push({
				severity: MarkerSeverity.Error,
				message: "未闭合的单引号 '",
				startLineNumber: lineNumber,
				startColumn: singleQuoteIndex + 1,
				endLineNumber: lineNumber,
				endColumn: singleQuoteIndex + 2
			});
		}

		if (doubleQuoteOpen) {
			markers.push({
				severity: MarkerSeverity.Error,
				message: '未闭合的双引号 "',
				startLineNumber: lineNumber,
				startColumn: doubleQuoteIndex + 1,
				endLineNumber: lineNumber,
				endColumn: doubleQuoteIndex + 2
			});
		}

		return markers;
	}

	/**
	 * 检查常见的 SQL 语法问题
	 */
	private checkCommonSyntaxIssues(line: string, lineNumber: number): IMarkerData[] {
		const markers: IMarkerData[] = [];
		const upperLine = line.toUpperCase();

		// 1. 不再检查 SELECT * 使用
		// if (upperLine.includes('SELECT *') || upperLine.includes('SELECT*')) {
		// 	const index = line.toLowerCase().indexOf('select *');
		// 	if (index >= 0) {
		// 		markers.push({
		// 			severity: MarkerSeverity.Warning,
		// 			message: '建议避免使用 SELECT *，明确指定需要的列',
		// 			startLineNumber: lineNumber,
		// 			startColumn: index + 1,
		// 			endLineNumber: lineNumber,
		// 			endColumn: index + 9
		// 		});
		// 	}
		// }

		// 2. 检查没有 WHERE 的 DELETE 或 UPDATE（警告）
		if ((upperLine.includes('DELETE FROM') || upperLine.includes('UPDATE ')) &&
			!upperLine.includes('WHERE')) {
			markers.push({
				severity: MarkerSeverity.Warning,
				message: '危险操作: DELETE/UPDATE 语句缺少 WHERE 子句',
				startLineNumber: lineNumber,
				startColumn: 1,
				endLineNumber: lineNumber,
				endColumn: line.length + 1
			});
		}

		// 3. 不再检查多个空格
		// const multipleSpaces = /\s{3,}/g;
		// let match;
		// while ((match = multipleSpaces.exec(line)) !== null) {
		// 	markers.push({
		// 		severity: MarkerSeverity.Info,
		// 		message: '存在多个连续空格',
		// 		startLineNumber: lineNumber,
		// 		startColumn: match.index + 1,
		// 		endLineNumber: lineNumber,
		// 		endColumn: match.index + match[0].length + 1
		// 	});
		// }

		// 4. 不再检查行尾分号
		// const trimmedLine = line.trim();
		// if (trimmedLine && !trimmedLine.startsWith('--') && !trimmedLine.startsWith('#')) {
		// 	if (trimmedLine.endsWith(';')) {
		// 		// 这通常是正确的
		// 	} else if (upperLine.includes('SELECT') || upperLine.includes('INSERT') ||
		// 		upperLine.includes('UPDATE') || upperLine.includes('DELETE')) {
		// 		// 如果是语句的最后一行，应该有分号（信息级别）
		// 		markers.push({
		// 			severity: MarkerSeverity.Info,
		// 			message: 'SQL 语句建议以分号结尾',
		// 			startLineNumber: lineNumber,
		// 			startColumn: line.length,
		// 			endLineNumber: lineNumber,
		// 			endColumn: line.length + 1
		// 		});
		// 	}
		// }

		return markers;
	}


	override dispose(): void {
		// 清除所有诊断标记
		this.markerService.changeAll(this.diagnosticsOwner, []);
		super.dispose();
	}
}
