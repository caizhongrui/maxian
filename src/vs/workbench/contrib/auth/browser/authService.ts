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

			// 处理后端响应：{ code: 200, msg: "操作成功", data: {...用户对象} }
			if (!data || data.code !== 200) {
				throw new Error(data?.msg || '登录失败：服务器错误');
			}

			// 检查返回的用户对象是否有效
			if (!data.data || typeof data.data !== 'object') {
				throw new Error('登录失败：用户名或密码错误');
			}

			const userData = data.data;

			// 解析 agentPermission：后端返回字符串 "code,architect,debug"，需要转换为数组
			let agentPermission: string[] | null = null;
			if (userData.agentPermission && typeof userData.agentPermission === 'string') {
				agentPermission = userData.agentPermission.split(',').map((p: string) => p.trim()).filter((p: string) => p);
			}

			// 构造标准的 LoginResponse
			const loginResponse: LoginResponse = {
				accessToken: `session_${request.username}_${Date.now()}`,
				refreshToken: `refresh_${request.username}_${Date.now()}`,
				tokenType: 'Bearer',
				expiresIn: 86400, // 默认 24 小时
				user: {
					id: String(userData.id || request.username),
					username: userData.userName || request.username,
					displayName: userData.nickName || userData.userName || request.username,
					email: userData.email || '',
					avatar: userData.avatar,
					agentPermission: agentPermission
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

			return loginResponse;
		} catch (error) {
			this.setStatus(AuthStatus.Failed);
			throw error;
		}
	}

	/**
	 * 登出 - 只清除本地缓存
	 */
	async logout(): Promise<void> {

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

		this.setStatus(AuthStatus.Authenticated);
		this._onDidChangeUser.fire(this._currentUser);

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
