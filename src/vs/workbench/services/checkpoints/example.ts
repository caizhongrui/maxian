/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Checkpoint Service 使用示例
 *
 * 这个文件展示了如何在VS Code扩展或服务中使用Checkpoint服务
 */

import { URI } from '../../../base/common/uri.js';
import { ICheckpointService, ICheckpointEvent } from './common/checkpoints.js';

/**
 * 示例1: 基本的检查点管理器
 */
export class BasicCheckpointManager {
	constructor(
		private readonly checkpointService: ICheckpointService
	) {}

	/**
	 * 初始化并创建第一个检查点
	 */
	async setup(workspaceUri: URI, storageUri: URI): Promise<void> {
		console.log('Setting up checkpoint service...');

		// 1. 初始化服务
		const result = await this.checkpointService.initialize({
			workspaceUri,
			storageUri,
			taskId: 'example-task'
		});

		console.log(`Initialized: ${result.created ? 'new' : 'existing'} (${result.duration}ms)`);

		// 2. 创建初始检查点
		const checkpoint = await this.checkpointService.saveCheckpoint('Initial checkpoint');
		if (checkpoint) {
			console.log(`Created checkpoint: ${checkpoint.commit}`);
		}
	}

	/**
	 * 工作流示例：编辑-保存-查看
	 */
	async workflowExample(): Promise<void> {
		// 1. 做一些改动后保存检查点
		const cp1 = await this.checkpointService.saveCheckpoint('Added feature A');
		console.log('Checkpoint 1:', cp1?.commit);

		// 2. 继续工作，保存另一个检查点
		const cp2 = await this.checkpointService.saveCheckpoint('Fixed bug B');
		console.log('Checkpoint 2:', cp2?.commit);

		// 3. 查看所有检查点
		const checkpoints = this.checkpointService.getCheckpoints();
		console.log(`Total checkpoints: ${checkpoints.length}`);
		checkpoints.forEach((cp, index) => {
			console.log(`[${index}] ${cp.hash}: ${cp.message}`);
		});

		// 4. 如果需要回退，恢复到第一个检查点
		if (cp1) {
			await this.checkpointService.restoreCheckpoint(cp1.commit);
			console.log('Restored to checkpoint 1');
		}
	}

	/**
	 * 查看变更差异
	 */
	async viewDifferences(fromHash: string, toHash?: string): Promise<void> {
		const diffs = await this.checkpointService.getDiff({
			from: fromHash,
			to: toHash
		});

		console.log(`Found ${diffs.length} changed files:`);
		diffs.forEach(diff => {
			console.log(`\nFile: ${diff.paths.relative}`);
			console.log('---Before---');
			console.log(diff.content.before.substring(0, 100) + '...');
			console.log('---After---');
			console.log(diff.content.after.substring(0, 100) + '...');
		});
	}
}

/**
 * 示例2: 带事件监听的检查点管理器
 */
export class EventDrivenCheckpointManager {
	constructor(
		private readonly checkpointService: ICheckpointService
	) {
		this.registerEventListeners();
	}

	private registerEventListeners(): void {
		this.checkpointService.onDidChangeCheckpoint((event: ICheckpointEvent) => {
			this.handleCheckpointEvent(event);
		});
	}

	private handleCheckpointEvent(event: ICheckpointEvent): void {
		switch (event.type) {
			case 'initialize':
				console.log(`✓ Initialized for workspace: ${event.workspaceUri?.toString()}`);
				console.log(`  Duration: ${event.duration}ms`);
				break;

			case 'checkpoint':
				console.log(`✓ Checkpoint created: ${event.commitHash}`);
				console.log(`  Duration: ${event.duration}ms`);
				this.onCheckpointCreated(event);
				break;

			case 'restore':
				console.log(`✓ Restored to: ${event.commitHash}`);
				console.log(`  Duration: ${event.duration}ms`);
				this.onCheckpointRestored(event);
				break;

			case 'error':
				console.error(`✗ Error occurred:`, event.error);
				this.onError(event);
				break;
		}
	}

	private onCheckpointCreated(event: ICheckpointEvent): void {
		// 自定义逻辑：检查点创建后的处理
		// 例如：通知用户、更新UI、发送遥测等
	}

	private onCheckpointRestored(event: ICheckpointEvent): void {
		// 自定义逻辑：检查点恢复后的处理
		// 例如：重新加载文件、刷新编辑器等
	}

	private onError(event: ICheckpointEvent): void {
		// 自定义逻辑：错误处理
		// 例如：显示错误消息、记录日志、重试等
	}
}

/**
 * 示例3: 自动保存检查点
 */
export class AutoCheckpointService {
	private autoSaveTimer: NodeJS.Timeout | undefined;
	private checkpointCount = 0;

	constructor(
		private readonly checkpointService: ICheckpointService
	) {}

	/**
	 * 启动自动保存（每5分钟）
	 */
	startAutoSave(intervalMs: number = 5 * 60 * 1000): void {
		console.log(`Starting auto-save with interval: ${intervalMs}ms`);

		this.autoSaveTimer = setInterval(async () => {
			await this.performAutoSave();
		}, intervalMs);
	}

	/**
	 * 停止自动保存
	 */
	stopAutoSave(): void {
		if (this.autoSaveTimer) {
			clearInterval(this.autoSaveTimer);
			this.autoSaveTimer = undefined;
			console.log('Auto-save stopped');
		}
	}

	private async performAutoSave(): Promise<void> {
		try {
			const message = `Auto-save checkpoint #${++this.checkpointCount} at ${new Date().toISOString()}`;

			const result = await this.checkpointService.saveCheckpoint(message, {
				allowEmpty: false,  // 不保存空提交
				suppressMessage: true  // 不显示消息提示
			});

			if (result) {
				console.log(`Auto-saved: ${result.commit}`);
			} else {
				console.log('No changes to auto-save');
			}
		} catch (error) {
			console.error('Auto-save failed:', error);
		}
	}

	/**
	 * 清理旧的自动保存检查点（保留最近N个）
	 */
	async cleanupOldAutoSaves(keepRecent: number = 10): Promise<void> {
		const checkpoints = this.checkpointService.getCheckpoints();
		const autoSaves = checkpoints.filter(cp => cp.message.startsWith('Auto-save'));

		if (autoSaves.length > keepRecent) {
			console.log(`Cleaning up ${autoSaves.length - keepRecent} old auto-saves`);
			// 注意：当前API不支持删除单个检查点
			// 这需要扩展API或使用更底层的Git操作
		}
	}
}

/**
 * 示例4: 检查点比较工具
 */
export class CheckpointComparator {
	constructor(
		private readonly checkpointService: ICheckpointService
	) {}

	/**
	 * 比较两个检查点并生成报告
	 */
	async compareCheckpoints(hash1: string, hash2: string): Promise<void> {
		console.log(`Comparing ${hash1} with ${hash2}`);

		const diffs = await this.checkpointService.getDiff({
			from: hash1,
			to: hash2
		});

		const report = {
			totalFiles: diffs.length,
			addedFiles: 0,
			modifiedFiles: 0,
			deletedFiles: 0,
			files: diffs.map(diff => ({
				path: diff.paths.relative,
				beforeSize: diff.content.before.length,
				afterSize: diff.content.after.length,
				change: this.getChangeType(diff)
			}))
		};

		// 统计文件变更类型
		report.files.forEach(file => {
			if (file.change === 'added') report.addedFiles++;
			else if (file.change === 'modified') report.modifiedFiles++;
			else if (file.change === 'deleted') report.deletedFiles++;
		});

		console.log('Comparison Report:');
		console.log(`  Total files changed: ${report.totalFiles}`);
		console.log(`  Added: ${report.addedFiles}`);
		console.log(`  Modified: ${report.modifiedFiles}`);
		console.log(`  Deleted: ${report.deletedFiles}`);
		console.log('\nDetails:');
		report.files.forEach(file => {
			console.log(`  [${file.change.toUpperCase()}] ${file.path} (${file.beforeSize} → ${file.afterSize} bytes)`);
		});
	}

	private getChangeType(diff: any): 'added' | 'modified' | 'deleted' {
		if (diff.content.before === '' && diff.content.after !== '') {
			return 'added';
		} else if (diff.content.before !== '' && diff.content.after === '') {
			return 'deleted';
		} else {
			return 'modified';
		}
	}

	/**
	 * 找出特定文件的所有历史版本
	 */
	async getFileHistory(filePath: string): Promise<void> {
		const checkpoints = this.checkpointService.getCheckpoints();

		console.log(`History of ${filePath}:`);

		for (let i = 0; i < checkpoints.length - 1; i++) {
			const from = checkpoints[i];
			const to = checkpoints[i + 1];

			const diffs = await this.checkpointService.getDiff({
				from: from.hash,
				to: to.hash
			});

			const fileDiff = diffs.find(d => d.paths.relative === filePath);
			if (fileDiff) {
				console.log(`  ${new Date(to.timestamp).toISOString()}: ${to.message}`);
				console.log(`    ${fileDiff.content.before.length} → ${fileDiff.content.after.length} bytes`);
			}
		}
	}
}

/**
 * 示例5: 完整的应用场景
 */
export class TaskCheckpointManager {
	private isInitialized = false;

	constructor(
		private readonly checkpointService: ICheckpointService,
		private readonly taskId: string
	) {}

	/**
	 * 初始化任务的检查点系统
	 */
	async initializeForTask(workspaceUri: URI, storageUri: URI): Promise<void> {
		console.log(`Initializing checkpoints for task: ${this.taskId}`);

		// 初始化服务
		await this.checkpointService.initialize({
			workspaceUri,
			storageUri,
			taskId: this.taskId
		});

		// 创建任务开始的检查点
		await this.checkpointService.saveCheckpoint(`Task ${this.taskId} started`);

		this.isInitialized = true;
		console.log('Task checkpoint system ready');
	}

	/**
	 * 在任务的关键步骤保存检查点
	 */
	async saveCheckpointAtStep(stepName: string, description?: string): Promise<void> {
		if (!this.isInitialized) {
			throw new Error('Checkpoint system not initialized');
		}

		const message = description
			? `[${this.taskId}] ${stepName}: ${description}`
			: `[${this.taskId}] ${stepName}`;

		const result = await this.checkpointService.saveCheckpoint(message);

		if (result) {
			console.log(`Checkpoint saved at step: ${stepName}`);
		}
	}

	/**
	 * 任务完成时的清理
	 */
	async finalizeTask(): Promise<void> {
		// 保存最终检查点
		await this.checkpointService.saveCheckpoint(`Task ${this.taskId} completed`);

		// 生成任务报告
		const checkpoints = this.checkpointService.getCheckpoints();
		console.log(`\nTask ${this.taskId} Summary:`);
		console.log(`Total checkpoints: ${checkpoints.length}`);
		checkpoints.forEach((cp, idx) => {
			console.log(`  ${idx + 1}. ${cp.message} (${new Date(cp.timestamp).toLocaleString()})`);
		});
	}

	/**
	 * 回退任务到特定步骤
	 */
	async rollbackToStep(stepName: string): Promise<void> {
		const checkpoints = this.checkpointService.getCheckpoints();
		const checkpoint = checkpoints.find(cp => cp.message.includes(stepName));

		if (checkpoint) {
			await this.checkpointService.restoreCheckpoint(checkpoint.hash);
			console.log(`Rolled back to step: ${stepName}`);
		} else {
			console.warn(`No checkpoint found for step: ${stepName}`);
		}
	}
}

// 导出所有示例类
export const CheckpointExamples = {
	BasicCheckpointManager,
	EventDrivenCheckpointManager,
	AutoCheckpointService,
	CheckpointComparator,
	TaskCheckpointManager
};
