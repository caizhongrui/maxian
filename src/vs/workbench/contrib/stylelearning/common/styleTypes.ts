/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * 代码风格学习系统 - 类型定义
 */

/**
 * 源文件信息
 */
export interface SourceFile {
	path: string;
	language: string;
	content: string;
	size: number;
}

/**
 * 命名约定
 */
export interface NamingConventions {
	/** 类名模式 (e.g., "PascalCase", "UpperCamelCase") */
	classPattern: string;
	/** 类名前缀 (e.g., "Base", "Abstract") */
	classPrefix: string[];
	/** 类名后缀 (e.g., "Service", "Controller", "Impl") */
	classSuffix: string[];

	/** 方法名模式 (e.g., "camelCase", "snake_case") */
	methodPattern: string;
	/** 方法名前缀 (e.g., "get", "set", "is", "handle") */
	methodPrefix: string[];

	/** 变量名模式 */
	variablePattern: string;
	/** 常量名模式 (e.g., "UPPER_SNAKE_CASE") */
	constantPattern: string;

	/** 接口名模式 */
	interfacePattern: string;
	/** 接口名前缀 (e.g., "I") */
	interfacePrefix: string;
}

/**
 * 代码结构模式
 */
export interface StructurePatterns {
	/** 缩进方式 ("tab" | "space") */
	indentation: 'tab' | 'space';
	/** 缩进大小 (如果使用 space) */
	indentSize: number;

	/** 最大行长度 */
	maxLineLength: number;

	/** 大括号风格 ("same-line" | "new-line") */
	braceStyle: 'same-line' | 'new-line';

	/** 引号风格 ("single" | "double") */
	quoteStyle: 'single' | 'double';

	/** 分号使用 */
	useSemicolon: boolean;

	/** 尾部逗号 */
	trailingComma: boolean;

	/** 空格规则 */
	spacing: {
		beforeFunctionParens: boolean;
		beforeBraces: boolean;
		aroundOperators: boolean;
	};
}

/**
 * 注释风格
 */
export interface CommentStyle {
	/** 文件头注释模板 */
	fileHeaderTemplate?: string;

	/** 类注释风格 ("JSDoc" | "JavaDoc" | "DocString") */
	classCommentStyle: string;
	/** 类注释是否必需 */
	requireClassComment: boolean;

	/** 方法注释风格 */
	methodCommentStyle: string;
	/** 方法注释是否必需 */
	requireMethodComment: boolean;

	/** 是否包含作者信息 */
	includeAuthor: boolean;
	/** 是否包含日期 */
	includeDate: boolean;
	/** 是否包含版本 */
	includeVersion: boolean;

	/** 注释语言偏好 ("zh" | "en" | "mixed") */
	commentLanguage: 'zh' | 'en' | 'mixed';
}

/**
 * 框架使用模式
 */
export interface FrameworkPatterns {
	/** 主框架 */
	primaryFramework?: string;

	/** 常用库 */
	commonLibraries: string[];

	/** 架构模式 (e.g., "MVC", "MVVM", "Layered") */
	architecturePattern?: string;

	/** 依赖注入方式 */
	dependencyInjection?: string;

	/** 错误处理模式 */
	errorHandling?: string;

	/** 日志记录模式 */
	loggingPattern?: string;
}

/**
 * 代码示例
 */
export interface CodeExamples {
	/** 示例类 */
	sampleClasses: string[];
	/** 示例方法 */
	sampleMethods: string[];
	/** 示例注释 */
	sampleComments: string[];
}

/**
 * 完整的代码风格配置文件
 */
export interface CodeStyleProfile {
	/** 项目ID */
	projectId: string;
	/** 项目名称 */
	projectName: string;
	/** 主要编程语言 */
	primaryLanguage: string;

	/** 命名约定 */
	naming: NamingConventions;
	/** 结构模式 */
	structure: StructurePatterns;
	/** 注释风格 */
	comments: CommentStyle;
	/** 框架模式 */
	frameworks: FrameworkPatterns;

	/** 代码示例 */
	examples: CodeExamples;

	/** 扫描的文件数量 */
	fileCount: number;
	/** 代码总行数 */
	totalLines: number;

	/** 创建时间 */
	createdAt: Date;
	/** 最后更新时间 */
	updatedAt: Date;

	/** 置信度评分 (0-1) */
	confidence: number;
}

/**
 * AI 增强后的风格配置
 */
export interface EnhancedProfile extends CodeStyleProfile {
	/** AI 识别的最佳实践 */
	bestPractices: string[];
	/** AI 识别的代码模式 */
	patterns: string[];
	/** AI 生成的风格总结 */
	styleSummary: string;
}

/**
 * 风格学习进度
 */
export interface LearningProgress {
	status: 'pending' | 'scanning' | 'analyzing' | 'enhancing' | 'completed' | 'failed';
	progress: number; // 0-100
	message: string;
	filesScanned: number;
	totalFiles: number;
}
