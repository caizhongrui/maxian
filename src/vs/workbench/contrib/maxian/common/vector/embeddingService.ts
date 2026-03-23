/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * 本地语义向量嵌入服务
 * 使用 @xenova/transformers 加载本地 ONNX 模型，生成文本向量
 * 模型优先从 resources/models/multilingual-e5-small/ 读取（本地打包），失败时 fallback 到缓存目录
 */

// 使用动态 import 延迟加载 @xenova/transformers，避免在 VSCode 扩展环境中的加载问题
type XenovaTransformers = typeof import('@xenova/transformers');

// 单例实例
let _pipelineInstance: unknown = null;
let _pipelineLoading: Promise<unknown> | null = null;
let _transformersModule: XenovaTransformers | null = null;

/**
 * 获取 transformers 模块（延迟加载）
 */
async function getTransformersModule(): Promise<XenovaTransformers> {
	if (_transformersModule) {
		return _transformersModule;
	}
	// 动态 import
	_transformersModule = await import('@xenova/transformers') as XenovaTransformers;
	return _transformersModule;
}

/**
 * 模型配置
 */
const MODEL_NAME = 'Xenova/multilingual-e5-small';

/**
 * 向量维度（multilingual-e5-small 输出 384 维）
 */
export const EMBEDDING_DIMENSION = 384;

/**
 * EmbeddingService: 提供文本向量化能力
 * 懒加载模型，第一次调用 embed() 时才初始化
 */
export class EmbeddingService {
	private static _instance: EmbeddingService | null = null;

	/**
	 * 获取单例实例
	 */
	static getInstance(): EmbeddingService {
		if (!EmbeddingService._instance) {
			EmbeddingService._instance = new EmbeddingService();
		}
		return EmbeddingService._instance;
	}

	private constructor() {
		// 私有构造，强制使用单例
	}

	/**
	 * 初始化模型 pipeline
	 * 第一次调用时加载模型，后续调用直接复用
	 */
	private async getPipeline(): Promise<unknown> {
		if (_pipelineInstance) {
			return _pipelineInstance;
		}

		if (_pipelineLoading) {
			return _pipelineLoading;
		}

		_pipelineLoading = this.loadPipeline();
		_pipelineInstance = await _pipelineLoading;
		_pipelineLoading = null;
		return _pipelineInstance;
	}

	/**
	 * 加载 pipeline
	 * 优先使用本地模型路径，fallback 到 HuggingFace 缓存目录
	 */
	private async loadPipeline(): Promise<unknown> {
		const transformers = await getTransformersModule();
		const env = transformers.env;

		// 设置环境：禁止远程下载，只使用本地模型
		env.allowRemoteModels = false;
		env.allowLocalModels = true;

		// 尝试多个本地模型路径
		const fs = await import('fs');
		const path = await import('path');
		const os = await import('os');

		// 可能的本地模型路径（优先级从高到低）
		const candidatePaths: string[] = [];

		// 1. resources/models 目录（打包在应用中）
		// 通过 __dirname 找到 resources 目录
		try {
			// Electron 环境中 process.resourcesPath 是应用 resources 目录
			if (typeof process !== 'undefined' && (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath) {
				const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath!;
				candidatePaths.push(path.join(resourcesPath, 'models', 'multilingual-e5-small'));
			}
		} catch { /* ignore */ }

		// 2. ~/.cache/huggingface/hub/models--Xenova--multilingual-e5-small/snapshots/...
		try {
			const homeDir = os.homedir();
			const hfCacheDir = path.join(homeDir, '.cache', 'huggingface', 'hub');
			candidatePaths.push(path.join(hfCacheDir, 'models--Xenova--multilingual-e5-small', 'snapshots'));
		} catch { /* ignore */ }

		// 3. ~/.cache/xenova/Xenova/multilingual-e5-small
		try {
			const homeDir = os.homedir();
			candidatePaths.push(path.join(homeDir, '.cache', 'xenova', 'Xenova', 'multilingual-e5-small'));
		} catch { /* ignore */ }

		// 4. 用户数据目录
		try {
			if (typeof process !== 'undefined' && process.env && process.env['HOME']) {
				candidatePaths.push(path.join(process.env['HOME'], '.cache', 'xenova', 'Xenova', 'multilingual-e5-small'));
			}
		} catch { /* ignore */ }

		// 检查哪个路径存在
		let localModelPath: string | null = null;
		for (const candidatePath of candidatePaths) {
			try {
				// 对于 snapshot 目录，找到第一个子目录
				const stat = await fs.promises.stat(candidatePath).catch(() => null);
				if (stat && stat.isDirectory()) {
					// 对于 HuggingFace snapshots 目录，获取第一个 snapshot hash 子目录
					if (candidatePath.endsWith('snapshots')) {
						const entries = await fs.promises.readdir(candidatePath);
						if (entries.length > 0) {
							localModelPath = path.join(candidatePath, entries[0]);
						}
					} else {
						localModelPath = candidatePath;
					}
					if (localModelPath) {
						// 验证有 onnx/model_quantized.onnx 文件
						const modelFile = path.join(localModelPath, 'onnx', 'model_quantized.onnx');
						const modelFileStat = await fs.promises.stat(modelFile).catch(() => null);
						if (modelFileStat) {
							console.log('[EmbeddingService] 使用本地模型路径:', localModelPath);
							break;
						} else {
							localModelPath = null;
						}
					}
				}
			} catch {
				continue;
			}
		}

		if (localModelPath) {
			env.localModelPath = localModelPath + path.sep;
			// 使用本地路径格式（model_name_or_path 参数会忽略，直接用 localModelPath）
			const pipe = await transformers.pipeline('feature-extraction', MODEL_NAME, {
				quantized: true,
				local_files_only: true,
				cache_dir: path.dirname(localModelPath),
			});
			return pipe;
		} else {
			// Fallback: 允许从缓存下载（如果网络可用）
			console.log('[EmbeddingService] 本地模型不存在，尝试从缓存目录加载（允许下载）');
			env.allowRemoteModels = true;
			const pipe = await transformers.pipeline('feature-extraction', MODEL_NAME, {
				quantized: true,
			});
			return pipe;
		}
	}

	/**
	 * 将文本转换为向量
	 * @param text 输入文本
	 * @returns 384维浮点向量
	 */
	async embed(text: string): Promise<number[]> {
		const pipe = await this.getPipeline();

		// multilingual-e5 需要前缀提示
		// passage: 用于文档（被搜索的内容）
		// query: 用于查询（用户输入的搜索词）
		const prefixedText = `passage: ${text}`;

		// 调用 pipeline
		const pipelineFunc = pipe as (input: string, options: Record<string, unknown>) => Promise<unknown>;
		const output = await pipelineFunc(prefixedText, {
			pooling: 'mean',
			normalize: true,
		});

		// 提取向量数据
		// @xenova/transformers 返回的是 Tensor 对象，data 属性是 Float32Array
		const tensor = output as { data: Float32Array | number[] };
		const vector = Array.from(tensor.data) as number[];

		return vector;
	}

	/**
	 * 将查询文本转换为向量（使用 query 前缀）
	 * @param query 查询文本
	 * @returns 384维浮点向量
	 */
	async embedQuery(query: string): Promise<number[]> {
		const pipe = await this.getPipeline();

		// 使用 query 前缀
		const prefixedText = `query: ${query}`;

		const pipelineFunc = pipe as (input: string, options: Record<string, unknown>) => Promise<unknown>;
		const output = await pipelineFunc(prefixedText, {
			pooling: 'mean',
			normalize: true,
		});

		const tensor = output as { data: Float32Array | number[] };
		const vector = Array.from(tensor.data) as number[];

		return vector;
	}

	/**
	 * 批量将文本转换为向量
	 * @param texts 文本数组
	 * @returns 向量数组
	 */
	async embedBatch(texts: string[]): Promise<number[][]> {
		const results: number[][] = [];
		// 串行处理以避免内存问题（ONNX 模型占用内存较高）
		for (const text of texts) {
			const vector = await this.embed(text);
			results.push(vector);
		}
		return results;
	}

	/**
	 * 检查模型是否已加载
	 */
	isLoaded(): boolean {
		return _pipelineInstance !== null;
	}

	/**
	 * 预热模型（提前加载，避免第一次搜索时等待）
	 */
	async warmup(): Promise<void> {
		try {
			await this.embed('warmup');
			console.log('[EmbeddingService] 模型预热完成');
		} catch (error) {
			console.warn('[EmbeddingService] 模型预热失败:', error);
		}
	}
}
