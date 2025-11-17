/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { EnhancedProfile, CodeStyleProfile } from './styleTypes.js';

/**
 * 风格配置存储
 * 负责代码风格配置的持久化存储和读取
 */
export class StyleStore {

	// 配置文件名
	private static readonly PROFILE_FILE_NAME = '.zhikai-style.json';

	// 配置文件目录
	private static readonly CONFIG_DIR = '.zhikai';

	constructor(
		private readonly fileService: IFileService
	) { }

	/**
	 * 保存风格配置到工作区
	 */
	async saveProfile(workspaceFolder: URI, profile: EnhancedProfile): Promise<void> {
		console.log('[StyleStore] Saving profile for workspace:', workspaceFolder.fsPath);

		try {
			// 确保配置目录存在
			const configDir = this.getConfigDir(workspaceFolder);
			await this.ensureDirectoryExists(configDir);

			// 序列化配置
			const json = this.serializeProfile(profile);

			// 写入文件
			const fileUri = this.getProfilePath(workspaceFolder);
			const content = VSBuffer.fromString(json);

			await this.fileService.writeFile(fileUri, content);

			console.log('[StyleStore] Profile saved successfully to:', fileUri.fsPath);
		} catch (error) {
			console.error('[StyleStore] Failed to save profile:', error);
			throw new Error('保存代码风格配置失败: ' + error);
		}
	}

	/**
	 * 从工作区加载风格配置
	 */
	async loadProfile(workspaceFolder: URI): Promise<EnhancedProfile | null> {
		console.log('[StyleStore] Loading profile from workspace:', workspaceFolder.fsPath);

		try {
			const fileUri = this.getProfilePath(workspaceFolder);

			// 检查文件是否存在
			const exists = await this.profileExists(workspaceFolder);
			if (!exists) {
				console.log('[StyleStore] Profile file not found');
				return null;
			}

			// 读取文件
			const fileContent = await this.fileService.readFile(fileUri);
			const json = fileContent.value.toString();

			// 反序列化配置
			const profile = this.deserializeProfile(json);

			console.log('[StyleStore] Profile loaded successfully');
			return profile;
		} catch (error) {
			console.error('[StyleStore] Failed to load profile:', error);
			return null;
		}
	}

	/**
	 * 检查配置文件是否存在
	 */
	async profileExists(workspaceFolder: URI): Promise<boolean> {
		try {
			const fileUri = this.getProfilePath(workspaceFolder);
			const stat = await this.fileService.resolve(fileUri);
			return stat.isFile;
		} catch {
			return false;
		}
	}

	/**
	 * 更新风格配置
	 */
	async updateProfile(
		workspaceFolder: URI,
		updater: (profile: EnhancedProfile) => EnhancedProfile
	): Promise<void> {
		console.log('[StyleStore] Updating profile...');

		// 加载现有配置
		const existing = await this.loadProfile(workspaceFolder);
		if (!existing) {
			throw new Error('配置文件不存在');
		}

		// 应用更新
		const updated = updater(existing);

		// 更新时间戳
		updated.updatedAt = new Date();

		// 保存更新后的配置
		await this.saveProfile(workspaceFolder, updated);

		console.log('[StyleStore] Profile updated successfully');
	}

	/**
	 * 删除风格配置
	 */
	async deleteProfile(workspaceFolder: URI): Promise<void> {
		console.log('[StyleStore] Deleting profile...');

		try {
			const fileUri = this.getProfilePath(workspaceFolder);
			const exists = await this.profileExists(workspaceFolder);

			if (exists) {
				await this.fileService.del(fileUri);
				console.log('[StyleStore] Profile deleted successfully');
			}
		} catch (error) {
			console.error('[StyleStore] Failed to delete profile:', error);
			throw new Error('删除代码风格配置失败: ' + error);
		}
	}

	/**
	 * 获取配置的最后更新时间
	 */
	async getLastUpdateTime(workspaceFolder: URI): Promise<Date | null> {
		try {
			const profile = await this.loadProfile(workspaceFolder);
			return profile?.updatedAt || null;
		} catch {
			return null;
		}
	}

	/**
	 * 检查配置是否需要更新
	 * @param workspaceFolder 工作区文件夹
	 * @param maxAgeInDays 最大有效期（天）
	 */
	async needsUpdate(workspaceFolder: URI, maxAgeInDays: number = 30): Promise<boolean> {
		const lastUpdate = await this.getLastUpdateTime(workspaceFolder);

		if (!lastUpdate) {
			return true; // 没有配置，需要更新
		}

		const now = new Date();
		const ageInDays = (now.getTime() - lastUpdate.getTime()) / (1000 * 60 * 60 * 24);

		return ageInDays > maxAgeInDays;
	}

	/**
	 * 导出配置为 JSON 字符串（用于分享或备份）
	 */
	async exportProfile(workspaceFolder: URI): Promise<string | null> {
		const profile = await this.loadProfile(workspaceFolder);
		if (!profile) {
			return null;
		}

		return this.serializeProfile(profile);
	}

	/**
	 * 从 JSON 字符串导入配置
	 */
	async importProfile(workspaceFolder: URI, json: string): Promise<void> {
		console.log('[StyleStore] Importing profile...');

		try {
			const profile = this.deserializeProfile(json);
			await this.saveProfile(workspaceFolder, profile);
			console.log('[StyleStore] Profile imported successfully');
		} catch (error) {
			console.error('[StyleStore] Failed to import profile:', error);
			throw new Error('导入代码风格配置失败: ' + error);
		}
	}

	// ==================== 私有辅助方法 ====================

	/**
	 * 获取配置文件路径
	 */
	private getProfilePath(workspaceFolder: URI): URI {
		return URI.joinPath(workspaceFolder, StyleStore.CONFIG_DIR, StyleStore.PROFILE_FILE_NAME);
	}

	/**
	 * 获取配置目录路径
	 */
	private getConfigDir(workspaceFolder: URI): URI {
		return URI.joinPath(workspaceFolder, StyleStore.CONFIG_DIR);
	}

	/**
	 * 确保目录存在
	 */
	private async ensureDirectoryExists(directory: URI): Promise<void> {
		try {
			const stat = await this.fileService.resolve(directory);
			if (!stat.isDirectory) {
				throw new Error('路径已存在但不是目录');
			}
		} catch {
			// 目录不存在，创建它
			try {
				await this.fileService.createFolder(directory);
			} catch (error) {
				console.error('[StyleStore] Failed to create directory:', error);
				throw new Error('创建配置目录失败: ' + error);
			}
		}
	}

	/**
	 * 序列化配置为 JSON
	 */
	private serializeProfile(profile: EnhancedProfile): string {
		// 转换 Date 对象为 ISO 字符串
		const serializable = {
			...profile,
			createdAt: profile.createdAt.toISOString(),
			updatedAt: profile.updatedAt.toISOString()
		};

		// 格式化输出，便于阅读
		return JSON.stringify(serializable, null, 2);
	}

	/**
	 * 从 JSON 反序列化配置
	 */
	private deserializeProfile(json: string): EnhancedProfile {
		const parsed = JSON.parse(json);

		// 转换 ISO 字符串为 Date 对象
		return {
			...parsed,
			createdAt: new Date(parsed.createdAt),
			updatedAt: new Date(parsed.updatedAt)
		};
	}

	/**
	 * 创建配置的副本
	 */
	static cloneProfile(profile: EnhancedProfile): EnhancedProfile {
		return JSON.parse(JSON.stringify({
			...profile,
			createdAt: profile.createdAt.toISOString(),
			updatedAt: profile.updatedAt.toISOString()
		})) as EnhancedProfile;
	}

	/**
	 * 合并两个配置（用于增量更新）
	 */
	static mergeProfiles(base: CodeStyleProfile, updates: Partial<CodeStyleProfile>): CodeStyleProfile {
		return {
			...base,
			...updates,
			naming: { ...base.naming, ...updates.naming },
			structure: { ...base.structure, ...updates.structure },
			comments: { ...base.comments, ...updates.comments },
			frameworks: { ...base.frameworks, ...updates.frameworks },
			examples: { ...base.examples, ...updates.examples },
			updatedAt: new Date()
		};
	}
}

/**
 * 风格配置缓存
 * 在内存中缓存配置，避免频繁的文件 I/O
 */
export class StyleProfileCache {

	private cache = new Map<string, { profile: EnhancedProfile; timestamp: number }>();

	// 缓存有效期（毫秒）
	private static readonly CACHE_TTL = 5 * 60 * 1000; // 5分钟

	/**
	 * 获取缓存的配置
	 */
	get(workspacePath: string): EnhancedProfile | null {
		const cached = this.cache.get(workspacePath);

		if (!cached) {
			return null;
		}

		// 检查缓存是否过期
		const now = Date.now();
		if (now - cached.timestamp > StyleProfileCache.CACHE_TTL) {
			this.cache.delete(workspacePath);
			return null;
		}

		return cached.profile;
	}

	/**
	 * 设置缓存的配置
	 */
	set(workspacePath: string, profile: EnhancedProfile): void {
		this.cache.set(workspacePath, {
			profile,
			timestamp: Date.now()
		});
	}

	/**
	 * 清除特定工作区的缓存
	 */
	clear(workspacePath: string): void {
		this.cache.delete(workspacePath);
	}

	/**
	 * 清除所有缓存
	 */
	clearAll(): void {
		this.cache.clear();
	}

	/**
	 * 获取缓存大小
	 */
	get size(): number {
		return this.cache.size;
	}
}
