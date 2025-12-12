/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDatabaseService } from '../common/databaseService.js';
import { registerMainProcessRemoteService } from '../../../../platform/ipc/electron-sandbox/services.js';

// 注册为主进程远程服务
// 这会自动创建一个IPC代理,将所有方法调用转发到主进程
registerMainProcessRemoteService(IDatabaseService, 'database');
