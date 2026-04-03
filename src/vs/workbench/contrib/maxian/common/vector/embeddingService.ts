/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * 本地语义向量嵌入服务
 * 使用 @xenova/transformers 加载本地 ONNX 模型，生成文本向量
 * 模型从 resources/models/multilingual-e5-small/ 读取（内置打包，不支持远程下载）
 *
 * ⚡ Worker 线程架构：embedding 推理在独立 Worker 线程中运行，不阻塞主进程事件循环
 */

import { FileAccess } from '../../../../../base/common/network.js';

/**
 * 向量维度（multilingual-e5-small 输出 384 维）
 */
export const EMBEDDING_DIMENSION = 384;

/**
 * Worker 线程内联脚本
 * 使用 CJS + dynamic import(@xenova/transformers) 避免模块格式问题
 */
const WORKER_SCRIPT = `
'use strict';
const { parentPort, workerData } = require('worker_threads');
const nodePath = require('path');

let _pipeline = null;

async function init() {
	try {
		// 动态 import ESM 包（CJS 中可以用 import()）
		// 使用主线程传入的绝对路径加载（绕过 tmp 目录下找不到 node_modules 的问题）
		const transformers = await import(workerData.transformersAbsPath);
		const env = transformers.env;
		env.allowRemoteModels = false;
		env.allowLocalModels = true;
		env.localModelPath = workerData.localBaseDir + nodePath.sep;

		_pipeline = await transformers.pipeline('feature-extraction', 'Xenova/multilingual-e5-small', {
			quantized: true,
			local_files_only: true,
			cache_dir: workerData.localBaseDir,
		});

		parentPort.postMessage({ type: 'ready' });
	} catch (e) {
		parentPort.postMessage({ type: 'init_error', error: e.message || String(e) });
	}
}

// 节流：上次推理完成时间，用于控制推理频率
let _lastEmbedTime = 0;
// 每次推理后休眠的时间（ms），限制 CPU 占用
// 若推理耗时 ~80ms，THROTTLE_MS=80 则 CPU 占用约 50%
// 若推理耗时 ~80ms，THROTTLE_MS=160 则 CPU 占用约 33%
const THROTTLE_MS = 150;

parentPort.on('message', async (msg) => {
	if (msg.type === 'embed') {
		if (!_pipeline) {
			parentPort.postMessage({ type: 'error', id: msg.id, error: 'Pipeline not ready' });
			return;
		}
		try {
			// 节流：距上次推理不足 THROTTLE_MS 则等待，避免 100% CPU 占用
			const now = Date.now();
			const elapsed = now - _lastEmbedTime;
			if (_lastEmbedTime > 0 && elapsed < THROTTLE_MS) {
				await new Promise(r => setTimeout(r, THROTTLE_MS - elapsed));
			}

			const output = await _pipeline(msg.text, { pooling: 'mean', normalize: true });
			_lastEmbedTime = Date.now();
			// output.data 是 Float32Array，序列化为普通 Array 传回主线程
			parentPort.postMessage({ type: 'result', id: msg.id, vector: Array.from(output.data) });
		} catch (e) {
			parentPort.postMessage({ type: 'error', id: msg.id, error: e.message || String(e) });
		}
	}
});

init();
`;

/**
 * EmbeddingService: 提供文本向量化能力
 * Worker 线程架构 — 推理在后台线程执行，主线程不阻塞
 */
export class EmbeddingService {
	private static _instance: EmbeddingService | null = null;

	/** Worker 线程实例 */
	private _worker: import('worker_threads').Worker | null = null;
	/** Worker 初始化 Promise */
	private _workerReady: Promise<void> | null = null;
	/** 待处理请求：id → {resolve, reject} */
	private _pending = new Map<number, { resolve: (v: number[]) => void; reject: (e: Error) => void }>();
	/** 请求 id 计数器 */
	private _nextId = 0;
	/** Worker 脚本临时文件路径 */
	private _workerScriptPath: string | null = null;

	static getInstance(): EmbeddingService {
		if (!EmbeddingService._instance) {
			EmbeddingService._instance = new EmbeddingService();
		}
		return EmbeddingService._instance;
	}

	private constructor() { }

	/**
	 * 预热：启动 Worker 并等待模型加载完成
	 */
	async warmUp(): Promise<void> {
		await this._getWorker();
	}

	/**
	 * 获取（或创建）Worker 实例
	 */
	private async _getWorker(): Promise<import('worker_threads').Worker> {
		if (this._worker && this._workerReady) {
			await this._workerReady;
			return this._worker;
		}

		if (this._workerReady) {
			await this._workerReady;
			return this._worker!;
		}

		this._workerReady = this._initWorker();
		await this._workerReady;
		return this._worker!;
	}

	/**
	 * 初始化 Worker 线程
	 */
	private async _initWorker(): Promise<void> {
		const fs = await import('fs');
		const path = await import('path');
		const os = await import('os');
		const workerThreads = await import('worker_threads');

		// 找到本地模型目录
		const localBaseDir = await this._findModelDir();
		if (!localBaseDir) {
			throw new Error('[EmbeddingService] 本地嵌入模型未找到，无法启动 Worker 线程');
		}

		// 将 worker 脚本写到临时文件（CJS 格式，Node.js Worker 可直接加载）
		const scriptPath = path.join(os.tmpdir(), 'maxian-embedding-worker.cjs');
		await fs.promises.writeFile(scriptPath, WORKER_SCRIPT, 'utf-8');
		this._workerScriptPath = scriptPath;

		// 解析 @xenova/transformers 入口文件绝对路径（Windows 下 process.cwd 可能不是应用根目录）
		const transformersAbsPath = await this._resolveTransformersEntry();
		if (!transformersAbsPath) {
			throw new Error('[EmbeddingService] 未找到 @xenova/transformers 入口文件');
		}

		// 创建 Worker 线程，传入 transformers 绝对路径
		const worker = new workerThreads.Worker(scriptPath, {
			workerData: { localBaseDir, transformersAbsPath },
		});
		this._worker = worker;

		// 监听消息
		worker.on('message', (msg: { type: string; id?: number; vector?: number[]; error?: string }) => {
			if (msg.type === 'result' && msg.id !== undefined) {
				const pending = this._pending.get(msg.id);
				if (pending) {
					this._pending.delete(msg.id);
					pending.resolve(msg.vector!);
				}
			} else if (msg.type === 'error' && msg.id !== undefined) {
				const pending = this._pending.get(msg.id);
				if (pending) {
					this._pending.delete(msg.id);
					pending.reject(new Error(msg.error || 'embedding error'));
				}
			}
			// 'ready' 和 'init_error' 由 _initWorker 的 Promise 处理
		});

		worker.on('error', (err) => {
			console.error('[EmbeddingService] Worker 线程错误:', err);
			// 拒绝所有待处理请求
			for (const [, pending] of this._pending) {
				pending.reject(err);
			}
			this._pending.clear();
			this._worker = null;
			this._workerReady = null;
		});

		worker.on('exit', (code) => {
			if (code !== 0) {
				console.error('[EmbeddingService] Worker 线程异常退出，code:', code);
			}
			this._worker = null;
			this._workerReady = null;
		});

		// 等待 Worker 中模型加载完成
		await new Promise<void>((resolve, reject) => {
			const timeout = setTimeout(() => {
				reject(new Error('[EmbeddingService] Worker 初始化超时'));
			}, 60_000); // 60s timeout for model loading

			const onMsg = (msg: { type: string; error?: string }) => {
				if (msg.type === 'ready') {
					clearTimeout(timeout);
					worker.off('message', onMsg);
					console.log('[EmbeddingService] Worker 线程就绪，模型已加载');
					resolve();
				} else if (msg.type === 'init_error') {
					clearTimeout(timeout);
					worker.off('message', onMsg);
					reject(new Error(`[EmbeddingService] Worker 初始化失败: ${msg.error}`));
				}
			};
			worker.on('message', onMsg);
		});
	}

	/**
	 * 解析 transformers 入口路径（优先 require.resolve，失败则按候选目录查找）
	 */
	private async _resolveTransformersEntry(): Promise<string | null> {
		const fs = await import('fs');
		const path = await import('path');

		try {
			if (typeof require === 'function' && typeof require.resolve === 'function') {
				return require.resolve('@xenova/transformers/src/transformers.js');
			}
		} catch {
			// ignore
		}

		const candidates: string[] = [];
		const entrySuffix = path.join('node_modules', '@xenova', 'transformers', 'src', 'transformers.js');

		try {
			if (typeof process !== 'undefined' && process.cwd) {
				candidates.push(path.join(process.cwd(), entrySuffix));
			}
		} catch { /* ignore */ }

		try {
			if (typeof process !== 'undefined' && (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath) {
				const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath!;
				candidates.push(path.join(resourcesPath, 'app', entrySuffix));
				candidates.push(path.join(resourcesPath, entrySuffix));
			}
		} catch { /* ignore */ }

		try {
			const fileRoot = FileAccess.asFileUri('').fsPath;
			let dir = fileRoot;
			for (let i = 0; i < 5; i++) {
				candidates.push(path.join(dir, entrySuffix));
				dir = path.dirname(dir);
			}
		} catch { /* ignore */ }

		for (const candidate of candidates) {
			try {
				const stat = await fs.promises.stat(candidate).catch(() => null);
				if (stat?.isFile()) {
					return candidate;
				}
			} catch {
				// ignore
			}
		}

		return null;
	}

	/**
	 * 查找本地模型目录
	 */
	private async _findModelDir(): Promise<string | null> {
		const fs = await import('fs');
		const path = await import('path');

		const candidateBasePaths: string[] = [];

		try {
			const fileRoot = FileAccess.asFileUri('').fsPath;
			let dir = fileRoot;
			for (let i = 0; i < 4; i++) {
				candidateBasePaths.push(path.join(dir, 'resources', 'models'));
				dir = path.dirname(dir);
			}
		} catch { /* ignore */ }

		try {
			if (typeof process !== 'undefined' && process.cwd) {
				candidateBasePaths.push(path.join(process.cwd(), 'resources', 'models'));
			}
		} catch { /* ignore */ }

		try {
			if (typeof process !== 'undefined' && (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath) {
				const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath!;
				candidateBasePaths.push(path.join(resourcesPath, 'models'));
			}
		} catch { /* ignore */ }

		for (const baseDir of candidateBasePaths) {
			try {
				const modelFile = path.join(baseDir, 'Xenova', 'multilingual-e5-small', 'onnx', 'model_quantized.onnx');
				const stat = await fs.promises.stat(modelFile).catch(() => null);
				if (stat) {
					console.log('[EmbeddingService] 使用本地模型目录:', baseDir);
					return baseDir;
				}
			} catch {
				continue;
			}
		}

		console.error('[EmbeddingService] 本地模型未找到，候选路径:\n' + candidateBasePaths.join('\n'));
		return null;
	}

	/**
	 * 将文本转换为向量（通过 Worker 线程异步执行，不阻塞主线程）
	 * @param text 输入文本
	 * @returns 384维浮点向量
	 */
	async embed(text: string): Promise<number[]> {
		const worker = await this._getWorker();
		const id = this._nextId++;
		return new Promise<number[]>((resolve, reject) => {
			this._pending.set(id, { resolve, reject });
			worker.postMessage({ type: 'embed', id, text: `passage: ${text}` });
		});
	}

	/**
	 * 将查询文本转换为向量（使用 query 前缀）
	 */
	async embedQuery(query: string): Promise<number[]> {
		const worker = await this._getWorker();
		const id = this._nextId++;
		return new Promise<number[]>((resolve, reject) => {
			this._pending.set(id, { resolve, reject });
			worker.postMessage({ type: 'embed', id, text: `query: ${query}` });
		});
	}

	/**
	 * 批量文本向量化（顺序发送到 Worker，每个等待结果后继续）
	 */
	async embedBatch(texts: string[]): Promise<number[][]> {
		const results: number[][] = [];
		for (const text of texts) {
			results.push(await this.embed(text));
		}
		return results;
	}

	/**
	 * 检查模型是否已加载（Worker 是否就绪）
	 */
	isLoaded(): boolean {
		return this._worker !== null;
	}

	/**
	 * 停止 Worker 线程（IDE 关闭时调用）
	 */
	async terminate(): Promise<void> {
		if (this._worker) {
			await this._worker.terminate();
			this._worker = null;
			this._workerReady = null;
		}
		// 清理临时文件
		if (this._workerScriptPath) {
			const fs = await import('fs');
			await fs.promises.unlink(this._workerScriptPath).catch(() => { /* ignore */ });
		}
	}
}
