/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { ITreeSitterService } from '../common/treeSitter.js';
import { TreeSitterService } from './treeSitterService.js';

// Register the Tree-sitter service as a singleton
registerSingleton(ITreeSitterService, TreeSitterService, InstantiationType.Delayed);
