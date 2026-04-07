/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { getSystemInfoSection, type SystemInfo } from '../../common/prompts/sections/systemInfo.js';

suite('SystemInfoSection', () => {

	test('darwin 平台不应被识别为 Windows', () => {
		const info: SystemInfo = {
			platform: 'darwin',
			arch: 'arm64',
			nodeVersion: 'v18.0.0',
			shell: 'zsh'
		};

		const section = getSystemInfoSection('/repo', info);

		assert.ok(section.includes('操作系统: macOS (darwin arm64)'));
		assert.ok(section.includes('⚠️ 当前是 macOS 系统'));
		assert.ok(!section.includes('⚠️ 当前运行在 Windows 系统'));
		assert.ok(!section.includes('⚠️ 当前使用 CMD'));
		assert.ok(!section.includes('del（文件）/ rmdir /s /q（目录）'));
	});

	test('win32 平台应输出 Windows 命令约束', () => {
		const info: SystemInfo = {
			platform: 'win32',
			arch: 'x64',
			nodeVersion: 'v18.0.0',
			shell: 'cmd'
		};

		const section = getSystemInfoSection('/repo', info);

		assert.ok(section.includes('操作系统: Windows (win32)'));
		assert.ok(section.includes('⚠️ 当前运行在 Windows 系统'));
		assert.ok(section.includes('⚠️ 当前使用 CMD'));
		assert.ok(section.includes('del（文件）/ rmdir /s /q（目录）'));
	});
});

