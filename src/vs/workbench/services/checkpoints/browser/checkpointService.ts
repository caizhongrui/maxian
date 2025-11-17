/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { URI } from '../../../../base/common/uri.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { ISCMService, ISCMRepository } from '../../../contrib/scm/common/scm.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import {
	ICheckpointService,
	ICheckpointResult,
	ICheckpointDiff,
	ICheckpoint,
	ICheckpointEvent,
	ICheckpointServiceOptions
} from '../common/checkpoints.js';
import { GitHelper } from '../common/gitHelper.js';
// import { getExcludePatterns } from '../common/excludePatterns.js'; // Unused

/**
 * Checkpoint service implementation
 *
 * This service provides Git-based code snapshot functionality:
 * - Automatic checkpoint creation
 * - List all checkpoints
 * - Restore to specific versions
 * - Show differences between checkpoints
 */
export class CheckpointService extends Disposable implements ICheckpointService {

	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangeCheckpoint = this._register(new Emitter<ICheckpointEvent>());
	readonly onDidChangeCheckpoint: Event<ICheckpointEvent> = this._onDidChangeCheckpoint.event;

	private _isInitialized: boolean = false;
	private _baseHash: string | undefined;
	private _checkpoints: ICheckpoint[] = [];
	private _gitHelper: GitHelper | undefined;
	private _workspaceUri: URI | undefined;
	// private _storageUri: URI | undefined; // Unused
	// private _taskId: string | undefined; // Unused

	private readonly STORAGE_KEY = 'checkpoint.history';

	constructor(
		@ILogService private readonly logService: ILogService,
		@IStorageService private readonly storageService: IStorageService,
		@ISCMService private readonly scmService: ISCMService,
		@IWorkspaceContextService _workspaceContextService: IWorkspaceContextService
	) {
		super();
		this.logService.info('[CheckpointService] Service created');
	}

	get isInitialized(): boolean {
		return this._isInitialized;
	}

	get baseHash(): string | undefined {
		return this._baseHash;
	}

	/**
	 * Initialize the checkpoint service
	 */
	async initialize(options: ICheckpointServiceOptions): Promise<{ created: boolean; duration: number }> {
		const startTime = Date.now();
		this.logService.info('[CheckpointService] Initializing checkpoint service', options.workspaceUri.toString());

		try {
			this._workspaceUri = options.workspaceUri;
			// this._storageUri = options.storageUri; // Unused
			// this._taskId = options.taskId; // Unused

			// Validate workspace
			this.validateWorkspace(options.workspaceUri);

			// Find or create Git repository
			const repository = await this.getOrCreateRepository(options.workspaceUri);
			if (!repository) {
				throw new Error('Failed to get or create Git repository');
			}

			// Initialize Git helper
			this._gitHelper = new GitHelper(repository);

			// Check if this is a new checkpoint repository
			const created = await this.isNewRepository();

			// Load checkpoint history
			await this.loadCheckpointHistory();

			// Get base hash
			this._baseHash = await this.getCurrentCommitHash();

			this._isInitialized = true;
			const duration = Date.now() - startTime;

			this._onDidChangeCheckpoint.fire({
				type: 'initialize',
				workspaceUri: options.workspaceUri,
				commitHash: this._baseHash,
				duration
			});

			this.logService.info(`[CheckpointService] Initialized in ${duration}ms, base hash: ${this._baseHash}`);

			return { created, duration };
		} catch (error) {
			const duration = Date.now() - startTime;
			this.logService.error('[CheckpointService] Initialization failed', error);
			this._onDidChangeCheckpoint.fire({
				type: 'error',
				error: error instanceof Error ? error : new Error(String(error)),
				duration
			});
			throw error;
		}
	}

	/**
	 * Save a checkpoint
	 */
	async saveCheckpoint(message: string, options?: { allowEmpty?: boolean; suppressMessage?: boolean }): Promise<ICheckpointResult | undefined> {
		if (!this._isInitialized || !this._gitHelper) {
			throw new Error('Checkpoint service not initialized');
		}

		const startTime = Date.now();
		this.logService.info('[CheckpointService] Saving checkpoint:', message);

		try {
			// Stage all changes
			await this._gitHelper.stageAll();

			// Create commit
			const commitHash = await this._gitHelper.commit(message, { allowEmpty: options?.allowEmpty });

			// Get diff summary
			const diffSummary = await this._gitHelper.getDiffSummary(this._baseHash || 'HEAD~1', commitHash);

			// Create checkpoint record
			const checkpoint: ICheckpoint = {
				hash: commitHash,
				message,
				timestamp: Date.now()
			};

			this._checkpoints.push(checkpoint);
			await this.saveCheckpointHistory();

			const result: ICheckpointResult = {
				commit: commitHash,
				branch: await this._gitHelper.getCurrentBranch(),
				summary: {
					changes: diffSummary.changed,
					insertions: diffSummary.insertions,
					deletions: diffSummary.deletions
				}
			};

			const duration = Date.now() - startTime;
			this._onDidChangeCheckpoint.fire({
				type: 'checkpoint',
				workspaceUri: this._workspaceUri,
				commitHash,
				duration
			});

			this.logService.info(`[CheckpointService] Checkpoint saved in ${duration}ms:`, commitHash);

			return result;
		} catch (error) {
			this.logService.error('[CheckpointService] Failed to save checkpoint', error);
			this._onDidChangeCheckpoint.fire({
				type: 'error',
				error: error instanceof Error ? error : new Error(String(error))
			});
			throw error;
		}
	}

	/**
	 * Get all checkpoints
	 */
	getCheckpoints(): ICheckpoint[] {
		return [...this._checkpoints];
	}

	/**
	 * Restore to a specific checkpoint
	 */
	async restoreCheckpoint(commitHash: string): Promise<void> {
		if (!this._isInitialized || !this._gitHelper) {
			throw new Error('Checkpoint service not initialized');
		}

		const startTime = Date.now();
		this.logService.info('[CheckpointService] Restoring checkpoint:', commitHash);

		try {
			// Clean untracked files
			await this._gitHelper.clean({ force: true, directories: true });

			// Reset to commit
			await this._gitHelper.reset(commitHash, true);

			// Remove checkpoints after this one
			const index = this._checkpoints.findIndex(cp => cp.hash === commitHash);
			if (index !== -1) {
				this._checkpoints = this._checkpoints.slice(0, index + 1);
				await this.saveCheckpointHistory();
			}

			const duration = Date.now() - startTime;
			this._onDidChangeCheckpoint.fire({
				type: 'restore',
				workspaceUri: this._workspaceUri,
				commitHash,
				duration
			});

			this.logService.info(`[CheckpointService] Checkpoint restored in ${duration}ms`);
		} catch (error) {
			this.logService.error('[CheckpointService] Failed to restore checkpoint', error);
			this._onDidChangeCheckpoint.fire({
				type: 'error',
				error: error instanceof Error ? error : new Error(String(error))
			});
			throw error;
		}
	}

	/**
	 * Get diff between commits
	 */
	async getDiff(options: { from?: string; to?: string }): Promise<ICheckpointDiff[]> {
		if (!this._isInitialized || !this._gitHelper) {
			throw new Error('Checkpoint service not initialized');
		}

		this.logService.info('[CheckpointService] Getting diff:', options);

		try {
			const diffs: ICheckpointDiff[] = [];

			// Get diff summary first
			const from = options.from || this._baseHash || 'HEAD~1';
			const to = options.to || 'HEAD';

			const diffSummary = await this._gitHelper.getDiffSummary(from, to);

			// For each changed file, get the content
			for (const file of diffSummary.files) {
				const beforeContent = await this._gitHelper.show(from, file.file).catch(() => '');
				const afterContent = await this._gitHelper.show(to, file.file).catch(() => '');

				diffs.push({
					paths: {
						relative: file.file,
						absolute: URI.joinPath(this._workspaceUri!, file.file).fsPath
					},
					content: {
						before: beforeContent,
						after: afterContent
					}
				});
			}

			return diffs;
		} catch (error) {
			this.logService.error('[CheckpointService] Failed to get diff', error);
			throw error;
		}
	}

	/**
	 * Clear all checkpoints
	 */
	async clear(): Promise<void> {
		this._checkpoints = [];
		await this.saveCheckpointHistory();
		this._isInitialized = false;
		this._baseHash = undefined;
		this._gitHelper = undefined;
		this.logService.info('[CheckpointService] Cleared all checkpoints');
	}

	/**
	 * Validate workspace is suitable for checkpoints
	 */
	private validateWorkspace(workspaceUri: URI): void {
		// Check for protected paths (home, desktop, etc.)
		const path = workspaceUri.fsPath;
		const protectedPaths = [
			process.env.HOME,
			process.env.USERPROFILE,
		].filter(Boolean);

		if (protectedPaths.some(p => p && path === p)) {
			throw new Error(`Cannot use checkpoints in protected directory: ${path}`);
		}
	}

	/**
	 * Get or create Git repository for workspace
	 */
	private async getOrCreateRepository(workspaceUri: URI): Promise<ISCMRepository | undefined> {
		// Try to find existing repository
		for (const repository of this.scmService.repositories) {
			if (repository.provider.rootUri?.toString() === workspaceUri.toString()) {
				return repository;
			}
		}

		// If no repository found, wait for SCM to discover it
		// In a real implementation, we might need to trigger Git initialization
		this.logService.warn('[CheckpointService] No Git repository found for workspace');
		return undefined;
	}

	/**
	 * Check if this is a new repository
	 */
	private async isNewRepository(): Promise<boolean> {
		if (!this._gitHelper) {
			return true;
		}

		// Check if repository has any commits
		try {
			const currentHash = await this.getCurrentCommitHash();
			return !currentHash;
		} catch {
			return true;
		}
	}

	/**
	 * Get current commit hash
	 */
	private async getCurrentCommitHash(): Promise<string | undefined> {
		if (!this._gitHelper) {
			return undefined;
		}

		try {
			// This would use the Git helper to get current HEAD
			// For now, return undefined as placeholder
			return undefined;
		} catch {
			return undefined;
		}
	}

	/**
	 * Load checkpoint history from storage
	 */
	private async loadCheckpointHistory(): Promise<void> {
		const stored = this.storageService.get(this.STORAGE_KEY, StorageScope.WORKSPACE);
		if (stored) {
			try {
				this._checkpoints = JSON.parse(stored);
				this.logService.info(`[CheckpointService] Loaded ${this._checkpoints.length} checkpoints from storage`);
			} catch (error) {
				this.logService.error('[CheckpointService] Failed to parse checkpoint history', error);
				this._checkpoints = [];
			}
		}
	}

	/**
	 * Save checkpoint history to storage
	 */
	private async saveCheckpointHistory(): Promise<void> {
		try {
			const data = JSON.stringify(this._checkpoints);
			this.storageService.store(this.STORAGE_KEY, data, StorageScope.WORKSPACE, StorageTarget.MACHINE);
			this.logService.trace('[CheckpointService] Saved checkpoint history');
		} catch (error) {
			this.logService.error('[CheckpointService] Failed to save checkpoint history', error);
		}
	}

	override dispose(): void {
		this.logService.info('[CheckpointService] Disposing service');
		super.dispose();
	}
}

// Register the service
registerSingleton(ICheckpointService, CheckpointService, InstantiationType.Delayed);
