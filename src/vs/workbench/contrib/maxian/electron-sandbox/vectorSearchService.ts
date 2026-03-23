/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { registerMainProcessRemoteService } from '../../../../platform/ipc/electron-sandbox/services.js';
import { IVectorSearchService } from '../common/vector/IVectorSearchService.js';

// 通过 IPC 代理注册主进程的向量搜索服务
// 主进程端通过 ProxyChannel.fromService 注册 'maxianVectorSearch' 通道
// renderer 端通过 ProxyChannel.toService 自动创建代理
registerMainProcessRemoteService(IVectorSearchService, 'maxianVectorSearch');
