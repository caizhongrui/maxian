/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { IAuthService } from '../common/authService.js';
import { UserInfo, LoginRequest, LoginResponse, AuthStatus, AuthConfig, StoredAuthInfo } from '../common/authTypes.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';

/**
 * 认证服务实现
 */
export class AuthService extends Disposable implements IAuthService {
	declare readonly _serviceBrand: undefined;

	private _status: AuthStatus = AuthStatus.Unauthenticated;
	private _currentUser: UserInfo | undefined = undefined;
	private _config: AuthConfig | undefined = undefined;
	private _accessToken: string | undefined = undefined;
	private _refreshToken: string | undefined = undefined;

	private readonly _onDidChangeStatus = this._register(new Emitter<AuthStatus>());
	readonly onDidChangeStatus: Event<AuthStatus> = this._onDidChangeStatus.event;

	private readonly _onDidChangeUser = this._register(new Emitter<UserInfo | undefined>());
	readonly onDidChangeUser: Event<UserInfo | undefined> = this._onDidChangeUser.event;

	private static readonly STORAGE_KEY = 'zhikai.auth.credentials';
	private static readonly VALIDATION_INTERVAL = 30 * 60 * 1000; // 30 分钟

	private validationTimer: any = undefined;

	constructor(
		@IStorageService private readonly storageService: IStorageService,
		@IConfigurationService private readonly configurationService: IConfigurationService
	) {
		super();
		this.loadConfig();
	}

	get status(): AuthStatus {
		return this._status;
	}

	get currentUser(): UserInfo | undefined {
		return this._currentUser;
	}

	/**
	 * 加载配置
	 */
	private loadConfig(): void {
		const apiUrl = this.configurationService.getValue<string>('zhikai.auth.apiUrl');
		if (apiUrl) {
			this._config = {
				apiUrl,
				loginEndpoint: this.configurationService.getValue<string>('zhikai.auth.loginEndpoint') || '/api/auth/login',
				refreshEndpoint: this.configurationService.getValue<string>('zhikai.auth.refreshEndpoint') || '/api/auth/refresh',
				logoutEndpoint: this.configurationService.getValue<string>('zhikai.auth.logoutEndpoint') || '/api/auth/logout',
				userInfoEndpoint: this.configurationService.getValue<string>('zhikai.auth.userInfoEndpoint') || '/api/auth/user',
				timeout: this.configurationService.getValue<number>('zhikai.auth.timeout') || 30000
			};
		}
	}

	/**
	 * 登录
	 */
	async login(request: LoginRequest): Promise<LoginResponse> {
		if (!this._config?.apiUrl) {
			throw new Error('后端 API 地址未配置，请在设置中配置 zhikai.auth.apiUrl');
		}

		this.setStatus(AuthStatus.Authenticating);

		try {
			// 构建登录 URL: apiUrl + /knowledge/appCustomer/checkUser?userName=xxx&password=xxx
			const loginPath = '/knowledge/appCustomer/checkUser';
			// 移除 apiUrl 末尾的斜杠（如果有）
			const baseUrl = this._config.apiUrl.replace(/\/$/, '');
			const url = `${baseUrl}${loginPath}?userName=${encodeURIComponent(request.username)}&password=${encodeURIComponent(request.password)}`;

			const response = await fetch(url, {
				method: 'GET',
				headers: {
					'Accept': 'application/json'
				},
				signal: AbortSignal.timeout(this._config.timeout || 30000)
			});

			if (!response.ok) {
				const error = await response.text();
				throw new Error(`登录失败: ${response.status} ${error}`);
			}

			const data: any = await response.json();

			// 处理后端响应：{ code: 200, msg: "操作成功", data: {...} }
			// data 包含用户信息和权限配置
			if (!data || data.code !== 200) {
				throw new Error(data?.msg || '登录失败：服务器错误');
			}

			// 兼容旧格式(data为true/false)和新格式(data为对象)
			const isOldFormat = typeof data.data === 'boolean' || data.data === 'true' || data.data === 'false';

			if (isOldFormat) {
				// 旧格式：data.data 为 true/false
				if (data.data !== true && data.data !== 'true') {
					throw new Error('登录失败：用户名或密码错误');
				}
			} else if (!data.data) {
				// 新格式但data为空
				throw new Error('登录失败：用户名或密码错误');
			}

			// 从响应中提取用户信息和权限
			const responseData = isOldFormat ? {} : (data.data || {});

			// 构造标准的 LoginResponse（简化版，不需要真实的 token）
			const loginResponse: LoginResponse = {
				accessToken: `session_${request.username}_${Date.now()}`,
				refreshToken: `refresh_${request.username}_${Date.now()}`,
				tokenType: 'Bearer',
				expiresIn: 86400, // 默认 24 小时
				user: {
					id: responseData.id || data.user?.id || data.id || request.username,
					username: request.username,
					displayName: responseData.displayName || data.user?.displayName || data.displayName || data.name || request.username,
					email: responseData.email || data.user?.email || data.email || '',
					avatar: responseData.avatar || data.user?.avatar || data.avatar,
					agentPermission: responseData.agentPermission // 提取 agentPermission 字段
				}
			};

			// 保存令牌和用户信息
			this._accessToken = loginResponse.accessToken;
			this._refreshToken = loginResponse.refreshToken;
			this._currentUser = loginResponse.user;

			// 如果选择记住我，持久化存储（包括用户名和密码）
			if (request.rememberMe) {
				this.saveCredentials(loginResponse, true, request.username, request.password);
			} else {
				// 仅在会话中存储
				this.saveCredentials(loginResponse, false);
			}

			this.setStatus(AuthStatus.Authenticated);
			this._onDidChangeUser.fire(this._currentUser);

			// 启动定时校验
			this.startPeriodicValidation();

			return loginResponse;
		} catch (error) {
			this.setStatus(AuthStatus.Failed);
			throw error;
		}
	}

	/**
	 * 启动定时校验
	 */
	private startPeriodicValidation(): void {
		// 清除之前的定时器
		this.stopPeriodicValidation();

		// 设置定时器，每 30 分钟校验一次
		this.validationTimer = setInterval(async () => {
			const isValid = await this.validateToken();

			if (!isValid) {
				await this.logout();
				// 触发状态变化，让 UI 显示登录对话框
				this.setStatus(AuthStatus.Unauthenticated);
			}
		}, AuthService.VALIDATION_INTERVAL);
	}

	/**
	 * 停止定时校验
	 */
	private stopPeriodicValidation(): void {
		if (this.validationTimer) {
			clearInterval(this.validationTimer);
			this.validationTimer = undefined;
		}
	}

	/**
	 * 登出 - 只清除本地缓存
	 */
	async logout(): Promise<void> {
		// 停止定时校验
		this.stopPeriodicValidation();

		// 清除本地状态
		this._accessToken = undefined;
		this._refreshToken = undefined;
		this._currentUser = undefined;

		// 清除存储
		this.storageService.remove(AuthService.STORAGE_KEY, StorageScope.APPLICATION);

		this.setStatus(AuthStatus.Unauthenticated);
		this._onDidChangeUser.fire(undefined);
	}

	/**
	 * 刷新令牌
	 */
	async refreshToken(): Promise<boolean> {
		if (!this._config?.apiUrl || !this._refreshToken) {
			return false;
		}

		try {
			const url = `${this._config.apiUrl}${this._config.refreshEndpoint || '/api/auth/refresh'}`;
			const response = await fetch(url, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Authorization': `Bearer ${this._refreshToken}`
				},
				signal: AbortSignal.timeout(this._config.timeout || 30000)
			});

			if (!response.ok) {
				await this.logout();
				return false;
			}

			const data: LoginResponse = await response.json();

			// 更新令牌
			this._accessToken = data.accessToken;
			if (data.refreshToken) {
				this._refreshToken = data.refreshToken;
			}

			// 更新存储
			const stored = this.loadStoredCredentials();
			if (stored) {
				this.saveCredentials(data, stored.rememberMe || false);
			}

			return true;
		} catch (error) {
			await this.logout();
			return false;
		}
	}

	/**
	 * 自动登录
	 */
	async autoLogin(): Promise<boolean> {
		const stored = this.loadStoredCredentials();
		if (!stored) {
			return false;
		}

		// 如果有用户名和密码，使用它们重新登录
		if (stored.username && stored.password && stored.rememberMe) {
			try {
				await this.login({
					username: stored.username,
					password: stored.password,
					rememberMe: true
				});
				return true;
			} catch (error) {
				await this.logout();
				return false;
			}
		}

		// 如果没有用户名密码，尝试使用 token
		// 检查令牌是否过期
		if (stored.expiresAt && Date.now() >= stored.expiresAt) {
			this._refreshToken = stored.refreshToken;
			return await this.refreshToken();
		}

		// 使用存储的令牌
		this._accessToken = stored.accessToken;
		this._refreshToken = stored.refreshToken;
		this._currentUser = stored.user;

		// 验证令牌是否仍然有效
		const isValid = await this.validateToken();
		if (!isValid) {
			await this.logout();
			return false;
		}

		this.setStatus(AuthStatus.Authenticated);
		this._onDidChangeUser.fire(this._currentUser);

		// 启动定时校验
		this.startPeriodicValidation();

		return true;
	}

	/**
	 * 检查是否已登录
	 */
	isAuthenticated(): boolean {
		return this._status === AuthStatus.Authenticated && !!this._accessToken;
	}

	/**
	 * 获取访问令牌
	 */
	getAccessToken(): string | undefined {
		return this._accessToken;
	}

	/**
	 * 验证令牌 - 使用登录接口再次验证
	 */
	async validateToken(): Promise<boolean> {
		if (!this._config?.apiUrl || !this._currentUser) {
			return false;
		}

		try {
			// 使用当前用户信息重新调用登录接口验证
			// 注意：这里需要用户名，但没有密码，所以只能用存储的 token 来验证
			// 如果后端有专门的验证接口，应该使用那个接口
			// 暂时使用 userInfoEndpoint，如果后端返回 200 就认为有效
			const baseUrl = this._config.apiUrl.replace(/\/$/, '');

			// 简单验证：尝试用当前 accessToken 作为标识
			// 如果后端有 token 验证接口，这里应该调用那个接口
			const url = `${baseUrl}${this._config.userInfoEndpoint || '/api/auth/user'}`;

			const response = await fetch(url, {
				method: 'GET',
				headers: {
					'Authorization': `Bearer ${this._accessToken}`,
					'Accept': 'application/json'
				},
				signal: AbortSignal.timeout(this._config.timeout || 30000)
			});

			if (response.ok) {
				const data: any = await response.json();
				// 验证响应格式
				if (data && data.code === 200 && data.data === true) {
					return true;
				}
			}

			return false;
		} catch (error) {
			return false;
		}
	}

	/**
	 * 设置认证配置
	 */
	setConfig(config: AuthConfig): void {
		this._config = config;
	}

	/**
	 * 获取认证配置
	 */
	getConfig(): AuthConfig | undefined {
		return this._config;
	}

	/**
	 * 设置状态
	 */
	private setStatus(status: AuthStatus): void {
		if (this._status !== status) {
			this._status = status;
			this._onDidChangeStatus.fire(status);
		}
	}

	/**
	 * 保存凭证
	 */
	private saveCredentials(response: LoginResponse, rememberMe: boolean, username?: string, password?: string): void {
		const stored: StoredAuthInfo = {
			accessToken: response.accessToken,
			refreshToken: response.refreshToken,
			user: response.user,
			expiresAt: response.expiresIn ? Date.now() + response.expiresIn * 1000 : undefined,
			rememberMe,
			username,
			password
		};

		const target = rememberMe ? StorageTarget.MACHINE : StorageTarget.USER;

		this.storageService.store(
			AuthService.STORAGE_KEY,
			JSON.stringify(stored),
			StorageScope.APPLICATION,
			target
		);
	}

	/**
	 * 加载存储的凭证
	 */
	private loadStoredCredentials(): StoredAuthInfo | undefined {
		const stored = this.storageService.get(AuthService.STORAGE_KEY, StorageScope.APPLICATION);
		if (!stored) {
			return undefined;
		}

		try {
			const parsed = JSON.parse(stored) as StoredAuthInfo;
			return parsed;
		} catch (error) {
			return undefined;
		}
	}
}
