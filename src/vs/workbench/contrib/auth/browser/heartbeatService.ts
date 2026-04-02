/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { IAuthService } from '../common/authService.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { createStructuredLogger } from '../../../common/structuredLogger.js';

/**
 * 心跳请求数据结构
 */
interface HeartbeatRequest {
	userName: string;
	clientId: string;
	pluginVersion: string;
	ideType: string;
	osType: string;
}

/**
 * 心跳服务 - 定时向服务器报告在线状态
 */
export class HeartbeatService extends Disposable {
	private static readonly HEARTBEAT_INTERVAL_MS = 60 * 1000; // 1分钟
	private static readonly IDE_VERSION = '1.0.0';
	private static readonly IDE_TYPE = 'Tianhe Zhikai IDE';

	private readonly clientId: string;
	private readonly logger = createStructuredLogger('HeartbeatService');
	private heartbeatTimer: any | undefined;
	private isRunning = false;

	constructor(
		@IAuthService private readonly authService: IAuthService,
		@IConfigurationService private readonly configurationService: IConfigurationService
	) {
		super();
		this.clientId = generateUuid();
	}

	/**
	 * 启动心跳服务
	 */
	public startHeartbeat(): void {
		if (this.isRunning) {
			return;
		}

		this.isRunning = true;

		// 立即发送一次心跳
		this.sendHeartbeat();

		// 设置定时器
		this.heartbeatTimer = setInterval(() => {
			this.sendHeartbeat();
		}, HeartbeatService.HEARTBEAT_INTERVAL_MS);
		this.logger.debug('started', { intervalSeconds: HeartbeatService.HEARTBEAT_INTERVAL_MS / 1000 });
	}

	/**
	 * 停止心跳服务
	 */
	public stopHeartbeat(): void {
		if (!this.isRunning) {
			return;
		}

		this.isRunning = false;

		if (this.heartbeatTimer) {
			clearInterval(this.heartbeatTimer);
			this.heartbeatTimer = undefined;
		}
		this.logger.debug('stopped');
	}

	/**
	 * 发送心跳
	 */
	private async sendHeartbeat(): Promise<void> {
		try {
			// 检查用户是否已登录
			if (!this.authService.isAuthenticated()) {
				this.logger.debug('skip_not_authenticated');
				return;
			}

			const user = this.authService.currentUser;
			if (!user) {
				this.logger.debug('skip_missing_user');
				return;
			}

			// 获取API URL
			const apiUrl = this.configurationService.getValue<string>('zhikai.auth.apiUrl');
			if (!apiUrl) {
				this.logger.debug('skip_missing_api_url');
				return;
			}

			// 构建心跳请求
			const heartbeatRequest: HeartbeatRequest = {
				userName: user.username,
				clientId: this.clientId,
				pluginVersion: HeartbeatService.IDE_VERSION,
				ideType: HeartbeatService.IDE_TYPE,
				osType: this.getOsType()
			};

			// 发送心跳请求（移除末尾斜杠避免双斜杠）
			const baseUrl = apiUrl.replace(/\/$/, '');
			const heartbeatUrl = `${baseUrl}/knowledge/userOnline/heartbeat`;

			const response = await fetch(heartbeatUrl, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json;charset=UTF-8'
				},
				body: JSON.stringify(heartbeatRequest)
			});

			if (response.ok) {
				this.logger.debug('sent_success', { userName: user.username });
			} else {
				this.logger.warn('sent_failed_status', { status: response.status });
			}
		} catch (error) {
			this.logger.warn('send_failed', { error: String(error) });
		}
	}

	/**
	 * 获取操作系统类型
	 */
	private getOsType(): string {
		// 在浏览器环境中使用 navigator.platform
		const platform = typeof process !== 'undefined' && process.platform
			? process.platform
			: (typeof navigator !== 'undefined' ? navigator.platform : 'unknown');

		if (platform.toLowerCase().includes('mac')) {
			return 'macOS';
		} else if (platform.toLowerCase().includes('win')) {
			return 'Windows';
		} else if (platform.toLowerCase().includes('linux')) {
			return 'Linux';
		}
		return platform;
	}

	/**
	 * 获取客户端ID
	 */
	public getClientId(): string {
		return this.clientId;
	}

	/**
	 * 检查是否正在运行
	 */
	public getIsRunning(): boolean {
		return this.isRunning;
	}

	override dispose(): void {
		this.stopHeartbeat();
		super.dispose();
	}
}
