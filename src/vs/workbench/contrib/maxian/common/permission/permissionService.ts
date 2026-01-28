/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';
import { IPermissionRequest, IPermissionCheckResult, PermissionAction, PermissionReply, PermissionRuleset } from './permissionTypes.js';
import { ToolName } from '../tools/toolTypes.js';

export const IPermissionService = createDecorator<IPermissionService>('permissionService');

/**
 * 权限服务接口
 */
export interface IPermissionService {
	readonly _serviceBrand: undefined;

	/**
	 * 检查工具调用权限
	 * @param request 权限检查请求
	 * @returns 权限检查结果
	 */
	check(request: IPermissionRequest): Promise<IPermissionCheckResult>;

	/**
	 * 记住用户的权限选择
	 * @param tool 工具名称
	 * @param pattern 文件/路径模式
	 * @param action 权限操作
	 */
	remember(tool: ToolName, pattern: string, action: PermissionAction): Promise<void>;

	/**
	 * 获取当前权限规则集
	 * @returns 权限规则集
	 */
	getRules(): Promise<PermissionRuleset>;

	/**
	 * 更新权限规则
	 * @param rules 新的规则集
	 */
	updateRules(rules: PermissionRuleset): Promise<void>;

	/**
	 * 重置为默认权限规则
	 */
	resetToDefaults(): Promise<void>;

	/**
	 * 询问用户权限
	 * @param request 权限请求
	 * @returns 用户回复
	 */
	askUser(request: IPermissionRequest): Promise<PermissionReply>;
}
