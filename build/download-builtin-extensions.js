/*---------------------------------------------------------------------------------------------
 *  从 Open VSX 下载内置扩展
 *--------------------------------------------------------------------------------------------*/

const https = require('https');
const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream');
const { promisify } = require('util');
const streamPipeline = promisify(pipeline);

const OPEN_VSX_API = 'https://open-vsx.org/api';

// 读取 product.json
const productJsonPath = path.join(__dirname, '..', 'product.json');
const productJson = JSON.parse(fs.readFileSync(productJsonPath, 'utf8'));

// 扩展安装目录
const extensionsDir = path.join(__dirname, '..', 'extensions');

// 确保扩展目录存在
if (!fs.existsSync(extensionsDir)) {
	fs.mkdirSync(extensionsDir, { recursive: true });
}

// 从 Open VSX 下载扩展
async function downloadExtension(publisher, extensionName, version) {
	return new Promise((resolve, reject) => {
		const url = `${OPEN_VSX_API}/${publisher}/${extensionName}/${version}/file/${publisher}.${extensionName}-${version}.vsix`;

		console.log(`  下载 URL: ${url}`);

		const extensionDir = path.join(extensionsDir, `${publisher}.${extensionName}-${version}`);
		const vsixPath = path.join(extensionsDir, `${publisher}.${extensionName}-${version}.vsix`);

		// 如果扩展已存在，跳过下载
		if (fs.existsSync(extensionDir)) {
			console.log(`  扩展已存在，跳过下载`);
			resolve(extensionDir);
			return;
		}

		https.get(url, (res) => {
			if (res.statusCode === 302 || res.statusCode === 301) {
				// 处理重定向
				const redirectUrl = res.headers.location;
				console.log(`  重定向到: ${redirectUrl}`);

				https.get(redirectUrl, (redirectRes) => {
					if (redirectRes.statusCode !== 200) {
						reject(new Error(`下载失败，状态码: ${redirectRes.statusCode}`));
						return;
					}

					const fileStream = fs.createWriteStream(vsixPath);
					streamPipeline(redirectRes, fileStream)
						.then(() => {
							console.log(`  已保存到: ${vsixPath}`);
							resolve(vsixPath);
						})
						.catch(reject);
				}).on('error', reject);

			} else if (res.statusCode === 200) {
				const fileStream = fs.createWriteStream(vsixPath);
				streamPipeline(res, fileStream)
					.then(() => {
						console.log(`  已保存到: ${vsixPath}`);
						resolve(vsixPath);
					})
					.catch(reject);
			} else {
				reject(new Error(`下载失败，状态码: ${res.statusCode}`));
			}
		}).on('error', reject);
	});
}

// 解压 VSIX 文件
async function extractVsix(vsixPath, targetDir) {
	return new Promise((resolve, reject) => {
		// 如果目标目录已存在，跳过解压
		if (fs.existsSync(targetDir)) {
			console.log(`  目录已存在，跳过解压`);
			resolve(targetDir);
			return;
		}

		const AdmZip = require('adm-zip');

		try {
			const zip = new AdmZip(vsixPath);
			zip.extractAllTo(targetDir, true);

			// 移动 extension 目录到目标目录
			const extensionDir = path.join(targetDir, 'extension');
			if (fs.existsSync(extensionDir)) {
				const files = fs.readdirSync(extensionDir);
				files.forEach(file => {
					const src = path.join(extensionDir, file);
					const dest = path.join(targetDir, file);
					fs.renameSync(src, dest);
				});
				fs.rmdirSync(extensionDir);
			}

			console.log(`  已解压到: ${targetDir}`);

			// 删除 VSIX 文件
			fs.unlinkSync(vsixPath);
			console.log(`  已删除临时文件: ${vsixPath}`);

			resolve(targetDir);
		} catch (err) {
			reject(err);
		}
	});
}

async function main() {
	console.log('开始下载内置扩展...\n');
	console.log(`扩展目录: ${extensionsDir}\n`);

	// 检查是否安装了 adm-zip
	try {
		require('adm-zip');
	} catch (err) {
		console.error('错误: 需要安装 adm-zip 模块');
		console.error('请运行: npm install --save-dev adm-zip');
		process.exit(1);
	}

	const extensions = productJson.builtInExtensions || [];
	console.log(`共 ${extensions.length} 个扩展需要下载\n`);

	let successCount = 0;
	let failCount = 0;

	for (let i = 0; i < extensions.length; i++) {
		const ext = extensions[i];
		const parts = ext.name.split('.');

		// 跳过 ms-vscode 扩展（这些通常是内置的）
		if (parts[0] === 'ms-vscode') {
			console.log(`[${i + 1}/${extensions.length}] 跳过内置扩展: ${ext.name}`);
			continue;
		}

		console.log(`[${i + 1}/${extensions.length}] 下载扩展: ${ext.name} v${ext.version}`);

		try {
			const publisher = parts[0];
			const extensionName = parts.slice(1).join('.');

			const vsixPath = await downloadExtension(publisher, extensionName, ext.version);

			if (vsixPath) {
				const targetDir = path.join(extensionsDir, `${publisher}.${extensionName}-${ext.version}`);
				await extractVsix(vsixPath, targetDir);
				console.log(`  ✓ ${ext.name} 下载完成\n`);
				successCount++;
			}

			// 添加延迟避免请求过快
			await new Promise(resolve => setTimeout(resolve, 500));

		} catch (err) {
			console.error(`  ✗ ${ext.name} 下载失败:`, err.message);
			console.error('');
			failCount++;
		}
	}

	console.log('\n下载完成!');
	console.log(`成功: ${successCount} 个`);
	console.log(`失败: ${failCount} 个`);
	console.log(`跳过: ${extensions.length - successCount - failCount} 个`);
}

main().catch(err => {
	console.error('错误:', err);
	process.exit(1);
});
