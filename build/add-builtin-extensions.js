/*---------------------------------------------------------------------------------------------
 *  获取并添加内置扩展到 product.json
 *--------------------------------------------------------------------------------------------*/

const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const OPEN_VSX_API = 'https://open-vsx.org/api';

// 要添加的扩展列表
const extensionsToAdd = [
	// ===== Java 开发扩展 =====
	{ publisher: 'redhat', name: 'java' },
	{ publisher: 'vscjava', name: 'vscode-java-debug' },
	{ publisher: 'vscjava', name: 'vscode-java-test' },
	{ publisher: 'vscjava', name: 'vscode-maven' },
	{ publisher: 'vscjava', name: 'vscode-java-dependency' },
	{ publisher: 'GabrielBB', name: 'vscode-lombok' },              // Lombok 支持
	// { publisher: 'SonarSource', name: 'sonarlint-vscode' },         // 代码质量检查 - 已移除
	{ publisher: 'shengchen', name: 'vscode-checkstyle' },          // Checkstyle

	// ===== Spring Boot & Spring Cloud 开发扩展 =====
	{ publisher: 'vmware', name: 'vscode-spring-boot' },
	{ publisher: 'vscjava', name: 'vscode-spring-initializr' },
	{ publisher: 'vscjava', name: 'vscode-spring-boot-dashboard' },

	// ===== Vue 开发扩展 =====
	// { publisher: 'Vue', name: 'volar' },                            // Vue 语言特性 (官方) - 有兼容性问题，暂时移除
	{ publisher: 'johnsoncodehk', name: 'vscode-typescript-vue-plugin' }, // TypeScript Vue 插件
	{ publisher: 'hollowtree', name: 'vue-snippets' },              // Vue 代码片段
	{ publisher: 'octref', name: 'vetur' },                         // Vetur (Vue 2 支持)
	{ publisher: 'antfu', name: 'vite' },                           // Vite 支持

	// ===== 前端开发工具 =====
	{ publisher: 'ritwickdey', name: 'LiveServer' },                // Live Server
	{ publisher: 'bradlc', name: 'vscode-tailwindcss' },            // Tailwind CSS
	{ publisher: 'ecmel', name: 'vscode-html-css' },                // HTML CSS 支持
	{ publisher: 'zignd', name: 'html-css-class-completion' },      // HTML CSS 类名补全
	{ publisher: 'pranaygp', name: 'vscode-css-peek' },             // CSS Peek

	// ===== 代码格式化和质量工具 =====
	{ publisher: 'dbaeumer', name: 'vscode-eslint' },               // ESLint
	{ publisher: 'esbenp', name: 'prettier-vscode' },               // Prettier
	{ publisher: 'stylelint', name: 'vscode-stylelint' },           // Stylelint

	// ===== 智能提示和补全 =====
	{ publisher: 'christian-kohler', name: 'path-intellisense' },   // 路径智能提示
	{ publisher: 'christian-kohler', name: 'npm-intellisense' },    // npm 智能提示
	{ publisher: 'wix', name: 'vscode-import-cost' },               // 导入成本显示

	// ===== Git 工具 =====
	{ publisher: 'eamodio', name: 'gitlens' },                      // GitLens
	{ publisher: 'donjayamanne', name: 'githistory' },              // Git History

	// ===== HTML 和标签工具 =====
	{ publisher: 'formulahendry', name: 'auto-close-tag' },         // 自动关闭标签
	{ publisher: 'formulahendry', name: 'auto-rename-tag' },        // 自动重命名标签

	// ===== 代码可读性和增强 =====
	{ publisher: 'aaron-bond', name: 'better-comments' },           // 更好的注释
	{ publisher: 'usernamehw', name: 'errorlens' },                 // 错误提示增强
	{ publisher: 'oderwat', name: 'indent-rainbow' },               // 缩进彩虹
	// { publisher: 'CoenraadS', name: 'bracket-pair-colorizer-2' },   // 括号配对着色 - 已弃用，VSCode 已内置
	{ publisher: 'wayou', name: 'vscode-todo-highlight' },          // TODO 高亮

	// ===== 图标主题 =====
	{ publisher: 'PKief', name: 'material-icon-theme' },            // Material 图标主题
	{ publisher: 'vscode-icons-team', name: 'vscode-icons' },       // VSCode 图标

	// ===== 语言包 =====
	{ publisher: 'MS-CEINTL', name: 'vscode-language-pack-zh-hans' }, // 中文语言包

	// ===== REST API 工具 =====
	{ publisher: 'humao', name: 'rest-client' },                    // REST 客户端

	// ===== Docker 和容器 =====
	{ publisher: 'ms-azuretools', name: 'vscode-docker' },          // Docker 支持

	// ===== YAML 和配置文件 =====
	{ publisher: 'redhat', name: 'vscode-yaml' },                   // YAML 支持

	// ===== Markdown =====
	{ publisher: 'yzhang', name: 'markdown-all-in-one' },           // Markdown 增强
	{ publisher: 'shd101wyy', name: 'markdown-preview-enhanced' }   // Markdown 预览增强
];

// 从 Open VSX 获取扩展元数据
async function getExtensionMetadata(publisher, extensionName) {
	return new Promise((resolve, reject) => {
		const url = `${OPEN_VSX_API}/${publisher}/${extensionName}`;

		console.log(`获取扩展信息: ${publisher}.${extensionName}`);

		https.get(url, (res) => {
			let data = '';

			res.on('data', (chunk) => {
				data += chunk;
			});

			res.on('end', () => {
				try {
					const metadata = JSON.parse(data);

					if (metadata.error) {
						reject(new Error(`扩展 ${publisher}.${extensionName} 获取失败: ${metadata.error}`));
						return;
					}

					// 构建扩展定义
					const extensionDef = {
						name: `${publisher}.${extensionName}`,
						version: metadata.version,
						sha256: metadata.files?.download ? null : null, // Open VSX 不直接提供 SHA256
						repo: metadata.repository || `https://github.com/${publisher}/${extensionName}`,
						metadata: {
							id: metadata.namespace?.toLowerCase() + '.' + metadata.name?.toLowerCase(),
							publisherId: {
								publisherId: metadata.namespaceId || '',
								publisherName: metadata.namespace || publisher,
								displayName: metadata.namespaceDisplayName || metadata.namespace || publisher,
								flags: metadata.verified ? 'verified' : ''
							},
							publisherDisplayName: metadata.namespaceDisplayName || metadata.namespace || publisher
						}
					};

					console.log(`  ✓ ${publisher}.${extensionName} v${metadata.version}`);
					resolve(extensionDef);
				} catch (err) {
					reject(err);
				}
			});
		}).on('error', (err) => {
			reject(err);
		});
	});
}

async function main() {
	console.log('开始获取扩展元数据...\n');

	const extensions = [];

	for (const ext of extensionsToAdd) {
		try {
			const metadata = await getExtensionMetadata(ext.publisher, ext.name);
			extensions.push(metadata);
			// 添加延迟避免请求过快
			await new Promise(resolve => setTimeout(resolve, 500));
		} catch (err) {
			console.error(`  ✗ 获取 ${ext.publisher}.${ext.name} 失败:`, err.message);
		}
	}

	console.log(`\n成功获取 ${extensions.length}/${extensionsToAdd.length} 个扩展的元数据\n`);

	// 读取 product.json
	const productJsonPath = path.join(__dirname, '..', 'product.json');
	const productJson = JSON.parse(fs.readFileSync(productJsonPath, 'utf8'));

	// 合并扩展列表（去重）
	const existingNames = new Set(productJson.builtInExtensions.map(e => e.name));
	const newExtensions = extensions.filter(e => !existingNames.has(e.name));

	productJson.builtInExtensions.push(...newExtensions);

	// 保存 product.json
	fs.writeFileSync(productJsonPath, JSON.stringify(productJson, null, '\t') + '\n', 'utf8');

	console.log(`已添加 ${newExtensions.length} 个新扩展到 product.json`);
	console.log('\n添加的扩展:');
	newExtensions.forEach(ext => {
		console.log(`  - ${ext.name} v${ext.version}`);
	});

	console.log('\n注意: 运行 npm run download-builtin-extensions 来下载这些扩展');
}

main().catch(err => {
	console.error('错误:', err);
	process.exit(1);
});
