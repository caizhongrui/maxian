/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { $, append } from '../../../../base/browser/dom.js';
import { Button } from '../../../../base/browser/ui/button/button.js';
import { InputBox } from '../../../../base/browser/ui/inputbox/inputBox.js';
import { Checkbox } from '../../../../base/browser/ui/toggle/toggle.js';
import { IContextViewService } from '../../../../platform/contextview/browser/contextView.js';
import { defaultButtonStyles, defaultInputBoxStyles, defaultCheckboxStyles } from '../../../../platform/theme/browser/defaultStyles.js';

export interface ILoginFormData {
	apiUrl: string;
	username: string;
	password: string;
	rememberMe: boolean;
}

/**
 * 登录表单视图
 */
export class LoginFormView extends Disposable {
	private container: HTMLElement;
	private apiUrlInput!: InputBox;
	private usernameInput!: InputBox;
	private passwordInput!: InputBox;
	private rememberMeCheckbox!: Checkbox;
	private loginButton!: Button;
	private cancelButton!: Button;

	private onSubmitCallback?: (data: ILoginFormData) => void;
	private onCancelCallback?: () => void;

	constructor(
		container: HTMLElement,
		@IContextViewService private readonly contextViewService: IContextViewService
	) {
		super();
		this.container = container;
		this.render();
	}

	private render(): void {
		this.container.style.padding = '0';
		this.container.style.minWidth = '480px';
		this.container.style.maxWidth = '480px';
		this.container.style.borderRadius = '8px';
		this.container.style.overflow = 'hidden';

		// 顶部装饰条
		const headerDecor = append(this.container, $('div.login-header-decor'));
		headerDecor.style.height = '4px';
		headerDecor.style.background = 'linear-gradient(90deg, #007ACC, #00BCF2, #00D4FF)';

		// 头部区域
		const header = append(this.container, $('div.login-header'));
		header.style.padding = '32px 40px 24px';
		header.style.textAlign = 'center';
		header.style.background = 'var(--vscode-editor-background)';

		// Logo/图标
		const icon = append(header, $('div.login-icon'));
		icon.textContent = '🔐';
		icon.style.fontSize = '48px';
		icon.style.marginBottom = '16px';
		icon.style.opacity = '0.9';

		// 标题
		const title = append(header, $('h2'));
		title.textContent = '欢迎使用码弦 IDE';
		title.style.margin = '0';
		title.style.fontSize = '24px';
		title.style.fontWeight = '600';
		title.style.color = 'var(--vscode-foreground)';
		title.style.marginBottom = '8px';

		// 副标题
		const subtitle = append(header, $('p.login-subtitle'));
		subtitle.textContent = '请登录以继续';
		subtitle.style.margin = '0';
		subtitle.style.fontSize = '14px';
		subtitle.style.color = 'var(--vscode-descriptionForeground)';
		subtitle.style.opacity = '0.8';

		// 表单容器
		const formContainer = append(this.container, $('div.login-form'));
		formContainer.style.padding = '24px 40px 32px';
		formContainer.style.background = 'var(--vscode-editor-background)';

		// API 地址
		const apiUrlGroup = append(formContainer, $('div.form-group'));
		apiUrlGroup.style.marginBottom = '20px';

		const apiUrlLabelWrapper = append(apiUrlGroup, $('div.label-wrapper'));
		apiUrlLabelWrapper.style.display = 'flex';
		apiUrlLabelWrapper.style.alignItems = 'center';
		apiUrlLabelWrapper.style.marginBottom = '8px';

		const apiUrlIcon = append(apiUrlLabelWrapper, $('span.field-icon'));
		apiUrlIcon.textContent = '🌐';
		apiUrlIcon.style.marginRight = '6px';
		apiUrlIcon.style.fontSize = '14px';

		const apiUrlLabel = append(apiUrlLabelWrapper, $('label'));
		apiUrlLabel.textContent = '后端 API 地址';
		apiUrlLabel.style.fontWeight = '500';
		apiUrlLabel.style.fontSize = '13px';
		apiUrlLabel.style.color = 'var(--vscode-foreground)';

		this.apiUrlInput = this._register(new InputBox(apiUrlGroup, this.contextViewService, {
			placeholder: '例如: http://10.205.81.162/api',
			inputBoxStyles: defaultInputBoxStyles
		}));
		this.apiUrlInput.value = 'http://10.205.81.162/api';
		this.apiUrlInput.inputElement.style.fontSize = '13px';

		// 用户名
		const usernameGroup = append(formContainer, $('div.form-group'));
		usernameGroup.style.marginBottom = '20px';

		const usernameLabelWrapper = append(usernameGroup, $('div.label-wrapper'));
		usernameLabelWrapper.style.display = 'flex';
		usernameLabelWrapper.style.alignItems = 'center';
		usernameLabelWrapper.style.marginBottom = '8px';

		const usernameIcon = append(usernameLabelWrapper, $('span.field-icon'));
		usernameIcon.textContent = '👤';
		usernameIcon.style.marginRight = '6px';
		usernameIcon.style.fontSize = '14px';

		const usernameLabel = append(usernameLabelWrapper, $('label'));
		usernameLabel.textContent = '用户名';
		usernameLabel.style.fontWeight = '500';
		usernameLabel.style.fontSize = '13px';
		usernameLabel.style.color = 'var(--vscode-foreground)';

		this.usernameInput = this._register(new InputBox(usernameGroup, this.contextViewService, {
			placeholder: '请输入用户名',
			inputBoxStyles: defaultInputBoxStyles
		}));
		this.usernameInput.inputElement.style.fontSize = '13px';

		// 密码
		const passwordGroup = append(formContainer, $('div.form-group'));
		passwordGroup.style.marginBottom = '24px';

		const passwordLabelWrapper = append(passwordGroup, $('div.label-wrapper'));
		passwordLabelWrapper.style.display = 'flex';
		passwordLabelWrapper.style.alignItems = 'center';
		passwordLabelWrapper.style.marginBottom = '8px';

		const passwordIcon = append(passwordLabelWrapper, $('span.field-icon'));
		passwordIcon.textContent = '🔑';
		passwordIcon.style.marginRight = '6px';
		passwordIcon.style.fontSize = '14px';

		const passwordLabel = append(passwordLabelWrapper, $('label'));
		passwordLabel.textContent = '密码';
		passwordLabel.style.fontWeight = '500';
		passwordLabel.style.fontSize = '13px';
		passwordLabel.style.color = 'var(--vscode-foreground)';

		this.passwordInput = this._register(new InputBox(passwordGroup, this.contextViewService, {
			placeholder: '请输入密码',
			type: 'password',
			inputBoxStyles: defaultInputBoxStyles
		}));
		this.passwordInput.inputElement.style.fontSize = '13px';

		// 记住我
		const rememberGroup = append(formContainer, $('div.form-group'));
		rememberGroup.style.marginBottom = '28px';
		rememberGroup.style.display = 'flex';
		rememberGroup.style.alignItems = 'center';
		rememberGroup.style.padding = '8px 0';

		this.rememberMeCheckbox = this._register(new Checkbox(
			'记住登录状态',
			true,
			defaultCheckboxStyles
		));
		append(rememberGroup, this.rememberMeCheckbox.domNode);

		const rememberLabel = append(rememberGroup, $('span'));
		rememberLabel.textContent = '记住登录状态';
		rememberLabel.style.marginLeft = '10px';
		rememberLabel.style.cursor = 'pointer';
		rememberLabel.style.fontSize = '13px';
		rememberLabel.style.color = 'var(--vscode-foreground)';
		rememberLabel.style.userSelect = 'none';

		// 按钮组
		const buttonGroup = append(formContainer, $('div.button-group'));
		buttonGroup.style.display = 'flex';
		buttonGroup.style.gap = '12px';
		buttonGroup.style.marginTop = '8px';

		this.cancelButton = this._register(new Button(buttonGroup, {
			...defaultButtonStyles,
			secondary: true
		}));
		this.cancelButton.label = '取消';
		this.cancelButton.element.style.minWidth = '100px';
		this.cancelButton.element.style.height = '32px';
		this._register(this.cancelButton.onDidClick(() => {
			if (this.onCancelCallback) {
				this.onCancelCallback();
			}
		}));

		this.loginButton = this._register(new Button(buttonGroup, defaultButtonStyles));
		this.loginButton.label = '登 录';
		this.loginButton.element.style.minWidth = '140px';
		this.loginButton.element.style.height = '32px';
		this.loginButton.element.style.fontWeight = '500';
		this._register(this.loginButton.onDidClick(() => {
			this.handleSubmit();
		}));

		// 回车提交
		this._register(this.passwordInput.onDidChange(() => {
			// Can handle enter key here if needed
		}));

		// 底部提示
		const footer = append(formContainer, $('div.login-footer'));
		footer.style.marginTop = '20px';
		footer.style.paddingTop = '20px';
		footer.style.borderTop = '1px solid var(--vscode-widget-border)';
		footer.style.textAlign = 'center';
		footer.style.fontSize = '12px';
		footer.style.color = 'var(--vscode-descriptionForeground)';
		footer.style.opacity = '0.7';

		const footerText = append(footer, $('span'));
		footerText.textContent = '首次登录？请联系管理员获取账号';
	}

	private handleSubmit(): void {
		const apiUrl = this.apiUrlInput.value.trim();
		const username = this.usernameInput.value.trim();
		const password = this.passwordInput.value;

		if (!apiUrl) {
			this.apiUrlInput.focus();
			this.apiUrlInput.showMessage({ content: '请输入后端 API 地址', type: 3 /* Error */ });
			return;
		}

		if (!username) {
			this.usernameInput.focus();
			this.usernameInput.showMessage({ content: '请输入用户名', type: 3 /* Error */ });
			return;
		}

		if (!password) {
			this.passwordInput.focus();
			this.passwordInput.showMessage({ content: '请输入密码', type: 3 /* Error */ });
			return;
		}

		const rememberMeChecked = this.rememberMeCheckbox.checked;

		if (this.onSubmitCallback) {
			this.onSubmitCallback({
				apiUrl,
				username,
				password,
				rememberMe: rememberMeChecked
			});
		}
	}

	public onSubmit(callback: (data: ILoginFormData) => void): void {
		this.onSubmitCallback = callback;
	}

	public onCancel(callback: () => void): void {
		this.onCancelCallback = callback;
	}

	public setError(message: string): void {
		// Show error near login button or in a dedicated error area
		// For now, we can show it on the first input
		this.apiUrlInput.showMessage({ content: message, type: 3 /* Error */ });
	}

	public focus(): void {
		// Focus on username if API is filled, otherwise API URL
		if (this.apiUrlInput.value) {
			this.usernameInput.focus();
		} else {
			this.apiUrlInput.focus();
		}
	}
}
