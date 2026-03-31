#!/usr/bin/env node
/**
 * 下载语义搜索所需的嵌入模型
 * 模型: Xenova/multilingual-e5-small (约 70MB)
 *
 * 运行方式:
 *   node scripts/download-embedding-model.js
 */

const { pipeline, env } = require('@xenova/transformers');
const path = require('path');
const os = require('os');
const fs = require('fs');

const MODEL_NAME = 'Xenova/multilingual-e5-small';

// 目标保存路径
const targetDir = path.join(os.homedir(), '.cache', 'xenova');

async function main() {
	console.log('正在下载嵌入模型:', MODEL_NAME);
	console.log('目标路径:', targetDir);
	console.log('');

	// 配置环境
	env.allowRemoteModels = true;
	env.allowLocalModels = true;
	env.cacheDir = targetDir;

	try {
		console.log('开始下载（约 70MB，请耐心等待）...');
		const pipe = await pipeline('feature-extraction', MODEL_NAME, {
			quantized: true,
			progress_callback: (progress) => {
				if (progress.status === 'downloading') {
					const pct = progress.progress ? progress.progress.toFixed(1) : '?';
					process.stdout.write(`\r下载进度: ${pct}% - ${progress.file || ''}`);
				} else if (progress.status === 'done') {
					process.stdout.write('\n');
					console.log('文件下载完成:', progress.file);
				}
			}
		});

		// 测试模型
		console.log('');
		console.log('正在测试模型...');
		const result = await pipe('test embedding', { pooling: 'mean', normalize: true });
		console.log('模型测试成功，向量维度:', result.data.length);

		// 查找实际保存路径
		const xenovaDir = path.join(targetDir, 'Xenova', 'multilingual-e5-small');
		if (fs.existsSync(xenovaDir)) {
			console.log('');
			console.log('✓ 模型已保存至:', xenovaDir);
		}

		console.log('');
		console.log('语义搜索现已可用，请重启 IDE 以加载模型。');
		process.exit(0);
	} catch (error) {
		console.error('下载失败:', error.message);
		process.exit(1);
	}
}

main();
