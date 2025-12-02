/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// 预装的扩展列表
const extensions = [
	// Java 开发扩展
	'redhat.java',                      // Java 语言支持
	'vscjava.vscode-java-debug',        // Java 调试器
	'vscjava.vscode-java-test',         // Java 测试运行器
	'vscjava.vscode-maven',             // Maven 支持
	'vscjava.vscode-java-dependency',   // Java 项目管理器

	// Vue 开发扩展
	'vue.volar',                        // Vue 语言特性 (Volar)
	'vue.vscode-typescript-vue-plugin', // TypeScript Vue 插件

	// 通用工具扩展
	'dbaeumer.vscode-eslint',           // ESLint
	'esbenp.prettier-vscode'            // Prettier 代码格式化
];

const extensionsDir = path.join(__dirname, '..', 'extensions');

// 确保扩展目录存在
if (!fs.existsSync(extensionsDir)) {
	fs.mkdirSync(extensionsDir, { recursive: true });
}

console.log('[码弦 IDE] 开始下载预装扩展...');
console.log(`[码弦 IDE] 扩展安装目录: ${extensionsDir}`);

extensions.forEach((ext, index) => {
	try {
		console.log(`[${index + 1}/${extensions.length}] 下载扩展: ${ext}`);

		// 使用 npm 的 @vscode/vsce 工具下载扩展
		// 或者使用 curl 从 Open VSX 下载
		const command = `code --install-extension ${ext} --force`;

		execSync(command, {
			stdio: 'inherit',
			cwd: extensionsDir
		});

		console.log(`    ✓ ${ext} 下载完成`);
	} catch (error) {
		console.error(`    ✗ ${ext} 下载失败:`, error.message);
	}
});

console.log('\n[码弦 IDE] 扩展下载完成！');
console.log(`[码弦 IDE] 共计 ${extensions.length} 个扩展`);
