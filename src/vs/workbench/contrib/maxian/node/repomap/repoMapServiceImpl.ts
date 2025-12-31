/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IRepoMapService, IRepoMapContext } from '../../common/repomap/repoMapService.js';
import { RepoMapGenerator } from './RepoMapGenerator.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { URI } from '../../../../../base/common/uri.js';
import * as path from 'path';

/**
 * RepoMapService实现（Node层）
 */
export class RepoMapService implements IRepoMapService {
	declare readonly _serviceBrand: undefined;

	private generator: RepoMapGenerator | null = null;

	constructor(
		@IFileService private readonly fileService: IFileService
	) {}

	async initialize(workspaceRoot: string): Promise<void> {
		this.generator = new RepoMapGenerator({
			workspaceRoot,
			maxTokens: 2048,
			mapMulNoFiles: 8,
			verbose: false
		});

		await this.generator.initialize();
		console.log('[RepoMapService] 初始化完成');
	}

	async generateRanked(context: IRepoMapContext): Promise<string> {
		if (!this.generator) {
			console.warn('[RepoMapService] 未初始化');
			return '';
		}

		// 将数组转换为Set（IPC传输后需要）
		const convertedContext: any = {
			...context,
			mentionedFiles: context.mentionedFiles ? new Set(context.mentionedFiles) : new Set(),
			mentionedIdents: context.mentionedIdents ? new Set(context.mentionedIdents) : new Set()
		};

		return await this.generator.generateRanked(convertedContext);
	}

	async getWorkspaceCodeFiles(workspaceRoot: string): Promise<string[]> {
		const extensions = ['.ts', '.tsx', '.js', '.jsx', '.py', '.java', '.go', '.rs', '.c', '.cpp', '.h', '.hpp'];
		const files: string[] = [];

		try {
			const workspaceUri = URI.file(workspaceRoot);
			const found = await this.findCodeFilesRecursive(workspaceUri, extensions, 0, 500);
			files.push(...found);
		} catch (error) {
			console.error('[RepoMapService] 获取工作区文件失败:', error);
		}

		return files;
	}

	private async findCodeFilesRecursive(
		dirUri: URI,
		extensions: string[],
		depth: number,
		maxFiles: number
	): Promise<string[]> {
		const files: string[] = [];

		if (depth > 10 || files.length >= maxFiles) {
			return files;
		}

		try {
			const entries = await this.fileService.resolve(dirUri);

			if (!entries.children) {
				return files;
			}

			for (const entry of entries.children) {
				const name = entry.name;

				if (name === 'node_modules' || name === '.git' || name === 'dist' ||
					name === 'build' || name === 'out' || name.startsWith('.')) {
					continue;
				}

				if (entry.isDirectory) {
					const subFiles = await this.findCodeFilesRecursive(entry.resource, extensions, depth + 1, maxFiles - files.length);
					files.push(...subFiles);

					if (files.length >= maxFiles) {
						break;
					}
				} else {
					const ext = path.extname(name);
					if (extensions.includes(ext)) {
						files.push(entry.resource.fsPath);

						if (files.length >= maxFiles) {
							break;
						}
					}
				}
			}
		} catch (error) {
			console.error('[RepoMapService] 读取目录失败:', dirUri.fsPath, error);
		}

		return files;
	}

	clearCache(): void {
		this.generator?.clearCache();
	}

	getStats() {
		return this.generator?.getStats() || {
			mapCacheSize: 0,
			tagCacheSize: 0,
			lastMapLength: 0
		};
	}
}
