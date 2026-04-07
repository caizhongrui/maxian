/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ToolName } from '../tools/toolTypes.js';

/**
 * 权限操作类型
 */
export type PermissionAction = 'allow' | 'deny' | 'ask';

/**
 * 权限规则
 */
export interface IPermissionRule {
	/** 工具名称 */
	tool: ToolName;
	/** 文件/路径模式（支持通配符） */
	pattern: string;
	/** 权限操作 */
	action: PermissionAction;
	/** 规则描述 */
	description?: string;
}

/**
 * 权限规则集
 */
export type PermissionRuleset = IPermissionRule[];

/**
 * 权限检查请求
 */
export interface IPermissionRequest {
	/** 工具名称 */
	tool: ToolName;
	/** 目标文件/路径 */
	target: string;
	/** 原因/上下文 */
	reason?: string;
	/** 额外元数据 */
	metadata?: Record<string, any>;
}

/**
 * 权限检查结果
 */
export interface IPermissionCheckResult {
	/** 权限操作 */
	action: PermissionAction;
	/** 匹配的规则 */
	rule?: IPermissionRule;
	/** 原因说明 */
	reason?: string;
}

/**
 * 权限对话框回复
 */
export type PermissionReply = 'once' | 'always' | 'reject';

/**
 * 默认权限规则配置
 */
export const DEFAULT_PERMISSION_RULES: Record<ToolName, Record<string, PermissionAction>> = {
	// 文件读取权限
	read_file: {
		'*.env': 'ask',              // 环境变量文件需要确认
		'*.env.local': 'ask',
		'*.env.development': 'ask',
		'*.env.production': 'ask',
		'*.env.example': 'allow',    // 示例文件允许
		'**/node_modules/**': 'deny', // 禁止读取node_modules
		'**/.git/**': 'deny',         // 禁止读取.git目录
		'**/.env*': 'ask',            // 所有.env开头的文件
		'**/secrets/**': 'ask',       // secrets目录需要确认
		'*': 'allow'                  // 其他文件默认允许
	},

	// 文件写入权限
	write_to_file: {
		'*.env': 'deny',              // 禁止修改环境变量
		'*.env.*': 'deny',
		'package.json': 'ask',        // 重要文件需要确认
		'package-lock.json': 'ask',
		'yarn.lock': 'ask',
		'pom.xml': 'ask',
		'build.gradle': 'ask',
		'tsconfig.json': 'ask',
		'.gitignore': 'ask',
		'**/node_modules/**': 'deny', // 禁止写入node_modules
		'**/.git/**': 'deny',         // 禁止写入.git
		'*': 'allow'
	},

	// 文件删除权限（比写入更严格）
	delete_file: {
		'**/node_modules/**': 'deny', // 禁止删除node_modules
		'**/.git/**': 'deny',         // 禁止删除.git
		'*.env': 'ask',               // 环境变量文件需要确认
		'*.env.*': 'ask',
		'package.json': 'ask',        // 重要文件需要确认
		'pom.xml': 'ask',
		'build.gradle': 'ask',
		'*': 'allow'
	},

	// 目录创建权限
	create_directory: {
		'**/node_modules/**': 'deny', // 禁止在node_modules下创建
		'**/.git/**': 'deny',         // 禁止在.git下创建
		'*': 'allow'
	},

	// 命令执行权限
	execute_command: {
		'rm -rf*': 'deny',            // 危险命令禁止
		'rm -fr*': 'deny',
		'sudo*': 'deny',              // sudo命令禁止
		'git push*': 'ask',           // Push需要确认
		'git push --force*': 'deny',  // 强制push禁止
		'npm install*': 'ask',        // 安装依赖需确认
		'npm uninstall*': 'ask',
		'yarn add*': 'ask',
		'mvn install*': 'ask',
		'gradle build*': 'ask',
		'*': 'allow'
	},

	// 文件编辑权限
	apply_diff: {
		'*.env': 'deny',
		'package.json': 'ask',
		'**/node_modules/**': 'deny',
		'*': 'allow'
	},

	// 文件搜索权限 (通常允许)
	search_files: {
		'*': 'allow'
	},

	list_files: {
		'*': 'allow'
	},

	glob: {
		'*': 'allow'
	},

	// LSP操作权限 (通常允许)
	lsp_diagnostics: {
		'*': 'allow'
	},

	lsp_hover: {
		'*': 'allow'
	},

	lsp_definition: {
		'*': 'allow'
	},

	lsp_references: {
		'*': 'allow'
	},

	lsp_type_definition: {
		'*': 'allow'
	},

	lsp: {
		'*': 'allow'
	},

	// 其他工具 (默认允许)
	codebase_search: {
		'*': 'allow'
	},

	list_code_definition_names: {
		'*': 'allow'
	},

	ask_followup_question: {
		'*': 'allow'
	},

	attempt_completion: {
		'*': 'allow'
	},

	new_task: {
		'*': 'allow'
	},

	update_todo_list: {
		'*': 'allow'
	},

	skill: {
		'*': 'allow'
	},

	// Batch工具：继承各工具的权限
	batch: {
		'*': 'allow'  // batch本身允许，但内部工具会各自检查权限
	},

	// 新增工具默认规则
	edit: {
		'*.env': 'deny',
		'*': 'allow'
	},

	edit_file: {
		'*.env': 'deny',
		'*': 'allow'
	},

	insert_content: {
		'*.env': 'deny',
		'*': 'allow'
	},

	multiedit: {
		'*.env': 'deny',
		'*': 'allow'
	},

	task: {
		'*': 'allow'
	},

	patch: {
		'*.env': 'deny',
		'*': 'allow'
	},

	// P2优化：待办列表工具（始终允许）
	todowrite: {
		'*': 'allow'
	},

	todoread: {
		'*': 'allow'
	},

	// PR代码审查（只读git操作，始终允许）
	pr_review: {
		'*': 'allow'
	},

	// 测试代码生成（读取源文件分析，始终允许）
	generate_tests: {
		'*': 'allow'
	},

	// MCP 工具调用（始终允许，权限由服务器配置控制）
	use_mcp_tool: {
		'*': 'allow'
	},

	// MCP 资源访问（始终允许）
	access_mcp_resource: {
		'*': 'allow'
	}
};

/**
 * 敏感文件模式列表
 */
export const SENSITIVE_FILE_PATTERNS = [
	'*.env',
	'*.env.*',
	'**/secrets/**',
	'**/.ssh/**',
	'**/.aws/**',
	'**/credentials*',
	'**/*secret*',
	'**/*password*',
	'**/*key*.pem',
	'**/*key*.key',
	'**/id_rsa*',
	'**/.npmrc',
	'**/.pypirc',
] as const;

/**
 * 危险命令模式列表
 */
export const DANGEROUS_COMMAND_PATTERNS = [
	'rm -rf*',
	'rm -fr*',
	'sudo*',
	'git push --force*',
	'git reset --hard*',
	'dd if=*',
	'mkfs.*',
	'format*',
	':(){:|:&};:',  // fork bomb
] as const;
