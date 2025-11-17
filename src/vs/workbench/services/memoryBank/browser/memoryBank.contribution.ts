/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { IMemoryBankService } from '../common/memoryBank.js';
import { MemoryBankService } from './memoryBankService.js';

registerSingleton(IMemoryBankService, MemoryBankService, InstantiationType.Delayed);
