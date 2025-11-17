/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IAuthService } from '../common/authService.js';
import { LoginRequest } from '../common/authTypes.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { IDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { ILayoutService } from '../../../../platform/layout/browser/layoutService.js';
import { IContextViewService } from '../../../../platform/contextview/browser/contextView.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { ISecretStorageService } from '../../../../platform/secrets/common/secrets.js';
import { $, append } from '../../../../base/browser/dom.js';
import { LoginFormView, ILoginFormData } from './loginView.js';

/**
 * 登录对话框 - 使用完整表单界面
 */
export class LoginDialog extends Disposable {
	private overlay: HTMLElement | undefined;
	private dialogElement: HTMLElement | undefined;
	private formView: LoginFormView | undefined;
	private resolvePromise?: (success: boolean) => void;

	private static readonly PASSWORD_KEY = 'zhikai.auth.password';

	constructor(
		@IAuthService private readonly authService: IAuthService,
		@IDialogService private readonly dialogService: IDialogService,
		@ILayoutService private readonly layoutService: ILayoutService,
		@IContextViewService private readonly contextViewService: IContextViewService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@ISecretStorageService private readonly secretStorageService: ISecretStorageService
	) {
		super();
	}

	/**
	 * 显示登录对话框 - 使用完整表单
	 */
	async show(): Promise<boolean> {
		try {
			while (true) {
				// 创建并显示登录表单对话框
				const success = await this.showFormDialog();

				if (success === null) {
					// 用户取消，询问是否退出
					const shouldExit = await this.dialogService.confirm({
						message: '未完成登录',
						detail: '确定要退出 IDE 吗？',
						primaryButton: '退出',
						cancelButton: '返回登录'
					});

					if (shouldExit.confirmed) {
						window.close();
						return false;
					}
					continue; // 返回登录
				}

				if (!success) {
					continue; // 重试
				}

				return true;
			}
		} catch (error) {
			throw error;
		}
	}

	/**
	 * 显示表单对话框
	 * @returns true=登录成功, false=需要重试, null=用户取消
	 */
	private async showFormDialog(): Promise<boolean | null> {
		return new Promise<boolean | null>((resolve) => {
			try {
				this.resolvePromise = resolve;

				// 创建遮罩层
				this.overlay = $('.login-overlay');
				this.overlay.style.position = 'fixed';
				this.overlay.style.top = '0';
				this.overlay.style.left = '0';
				this.overlay.style.width = '100vw';
				this.overlay.style.height = '100vh';
				this.overlay.style.backgroundColor = 'rgba(0, 0, 0, 0.6)';
				this.overlay.style.backdropFilter = 'blur(4px)';
				this.overlay.style.display = 'flex';
				this.overlay.style.alignItems = 'center';
				this.overlay.style.justifyContent = 'center';
				this.overlay.style.zIndex = '999999';  // 非常高的 z-index
				this.overlay.style.opacity = '0';
				this.overlay.style.transition = 'opacity 0.2s ease-out';
				this.overlay.style.pointerEvents = 'auto';  // 确保可以接收点击事件

				// 创建对话框容器
				this.dialogElement = $('.login-dialog');
				this.dialogElement.style.backgroundColor = 'var(--vscode-editor-background)';
				this.dialogElement.style.border = '1px solid var(--vscode-widget-border)';
				this.dialogElement.style.boxShadow = '0 8px 32px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255, 255, 255, 0.05)';
				this.dialogElement.style.borderRadius = '8px';
				this.dialogElement.style.overflow = 'hidden';
				this.dialogElement.style.transform = 'scale(0.95) translateY(-20px)';
				this.dialogElement.style.transition = 'transform 0.25s ease-out, opacity 0.25s ease-out';
				this.dialogElement.style.opacity = '0';

				// 创建表单视图
				this.formView = new LoginFormView(this.dialogElement, this.contextViewService);

				// 处理表单提交
				this.formView.onSubmit(async (data: ILoginFormData) => {
					await this.handleLogin(data);
				});

				// 处理取消
				this.formView.onCancel(() => {
					this.closeDialog();
					resolve(null);
				});

				// 将对话框添加到遮罩层
				append(this.overlay, this.dialogElement);

				const container = this.layoutService.activeContainer;

				// 将遮罩层添加到页面
				append(container, this.overlay);

				// 触发动画
				requestAnimationFrame(() => {
					if (this.overlay) {
						this.overlay.style.opacity = '1';
					}
					if (this.dialogElement) {
						this.dialogElement.style.transform = 'scale(1) translateY(0)';
						this.dialogElement.style.opacity = '1';
					}
				});

				// 聚焦表单
				setTimeout(() => {
					if (this.formView) {
						this.formView.focus();
					}
				}, 300);

			} catch (error) {
				resolve(false);
			}
		});
	}

	/**
	 * 处理登录
	 */
	private async handleLogin(data: ILoginFormData): Promise<void> {
		// 保存 API 配置到服务
		this.authService.setConfig({
			apiUrl: data.apiUrl,
			timeout: 30000
		});

		// 尝试登录
		try {
			const request: LoginRequest = {
				username: data.username,
				password: data.password,
				rememberMe: data.rememberMe
			};

			await this.authService.login(request);

			// 登录成功后，将配置保存到 settings（持久化）
			await this.configurationService.updateValue('zhikai.auth.apiUrl', data.apiUrl);
			await this.configurationService.updateValue('zhikai.auth.username', data.username);

			// 密码保存到加密存储（Secret Storage）
			if (data.rememberMe) {
				await this.secretStorageService.set(LoginDialog.PASSWORD_KEY, data.password);
			} else {
				// 不记住密码，清除已保存的密码
				await this.secretStorageService.delete(LoginDialog.PASSWORD_KEY);
			}

			// 关闭对话框
			this.closeDialog();

			// 解析 Promise
			if (this.resolvePromise) {
				this.resolvePromise(true);
				this.resolvePromise = undefined;
			}
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : '登录失败';

			// 显示错误对话框
			await this.dialogService.error(
				'登录失败',
				errorMsg
			);

			// 不关闭登录对话框，让用户修改后重试
		}
	}

	/**
	 * 关闭对话框
	 */
	private closeDialog(): void {
		if (this.formView) {
			this.formView.dispose();
			this.formView = undefined;
		}
		if (this.overlay && this.overlay.parentNode) {
			this.overlay.parentNode.removeChild(this.overlay);
			this.overlay = undefined;
		}
		this.dialogElement = undefined;
	}

	override dispose(): void {
		this.closeDialog();
		super.dispose();
	}
}
