/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize2 } from '../../../../nls.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { IAIService } from '../../../../platform/ai/common/ai.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'zhikai.testAI',
			title: localize2('zhikai.testAI', 'Test AI Service'),
			category: localize2('zhikai', 'Tianhe Zhikai'),
			f1: true
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const aiService = accessor.get(IAIService);
		const notificationService = accessor.get(INotificationService);

		notificationService.info('Calling AI service...');

		try {
			const result = await aiService.complete('Write a hello world function in TypeScript');

			notificationService.info('AI Response: ' + result.substring(0, 100));
		} catch (error) {
			notificationService.error('AI Error: ' + error);
		}
	}
});
