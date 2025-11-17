/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IListFilesOptions, IListFilesResult, IRegexSearchOptions, IRipgrepService } from '../common/ripgrep.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { Disposable } from '../../../../base/common/lifecycle.js';

/**
 * Browser implementation of RipgrepService
 * This is a stub that throws errors when used in browser context
 * The actual implementation is in the node layer
 */
export class BrowserRipgrepService extends Disposable implements IRipgrepService {
	declare readonly _serviceBrand: undefined;

	async getRipgrepPath(): Promise<string> {
		throw new Error('RipgrepService is not available in browser context');
	}

	async listFiles(options: IListFilesOptions): Promise<IListFilesResult> {
		throw new Error('RipgrepService is not available in browser context');
	}

	async regexSearch(options: IRegexSearchOptions): Promise<string> {
		throw new Error('RipgrepService is not available in browser context');
	}
}

// Register browser stub
registerSingleton(IRipgrepService, BrowserRipgrepService, InstantiationType.Delayed);
