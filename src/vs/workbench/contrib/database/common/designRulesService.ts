/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IDesignRulesConfig, DEFAULT_DESIGN_RULES } from './designRules.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';

export const IDesignRulesService = createDecorator<IDesignRulesService>('designRulesService');

/**
 * 设计规则服务接口
 */
export interface IDesignRulesService {
	readonly _serviceBrand: undefined;

	/**
	 * 配置变更事件
	 */
	readonly onDidChangeConfig: Event<IDesignRulesConfig>;

	/**
	 * 获取当前配置
	 */
	getConfig(): IDesignRulesConfig;

	/**
	 * 更新配置
	 */
	updateConfig(config: Partial<IDesignRulesConfig>): void;

	/**
	 * 重置为默认配置
	 */
	resetToDefault(): void;

	/**
	 * 导出配置为JSON
	 */
	exportConfig(): string;

	/**
	 * 从JSON导入配置
	 */
	importConfig(json: string): boolean;
}

/**
 * 设计规则服务实现
 */
export class DesignRulesService extends Disposable implements IDesignRulesService {
	declare readonly _serviceBrand: undefined;

	private static readonly STORAGE_KEY = 'database.designRules.config';

	private readonly _onDidChangeConfig = this._register(new Emitter<IDesignRulesConfig>());
	readonly onDidChangeConfig = this._onDidChangeConfig.event;

	private _config: IDesignRulesConfig;

	constructor(
		@IStorageService private readonly storageService: IStorageService
	) {
		super();
		this._config = this.loadConfig();
		console.log('[DesignRulesService] Initialized with config:', this._config);
	}

	/**
	 * 从存储加载配置
	 */
	private loadConfig(): IDesignRulesConfig {
		try {
			const stored = this.storageService.get(DesignRulesService.STORAGE_KEY, StorageScope.PROFILE);
			if (stored) {
				const config = JSON.parse(stored);
				console.log('[DesignRulesService] Loaded config from storage');
				return config;
			}
		} catch (error) {
			console.error('[DesignRulesService] Failed to load config:', error);
		}

		// 返回默认配置
		console.log('[DesignRulesService] Using default config');
		return { ...DEFAULT_DESIGN_RULES };
	}

	/**
	 * 保存配置到存储
	 */
	private saveConfig(): void {
		try {
			const json = JSON.stringify(this._config);
			this.storageService.store(
				DesignRulesService.STORAGE_KEY,
				json,
				StorageScope.PROFILE,
				StorageTarget.USER
			);
			console.log('[DesignRulesService] Config saved to storage');
		} catch (error) {
			console.error('[DesignRulesService] Failed to save config:', error);
		}
	}

	/**
	 * 获取当前配置
	 */
	getConfig(): IDesignRulesConfig {
		return { ...this._config };
	}

	/**
	 * 更新配置
	 */
	updateConfig(config: Partial<IDesignRulesConfig>): void {
		// 深度合并配置
		this._config = this.mergeConfig(this._config, config);
		this._config.updatedAt = new Date();

		// 保存并触发事件
		this.saveConfig();
		this._onDidChangeConfig.fire(this._config);

		console.log('[DesignRulesService] Config updated:', this._config);
	}

	/**
	 * 深度合并配置
	 */
	private mergeConfig(target: any, source: any): any {
		const result = { ...target };

		for (const key in source) {
			if (source.hasOwnProperty(key)) {
				const sourceValue = source[key];
				const targetValue = result[key];

				if (sourceValue !== null && typeof sourceValue === 'object' && !Array.isArray(sourceValue)) {
					// 递归合并对象
					result[key] = this.mergeConfig(targetValue || {}, sourceValue);
				} else {
					// 直接赋值
					result[key] = sourceValue;
				}
			}
		}

		return result;
	}

	/**
	 * 重置为默认配置
	 */
	resetToDefault(): void {
		this._config = { ...DEFAULT_DESIGN_RULES };
		this._config.updatedAt = new Date();

		this.saveConfig();
		this._onDidChangeConfig.fire(this._config);

		console.log('[DesignRulesService] Config reset to default');
	}

	/**
	 * 导出配置为JSON
	 */
	exportConfig(): string {
		return JSON.stringify(this._config, null, 2);
	}

	/**
	 * 从JSON导入配置
	 */
	importConfig(json: string): boolean {
		try {
			const config = JSON.parse(json);

			// 基本验证
			if (!config.name || typeof config.enabled !== 'boolean') {
				console.error('[DesignRulesService] Invalid config format');
				return false;
			}

			this._config = config;
			this._config.updatedAt = new Date();

			this.saveConfig();
			this._onDidChangeConfig.fire(this._config);

			console.log('[DesignRulesService] Config imported successfully');
			return true;
		} catch (error) {
			console.error('[DesignRulesService] Failed to import config:', error);
			return false;
		}
	}
}
