/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as electron from 'electron';
import { memoize } from '../../../base/common/decorators.js';
import { Event } from '../../../base/common/event.js';
import { hash } from '../../../base/common/hash.js';
import { DisposableStore } from '../../../base/common/lifecycle.js';
import { CancellationToken } from '../../../base/common/cancellation.js';
import { IConfigurationService } from '../../configuration/common/configuration.js';
import { IEnvironmentMainService } from '../../environment/electron-main/environmentMainService.js';
import { ILifecycleMainService, IRelaunchHandler, IRelaunchOptions } from '../../lifecycle/electron-main/lifecycleMainService.js';
import { ILogService } from '../../log/common/log.js';
import { IProductService } from '../../product/common/productService.js';
import { IRequestService } from '../../request/common/request.js';
import { ITelemetryService } from '../../telemetry/common/telemetry.js';
import { IUpdate, State, StateType, UpdateType, AvailableForDownload } from '../common/update.js';
import { AbstractUpdateService, UpdateErrorClassification, UpdateNotAvailableClassification } from './abstractUpdateService.js';

export class DarwinUpdateService extends AbstractUpdateService implements IRelaunchHandler {

	private readonly disposables = new DisposableStore();

	@memoize private get onRawError(): Event<string> { return Event.fromNodeEventEmitter(electron.autoUpdater, 'error', (_, message) => message); }
	@memoize private get onRawUpdateNotAvailable(): Event<void> { return Event.fromNodeEventEmitter<void>(electron.autoUpdater, 'update-not-available'); }
	@memoize private get onRawUpdateAvailable(): Event<void> { return Event.fromNodeEventEmitter(electron.autoUpdater, 'update-available'); }
	@memoize private get onRawUpdateDownloaded(): Event<IUpdate> { return Event.fromNodeEventEmitter(electron.autoUpdater, 'update-downloaded', (_, releaseNotes, version, timestamp) => ({ version, productVersion: version, timestamp })); }

	constructor(
		@ILifecycleMainService lifecycleMainService: ILifecycleMainService,
		@IConfigurationService configurationService: IConfigurationService,
		@ITelemetryService private readonly telemetryService: ITelemetryService,
		@IEnvironmentMainService environmentMainService: IEnvironmentMainService,
		@IRequestService requestService: IRequestService,
		@ILogService logService: ILogService,
		@IProductService productService: IProductService
	) {
		super(lifecycleMainService, configurationService, environmentMainService, requestService, logService, productService);

		lifecycleMainService.setRelaunchHandler(this);
	}

	handleRelaunch(options?: IRelaunchOptions): boolean {
		if (options?.addArgs || options?.removeArgs) {
			return false; // we cannot apply an update and restart with different args
		}

		if (this.state.type !== StateType.Ready) {
			return false; // we only handle the relaunch when we have a pending update
		}

		this.logService.trace('update#handleRelaunch(): running raw#quitAndInstall()');
		this.doQuitAndInstall();

		return true;
	}

	protected override async initialize(): Promise<void> {
		await super.initialize();
		this.onRawError(this.onError, this, this.disposables);
		this.onRawUpdateAvailable(this.onUpdateAvailable, this, this.disposables);
		this.onRawUpdateDownloaded(this.onUpdateDownloaded, this, this.disposables);
		this.onRawUpdateNotAvailable(this.onUpdateNotAvailable, this, this.disposables);
	}

	private onError(err: string): void {
		this.telemetryService.publicLog2<{ messageHash: string }, UpdateErrorClassification>('update:error', { messageHash: String(hash(String(err))) });
		this.logService.error('UpdateService error:', err);

		// only show message when explicitly checking for updates
		const message = (this.state.type === StateType.CheckingForUpdates && this.state.explicit) ? err : undefined;
		this.setState(State.Idle(UpdateType.Archive, message));
	}

	protected buildUpdateFeedUrl(quality: string): string | undefined {
		this.logService.info('[DarwinUpdateService] buildUpdateFeedUrl called with quality:', quality);

		// 使用内网API进行更新检查
		const apiUrl = this.configurationService.getValue<string>('zhikai.auth.apiUrl');
		this.logService.info('[DarwinUpdateService] apiUrl from config:', apiUrl);

		if (!apiUrl) {
			this.logService.error('[DarwinUpdateService] zhikai.auth.apiUrl not configured');
			return undefined;
		}

		// 构建更新检查URL: http://apiUrl/knowledge/plugin/update-check?platform=mac&version=当前版本
		const currentVersion = this.productService.version || '0.0.0';
		const url = `${apiUrl}/knowledge/plugin/update-check?platform=mac&version=${currentVersion}`;

		this.logService.info('[DarwinUpdateService] Update feed URL built:', url);

		// 注意：我们不直接使用 electron.autoUpdater.setFeedURL
		// 而是通过自定义的HTTP请求来检查更新
		// electron.autoUpdater 将在下载阶段使用

		return url;
	}

	protected async doCheckForUpdates(context: any): Promise<void> {
		this.setState(State.CheckingForUpdates(context));

		if (!this.url) {
			return;
		}

		try {
			this.logService.info('Checking for updates:', this.url);

			// 调用内网API检查更新
			const response = await this.requestService.request({ url: this.url }, CancellationToken.None);

			if (response.res.statusCode === 200) {
				// 读取响应数据
				const chunks: Uint8Array[] = [];

				response.stream.on('data', (chunk) => {
					chunks.push(chunk.buffer);
				});

				response.stream.on('end', () => {
					try {
						// 合并所有数据块
						const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
						const result = new Uint8Array(totalLength);
						let offset = 0;
						for (const chunk of chunks) {
							result.set(chunk, offset);
							offset += chunk.length;
						}

						// 解析内网API的响应格式: R<UpdateCheckResponse>
						const responseText = new TextDecoder().decode(result);
						const data = JSON.parse(responseText);
						const updateInfo = data.data;

						if (!updateInfo || !updateInfo.version) {
							this.logService.info('No update available');
							this.onUpdateNotAvailable();
							return;
						}

						this.logService.info('Update available:', updateInfo.version);

						// 优先使用 filePath（OSS直接下载地址），fallback 到内网下载端点
						let downloadUrl: string;
						if (updateInfo.filePath) {
							// 使用 OSS 直接下载地址
							downloadUrl = updateInfo.filePath;
							this.logService.info('Using OSS direct download URL:', downloadUrl);
						} else if (updateInfo.url) {
							// fallback: 使用内网下载端点
							const apiUrl = this.configurationService.getValue<string>('zhikai.auth.apiUrl');
							downloadUrl = `${apiUrl}${updateInfo.url}`;
							this.logService.info('Using internal download endpoint:', downloadUrl);
						} else {
							this.logService.error('No download URL available');
							this.onUpdateNotAvailable();
							return;
						}

						// 构建 IUpdate 对象
						const update: IUpdate = {
							version: updateInfo.version,
							productVersion: updateInfo.productVersion || updateInfo.version,
							url: downloadUrl
						};

						// 简化模式：不自动下载，提示用户手动下载
						// 显示 "可下载" 状态，用户点击后打开浏览器下载
						this.setState(State.AvailableForDownload(update));
					} catch (e) {
						this.logService.error('Failed to parse update response', e);
						this.onError(String(e));
					}
				});
			} else {
				// 无更新
				this.logService.info('No update available (status code:', response.res.statusCode, ')');
				this.onUpdateNotAvailable();
			}
		} catch (error) {
			this.logService.error('Error checking for updates:', error);
			this.onError(String(error));
		}
	}

	private onUpdateAvailable(): void {
		if (this.state.type !== StateType.CheckingForUpdates) {
			return;
		}

		this.setState(State.Downloading);
	}

	private onUpdateDownloaded(update: IUpdate): void {
		if (this.state.type !== StateType.Downloading) {
			return;
		}

		this.setState(State.Downloaded(update));

		type UpdateDownloadedClassification = {
			owner: 'joaomoreno';
			version: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'The version number of the new VS Code that has been downloaded.' };
			comment: 'This is used to know how often VS Code has successfully downloaded the update.';
		};
		this.telemetryService.publicLog2<{ version: String }, UpdateDownloadedClassification>('update:downloaded', { version: update.version });

		this.setState(State.Ready(update));
	}

	private onUpdateNotAvailable(): void {
		if (this.state.type !== StateType.CheckingForUpdates) {
			return;
		}
		this.telemetryService.publicLog2<{ explicit: boolean }, UpdateNotAvailableClassification>('update:notAvailable', { explicit: this.state.explicit });

		this.setState(State.Idle(UpdateType.Archive));
	}

	protected override async doDownloadUpdate(state: AvailableForDownload): Promise<void> {
		// 打开浏览器下载更新
		if (state.update.url) {
			this.logService.info('Opening download URL in browser:', state.update.url);
			// 使用系统默认浏览器打开下载链接
			await electron.shell.openExternal(state.update.url);
		}
		// 下载后返回 Idle 状态
		this.setState(State.Idle(UpdateType.Archive));
	}

	protected override doQuitAndInstall(): void {
		this.logService.trace('update#quitAndInstall(): running raw#quitAndInstall()');
		electron.autoUpdater.quitAndInstall();
	}

	dispose(): void {
		this.disposables.dispose();
	}
}
