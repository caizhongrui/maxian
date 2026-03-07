/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';

/**
 * 命令执行结果
 */
export interface ICommandExecutionResult {
	stdout: string;
	stderr: string;
	exitCode: number | null;
	timedOut: boolean;
	aborted: boolean;
}

/**
 * 命令执行选项
 * 注意：AbortSignal 不可通过 IPC 序列化，故不包含在此接口中。
 * 取消机制通过 cancel(commandId) 方法实现。
 */
export interface ICommandExecutionOptions {
	cwd?: string;
	timeout?: number;
	commandId?: string;
}

export const ICommandExecutionService = createDecorator<ICommandExecutionService>('maxianCommandExecutionService');

/**
 * 命令执行服务接口
 * 在 electron-main 层实现（child_process.spawn），通过 IPC 通道暴露给 renderer 层。
 * renderer 层通过 ProxyChannel 代理自动获得此服务。
 */
export interface ICommandExecutionService {
	readonly _serviceBrand: undefined;

	/**
	 * 执行命令并返回结果
	 */
	execute(command: string, options?: ICommandExecutionOptions): Promise<ICommandExecutionResult>;

	/**
	 * 取消正在执行的命令
	 * @param commandId execute() 时传入的 commandId
	 */
	cancel(commandId: string): Promise<void>;
}
