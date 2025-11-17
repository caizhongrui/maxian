/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { URI } from '../../../../base/common/uri.js';
import { IDisposable } from '../../../../base/common/lifecycle.js';

export const ICheckpointService = createDecorator<ICheckpointService>('checkpointService');

/**
 * Checkpoint result containing commit information
 */
export interface ICheckpointResult {
	readonly commit: string;
	readonly branch?: string;
	readonly summary?: {
		readonly changes: number;
		readonly insertions: number;
		readonly deletions: number;
	};
}

/**
 * Checkpoint diff information
 */
export interface ICheckpointDiff {
	readonly paths: {
		readonly relative: string;
		readonly absolute: string;
	};
	readonly content: {
		readonly before: string;
		readonly after: string;
	};
}

/**
 * Checkpoint metadata
 */
export interface ICheckpoint {
	readonly hash: string;
	readonly message: string;
	readonly timestamp: number;
	readonly author?: string;
}

/**
 * Checkpoint event types
 */
export interface ICheckpointEvent {
	readonly type: 'initialize' | 'checkpoint' | 'restore' | 'error';
	readonly workspaceUri?: URI;
	readonly commitHash?: string;
	readonly duration?: number;
	readonly error?: Error;
}

/**
 * Checkpoint service options
 */
export interface ICheckpointServiceOptions {
	readonly workspaceUri: URI;
	readonly storageUri: URI;
	readonly taskId?: string;
}

/**
 * Main checkpoint service interface
 */
export interface ICheckpointService extends IDisposable {
	readonly _serviceBrand: undefined;

	/**
	 * Event fired when checkpoint state changes
	 */
	readonly onDidChangeCheckpoint: Event<ICheckpointEvent>;

	/**
	 * Whether the service is initialized
	 */
	readonly isInitialized: boolean;

	/**
	 * Current base commit hash
	 */
	readonly baseHash: string | undefined;

	/**
	 * Initialize the checkpoint service for a workspace
	 */
	initialize(options: ICheckpointServiceOptions): Promise<{ created: boolean; duration: number }>;

	/**
	 * Save a checkpoint with the current state
	 */
	saveCheckpoint(message: string, options?: { allowEmpty?: boolean; suppressMessage?: boolean }): Promise<ICheckpointResult | undefined>;

	/**
	 * List all checkpoints
	 */
	getCheckpoints(): ICheckpoint[];

	/**
	 * Restore to a specific checkpoint
	 */
	restoreCheckpoint(commitHash: string): Promise<void>;

	/**
	 * Get diff between two commits
	 */
	getDiff(options: { from?: string; to?: string }): Promise<ICheckpointDiff[]>;

	/**
	 * Clear all checkpoints
	 */
	clear(): Promise<void>;
}
