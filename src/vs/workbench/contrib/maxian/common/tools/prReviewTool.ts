/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * PR代码审查工具
 *
 * 获取当前工作区的git diff，供Agent进行代码审查。
 * 工具本身只负责获取diff内容，不调用LLM，Agent会根据返回内容进行分析。
 */

import { execSync } from 'child_process';
import type { ToolResponse } from './toolTypes.js';

/** diff内容最大字符数（50000字符） */
const MAX_DIFF_LENGTH = 50000;

/**
 * 执行git命令，返回输出字符串或错误信息
 */
function runGitCommand(command: string, cwd: string): { output: string; error: string | null } {
	try {
		const output = execSync(command, {
			cwd,
			encoding: 'utf-8',
			maxBuffer: 10 * 1024 * 1024, // 10MB缓冲区
			timeout: 30000, // 30秒超时
		});
		return { output: output || '', error: null };
	} catch (err: any) {
		const errorMessage = err.stderr
			? err.stderr.toString()
			: err.message || String(err);
		return { output: '', error: errorMessage };
	}
}

/**
 * 检测仓库的默认主分支（main 或 master）
 */
function detectDefaultBranch(cwd: string): string {
	// 先尝试 main
	const mainResult = runGitCommand('git rev-parse --verify main', cwd);
	if (!mainResult.error) {
		return 'main';
	}
	// 再尝试 master
	const masterResult = runGitCommand('git rev-parse --verify master', cwd);
	if (!masterResult.error) {
		return 'master';
	}
	// 尝试从远程HEAD获取
	const remoteHeadResult = runGitCommand('git symbolic-ref refs/remotes/origin/HEAD', cwd);
	if (!remoteHeadResult.error && remoteHeadResult.output.trim()) {
		const parts = remoteHeadResult.output.trim().split('/');
		return parts[parts.length - 1] || 'main';
	}
	return 'main';
}

/**
 * PR代码审查工具主函数
 *
 * @param workspacePath 工作区根目录路径
 * @param params 工具参数
 * @returns 格式化的审查数据，供Agent分析
 */
export async function prReviewTool(
	workspacePath: string,
	params: {
		base_branch?: string;
		focus?: string;
	}
): Promise<ToolResponse> {
	const cwd = workspacePath || process.cwd();
	const focus = params.focus || 'all';

	// 确定基础分支
	let baseBranch = params.base_branch;
	if (!baseBranch) {
		baseBranch = detectDefaultBranch(cwd);
	}

	// 检查是否在git仓库中
	const gitCheckResult = runGitCommand('git rev-parse --git-dir', cwd);
	if (gitCheckResult.error) {
		return `Error: 当前目录不是git仓库，或git未安装。\n\n详情：${gitCheckResult.error}`;
	}

	// 获取当前分支名
	const currentBranchResult = runGitCommand('git rev-parse --abbrev-ref HEAD', cwd);
	const currentBranch = currentBranchResult.error
		? '(unknown)'
		: currentBranchResult.output.trim();

	// 检查基础分支是否存在
	const baseBranchCheckResult = runGitCommand(`git rev-parse --verify ${baseBranch}`, cwd);
	if (baseBranchCheckResult.error) {
		// 尝试远程分支
		const remoteBaseBranch = `origin/${baseBranch}`;
		const remoteBranchCheckResult = runGitCommand(`git rev-parse --verify ${remoteBaseBranch}`, cwd);
		if (remoteBranchCheckResult.error) {
			return `Error: 基础分支 "${baseBranch}" 不存在。\n\n请检查分支名称，或使用 base_branch 参数指定正确的基础分支。\n\n可用分支：\n${runGitCommand('git branch -a', cwd).output}`;
		}
		baseBranch = remoteBaseBranch;
	}

	// 获取提交记录
	const logResult = runGitCommand(
		`git log ${baseBranch}...HEAD --oneline`,
		cwd
	);

	const commitLog = logResult.error
		? `(获取提交记录失败: ${logResult.error})`
		: logResult.output.trim() || '(没有新的提交)';

	// 获取diff内容
	const diffResult = runGitCommand(
		`git diff ${baseBranch}...HEAD`,
		cwd
	);

	if (diffResult.error) {
		return `Error: 获取git diff失败。\n\n基础分支: ${baseBranch}\n当前分支: ${currentBranch}\n\n错误详情：${diffResult.error}`;
	}

	let diffContent = diffResult.output;

	if (!diffContent.trim()) {
		// 尝试仅diff当前未提交的更改
		const stagedDiffResult = runGitCommand('git diff --cached', cwd);
		const unstagedDiffResult = runGitCommand('git diff', cwd);
		const combinedDiff = [stagedDiffResult.output, unstagedDiffResult.output]
			.filter(Boolean)
			.join('\n');

		if (!combinedDiff.trim()) {
			return `## PR代码审查数据

### 基础分支: ${baseBranch}
### 当前分支: ${currentBranch}

没有发现与 ${baseBranch} 的差异。

可能的原因：
1. 当前分支与 ${baseBranch} 完全相同
2. 所有变更已合并到基础分支
3. 当前处于基础分支上

请确认是否切换到了正确的功能分支，或使用 base_branch 参数指定不同的基础分支。`;
		}

		diffContent = combinedDiff;
	}

	// 统计diff行数
	const diffLines = diffContent.split('\n');
	const totalLines = diffLines.length;

	// 截断超长diff
	let truncated = false;
	let displayDiff = diffContent;
	if (diffContent.length > MAX_DIFF_LENGTH) {
		displayDiff = diffContent.substring(0, MAX_DIFF_LENGTH);
		truncated = true;
	}

	// 构建统计信息
	const addedLines = diffLines.filter(l => l.startsWith('+') && !l.startsWith('+++')).length;
	const removedLines = diffLines.filter(l => l.startsWith('-') && !l.startsWith('---')).length;
	const changedFiles = diffLines.filter(l => l.startsWith('diff --git')).length;

	// 构建审查重点说明
	const focusDescription = getFocusDescription(focus);

	const output = [
		'## PR代码审查数据',
		'',
		`### 基础分支: ${baseBranch}`,
		`### 当前分支: ${currentBranch}`,
		`### 审查重点: ${focusDescription}`,
		`### 变更统计: ${changedFiles} 个文件, +${addedLines} -${removedLines} 行`,
		'',
		'### 提交记录',
		'```',
		commitLog,
		'```',
		'',
		`### 代码变更 (${totalLines} 行${truncated ? `，已截取前 ${MAX_DIFF_LENGTH} 字符` : ''})`,
		truncated ? `\n⚠️ diff内容过大，已截取前 ${MAX_DIFF_LENGTH} 字符（共 ${diffContent.length} 字符）。如需完整审查，请使用 base_branch 参数缩小范围。\n` : '',
		'```diff',
		displayDiff,
		'```',
	].filter(line => line !== undefined).join('\n');

	return output;
}

/**
 * 获取审查重点的描述文字
 */
function getFocusDescription(focus: string): string {
	switch (focus.toLowerCase()) {
		case 'security':
			return '安全性（SQL注入、XSS、权限校验、敏感信息泄露等）';
		case 'performance':
			return '性能（算法复杂度、数据库查询、内存使用、缓存策略等）';
		case 'maintainability':
			return '可维护性（代码结构、命名规范、注释、重复代码等）';
		case 'correctness':
			return '正确性（逻辑错误、边界条件、异常处理等）';
		case 'style':
			return '代码风格（格式规范、命名约定、代码组织等）';
		case 'all':
		default:
			return '全面审查（安全性、性能、可维护性、正确性、代码风格）';
	}
}
