/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { Event } from '../../../../base/common/event.js';
import { UserInfo, LoginRequest, LoginResponse, AuthStatus, AuthConfig } from './authTypes.js';

export const IAuthService = createDecorator<IAuthService>('authService');

/**
 * 认证服务接口
 */
export interface IAuthService {
	readonly _serviceBrand: undefined;

	/**
	 * 当前登录状态
	 */
	readonly status: AuthStatus;

	/**
	 * 当前用户信息
	 */
	readonly currentUser: UserInfo | undefined;

	/**
	 * 登录状态变化事件
	 */
	readonly onDidChangeStatus: Event<AuthStatus>;

	/**
	 * 用户信息变化事件
	 */
	readonly onDidChangeUser: Event<UserInfo | undefined>;

	/**
	 * 登录
	 */
	login(request: LoginRequest): Promise<LoginResponse>;

	/**
	 * 登出
	 */
	logout(): Promise<void>;

	/**
	 * 刷新令牌
	 */
	refreshToken(): Promise<boolean>;

	/**
	 * 自动登录（使用存储的令牌）
	 */
	autoLogin(): Promise<boolean>;

	/**
	 * 检查是否已登录
	 */
	isAuthenticated(): boolean;

	/**
	 * 获取访问令牌
	 */
	getAccessToken(): string | undefined;

	/**
	 * 验证令牌是否有效
	 */
	validateToken(): Promise<boolean>;

	/**
	 * 设置认证配置
	 */
	setConfig(config: AuthConfig): void;

	/**
	 * 获取认证配置
	 */
	getConfig(): AuthConfig | undefined;
}
