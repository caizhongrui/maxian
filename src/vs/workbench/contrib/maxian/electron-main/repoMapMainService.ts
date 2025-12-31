/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IRepoMapService } from '../common/repomap/repoMapService.js';
import { RepoMapService } from '../node/repomap/repoMapServiceImpl.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';

// 在主进程注册RepoMapService实现
registerSingleton(IRepoMapService, RepoMapService, InstantiationType.Delayed);
