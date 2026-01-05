/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../base/common/cancellation.js';
import { hash } from '../../../base/common/hash.js';
import { IConfigurationService } from '../../configuration/common/configuration.js';
import { IEnvironmentMainService } from '../../environment/electron-main/environmentMainService.js';
import { ILifecycleMainService, IRelaunchHandler, IRelaunchOptions } from '../../lifecycle/electron-main/lifecycleMainService.js';
import { ILogService } from '../../log/common/log.js';
import { INativeHostMainService } from '../../native/electron-main/nativeHostMainService.js';
import { IProductService } from '../../product/common/productService.js';
import { asJson, IRequestService } from '../../request/common/request.js';
import { ITelemetryService } from '../../telemetry/common/telemetry.js';
import { AvailableForDownload, DisablementReason, IUpdate, State, StateType, UpdateType } from '../common/update.js';
import { AbstractUpdateService, UpdateErrorClassification, UpdateNotAvailableClassification } from './abstractUpdateService.js';

function getUpdateType(): UpdateType {
	return UpdateType.Archive;
}

export class Win32UpdateService extends AbstractUpdateService implements IRelaunchHandler {

	constructor(
		@ILifecycleMainService lifecycleMainService: ILifecycleMainService,
		@IConfigurationService configurationService: IConfigurationService,
		@ITelemetryService private readonly telemetryService: ITelemetryService,
		@IEnvironmentMainService environmentMainService: IEnvironmentMainService,
		@IRequestService requestService: IRequestService,
		@ILogService logService: ILogService,
		@INativeHostMainService private readonly nativeHostMainService: INativeHostMainService,
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
		if (this.productService.target === 'user' && await this.nativeHostMainService.isAdmin(undefined)) {
			this.setState(State.Disabled(DisablementReason.RunningAsAdmin));
			this.logService.info('update#ctor - updates are disabled due to running as Admin in user setup');
			return;
		}

		await super.initialize();
	}

	protected buildUpdateFeedUrl(quality: string): string | undefined {
		// 使用内网API进行更新检查
		const apiUrl = this.configurationService.getValue<string>('zhikai.auth.apiUrl');
		if (!apiUrl) {
			this.logService.error('zhikai.auth.apiUrl not configured');
			return undefined;
		}

		// 构建更新检查URL: http://apiUrl/knowledge/plugin/update-check?platform=windows&version=当前版本
		const currentVersion = this.productService.version || '0.0.0';
		const url = `${apiUrl}/knowledge/plugin/update-check?platform=windows&version=${currentVersion}`;

		this.logService.info('Update feed URL:', url);
		return url;
	}

	protected doCheckForUpdates(context: any): void {
		if (!this.url) {
			return;
		}

		this.setState(State.CheckingForUpdates(context));

		this.requestService.request({ url: this.url }, CancellationToken.None)
			.then<IUpdate | null>(asJson)
			.then((response: any) => {
				const updateType = getUpdateType();

				// 解析内网API的响应格式: R<UpdateCheckResponse>
				// response.data 包含 UpdateCheckResponse 对象
				const updateInfo = response?.data;

				if (!updateInfo || (!updateInfo.url && !updateInfo.filePath) || !updateInfo.version) {
					this.logService.info('No update available');
					this.telemetryService.publicLog2<{ explicit: boolean }, UpdateNotAvailableClassification>('update:notAvailable', { explicit: !!context });
					this.setState(State.Idle(updateType));
					return Promise.resolve(null);
				}

				this.logService.info('Update available:', updateInfo.version);

				// 优先使用 filePath（OSS直接下载地址），fallback 到内网下载端点
				const apiUrl = this.configurationService.getValue<string>('zhikai.auth.apiUrl');
				let downloadUrl: string;
				if (updateInfo.filePath) {
					// OSS 直接下载地址（完整 URL）
					downloadUrl = updateInfo.filePath;
					this.logService.info('Using OSS download URL (filePath)');
				} else if (updateInfo.url) {
					// 内网相对路径，需要拼接 apiUrl
					downloadUrl = `${apiUrl}${updateInfo.url}`;
					this.logService.info('Using internal download URL (url)');
				} else {
					downloadUrl = '';
				}

				// 构建IUpdate对象
				const update: IUpdate = {
					version: updateInfo.version,
					productVersion: updateInfo.productVersion || updateInfo.version,
					url: downloadUrl,
					sha256hash: updateInfo.sha256,
					timestamp: updateInfo.timestamp
				};

				this.logService.info('Download URL:', downloadUrl);

				// 简化模式：不自动下载，提示用户手动下载
				// 显示 "可下载" 状态，用户点击后打开浏览器下载
				this.setState(State.AvailableForDownload(update));
				return Promise.resolve(null);
			})
			.then(undefined, err => {
				this.telemetryService.publicLog2<{ messageHash: string }, UpdateErrorClassification>('update:error', { messageHash: String(hash(String(err))) });
				this.logService.error('Update check error:', err);

				// only show message when explicitly checking for updates
				const message: string | undefined = !!context ? (err.message || err) : undefined;
				this.setState(State.Idle(getUpdateType(), message));
			});
	}

	protected override async doDownloadUpdate(state: AvailableForDownload): Promise<void> {
		// 打开浏览器下载更新
		if (state.update.url) {
			this.logService.info('Opening download URL in browser:', state.update.url);
			await this.nativeHostMainService.openExternal(undefined, state.update.url);
		}
		// 下载后返回 Idle 状态
		this.setState(State.Idle(getUpdateType()));
	}

	protected override getUpdateType(): UpdateType {
		return getUpdateType();
	}
}
