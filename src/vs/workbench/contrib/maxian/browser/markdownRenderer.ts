/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Markdown渲染器
 * 使用简单的正则表达式渲染基本Markdown语法
 */
export class MarkdownRenderer {

	/**
	 * 渲染Markdown文本为HTML
	 */
	static renderMarkdown(text: string): string {
		let html = text;

		// 代码块 ```language\ncode\n```
		html = html.replace(/```(\w+)?\n([\s\S]*?)```/g, (match, language, code) => {
			const lang = language || '';
			return `<pre class="code-block"><code class="language-${lang}">${this.escapeHtml(code.trim())}</code></pre>`;
		});

		// 行内代码 `code`
		html = html.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');

		// 粗体 **text**
		html = html.replace(/\*\*([^\*]+)\*\*/g, '<strong>$1</strong>');

		// 斜体 *text*
		html = html.replace(/\*([^\*]+)\*/g, '<em>$1</em>');

		// 标题 ### text
		html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
		html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
		html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

		// 列表
		html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
		html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');

		// 有序列表
		html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');
		// 注意：这个正则可能不够完善，但对基本场景足够

		// 链接 [text](url)
		html = html.replace(/\[([^\]]+)\]\(([^\)]+)\)/g, '<a href="$2" class="markdown-link">$1</a>');

		// 换行
		html = html.replace(/\n/g, '<br>');

		return html;
	}

	/**
	 * 转义HTML特殊字符
	 */
	private static escapeHtml(text: string): string {
		const div = document.createElement('div');
		div.textContent = text;
		return div.innerHTML;
	}

	/**
	 * 应用代码高亮（使用VSCode主题颜色）
	 */
	static applyCodeHighlight(element: HTMLElement): void {
		const codeBlocks = element.querySelectorAll('pre.code-block code');
		codeBlocks.forEach((codeElement) => {
			// 简单的语法高亮（关键字、字符串、注释）
			const code = codeElement.textContent || '';
			const highlighted = this.highlightCode(code);
			codeElement.innerHTML = highlighted;
		});
	}

	/**
	 * 简单的代码高亮
	 */
	private static highlightCode(code: string): string {
		let highlighted = this.escapeHtml(code);

		// JavaScript/TypeScript 关键字
		const keywords = [
			'function', 'const', 'let', 'var', 'if', 'else', 'return', 'import', 'export',
			'class', 'interface', 'type', 'async', 'await', 'for', 'while', 'switch',
			'case', 'break', 'continue', 'try', 'catch', 'finally', 'throw', 'new'
		];

		keywords.forEach(keyword => {
			const regex = new RegExp(`\\b(${keyword})\\b`, 'g');
			highlighted = highlighted.replace(regex, '<span class="keyword">$1</span>');
		});

		// 字符串 "..." 或 '...'
		highlighted = highlighted.replace(/"([^"]*)"/g, '<span class="string">"$1"</span>');
		highlighted = highlighted.replace(/'([^']*)'/g, '<span class="string">\'$1\'</span>');

		// 注释 //...
		highlighted = highlighted.replace(/(\/\/.*)/g, '<span class="comment">$1</span>');

		// 数字
		highlighted = highlighted.replace(/\b(\d+)\b/g, '<span class="number">$1</span>');

		return highlighted;
	}
}
