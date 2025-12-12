/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDatabaseService } from '../common/databaseService.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { DatabaseServiceImpl } from '../node/databaseServiceImpl.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';

export const IDatabaseMainService = createDecorator<IDatabaseMainService>('databaseMain');

export interface IDatabaseMainService extends IDatabaseService {
	readonly _serviceBrand: undefined;
}

// 注册数据库主进程服务
registerSingleton(IDatabaseMainService, DatabaseServiceImpl, InstantiationType.Delayed);
