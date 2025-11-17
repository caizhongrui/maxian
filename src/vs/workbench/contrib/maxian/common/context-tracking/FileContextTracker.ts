/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Copied from Kilocode src/core/context-tracking/FileContextTracker.ts
// Adapted for tianhe-zhikai-ide: complete implementation with VSCode integration

import * as path from 'path';
import * as fs from 'fs/promises';
import * as vscode from 'vscode';
import { safeWriteJson, getTaskDirectoryPath } from '../utils/storage';
import { GlobalFileNames } from '../utils/globalFileNames';
import { fileExistsAtPath } from '../utils/fsUtils';
import type { FileMetadataEntry, RecordSource, TaskMetadata } from './FileContextTrackerTypes';

/**
 * Interface for accessing global storage
 */
export interface IStorageProvider {
	readonly globalStorageUri: vscode.Uri;
}

/**
 * This class is responsible for tracking file operations that may result in stale context.
 * If a user modifies a file outside of Maxian, the context may become stale and need to be updated.
 * We do not want Maxian to reload the context every time a file is modified, so we use this class merely
 * to inform Maxian that the change has occurred, and tell Maxian to reload the file before making
 * any changes to it. This fixes an issue with diff editing, where Maxian was unable to complete a diff edit.
 */
export class FileContextTracker {
	readonly taskId: string;
	private storageProviderRef: WeakRef<IStorageProvider>;

	// File tracking and watching
	private fileWatchers = new Map<string, vscode.FileSystemWatcher>();
	private recentlyModifiedFiles = new Set<string>();
	private recentlyEditedByMaxian = new Set<string>();
	private checkpointPossibleFiles = new Set<string>();

	constructor(storageProvider: IStorageProvider, taskId: string) {
		this.storageProviderRef = new WeakRef(storageProvider);
		this.taskId = taskId;
	}

	// Gets the current working directory or returns undefined if it cannot be determined
	private getCwd(): string | undefined {
		const cwd = vscode.workspace.workspaceFolders?.map((folder) => folder.uri.fsPath).at(0);
		if (!cwd) {
			console.info('No workspace folder available - cannot determine current working directory');
		}
		return cwd;
	}

	// File watchers are set up for each file that is tracked in the task metadata.
	async setupFileWatcher(filePath: string) {
		// Only setup watcher if it doesn't already exist for this file
		if (this.fileWatchers.has(filePath)) {
			return;
		}

		const cwd = this.getCwd();
		if (!cwd) {
			return;
		}

		// Create a file system watcher for this specific file
		const fileUri = vscode.Uri.file(path.resolve(cwd, filePath));
		const watcher = vscode.workspace.createFileSystemWatcher(
			new vscode.RelativePattern(path.dirname(fileUri.fsPath), path.basename(fileUri.fsPath)),
		);

		// Track file changes
		watcher.onDidChange(() => {
			if (this.recentlyEditedByMaxian.has(filePath)) {
				this.recentlyEditedByMaxian.delete(filePath); // This was an edit by Maxian, no need to inform Maxian
			} else {
				this.recentlyModifiedFiles.add(filePath); // This was a user edit, we will inform Maxian
				this.trackFileContext(filePath, 'user_edited'); // Update the task metadata with file tracking
			}
		});

		// Store the watcher so we can dispose it later
		this.fileWatchers.set(filePath, watcher);
	}

	// Tracks a file operation in metadata and sets up a watcher for the file
	// This is the main entry point for FileContextTracker and is called when a file is passed to Maxian via a tool, mention, or edit.
	async trackFileContext(filePath: string, operation: RecordSource) {
		try {
			const cwd = this.getCwd();
			if (!cwd) {
				return;
			}

			await this.addFileToFileContextTracker(this.taskId, filePath, operation);

			// Set up file watcher for this file
			await this.setupFileWatcher(filePath);
		} catch (error) {
			console.error('Failed to track file operation:', error);
		}
	}

	private getStorageProvider(): IStorageProvider | undefined {
		const provider = this.storageProviderRef.deref();
		if (!provider) {
			console.error('StorageProvider reference is no longer valid');
			return undefined;
		}
		return provider;
	}

	// Gets task metadata from storage
	async getTaskMetadata(taskId: string): Promise<TaskMetadata> {
		const storageProvider = this.getStorageProvider();
		if (!storageProvider) {
			return { files_in_context: [] };
		}

		const globalStoragePath = storageProvider.globalStorageUri.fsPath;
		const taskDir = await getTaskDirectoryPath(globalStoragePath, taskId);
		const filePath = path.join(taskDir, GlobalFileNames.taskMetadata);
		try {
			if (await fileExistsAtPath(filePath)) {
				return JSON.parse(await fs.readFile(filePath, 'utf8'));
			}
		} catch (error) {
			console.error('Failed to read task metadata:', error);
		}
		return { files_in_context: [] };
	}

	// Saves task metadata to storage
	async saveTaskMetadata(taskId: string, metadata: TaskMetadata) {
		try {
			const storageProvider = this.getStorageProvider();
			if (!storageProvider) {
				return;
			}

			const globalStoragePath = storageProvider.globalStorageUri.fsPath;
			const taskDir = await getTaskDirectoryPath(globalStoragePath, taskId);
			const filePath = path.join(taskDir, GlobalFileNames.taskMetadata);
			await safeWriteJson(filePath, metadata);
		} catch (error) {
			console.error('Failed to save task metadata:', error);
		}
	}

	// Adds a file to the metadata tracker
	// This handles the business logic of determining if the file is new, stale, or active.
	// It also updates the metadata with the latest read/edit dates.
	async addFileToFileContextTracker(taskId: string, filePath: string, source: RecordSource) {
		try {
			const metadata = await this.getTaskMetadata(taskId);
			const now = Date.now();

			// Mark existing entries for this file as stale
			metadata.files_in_context.forEach((entry) => {
				if (entry.path === filePath && entry.record_state === 'active') {
					entry.record_state = 'stale';
				}
			});

			// Helper to get the latest date for a specific field and file
			const getLatestDateForField = (path: string, field: keyof FileMetadataEntry): number | null => {
				const relevantEntries = metadata.files_in_context
					.filter((entry) => entry.path === path && entry[field])
					.sort((a, b) => (b[field] as number) - (a[field] as number));

				return relevantEntries.length > 0 ? (relevantEntries[0][field] as number) : null;
			};

			let newEntry: FileMetadataEntry = {
				path: filePath,
				record_state: 'active',
				record_source: source,
				roo_read_date: getLatestDateForField(filePath, 'roo_read_date'),
				roo_edit_date: getLatestDateForField(filePath, 'roo_edit_date'),
				user_edit_date: getLatestDateForField(filePath, 'user_edit_date'),
			};

			switch (source) {
				// user_edited: The user has edited the file
				case 'user_edited':
					newEntry.user_edit_date = now;
					this.recentlyModifiedFiles.add(filePath);
					break;

				// roo_edited: Maxian has edited the file
				case 'roo_edited':
					newEntry.roo_read_date = now;
					newEntry.roo_edit_date = now;
					this.checkpointPossibleFiles.add(filePath);
					this.markFileAsEditedByMaxian(filePath);
					break;

				// read_tool/file_mentioned: Maxian has read the file via a tool or file mention
				case 'read_tool':
				case 'file_mentioned':
					newEntry.roo_read_date = now;
					break;
			}

			metadata.files_in_context.push(newEntry);
			await this.saveTaskMetadata(taskId, metadata);
		} catch (error) {
			console.error('Failed to add file to metadata:', error);
		}
	}

	// Returns (and then clears) the set of recently modified files
	getAndClearRecentlyModifiedFiles(): string[] {
		const files = Array.from(this.recentlyModifiedFiles);
		this.recentlyModifiedFiles.clear();
		return files;
	}

	getAndClearCheckpointPossibleFile(): string[] {
		const files = Array.from(this.checkpointPossibleFiles);
		this.checkpointPossibleFiles.clear();
		return files;
	}

	// Marks a file as edited by Maxian to prevent false positives in file watchers
	markFileAsEditedByMaxian(filePath: string): void {
		this.recentlyEditedByMaxian.add(filePath);
	}

	// Track file read operation (convenience method)
	async trackFileRead(filePath: string, source: RecordSource = 'read_tool'): Promise<void> {
		await this.trackFileContext(filePath, source);
	}

	// Track file write operation (convenience method)
	async trackFileWrite(filePath: string, source: RecordSource = 'roo_edited'): Promise<void> {
		await this.trackFileContext(filePath, source);
	}

	// Get recently accessed files sorted by most recent
	async getRecentFiles(limit: number = 10): Promise<string[]> {
		try {
			const metadata = await this.getTaskMetadata(this.taskId);

			// Get all unique file paths sorted by most recent access
			const fileAccessMap = new Map<string, number>();

			metadata.files_in_context.forEach(entry => {
				const mostRecentDate = Math.max(
					entry.roo_read_date || 0,
					entry.roo_edit_date || 0,
					entry.user_edit_date || 0
				);

				const existingDate = fileAccessMap.get(entry.path) || 0;
				if (mostRecentDate > existingDate) {
					fileAccessMap.set(entry.path, mostRecentDate);
				}
			});

			// Sort by date and return top N
			return Array.from(fileAccessMap.entries())
				.sort((a, b) => b[1] - a[1])
				.slice(0, limit)
				.map(([filePath]) => filePath);
		} catch (error) {
			console.error('Failed to get recent files:', error);
			return [];
		}
	}

	// Disposes all file watchers
	dispose(): void {
		for (const watcher of this.fileWatchers.values()) {
			watcher.dispose();
		}
		this.fileWatchers.clear();
	}
}
