/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append } from '../../../../base/browser/dom.js';
import { copyToClipboard } from './uiUtils.js';

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
		// 移除尾部空行（避免LLM响应末尾的\n\n被渲染为多余的<br>元素，在编码模式下尤为明显）
		while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
			lines.pop();
		}
		let i = 0;

		while (i < lines.length) {
			const line = lines[i];

			// 代码块 ```
			if (line.startsWith('```')) {
				// 解析 fence 信息：格式 language 或 language:filepath 或 language:filepath:startLine-endLine
				const fenceInfo = line.substring(3).trim();
				let language = fenceInfo;
				let filePath = '';
				let lineRange = '';

				if (fenceInfo.includes(':')) {
					const colonIdx = fenceInfo.indexOf(':');
					language = fenceInfo.substring(0, colonIdx);
					const rest = fenceInfo.substring(colonIdx + 1);
					// 判断末尾是否为行范围 digits-digits
					const lineRangeMatch = rest.match(/:?(\d+-\d+)$/);
					if (lineRangeMatch) {
						lineRange = lineRangeMatch[1];
						filePath = rest.substring(0, rest.length - lineRangeMatch[0].length);
					} else {
						filePath = rest;
					}
				}

				const codeLines: string[] = [];
				i++; // 跳过开始标记

				// 收集代码块内容
				while (i < lines.length && !lines[i].startsWith('```')) {
					codeLines.push(lines[i]);
					i++;
				}
				i++; // 跳过结束标记

				const codeContent = codeLines.join('\n');

				// 创建代码块包装器
				const codeBlockWrapper = append(container, $('div.code-block-wrapper'));
				codeBlockWrapper.style.position = 'relative';
				codeBlockWrapper.style.marginBottom = '8px';

				// 代码块头部（语言标签 + 文件来源 + 复制按钮）
				const codeHeader = append(codeBlockWrapper, $('div.code-block-header'));
				codeHeader.style.display = 'flex';
				codeHeader.style.alignItems = 'center';
				codeHeader.style.justifyContent = 'space-between';
				codeHeader.style.padding = '4px 10px';
				codeHeader.style.backgroundColor = 'var(--vscode-textCodeBlock-background)';
				codeHeader.style.borderTopLeftRadius = '6px';
				codeHeader.style.borderTopRightRadius = '6px';
				codeHeader.style.borderBottom = '1px solid var(--vscode-widget-border)';

				// 左侧信息区（语言 + 文件来源）
				const headerLeft = append(codeHeader, $('div'));
				headerLeft.style.display = 'flex';
				headerLeft.style.alignItems = 'center';
				headerLeft.style.gap = '8px';
				headerLeft.style.overflow = 'hidden';
				headerLeft.style.minWidth = '0';

				// 语言标签
				const langLabel = append(headerLeft, $('span.code-language'));
				langLabel.style.fontSize = '11px';
				langLabel.style.color = 'var(--vscode-descriptionForeground)';
				langLabel.style.textTransform = 'uppercase';
				langLabel.style.flexShrink = '0';
				langLabel.textContent = language || 'code';

				// 文件来源（有文件路径时才显示）
				if (filePath) {
					const sep = append(headerLeft, $('span'));
					sep.style.color = 'var(--vscode-widget-border)';
					sep.style.flexShrink = '0';
					sep.textContent = '•';

					const fileIcon = append(headerLeft, $('span.codicon.codicon-file-code'));
					fileIcon.style.fontSize = '12px';
					fileIcon.style.color = 'var(--vscode-symbolIcon-fileForeground, var(--vscode-descriptionForeground))';
					fileIcon.style.flexShrink = '0';

					// 文件路径 + 行范围
					const fileInfo = append(headerLeft, $('span'));
					fileInfo.style.fontSize = '12px';
					fileInfo.style.color = 'var(--vscode-foreground)';
					fileInfo.style.overflow = 'hidden';
					fileInfo.style.textOverflow = 'ellipsis';
					fileInfo.style.whiteSpace = 'nowrap';

					// 目录部分（浅色）+ 文件名部分（主色）
					const lastSlash = filePath.lastIndexOf('/');
					const dirPart = lastSlash >= 0 ? filePath.slice(0, lastSlash + 1) : '';
					const namePart = lastSlash >= 0 ? filePath.slice(lastSlash + 1) : filePath;

					if (dirPart) {
						const dirSpan = append(fileInfo, $('span'));
						dirSpan.style.color = 'var(--vscode-descriptionForeground)';
						dirSpan.textContent = dirPart;
					}
					const nameSpan = append(fileInfo, $('span'));
					nameSpan.style.fontWeight = '500';
					nameSpan.textContent = namePart;

					if (lineRange) {
						const lineSpan = append(fileInfo, $('span'));
						lineSpan.style.color = 'var(--vscode-descriptionForeground)';
						lineSpan.textContent = `:${lineRange}`;
					}
				} else if (lineRange) {
					// 只有行范围，没有文件路径
					const sep = append(headerLeft, $('span'));
					sep.style.color = 'var(--vscode-widget-border)';
					sep.textContent = '•';

					const lineSpan = append(headerLeft, $('span'));
					lineSpan.style.fontSize = '12px';
					lineSpan.style.color = 'var(--vscode-descriptionForeground)';
					lineSpan.textContent = `Line ${lineRange}`;
				}

				// 复制按钮
				const copyBtn = append(codeHeader, $('button.code-copy-btn'));
				copyBtn.style.background = 'transparent';
				copyBtn.style.border = 'none';
				copyBtn.style.cursor = 'pointer';
				copyBtn.style.color = 'var(--vscode-descriptionForeground)';
				copyBtn.style.fontSize = '12px';
				copyBtn.style.padding = '2px 6px';
				copyBtn.style.borderRadius = '4px';
				copyBtn.style.display = 'flex';
				copyBtn.style.alignItems = 'center';
				copyBtn.style.gap = '4px';
				copyBtn.style.transition = 'all 0.2s ease';

				const copyIcon = append(copyBtn, $('span.codicon.codicon-copy'));
				copyIcon.style.fontSize = '12px';

				const copyText = append(copyBtn, $('span'));
				copyText.textContent = '复制';

				copyBtn.onmouseenter = () => {
					copyBtn.style.backgroundColor = 'var(--vscode-toolbar-hoverBackground)';
					copyBtn.style.color = 'var(--vscode-foreground)';
				};
				copyBtn.onmouseleave = () => {
					copyBtn.style.backgroundColor = 'transparent';
					copyBtn.style.color = 'var(--vscode-descriptionForeground)';
				};
				copyBtn.onclick = async () => {
					const success = await copyToClipboard(codeContent);
					if (success) {
						copyIcon.className = 'codicon codicon-check';
						copyIcon.style.color = 'var(--vscode-charts-green)';
						copyText.textContent = '已复制';
						setTimeout(() => {
							copyIcon.className = 'codicon codicon-copy';
							copyIcon.style.color = '';
							copyText.textContent = '复制';
						}, 2000);
					}
				};

				// 创建代码块元素
				const pre = append(codeBlockWrapper, $('pre.code-block'));
				pre.style.margin = '0';
				pre.style.borderTopLeftRadius = '0';
				pre.style.borderTopRightRadius = '0';

				const code = append(pre, $('code'));
				if (language) {
					code.className = `language-${language}`;
				}
				code.textContent = codeContent;

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
	 * 支持多种编程语言的语法高亮
	 */
	private static highlightCode(codeElement: HTMLElement): void {
		const code = codeElement.textContent || '';
		const language = this.detectLanguage(codeElement);

		// 清空元素（使用DOM API避免CSP违规）
		while (codeElement.firstChild) {
			codeElement.removeChild(codeElement.firstChild);
		}

		// 按行处理
		const lines = code.split('\n');
		lines.forEach((line, index) => {
			if (index > 0) {
				codeElement.appendChild(document.createTextNode('\n'));
			}

			this.highlightLine(line, codeElement, language);
		});
	}

	/**
	 * 检测代码语言
	 */
	private static detectLanguage(codeElement: HTMLElement): string {
		const className = codeElement.className || '';
		const langMatch = className.match(/language-(\w+)/);
		return langMatch ? langMatch[1].toLowerCase() : 'text';
	}

	/**
	 * 高亮单行代码
	 */
	private static highlightLine(line: string, container: HTMLElement, language: string): void {
		let pos = 0;

		while (pos < line.length) {
			const remaining = line.substring(pos);

			// 1. 检查装饰器 @decorator
			const decoratorMatch = remaining.match(/^@[a-zA-Z_]\w*/);
			if (decoratorMatch) {
				const span = append(container, $('span.decorator'));
				span.textContent = decoratorMatch[0];
				pos += decoratorMatch[0].length;
				continue;
			}

			// 2. 检查模板字符串 `...${...}...`
			if (remaining.startsWith('`')) {
				const templateResult = this.parseTemplateString(remaining);
				if (templateResult) {
					this.renderTemplateString(templateResult.content, container);
					pos += templateResult.length;
					continue;
				}
			}

			// 3. 检查正则表达式 /pattern/flags
			const regexMatch = remaining.match(/^\/(?:[^/\\]|\\.)+\/[gimsuvy]*/);
			if (regexMatch && this.isRegexContext(line, pos)) {
				const span = append(container, $('span.regexp'));
				span.textContent = regexMatch[0];
				pos += regexMatch[0].length;
				continue;
			}

			// 4. 检查多行字符串（Python三引号）
			const tripleQuoteMatch = remaining.match(/^("""|''')[\s\S]*?\1/);
			if (tripleQuoteMatch) {
				const span = append(container, $('span.string'));
				span.textContent = tripleQuoteMatch[0];
				pos += tripleQuoteMatch[0].length;
				continue;
			}

			// 5. 检查字符串 "..." 或 '...'
			const stringMatch = remaining.match(/^("([^"\\]*(\\.[^"\\]*)*)"|'([^'\\]*(\\.[^'\\]*)*)')/);
			if (stringMatch) {
				const span = append(container, $('span.string'));
				span.textContent = stringMatch[0];
				pos += stringMatch[0].length;
				continue;
			}

			// 6. 检查单行注释 // 或 # 或 --
			const commentPrefixes = ['///', '//', '#', '--'];
			for (const prefix of commentPrefixes) {
				if (remaining.startsWith(prefix)) {
					const span = append(container, $('span.comment'));
					span.textContent = remaining;
					return; // 注释占据剩余行
				}
			}

			// 7. 检查多行注释开始 /* 或 <!--
			const multiCommentMatch = remaining.match(/^(\/\*[\s\S]*?\*\/|<!--[\s\S]*?-->)/);
			if (multiCommentMatch) {
				const span = append(container, $('span.comment'));
				span.textContent = multiCommentMatch[0];
				pos += multiCommentMatch[0].length;
				continue;
			}

			// 8. 检查 JSX/XML 标签
			if (language === 'jsx' || language === 'tsx' || language === 'xml' || language === 'html') {
				const tagMatch = remaining.match(/^<\/?[a-zA-Z][a-zA-Z0-9.:-]*/);
				if (tagMatch) {
					const span = append(container, $('span.tag'));
					span.textContent = tagMatch[0];
					pos += tagMatch[0].length;
					continue;
				}
			}

			// 9. 检查属性名 (在标签内)
			const attrMatch = remaining.match(/^([a-zA-Z_][\w-]*)\s*=/);
			if (attrMatch && this.isInsideTag(line, pos)) {
				const span = append(container, $('span.attribute'));
				span.textContent = attrMatch[1];
				pos += attrMatch[1].length;
				continue;
			}

			// 10. 检查方法调用 .methodName(
			const methodMatch = remaining.match(/^\.([a-zA-Z_]\w*)\s*\(/);
			if (methodMatch) {
				container.appendChild(document.createTextNode('.'));
				const span = append(container, $('span.method'));
				span.textContent = methodMatch[1];
				pos += 1 + methodMatch[1].length;
				continue;
			}

			// 11. 检查函数调用 functionName(
			const functionMatch = remaining.match(/^([a-zA-Z_]\w*)\s*\(/);
			if (functionMatch && !this.isKeyword(functionMatch[1], language)) {
				const span = append(container, $('span.function'));
				span.textContent = functionMatch[1];
				pos += functionMatch[1].length;
				continue;
			}

			// 12. 检查类型注解（TypeScript: variable: Type）
			if (language === 'typescript' || language === 'ts') {
				const typeMatch = remaining.match(/^:\s*([A-Z][a-zA-Z0-9_<>[\],\s]*)/);
				if (typeMatch) {
					container.appendChild(document.createTextNode(': '));
					const span = append(container, $('span.type'));
					span.textContent = typeMatch[1].trim();
					pos += typeMatch[0].length;
					continue;
				}
			}

			// 13. 检查类名（大写开头的标识符）
			const classMatch = remaining.match(/^([A-Z][a-zA-Z0-9_]*)/);
			if (classMatch && !this.isKeyword(classMatch[1], language)) {
				const span = append(container, $('span.class'));
				span.textContent = classMatch[0];
				pos += classMatch[0].length;
				continue;
			}

			// 14. 检查常量（全大写标识符）
			const constantMatch = remaining.match(/^([A-Z][A-Z0-9_]+)\b/);
			if (constantMatch && constantMatch[0].length > 1) {
				const span = append(container, $('span.constant'));
				span.textContent = constantMatch[0];
				pos += constantMatch[0].length;
				continue;
			}

			// 15. 检查布尔值和空值
			const boolNullMatch = remaining.match(/^(true|false|True|False|TRUE|FALSE)\b/);
			if (boolNullMatch) {
				const span = append(container, $('span.boolean'));
				span.textContent = boolNullMatch[0];
				pos += boolNullMatch[0].length;
				continue;
			}

			const nullMatch = remaining.match(/^(null|undefined|nil|None|NULL)\b/);
			if (nullMatch) {
				const span = append(container, $('span.null'));
				span.textContent = nullMatch[0];
				pos += nullMatch[0].length;
				continue;
			}

			// 16. 检查关键字
			const keywordMatch = this.matchKeyword(remaining, language);
			if (keywordMatch) {
				const span = append(container, $('span.keyword'));
				span.textContent = keywordMatch;
				pos += keywordMatch.length;
				continue;
			}

			// 17. 检查内置函数/类型
			const builtinMatch = this.matchBuiltin(remaining, language);
			if (builtinMatch) {
				const span = append(container, $('span.builtin'));
				span.textContent = builtinMatch;
				pos += builtinMatch.length;
				continue;
			}

			// 18. 检查数字（包括各种进制）
			const numberMatch = remaining.match(/^(0x[\da-fA-F]+|0b[01]+|0o[0-7]+|\d+\.?\d*([eE][+-]?\d+)?)/);
			if (numberMatch) {
				const span = append(container, $('span.number'));
				span.textContent = numberMatch[0];
				pos += numberMatch[0].length;
				continue;
			}

			// 19. 检查操作符
			const operatorMatch = remaining.match(/^(===|!==|==|!=|<=|>=|=>|->|&&|\|\||[+\-*/%&|^~<>!=]=?)/);
			if (operatorMatch) {
				const span = append(container, $('span.operator'));
				span.textContent = operatorMatch[0];
				pos += operatorMatch[0].length;
				continue;
			}

			// 20. 普通字符
			container.appendChild(document.createTextNode(remaining[0]));
			pos++;
		}
	}

	/**
	 * 解析模板字符串
	 */
	private static parseTemplateString(str: string): { content: string; length: number } | null {
		if (!str.startsWith('`')) {
			return null;
		}

		let i = 1;
		let depth = 0;
		let content = '`';

		while (i < str.length) {
			const char = str[i];

			if (char === '\\' && i + 1 < str.length) {
				content += char + str[i + 1];
				i += 2;
				continue;
			}

			if (char === '$' && str[i + 1] === '{' && depth === 0) {
				depth++;
				content += '${';
				i += 2;
				continue;
			}

			if (char === '{' && depth > 0) {
				depth++;
			}

			if (char === '}' && depth > 0) {
				depth--;
			}

			if (char === '`' && depth === 0) {
				content += '`';
				return { content, length: content.length };
			}

			content += char;
			i++;
		}

		return null;
	}

	/**
	 * 渲染模板字符串
	 */
	private static renderTemplateString(template: string, container: HTMLElement): void {
		const parts = template.split(/(\$\{[^}]*\})/);

		for (const part of parts) {
			if (part.startsWith('${') && part.endsWith('}')) {
				const span = append(container, $('span.template-expr'));
				span.textContent = part;
			} else {
				const span = append(container, $('span.template-string'));
				span.textContent = part;
			}
		}
	}

	/**
	 * 检查是否在正则表达式上下文中
	 */
	private static isRegexContext(line: string, pos: number): boolean {
		const before = line.substring(0, pos).trimEnd();
		const regexContextPrefixes = ['=', '(', ',', '[', '!', '&', '|', ':', ';', '{', 'return', 'typeof', 'instanceof'];
		return regexContextPrefixes.some(p => before.endsWith(p)) || before === '';
	}

	/**
	 * 检查是否在标签内
	 */
	private static isInsideTag(line: string, pos: number): boolean {
		const before = line.substring(0, pos);
		const lastOpen = before.lastIndexOf('<');
		const lastClose = before.lastIndexOf('>');
		return lastOpen > lastClose;
	}

	/**
	 * 检查是否是关键字
	 */
	private static isKeyword(word: string, language: string): boolean {
		const keywords = this.getKeywords(language);
		return keywords.includes(word);
	}

	/**
	 * 匹配关键字
	 */
	private static matchKeyword(str: string, language: string): string | null {
		const keywords = this.getKeywords(language);
		for (const keyword of keywords) {
			const regex = new RegExp(`^\\b(${keyword})\\b`);
			const match = str.match(regex);
			if (match) {
				return match[0];
			}
		}
		return null;
	}

	/**
	 * 获取语言关键字
	 */
	private static getKeywords(language: string): string[] {
		const commonKeywords = [
			'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue',
			'return', 'try', 'catch', 'finally', 'throw', 'new', 'delete', 'typeof', 'instanceof'
		];

		const languageKeywords: Record<string, string[]> = {
			javascript: [...commonKeywords,
				'function', 'const', 'let', 'var', 'class', 'extends', 'super', 'this',
				'import', 'export', 'default', 'from', 'as', 'async', 'await', 'yield',
				'static', 'get', 'set', 'of', 'in', 'debugger', 'with'
			],
			typescript: [...commonKeywords,
				'function', 'const', 'let', 'var', 'class', 'extends', 'super', 'this',
				'import', 'export', 'default', 'from', 'as', 'async', 'await', 'yield',
				'static', 'get', 'set', 'of', 'in', 'debugger', 'with',
				'interface', 'type', 'enum', 'namespace', 'module', 'declare', 'abstract',
				'implements', 'private', 'protected', 'public', 'readonly', 'keyof', 'infer',
				'is', 'asserts', 'override'
			],
			python: [...commonKeywords,
				'def', 'class', 'import', 'from', 'as', 'pass', 'raise', 'except',
				'with', 'yield', 'lambda', 'and', 'or', 'not', 'in', 'is', 'global',
				'nonlocal', 'assert', 'async', 'await', 'elif', 'True', 'False', 'None'
			],
			java: [...commonKeywords,
				'class', 'interface', 'extends', 'implements', 'abstract', 'final',
				'static', 'public', 'private', 'protected', 'void', 'int', 'long',
				'float', 'double', 'boolean', 'char', 'byte', 'short', 'package',
				'import', 'this', 'super', 'native', 'synchronized', 'volatile',
				'transient', 'strictfp', 'enum', 'assert'
			],
			go: [...commonKeywords,
				'func', 'package', 'import', 'var', 'const', 'type', 'struct',
				'interface', 'map', 'chan', 'range', 'select', 'defer', 'go',
				'fallthrough', 'goto'
			],
			rust: [...commonKeywords,
				'fn', 'let', 'mut', 'const', 'static', 'struct', 'enum', 'trait',
				'impl', 'mod', 'pub', 'crate', 'super', 'self', 'use', 'as', 'where',
				'async', 'await', 'move', 'ref', 'type', 'dyn', 'unsafe', 'extern',
				'loop', 'match', 'if', 'else'
			],
			sql: [
				'SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'NOT', 'IN', 'LIKE', 'BETWEEN',
				'JOIN', 'LEFT', 'RIGHT', 'INNER', 'OUTER', 'ON', 'GROUP', 'BY', 'HAVING',
				'ORDER', 'ASC', 'DESC', 'LIMIT', 'OFFSET', 'INSERT', 'INTO', 'VALUES',
				'UPDATE', 'SET', 'DELETE', 'CREATE', 'TABLE', 'INDEX', 'DROP', 'ALTER',
				'ADD', 'COLUMN', 'PRIMARY', 'KEY', 'FOREIGN', 'REFERENCES', 'NULL',
				'DEFAULT', 'UNIQUE', 'CHECK', 'CONSTRAINT', 'UNION', 'ALL', 'DISTINCT',
				'AS', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'EXISTS', 'TRUNCATE'
			],
			bash: [
				'if', 'then', 'else', 'elif', 'fi', 'case', 'esac', 'for', 'while',
				'until', 'do', 'done', 'in', 'function', 'return', 'exit', 'break',
				'continue', 'export', 'local', 'readonly', 'shift', 'source', 'declare',
				'echo', 'read', 'set', 'unset', 'eval', 'exec', 'trap'
			],
			css: [
				'@import', '@media', '@keyframes', '@font-face', '@supports', '@page',
				'!important'
			]
		};

		// 处理别名
		const aliases: Record<string, string> = {
			'js': 'javascript',
			'ts': 'typescript',
			'tsx': 'typescript',
			'jsx': 'javascript',
			'py': 'python',
			'rb': 'ruby',
			'sh': 'bash',
			'shell': 'bash',
			'zsh': 'bash'
		};

		const normalizedLang = aliases[language] || language;
		return languageKeywords[normalizedLang] || commonKeywords;
	}

	/**
	 * 匹配内置函数/类型
	 */
	private static matchBuiltin(str: string, language: string): string | null {
		const builtins = this.getBuiltins(language);
		for (const builtin of builtins) {
			const regex = new RegExp(`^\\b(${builtin})\\b`);
			const match = str.match(regex);
			if (match) {
				return match[0];
			}
		}
		return null;
	}

	/**
	 * 获取内置函数/类型
	 */
	private static getBuiltins(language: string): string[] {
		const builtins: Record<string, string[]> = {
			javascript: [
				'console', 'Math', 'JSON', 'Object', 'Array', 'String', 'Number', 'Boolean',
				'Date', 'RegExp', 'Error', 'Map', 'Set', 'WeakMap', 'WeakSet', 'Promise',
				'Symbol', 'Proxy', 'Reflect', 'parseInt', 'parseFloat', 'isNaN', 'isFinite',
				'encodeURI', 'decodeURI', 'encodeURIComponent', 'decodeURIComponent',
				'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'fetch',
				'document', 'window', 'navigator', 'location', 'history', 'localStorage',
				'sessionStorage', 'XMLHttpRequest', 'FormData', 'Blob', 'File', 'FileReader',
				'URL', 'URLSearchParams', 'Headers', 'Request', 'Response', 'AbortController'
			],
			typescript: [
				'console', 'Math', 'JSON', 'Object', 'Array', 'String', 'Number', 'Boolean',
				'Date', 'RegExp', 'Error', 'Map', 'Set', 'WeakMap', 'WeakSet', 'Promise',
				'Symbol', 'Proxy', 'Reflect', 'Partial', 'Required', 'Readonly', 'Pick',
				'Omit', 'Exclude', 'Extract', 'NonNullable', 'ReturnType', 'Parameters',
				'ConstructorParameters', 'InstanceType', 'Record', 'Awaited'
			],
			python: [
				'print', 'len', 'range', 'str', 'int', 'float', 'bool', 'list', 'dict',
				'set', 'tuple', 'type', 'isinstance', 'issubclass', 'hasattr', 'getattr',
				'setattr', 'delattr', 'open', 'input', 'format', 'sorted', 'reversed',
				'enumerate', 'zip', 'map', 'filter', 'reduce', 'any', 'all', 'sum', 'min',
				'max', 'abs', 'round', 'pow', 'divmod', 'hex', 'oct', 'bin', 'ord', 'chr',
				'repr', 'eval', 'exec', 'compile', 'globals', 'locals', 'vars', 'dir',
				'help', 'id', 'hash', 'iter', 'next', 'slice', 'super', 'classmethod',
				'staticmethod', 'property', 'object', 'Exception', 'BaseException'
			]
		};

		const aliases: Record<string, string> = {
			'js': 'javascript',
			'ts': 'typescript',
			'tsx': 'typescript',
			'jsx': 'javascript',
			'py': 'python'
		};

		const normalizedLang = aliases[language] || language;
		return builtins[normalizedLang] || [];
	}
}
