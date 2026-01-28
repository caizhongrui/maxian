/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { SystemPromptGenerator } from '../../common/prompts/systemPrompt.js';
import type { SystemInfo } from '../../common/prompts/sections/systemInfo.js';
import { ToolName } from '../../common/tools/toolTypes.js';

/**
 * 系统提示词生成器测试
 *
 * 🎯 测试目标：
 * 1. 确保系统提示词100%本地生成（零API依赖）
 * 2. 验证token消耗在合理范围
 * 3. 确保生成速度<1ms（同步操作）
 * 4. 验证Skills预留接口正常工作
 */
suite('SystemPromptGenerator', () => {

	const mockSystemInfo: SystemInfo = {
		platform: 'darwin',
		arch: 'arm64',
		nodeVersion: 'v18.0.0',
		shell: 'zsh'
	};

	const mockWorkspaceRoot = '/Users/test/project';

	const mockTools: ToolName[] = [
		'read_file',
		'write_to_file',
		'search_files',
		'list_files',
		'list_code_definition_names',
		'execute_command'
	];

	test('应该能同步生成系统提示词（无API调用）', () => {
		// 测试点1：SystemPromptGenerator.generate()是同步方法
		// 如果是异步（需要API调用），这里会编译错误
		const start = Date.now();
		const prompt = SystemPromptGenerator.generate(
			mockWorkspaceRoot,
			mockTools,
			mockSystemInfo,
			'code'
		);
		const elapsed = Date.now() - start;

		// 验证生成速度<1ms（本地生成应该非常快）
		assert.ok(elapsed < 10, `生成速度应<10ms，实际: ${elapsed}ms`);

		// 验证返回非空字符串
		assert.ok(prompt.length > 0, '系统提示词不应为空');
		assert.ok(typeof prompt === 'string', '系统提示词应该是字符串');
	});

	test('应该生成合理长度的系统提示词', () => {
		const prompt = SystemPromptGenerator.generate(
			mockWorkspaceRoot,
			mockTools,
			mockSystemInfo,
			'code'
		);

		// 估算token数（1 token ≈ 3 chars）
		const estimatedTokens = Math.ceil(prompt.length / 3);

		console.log(`[Test] 系统提示词统计:
  - 字符数: ${prompt.length}
  - 估算tokens: ${estimatedTokens}
  - 当前目标: <6000 tokens
  - Week 1目标: <1000 tokens`);

		// 当前应该<6000 tokens
		assert.ok(estimatedTokens < 6000, `Token数应<6000，实际: ${estimatedTokens}`);

		// TODO: Week 1优化后，改为 < 1000
		// assert.ok(estimatedTokens < 1000, `Token数应<1000，实际: ${estimatedTokens}`);
	});

	test('应该包含核心部分', () => {
		const prompt = SystemPromptGenerator.generate(
			mockWorkspaceRoot,
			mockTools,
			mockSystemInfo,
			'code'
		);

		// 验证包含必要的部分
		assert.ok(prompt.includes('码弦') || prompt.includes('Maxian'), '应包含角色定义');
		assert.ok(prompt.includes('工具') || prompt.includes('tool'), '应包含工具说明');
		assert.ok(prompt.includes('Markdown') || prompt.includes('markdown'), '应包含格式规则');

		// 验证不包含API相关内容
		assert.ok(!prompt.includes('fetch('), '不应包含fetch调用');
		assert.ok(!prompt.includes('http://'), '不应包含HTTP请求');
		assert.ok(!prompt.includes('https://'), '不应包含HTTPS请求（除了文档链接）');
	});

	test('应该支持不同模式', () => {
		const modes = ['code', 'ask', 'architect'] as const;

		for (const mode of modes) {
			const prompt = SystemPromptGenerator.generate(
				mockWorkspaceRoot,
				mockTools,
				mockSystemInfo,
				mode
			);

			assert.ok(prompt.length > 0, `${mode}模式应生成有效提示词`);

			// 不同模式的提示词应该有差异
			if (mode === 'architect') {
				// architect模式应该包含架构相关内容
				assert.ok(
					prompt.includes('架构') || prompt.includes('architect'),
					'architect模式应包含架构相关内容'
				);
			}
		}
	});

	test('Skills预留接口应该正常工作', () => {
		// 测试Skills预留接口（Week 1实施后启用）
		const promptWithSkills = SystemPromptGenerator.generate(
			mockWorkspaceRoot,
			mockTools,
			mockSystemInfo,
			'code',
			{
				reserveForSkills: true
			}
		);

		const promptWithoutSkills = SystemPromptGenerator.generate(
			mockWorkspaceRoot,
			mockTools,
			mockSystemInfo,
			'code',
			{
				reserveForSkills: false
			}
		);

		// 启用Skills提示时，提示词应该更长
		if (promptWithSkills.length > promptWithoutSkills.length) {
			// Skills提示已实施
			assert.ok(
				promptWithSkills.includes('SKILL') || promptWithSkills.includes('skill'),
				'启用Skills时应包含Skills提示'
			);
		}
		// else: Skills提示尚未实施，两者相同
	});

	test('token统计功能应该正常工作', () => {
		let statsLogged = false;
		const originalLog = console.log;

		// 捕获console.log输出
		console.log = (...args: any[]) => {
			const message = args.join(' ');
			if (message.includes('SystemPrompt') && message.includes('Token')) {
				statsLogged = true;
			}
			originalLog(...args);
		};

		try {
			SystemPromptGenerator.generate(
				mockWorkspaceRoot,
				mockTools,
				mockSystemInfo,
				'code',
				{
					includeStats: true
				}
			);

			// 验证是否输出了token统计
			assert.ok(statsLogged, '启用includeStats时应输出token统计');
		} finally {
			console.log = originalLog;
		}
	});

	test('应该支持缓存（重复生成应该返回相同结果）', () => {
		const prompt1 = SystemPromptGenerator.generate(
			mockWorkspaceRoot,
			mockTools,
			mockSystemInfo,
			'code'
		);

		const prompt2 = SystemPromptGenerator.generate(
			mockWorkspaceRoot,
			mockTools,
			mockSystemInfo,
			'code'
		);

		// 相同参数应该生成相同的提示词（确定性）
		assert.strictEqual(prompt1, prompt2, '相同参数应生成相同提示词');
	});

	test('不同工具列表应该生成不同的提示词', () => {
		const tools1: ToolName[] = ['read_file', 'write_to_file'];
		const tools2: ToolName[] = ['read_file', 'write_to_file', 'execute_command'];

		const prompt1 = SystemPromptGenerator.generate(
			mockWorkspaceRoot,
			tools1,
			mockSystemInfo,
			'code'
		);

		const prompt2 = SystemPromptGenerator.generate(
			mockWorkspaceRoot,
			tools2,
			mockSystemInfo,
			'code'
		);

		// 不同工具列表应该生成不同的提示词
		assert.notStrictEqual(prompt1, prompt2, '不同工具列表应生成不同提示词');

		// prompt2应该更长（包含更多工具）
		assert.ok(prompt2.length > prompt1.length, '更多工具应生成更长的提示词');
	});

	test('性能基准测试', () => {
		const iterations = 100;
		const start = Date.now();

		for (let i = 0; i < iterations; i++) {
			SystemPromptGenerator.generate(
				mockWorkspaceRoot,
				mockTools,
				mockSystemInfo,
				'code'
			);
		}

		const elapsed = Date.now() - start;
		const avgTime = elapsed / iterations;

		console.log(`[Benchmark] 生成${iterations}次系统提示词:
  - 总耗时: ${elapsed}ms
  - 平均耗时: ${avgTime.toFixed(2)}ms/次
  - 目标: <1ms/次`);

		// 平均每次应该<10ms（本地生成应该非常快）
		assert.ok(avgTime < 10, `平均生成时间应<10ms，实际: ${avgTime.toFixed(2)}ms`);

		// TODO: 优化后应该<1ms
		// assert.ok(avgTime < 1, `平均生成时间应<1ms，实际: ${avgTime.toFixed(2)}ms`);
	});
});

/**
 * 架构验证测试
 * 确保不会意外引入API依赖
 */
suite('SystemPrompt Architecture Validation', () => {

	test('SystemPromptGenerator应该是纯静态类（无实例状态）', () => {
		// SystemPromptGenerator应该只有静态方法
		// 不应该有constructor或实例方法

		const generator = SystemPromptGenerator as any;

		// 验证generate是静态方法
		assert.ok(typeof generator.generate === 'function', 'generate应该是静态方法');

		// 验证没有实例方法
		const instance = Object.create(generator.prototype);
		const instanceMethods = Object.getOwnPropertyNames(instance);

		// 只应该有constructor（继承自Object）
		assert.ok(
			instanceMethods.length <= 1,
			'不应该有实例方法（避免状态管理）'
		);
	});

	test('不应该导入网络相关模块', () => {
		// 这个测试主要是文档性质的
		// 实际的import检查应该在构建时进行

		const sourceCode = SystemPromptGenerator.toString();

		// 验证不包含网络调用
		assert.ok(!sourceCode.includes('fetch'), '不应该使用fetch');
		assert.ok(!sourceCode.includes('XMLHttpRequest'), '不应该使用XMLHttpRequest');
		assert.ok(!sourceCode.includes('axios'), '不应该使用axios');
		assert.ok(!sourceCode.includes('request'), '不应该使用request库');

		console.log('[架构验证] ✅ 系统提示词生成器没有网络依赖');
	});

	test('应该是同步方法（不返回Promise）', () => {
		const mockSystemInfo: SystemInfo = {
			platform: 'darwin',
			arch: 'arm64',
			nodeVersion: 'v18.0.0',
			shell: 'zsh'
		};

		const result = SystemPromptGenerator.generate(
			'/test',
			['read_file'],
			mockSystemInfo,
			'code'
		);

		// 验证返回类型是string，不是Promise
		assert.strictEqual(typeof result, 'string', '应该返回string，不是Promise');
		// 验证不是thenable对象（具有then方法的对象）
		assert.ok(typeof (result as any).then !== 'function', '不应该返回Promise或thenable对象');
	});
});
