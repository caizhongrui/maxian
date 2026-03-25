/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * 语义搜索索引状态栏
 * - 实时显示向量索引进度
 * - 切换项目时自动触发新项目索引
 */

import { Disposable, MutableDisposable } from '../../../../base/common/lifecycle.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { IStatusbarEntry, IStatusbarEntryAccessor, IStatusbarService, StatusbarAlignment } from '../../../services/statusbar/browser/statusbar.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IVectorSearchService, IIndexStats } from '../common/vector/IVectorSearchService.js';

const STATUS_BAR_ID = 'status.maxian.vectorSearch';
const POLL_INTERVAL_INDEXING = 1500;  // 索引中：每 1.5 秒刷新
const POLL_INTERVAL_IDLE = 30_000;   // 空闲：每 30 秒刷新（检测过期重建）

export class VectorSearchStatusBarContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.maxian.vectorSearchStatusBar';

	private readonly _entry = this._register(new MutableDisposable<IStatusbarEntryAccessor>());
	private _pollHandle: ReturnType<typeof setInterval> | undefined;
	private _currentCwd: string | undefined;
	private _isIndexing = false;

	constructor(
		@IStatusbarService private readonly _statusBarService: IStatusbarService,
		@IVectorSearchService private readonly _vectorSearchService: IVectorSearchService,
		@IWorkspaceContextService private readonly _workspaceService: IWorkspaceContextService,
	) {
		super();

		// 监听工作区文件夹变更（用户切换项目）
		this._register(this._workspaceService.onDidChangeWorkspaceFolders(() => {
			const newCwd = this._getCwd();
			if (newCwd && newCwd !== this._currentCwd) {
				this._onWorkspaceChanged(newCwd);
			}
		}));

		// 初始启动
		const cwd = this._getCwd();
		if (cwd) {
			this._currentCwd = cwd;
			this._startPolling(cwd, true);
		}
	}

	private _getCwd(): string | undefined {
		const folders = this._workspaceService.getWorkspace().folders;
		return folders[0]?.uri.fsPath;
	}

	/** 工作区切换时：更新 CWD，触发新项目索引，重启轮询 */
	private _onWorkspaceChanged(newCwd: string): void {
		this._currentCwd = newCwd;
		this._isIndexing = false;

		// 立即触发新项目的索引（不等待 codebase_search 调用）
		this._vectorSearchService.triggerIndexing(newCwd).catch(() => { /* ignore */ });

		// 重启轮询（快速频率，因为索引刚开始）
		this._startPolling(newCwd, false);
	}

	private _startPolling(cwd: string, triggerIndexing: boolean): void {
		if (this._pollHandle) {
			clearInterval(this._pollHandle);
			this._pollHandle = undefined;
		}

		// 立即触发一次索引（首次打开项目时）
		if (triggerIndexing) {
			this._vectorSearchService.triggerIndexing(cwd).catch(() => { /* ignore */ });
		}

		// 立即更新状态
		this._poll(cwd);

		// 开始定时轮询（初始用快速间隔）
		this._schedulePoll(cwd, POLL_INTERVAL_INDEXING);
	}

	private _schedulePoll(cwd: string, interval: number): void {
		if (this._pollHandle) {
			clearInterval(this._pollHandle);
		}
		this._pollHandle = setInterval(() => this._poll(cwd), interval);
		this._register({ dispose: () => { if (this._pollHandle) { clearInterval(this._pollHandle); } } });
	}

	private async _poll(cwd: string): Promise<void> {
		// 如果 CWD 已更换，跳过旧轮询
		if (cwd !== this._currentCwd) {
			return;
		}
		try {
			const stats = await this._vectorSearchService.getIndexStats(cwd);
			this._updateStatusBar(stats);

			// 状态变化时调整轮询频率
			const wasIndexing = this._isIndexing;
			this._isIndexing = stats.isIndexing;
			if (wasIndexing && !stats.isIndexing) {
				// 索引刚完成 → 切换到慢轮询
				this._schedulePoll(cwd, POLL_INTERVAL_IDLE);
			} else if (!wasIndexing && stats.isIndexing) {
				// 索引刚开始 → 切换到快轮询
				this._schedulePoll(cwd, POLL_INTERVAL_INDEXING);
			}
		} catch {
			// IPC 失败时不更新状态栏
		}
	}

	private _updateStatusBar(stats: IIndexStats): void {
		if (!stats.modelReady && stats.itemCount === 0 && !stats.isIndexing) {
			// 嵌入模型还在加载
			this._setEntry({
				text: '$(loading~spin) 语义搜索',
				ariaLabel: '语义搜索模型加载中',
				tooltip: '正在加载语义搜索嵌入模型，首次启动需要几秒钟...',
			});
			return;
		}

		if (stats.isIndexing) {
			const progressText = stats.total > 0 ? ` ${stats.indexed}/${stats.total}` : '';
			this._setEntry({
				text: `$(loading~spin) 向量索引${progressText}`,
				ariaLabel: `语义搜索建立索引中 ${stats.indexed}/${stats.total}`,
				tooltip: [
					'正在建立代码库语义索引...',
					stats.total > 0 ? `进度：${stats.indexed} / ${stats.total} 个文件` : '',
					'',
					'索引完成后 codebase_search 将使用语义向量搜索',
				].filter(Boolean).join('\n'),
			});
			return;
		}

		if (stats.modelReady && stats.itemCount > 0) {
			this._setEntry({
				text: '$(database) 语义搜索就绪',
				ariaLabel: '语义搜索已就绪',
				tooltip: `代码语义索引已就绪\n已索引 ${stats.itemCount} 个代码片段`,
			});
			return;
		}

		// 模型就绪但尚未建立索引（刚切换到新项目，索引触发中）
		if (stats.modelReady) {
			this._setEntry({
				text: '$(loading~spin) 语义搜索',
				ariaLabel: '语义搜索准备中',
				tooltip: '正在准备代码语义索引...',
			});
			return;
		}

		this._clearEntry();
	}

	private _setEntry(props: { text: string; ariaLabel: string; tooltip: string }): void {
		const entry: IStatusbarEntry = {
			name: '语义搜索',
			text: props.text,
			ariaLabel: props.ariaLabel,
			tooltip: props.tooltip,
		};
		if (!this._entry.value) {
			this._entry.value = this._statusBarService.addEntry(
				entry,
				STATUS_BAR_ID,
				StatusbarAlignment.RIGHT,
				100,
			);
		} else {
			this._entry.value.update(entry);
		}
	}

	private _clearEntry(): void {
		this._entry.clear();
	}

	override dispose(): void {
		if (this._pollHandle) {
			clearInterval(this._pollHandle);
		}
		super.dispose();
	}
}
