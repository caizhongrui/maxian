/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * 用户信息
 */
export interface UserInfo {
	/**
	 * 用户ID
	 */
	id: string;

	/**
	 * 用户名
	 */
	username: string;

	/**
	 * 邮箱
	 */
	email?: string;

	/**
	 * 显示名称
	 */
	displayName?: string;

	/**
	 * 头像URL
	 */
	avatar?: string;

	/**
	 * 角色
	 */
	roles?: string[];

	/**
	 * 其他元数据
	 */
	metadata?: Record<string, any>;

	/**
	 * Agent权限配置 - 控制用户可用的AI模式
	 * 例如: ["ask", "code", "architect"]
	 * null 或 undefined 表示只有 ask 模式可用
	 */
	agentPermission?: string[] | null;
}

/**
 * 登录请求
 */
export interface LoginRequest {
	/**
	 * 用户名
	 */
	username: string;

	/**
	 * 密码
	 */
	password: string;

	/**
	 * 记住我
	 */
	rememberMe?: boolean;
}

/**
 * 登录响应
 */
export interface LoginResponse {
	/**
	 * 访问令牌
	 */
	accessToken: string;

	/**
	 * 刷新令牌
	 */
	refreshToken?: string;

	/**
	 * 令牌类型
	 */
	tokenType?: string;

	/**
	 * 过期时间（秒）
	 */
	expiresIn?: number;

	/**
	 * 用户信息
	 */
	user: UserInfo;
}

/**
 * 登录状态
 */
export enum AuthStatus {
	/**
	 * 未登录
	 */
	Unauthenticated = 'unauthenticated',

	/**
	 * 已登录
	 */
	Authenticated = 'authenticated',

	/**
	 * 登录中
	 */
	Authenticating = 'authenticating',

	/**
	 * 登录失败
	 */
	Failed = 'failed'
}

/**
 * 认证配置
 */
export interface AuthConfig {
	/**
	 * 后端API地址
	 */
	apiUrl: string;

	/**
	 * 登录端点
	 */
	loginEndpoint?: string;

	/**
	 * 刷新令牌端点
	 */
	refreshEndpoint?: string;

	/**
	 * 登出端点
	 */
	logoutEndpoint?: string;

	/**
	 * 用户信息端点
	 */
	userInfoEndpoint?: string;

	/**
	 * 请求超时（毫秒）
	 */
	timeout?: number;
}

/**
 * 存储的认证信息
 */
export interface StoredAuthInfo {
	/**
	 * 访问令牌
	 */
	accessToken: string;

	/**
	 * 刷新令牌
	 */
	refreshToken?: string;

	/**
	 * 用户信息
	 */
	user: UserInfo;

	/**
	 * 过期时间戳
	 */
	expiresAt?: number;

	/**
	 * 记住我
	 */
	rememberMe?: boolean;

	/**
	 * 用户名（用于自动登录）
	 */
	username?: string;

	/**
	 * 密码（用于自动登录，注意：实际应用中应该加密存储）
	 */
	password?: string;
}
