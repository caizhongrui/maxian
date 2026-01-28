/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ISkillService } from '../common/skillService.js';
import { registerMainProcessRemoteService } from '../../../../platform/ipc/electron-sandbox/services.js';

/**
 * 注册 SkillService 为主进程远程服务
 *
 * 这会自动创建一个 IPC 代理，将所有方法调用转发到主进程（Node环境）
 * 主进程中的实际实现在 electron-main/ 目录
 */
registerMainProcessRemoteService(ISkillService, 'skill');
