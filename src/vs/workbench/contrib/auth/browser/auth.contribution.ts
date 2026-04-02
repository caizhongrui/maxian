/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { IWorkbenchContribution, WorkbenchPhase, registerWorkbenchContribution2 } from '../../../common/contributions.js';
import { IAuthService } from '../common/authService.js';
import { AuthService } from './authService.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { LoginDialog } from './loginDialog.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { AuthStatus } from '../common/authTypes.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { registerAction2, Action2 } from '../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { Categories } from '../../../../platform/action/common/actionCommonCategories.js';
import { ISecretStorageService } from '../../../../platform/secrets/common/secrets.js';
import { IStatusbarService, StatusbarAlignment, IStatusbarEntryAccessor } from '../../../services/statusbar/browser/statusbar.js';
import { HeartbeatService } from './heartbeatService.js';
import { IUpdateService } from '../../../../platform/update/common/update.js';
import { createStructuredLogger } from '../../../common/structuredLogger.js';

// 注册认证服务
registerSingleton(IAuthService, AuthService, InstantiationType.Delayed);
const log = createStructuredLogger('AuthStartupContribution');

/**
 * 认证启动贡献
 */
class AuthStartupContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.authStartup';

	private loginDialog: LoginDialog | undefined;
	private userStatusBarEntry: IStatusbarEntryAccessor | undefined;
	private logoutStatusBarEntry: IStatusbarEntryAccessor | undefined;
	private heartbeatService: HeartbeatService;
	private static readonly PASSWORD_KEY = 'zhikai.auth.password';

	constructor(
		@IAuthService private readonly authService: IAuthService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@INotificationService _notificationService: INotificationService,
		@ISecretStorageService private readonly secretStorageService: ISecretStorageService,
		@IStatusbarService private readonly statusbarService: IStatusbarService,
		@IUpdateService private readonly updateService: IUpdateService
	) {
		super();

		// 创建心跳服务实例
		this.heartbeatService = this.instantiationService.createInstance(HeartbeatService);
		this._register(this.heartbeatService);
		log.debug('heartbeat_service_created');

		// IDE 启动时进行认证检查，延迟执行以确保 UI 已完全加载
		setTimeout(() => {
			log.debug('authentication_check_started');
			this.checkAuthentication();
		}, 1000); // 延迟 1 秒，确保 QuickInput UI 已准备好

		// 监听登录状态变化
		this._register(this.authService.onDidChangeStatus((status) => {
			log.debug('auth_status_changed', { status });
			if (status === AuthStatus.Unauthenticated) {
				// 隐藏状态栏项
				this.updateStatusBar();
				// 停止心跳
				this.heartbeatService.stopHeartbeat();
			}
		}));

		// 监听用户信息变化
		this._register(this.authService.onDidChangeUser((user) => {
			log.debug('auth_user_changed', { userName: user?.username ?? null });
			if (user) {
				// this.notificationService.info(`欢迎回来，${user.displayName || user.username}！`);
				// 显示状态栏项
				this.updateStatusBar();
				// 用户登录成功，启动心跳
				log.debug('start_heartbeat_for_user', { userName: user.username });
				this.heartbeatService.startHeartbeat();
				// 登录成功后检查更新（延迟2秒确保UpdateService已初始化）
				log.debug('schedule_update_check_after_login');
				setTimeout(() => {
					log.debug('check_for_updates_called', { state: String(this.updateService.state) });
					this.updateService.checkForUpdates(false).then(() => {
						log.debug('check_for_updates_completed');
					}).catch((err) => {
						log.error('check_for_updates_failed', { error: String(err) });
					});
				}, 2000);
			} else {
				// 用户退出登录
				this.updateStatusBar();
				// 停止心跳
				this.heartbeatService.stopHeartbeat();
			}
		}));
	}

	/**
	 * 更新状态栏显示
	 */
	private updateStatusBar(): void {
		// 先移除旧的状态栏项
		if (this.userStatusBarEntry) {
			this.userStatusBarEntry.dispose();
			this.userStatusBarEntry = undefined;
		}
		if (this.logoutStatusBarEntry) {
			this.logoutStatusBarEntry.dispose();
			this.logoutStatusBarEntry = undefined;
		}

		const user = this.authService.currentUser;
		if (user) {
			// 显示当前用户（不可点击）
			this.userStatusBarEntry = this.statusbarService.addEntry({
				name: '当前用户',
				text: `$(account) ${user.displayName || user.username}`,
				tooltip: `当前登录用户: ${user.displayName || user.username}`,
				ariaLabel: `当前用户: ${user.displayName || user.username}`
			}, 'zhikai.auth.user', StatusbarAlignment.RIGHT, 101);

			// 显示退出按钮（可点击）
			this.logoutStatusBarEntry = this.statusbarService.addEntry({
				name: '退出登录',
				text: '$(sign-out)',
				tooltip: '退出登录',
				command: 'zhikai.logout',
				ariaLabel: '退出登录'
			}, 'zhikai.auth.logout', StatusbarAlignment.RIGHT, 100);
		}
	}

	/**
	 * 检查认证状态
	 */
	private async checkAuthentication(): Promise<void> {
		// 先从配置读取 API URL
		const apiUrl = this.configurationService.getValue<string>('zhikai.auth.apiUrl');
		if (apiUrl) {
			this.authService.setConfig({
				apiUrl,
				timeout: 30000
			});
		}

		// 1. 首先尝试使用存储的凭据自动登录（包括 token 和密码）
		// authService.autoLogin() 会从 StorageService 读取凭据
		const autoLoginSuccess = await this.authService.autoLogin();
		if (autoLoginSuccess) {
			log.debug('auto_login_success');
			// 清理旧的 SecretStorage 中的密码（向后兼容迁移）
			await this.secretStorageService.delete(AuthStartupContribution.PASSWORD_KEY);
			return;
		}

		// 2. 向后兼容：尝试从旧的 SecretStorage 读取密码（用于数据迁移）
		const username = this.configurationService.getValue<string>('zhikai.auth.username');
		const legacyPassword = await this.secretStorageService.get(AuthStartupContribution.PASSWORD_KEY);

		if (apiUrl && username && legacyPassword) {
			log.debug('legacy_password_migration_started');
			try {
				// 使用旧密码登录，登录成功后会自动保存到新位置（StorageService）
				await this.authService.login({
					username,
					password: legacyPassword,
					rememberMe: true
				});
				log.debug('legacy_password_migration_success');
				// 清理旧的 SecretStorage
				await this.secretStorageService.delete(AuthStartupContribution.PASSWORD_KEY);
				return;
			} catch (error) {
				log.warn('legacy_password_migration_failed', { error: String(error) });
				await this.secretStorageService.delete(AuthStartupContribution.PASSWORD_KEY);
			}
		}

		// 3. 没有任何保存的凭据，显示登录对话框
		await this.showLoginDialog();
	}

	/**
	 * 显示登录对话框
	 */
	private async showLoginDialog(): Promise<void> {
		if (this.loginDialog) {
			return; // 已经在显示登录对话框
		}

		this.loginDialog = this.instantiationService.createInstance(LoginDialog);

		try {
			const success = await this.loginDialog.show();

			if (!success) {
				// 用户选择退出
			}
		} catch (error) {
		} finally {
			this.loginDialog.dispose();
			this.loginDialog = undefined;
		}
	}
}

/**
 * 注册启动时的认证检查
 */
registerWorkbenchContribution2(
	AuthStartupContribution.ID,
	AuthStartupContribution,
	WorkbenchPhase.BlockRestore // 在恢复工作区之前执行
);

/**
 * 退出登录命令
 */
class LogoutAction extends Action2 {
	constructor() {
		super({
			id: 'zhikai.logout',
			title: { value: '退出登录', original: 'Logout' },
			category: Categories.View,
			f1: true
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const authService = accessor.get(IAuthService);
		const notificationService = accessor.get(INotificationService);
		const dialogService = accessor.get(IDialogService);
		const instantiationService = accessor.get(IInstantiationService);
		const configurationService = accessor.get(IConfigurationService);
		const secretStorageService = accessor.get(ISecretStorageService);

		// 显示确认对话框
		const result = await dialogService.confirm({
			message: '确定要退出登录吗？',
			detail: '退出后需要重新登录才能使用 IDE',
			primaryButton: '退出登录',
			cancelButton: '取消'
		});

		if (!result.confirmed) {
			return;
		}

		try {
			await authService.logout();

			// 清除配置文件中的用户名
			await configurationService.updateValue('zhikai.auth.username', '');

			// 清除加密存储中的密码
			await secretStorageService.delete('zhikai.auth.password');

			notificationService.info('已退出登录');

			// 显示登录对话框
			const loginDialog = instantiationService.createInstance(LoginDialog);
			await loginDialog.show();
			loginDialog.dispose();
		} catch (error) {
			notificationService.error('退出登录失败：' + (error instanceof Error ? error.message : '未知错误'));
		}
	}
}

registerAction2(LogoutAction);
