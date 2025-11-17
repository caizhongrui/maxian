/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';

/**
 * 聊天消息角色
 */
export enum ChatRole {
	User = 'user',
	Assistant = 'assistant',
	System = 'system'
}

/**
 * 聊天消息
 */
export interface ChatMessage {
	/**
	 * 消息ID
	 */
	id: string;

	/**
	 * 角色
	 */
	role: ChatRole;

	/**
	 * 消息内容
	 */
	content: string;

	/**
	 * 时间戳
	 */
	timestamp: number;

	/**
	 * 附加的代码片段
	 */
	codeSnippet?: CodeSnippet;

	/**
	 * 附加的文件上下文
	 */
	fileContext?: FileContext;

	/**
	 * 元数据
	 */
	metadata?: {
		[key: string]: any;
	};
}

/**
 * 代码片段
 */
export interface CodeSnippet {
	/**
	 * 代码内容
	 */
	code: string;

	/**
	 * 语言
	 */
	language: string;

	/**
	 * 文件URI（如果来自文件）
	 */
	fileUri?: URI;

	/**
	 * 起始行号
	 */
	startLine?: number;

	/**
	 * 结束行号
	 */
	endLine?: number;
}

/**
 * 文件上下文
 */
export interface FileContext {
	/**
	 * 文件URI
	 */
	fileUri: URI;

	/**
	 * 文件名
	 */
	fileName: string;

	/**
	 * 文件路径
	 */
	filePath: string;

	/**
	 * 语言
	 */
	language: string;

	/**
	 * 文件内容（可选，用于小文件）
	 */
	content?: string;

	/**
	 * 选中的范围
	 */
	selection?: {
		startLine: number;
		startColumn: number;
		endLine: number;
		endColumn: number;
	};

	/**
	 * 代码结构信息（通过语言适配器提取）
	 */
	codeStructure?: {
		/**
		 * 类列表（简化信息）
		 */
		classes?: Array<{
			name: string;
			visibility: string;
			methods: Array<{ name: string; returnType?: string; }>;
			properties: Array<{ name: string; type?: string; }>;
		}>;

		/**
		 * 函数列表（文件级别）
		 */
		functions?: Array<{
			name: string;
			returnType?: string;
			parameters: Array<{ name: string; type?: string; }>;
		}>;

		/**
		 * 导入语句
		 */
		imports?: Array<{
			modulePath: string;
			importedNames?: string[];
		}>;

		/**
		 * 检测到的框架
		 */
		frameworks?: string[];
	};
}

/**
 * 聊天响应
 */
export interface ChatResponse {
	/**
	 * 响应消息
	 */
	message: ChatMessage;

	/**
	 * 建议的操作
	 */
	suggestedActions?: SuggestedAction[];

	/**
	 * 是否完成
	 */
	isComplete: boolean;

	/**
	 * 错误信息
	 */
	error?: string;
}

/**
 * 建议的操作
 */
export interface SuggestedAction {
	/**
	 * 操作ID
	 */
	id: string;

	/**
	 * 操作标题
	 */
	title: string;

	/**
	 * 操作描述
	 */
	description?: string;

	/**
	 * 操作图标
	 */
	icon?: string;

	/**
	 * 操作命令
	 */
	command: string;

	/**
	 * 命令参数
	 */
	args?: any[];
}

/**
 * 对话上下文
 */
export interface ConversationContext {
	/**
	 * 当前工作区
	 */
	workspaceFolder?: URI;

	/**
	 * 当前文件
	 */
	currentFile?: FileContext;

	/**
	 * 选中的代码
	 */
	selectedCode?: CodeSnippet;

	/**
	 * 项目语言
	 */
	projectLanguage?: string;

	/**
	 * 项目框架
	 */
	projectFrameworks?: string[];

	/**
	 * 最近的错误
	 */
	recentErrors?: string[];

	/**
	 * 打开的文件列表
	 */
	openFiles?: string[];
}

/**
 * 聊天请求
 */
export interface ChatRequest {
	/**
	 * 用户消息
	 */
	message: string;

	/**
	 * 是否包含上下文
	 */
	includeContext: boolean;

	/**
	 * 上下文
	 */
	context?: ConversationContext;

	/**
	 * 历史消息（最近N条）
	 */
	history?: ChatMessage[];

	/**
	 * 请求类型
	 */
	type?: ChatRequestType;
}

/**
 * 聊天请求类型
 */
export enum ChatRequestType {
	/**
	 * 普通对话
	 */
	General = 'general',

	/**
	 * 代码解释
	 */
	ExplainCode = 'explain',

	/**
	 * 代码优化
	 */
	OptimizeCode = 'optimize',

	/**
	 * 查找错误
	 */
	FindBugs = 'find_bugs',

	/**
	 * 生成文档
	 */
	GenerateDocs = 'generate_docs',

	/**
	 * 重构代码
	 */
	RefactorCode = 'refactor'
}

/**
 * 对话会话
 */
export interface Conversation {
	/**
	 * 会话ID
	 */
	id: string;

	/**
	 * 会话标题
	 */
	title: string;

	/**
	 * 消息列表
	 */
	messages: ChatMessage[];

	/**
	 * 创建时间
	 */
	createdAt: number;

	/**
	 * 更新时间
	 */
	updatedAt: number;

	/**
	 * 上下文
	 */
	context?: ConversationContext;
}

/**
 * 聊天配置
 */
export interface ChatConfiguration {
	/**
	 * 最大历史消息数
	 */
	maxHistoryMessages: number;

	/**
	 * 是否自动包含上下文
	 */
	autoIncludeContext: boolean;

	/**
	 * 是否显示建议操作
	 */
	showSuggestedActions: boolean;

	/**
	 * 代码高亮主题
	 */
	codeHighlightTheme: string;

	/**
	 * 是否启用Markdown渲染
	 */
	enableMarkdownRendering: boolean;
}
