/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append } from '../../../../base/browser/dom.js';

/**
 * 基于DOM的Markdown渲染器
 * 不使用innerHTML,通过创建DOM元素来渲染Markdown,避免CSP违规
 */
export class MarkdownRendererDom {

	/**
	 * 渲染Markdown文本为DOM元素
	 * @param text Markdown文本
	 * @param container 容器元素
	 */
	static renderMarkdown(text: string, container: HTMLElement): void {
		// 清空容器（使用DOM API避免CSP违规）
		while (container.firstChild) {
			container.removeChild(container.firstChild);
		}
		container.className = 'markdown-content';

		// 按行分割文本
		const lines = text.split('\n');
		let i = 0;

		while (i < lines.length) {
			const line = lines[i];

			// 代码块 ```
			if (line.startsWith('```')) {
				const language = line.substring(3).trim();
				const codeLines: string[] = [];
				i++; // 跳过开始标记

				// 收集代码块内容
				while (i < lines.length && !lines[i].startsWith('```')) {
					codeLines.push(lines[i]);
					i++;
				}
				i++; // 跳过结束标记

				// 创建代码块元素
				const pre = append(container, $('pre.code-block'));
				const code = append(pre, $('code'));
				if (language) {
					code.className = `language-${language}`;
				}
				code.textContent = codeLines.join('\n');

				// 应用代码高亮
				this.highlightCode(code);
				continue;
			}

			// 标题
			if (line.startsWith('### ')) {
				const h3 = append(container, $('h3'));
				this.renderInlineElements(line.substring(4), h3);
				i++;
				continue;
			}
			if (line.startsWith('## ')) {
				const h2 = append(container, $('h2'));
				this.renderInlineElements(line.substring(3), h2);
				i++;
				continue;
			}
			if (line.startsWith('# ')) {
				const h1 = append(container, $('h1'));
				this.renderInlineElements(line.substring(2), h1);
				i++;
				continue;
			}

			// 无序列表
			if (line.startsWith('- ') || line.startsWith('* ')) {
				const ul = append(container, $('ul'));
				while (i < lines.length && (lines[i].startsWith('- ') || lines[i].startsWith('* '))) {
					const li = append(ul, $('li'));
					this.renderInlineElements(lines[i].substring(2), li);
					i++;
				}
				continue;
			}

			// 有序列表
			if (/^\d+\.\s/.test(line)) {
				const ol = append(container, $('ol'));
				while (i < lines.length && /^\d+\.\s/.test(lines[i])) {
					const li = append(ol, $('li'));
					const content = lines[i].replace(/^\d+\.\s/, '');
					this.renderInlineElements(content, li);
					i++;
				}
				continue;
			}

			// 空行
			if (line.trim() === '') {
				append(container, $('br'));
				i++;
				continue;
			}

			// 普通段落
			const p = append(container, $('p'));
			p.style.margin = '4px 0';
			this.renderInlineElements(line, p);
			i++;
		}
	}

	/**
	 * 渲染行内元素（粗体、斜体、代码、链接）
	 */
	private static renderInlineElements(text: string, container: HTMLElement): void {
		let pos = 0;

		while (pos < text.length) {
			// 查找下一个特殊标记
			const remaining = text.substring(pos);

			const codeMatch = remaining.match(/`([^`]+)`/);
			const boldMatch = remaining.match(/\*\*(.+?)\*\*/);
			const linkMatch = remaining.match(/\[([^\]]+)\]\(([^\)]+)\)/);
			// 斜体匹配：单星号（会在后续逻辑中过滤掉粗体的情况）
			const italicMatch = remaining.match(/\*(.+?)\*/);

			// 找出最近的匹配（优先级：代码 > 链接 > 粗体 > 斜体）
			let nearestMatch: RegExpMatchArray | null = null;
			let nearestType: 'code' | 'bold' | 'italic' | 'link' | null = null;
			let nearestIndex = Infinity;

			if (codeMatch && codeMatch.index !== undefined && codeMatch.index < nearestIndex) {
				nearestMatch = codeMatch;
				nearestType = 'code';
				nearestIndex = codeMatch.index;
			}
			if (linkMatch && linkMatch.index !== undefined && linkMatch.index < nearestIndex) {
				nearestMatch = linkMatch;
				nearestType = 'link';
				nearestIndex = linkMatch.index;
			}
			// 粗体优先于斜体
			if (boldMatch && boldMatch.index !== undefined && boldMatch.index < nearestIndex) {
				nearestMatch = boldMatch;
				nearestType = 'bold';
				nearestIndex = boldMatch.index;
			}
			// 斜体检查：确保不是粗体的一部分
			if (italicMatch && italicMatch.index !== undefined && italicMatch.index < nearestIndex) {
				// 检查斜体匹配的位置，确保前后都不是星号（避免匹配粗体的部分）
				const matchPos = italicMatch.index;
				const isPreviousStar = matchPos > 0 && remaining[matchPos - 1] === '*';
				const isNextStar = matchPos + italicMatch[0].length < remaining.length && remaining[matchPos + italicMatch[0].length] === '*';

				// 如果不是粗体的一部分，才选择斜体
				if (!isPreviousStar && !isNextStar) {
					nearestMatch = italicMatch;
					nearestType = 'italic';
					nearestIndex = italicMatch.index;
				}
			}

			// 如果没有找到任何匹配，添加剩余文本
			if (!nearestMatch || nearestMatch.index === undefined) {
				const textNode = document.createTextNode(remaining);
				container.appendChild(textNode);
				break;
			}

			// 添加匹配前的普通文本
			if (nearestIndex > 0) {
				const beforeText = remaining.substring(0, nearestIndex);
				const textNode = document.createTextNode(beforeText);
				container.appendChild(textNode);
			}

			// 添加特殊元素
			if (nearestType === 'code') {
				const code = append(container, $('code.inline-code'));
				code.textContent = nearestMatch[1];
			} else if (nearestType === 'bold') {
				const strong = append(container, $('strong'));
				strong.textContent = nearestMatch[1];
			} else if (nearestType === 'italic') {
				const em = append(container, $('em'));
				em.textContent = nearestMatch[1];
			} else if (nearestType === 'link') {
				const a = append(container, $('a.markdown-link')) as HTMLAnchorElement;
				a.href = nearestMatch[2];
				a.textContent = nearestMatch[1];
			}

			// 移动位置
			pos += nearestIndex + nearestMatch[0].length;
		}
	}

	/**
	 * 增强的代码高亮
	 */
	private static highlightCode(codeElement: HTMLElement): void {
		const code = codeElement.textContent || '';

		// 清空元素（使用DOM API避免CSP违规）
		while (codeElement.firstChild) {
			codeElement.removeChild(codeElement.firstChild);
		}

		// 通用编程语言关键字
		const keywords = [
			// JavaScript/TypeScript
			'function', 'const', 'let', 'var', 'if', 'else', 'return', 'import', 'export',
			'class', 'interface', 'type', 'async', 'await', 'for', 'while', 'switch',
			'case', 'break', 'continue', 'try', 'catch', 'finally', 'throw', 'new',
			'this', 'super', 'extends', 'implements', 'static', 'private', 'public', 'protected',
			// Java
			'public', 'private', 'protected', 'static', 'final', 'void', 'int', 'boolean',
			'String', 'double', 'float', 'long', 'short', 'byte', 'char', 'class', 'interface',
			'extends', 'implements', 'package', 'import', 'throws', 'throw', 'try', 'catch',
			// Python
			'def', 'class', 'import', 'from', 'as', 'if', 'elif', 'else', 'for', 'while',
			'return', 'yield', 'lambda', 'with', 'pass', 'raise', 'finally', 'try', 'except',
			// 其他
			'true', 'false', 'null', 'undefined', 'None', 'self', 'True', 'False'
		];

		// 按行处理
		const lines = code.split('\n');
		lines.forEach((line, index) => {
			if (index > 0) {
				codeElement.appendChild(document.createTextNode('\n'));
			}

			let remaining = line;
			let pos = 0;

			while (pos < remaining.length) {
				let matched = false;

				// 检查字符串 "..." 或 '...'
				const stringMatch = remaining.substring(pos).match(/^("([^"\\]*(\\.[^"\\]*)*)"|'([^'\\]*(\\.[^'\\]*)*)')/);
				if (stringMatch) {
					const span = append(codeElement, $('span.string'));
					span.textContent = stringMatch[0];
					pos += stringMatch[0].length;
					matched = true;
					continue;
				}

				// 检查单行注释 // 或 #
				if (remaining.substring(pos).match(/^(\/\/|#)/)) {
					const span = append(codeElement, $('span.comment'));
					span.textContent = remaining.substring(pos);
					break;
				}

				// 检查多行注释 /* ... */
				const multiCommentMatch = remaining.substring(pos).match(/^\/\*[\s\S]*?\*\//);
				if (multiCommentMatch) {
					const span = append(codeElement, $('span.comment'));
					span.textContent = multiCommentMatch[0];
					pos += multiCommentMatch[0].length;
					matched = true;
					continue;
				}

				// 检查函数调用 functionName(
				const functionMatch = remaining.substring(pos).match(/^([a-zA-Z_]\w*)\s*\(/);
				if (functionMatch) {
					const span = append(codeElement, $('span.function'));
					span.textContent = functionMatch[1];
					pos += functionMatch[1].length;
					matched = true;
					continue;
				}

				// 检查类名（大写开头的标识符）
				const classMatch = remaining.substring(pos).match(/^([A-Z][a-zA-Z0-9_]*)/);
				if (classMatch && !keywords.includes(classMatch[1])) {
					const span = append(codeElement, $('span.class'));
					span.textContent = classMatch[0];
					pos += classMatch[0].length;
					matched = true;
					continue;
				}

				// 检查关键字
				for (const keyword of keywords) {
					const regex = new RegExp(`^\\b(${keyword})\\b`);
					const keywordMatch = remaining.substring(pos).match(regex);
					if (keywordMatch) {
						const span = append(codeElement, $('span.keyword'));
						span.textContent = keywordMatch[0];
						pos += keywordMatch[0].length;
						matched = true;
						break;
					}
				}
				if (matched) {
					continue;
				}

				// 检查数字
				const numberMatch = remaining.substring(pos).match(/^\b(\d+\.?\d*)\b/);
				if (numberMatch) {
					const span = append(codeElement, $('span.number'));
					span.textContent = numberMatch[0];
					pos += numberMatch[0].length;
					matched = true;
					continue;
				}

				// 普通字符
				codeElement.appendChild(document.createTextNode(remaining[pos]));
				pos++;
			}
		});
	}
}
