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
import { FileAccess } from '../../../../base/common/network.js';

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
		this.container.style.minWidth = '440px';
		this.container.style.maxWidth = '440px';
		this.container.style.borderRadius = '12px';
		this.container.style.overflow = 'hidden';

		// ── 顶部渐变条 ──
		const topBar = append(this.container, $('div'));
		topBar.style.height = '3px';
		topBar.style.background = 'var(--vscode-focusBorder, #007acc)';

		// ── Hero 头部 ──
		const header = append(this.container, $('div'));
		header.style.padding = '36px 40px 28px';
		header.style.textAlign = 'center';
		header.style.background = 'var(--vscode-sideBar-background, var(--vscode-editor-background))';
		header.style.borderBottom = '1px solid var(--vscode-widget-border, rgba(128,128,128,0.2))';

		// 头像渐变环
		const avatarRing = append(header, $('div'));
		avatarRing.style.width = '72px';
		avatarRing.style.height = '72px';
		avatarRing.style.borderRadius = '18px';
		avatarRing.style.padding = '2px';
		avatarRing.style.background = 'var(--vscode-focusBorder, #007acc)';
		avatarRing.style.boxShadow = '0 8px 28px rgba(0,0,0,0.2)';
		avatarRing.style.margin = '0 auto 18px';
		avatarRing.style.display = 'inline-block';

		const avatarInner = append(avatarRing, $('div'));
		avatarInner.style.width = '100%';
		avatarInner.style.height = '100%';
		avatarInner.style.borderRadius = '16px';
		avatarInner.style.overflow = 'hidden';
		avatarInner.style.background = 'var(--vscode-editor-background)';

		const logoImg = append(avatarInner, $('img')) as HTMLImageElement;
		logoImg.src = FileAccess.asBrowserUri('vs/workbench/contrib/maxian/browser/media/icons/maxian-avatar.png').toString(true);
		logoImg.style.width = '100%';
		logoImg.style.height = '100%';
		logoImg.style.objectFit = 'cover';
		logoImg.style.display = 'block';

		// 品牌标题
		const brandTitle = append(header, $('div'));
		brandTitle.textContent = '码弦';
		brandTitle.style.fontSize = '28px';
		brandTitle.style.fontWeight = '700';
		brandTitle.style.letterSpacing = '3px';
		brandTitle.style.marginBottom = '6px';
		brandTitle.style.lineHeight = '1';
		brandTitle.style.color = 'var(--vscode-foreground)';

		const brandSub = append(header, $('div'));
		brandSub.textContent = '智能 AI 编程助手';
		brandSub.style.fontSize = '12px';
		brandSub.style.color = 'var(--vscode-descriptionForeground)';
		brandSub.style.opacity = '0.6';
		brandSub.style.letterSpacing = '0.8px';

		// ── 表单区域 ──
		const form = append(this.container, $('div'));
		form.style.padding = '28px 40px 32px';
		form.style.background = 'var(--vscode-editor-background)';
		form.style.display = 'flex';
		form.style.flexDirection = 'column';
		form.style.gap = '16px';

		// 通用 label 创建函数
		const makeLabel = (parent: HTMLElement, iconClass: string, text: string) => {
			const label = append(parent, $('div'));
			label.style.display = 'flex';
			label.style.alignItems = 'center';
			label.style.gap = '5px';
			label.style.marginBottom = '6px';
			label.style.fontSize = '11px';
			label.style.fontWeight = '600';
			label.style.color = 'var(--vscode-descriptionForeground)';
			label.style.letterSpacing = '0.8px';
			label.style.textTransform = 'uppercase';
			label.style.opacity = '0.8';

			const icon = append(label, $(`span.codicon.${iconClass}`));
			icon.style.fontSize = '12px';

			const span = append(label, $('span'));
			span.textContent = text;
		};

		// ── API 地址 ──
		const apiGroup = append(form, $('div'));
		makeLabel(apiGroup, 'codicon-server', '后端 API 地址');
		this.apiUrlInput = this._register(new InputBox(apiGroup, this.contextViewService, {
			placeholder: '例如: http://10.205.81.162/api',
			inputBoxStyles: defaultInputBoxStyles
		}));
		this.apiUrlInput.value = 'http://10.205.81.162/api';
		this.apiUrlInput.inputElement.style.fontSize = '13px';

		// ── 用户名 ──
		const userGroup = append(form, $('div'));
		makeLabel(userGroup, 'codicon-person', '用户名');
		this.usernameInput = this._register(new InputBox(userGroup, this.contextViewService, {
			placeholder: '请输入用户名',
			inputBoxStyles: defaultInputBoxStyles
		}));
		this.usernameInput.inputElement.style.fontSize = '13px';

		// ── 密码 ──
		const passGroup = append(form, $('div'));
		makeLabel(passGroup, 'codicon-lock', '密码');
		this.passwordInput = this._register(new InputBox(passGroup, this.contextViewService, {
			placeholder: '请输入密码',
			type: 'password',
			inputBoxStyles: defaultInputBoxStyles
		}));
		this.passwordInput.inputElement.style.fontSize = '13px';

		// ── 记住我 ──
		const rememberRow = append(form, $('div'));
		rememberRow.style.display = 'flex';
		rememberRow.style.alignItems = 'center';
		rememberRow.style.gap = '8px';
		rememberRow.style.padding = '2px 0';

		this.rememberMeCheckbox = this._register(new Checkbox('记住登录状态', true, defaultCheckboxStyles));
		append(rememberRow, this.rememberMeCheckbox.domNode);

		const rememberLabel = append(rememberRow, $('span'));
		rememberLabel.textContent = '记住登录状态';
		rememberLabel.style.fontSize = '13px';
		rememberLabel.style.color = 'var(--vscode-foreground)';
		rememberLabel.style.cursor = 'pointer';
		rememberLabel.style.userSelect = 'none';
		rememberLabel.style.opacity = '0.8';

		// ── 按钮区 ──
		const btnArea = append(form, $('div'));
		btnArea.style.display = 'flex';
		btnArea.style.flexDirection = 'column';
		btnArea.style.gap = '10px';
		btnArea.style.marginTop = '4px';

		// 登录按钮（全宽渐变）
		this.loginButton = this._register(new Button(btnArea, defaultButtonStyles));
		this.loginButton.label = '登  录';
		this.loginButton.element.style.width = '100%';
		this.loginButton.element.style.height = '38px';
		this.loginButton.element.style.fontSize = '14px';
		this.loginButton.element.style.fontWeight = '600';
		this.loginButton.element.style.letterSpacing = '2px';
		this.loginButton.element.style.borderRadius = '6px';
		this.loginButton.element.style.border = 'none';
		this.loginButton.element.style.background = 'var(--vscode-button-background)';
		this.loginButton.element.style.color = 'var(--vscode-button-foreground)';
		this.loginButton.element.style.cursor = 'pointer';
		this.loginButton.element.style.transition = 'opacity 0.15s, transform 0.1s';
		this.loginButton.element.onmouseenter = () => {
			this.loginButton.element.style.opacity = '0.9';
			this.loginButton.element.style.transform = 'translateY(-1px)';
		};
		this.loginButton.element.onmouseleave = () => {
			this.loginButton.element.style.opacity = '1';
			this.loginButton.element.style.transform = 'translateY(0)';
		};
		this._register(this.loginButton.onDidClick(() => this.handleSubmit()));

		// 取消按钮（幽灵样式）
		this.cancelButton = this._register(new Button(btnArea, { ...defaultButtonStyles, secondary: true }));
		this.cancelButton.label = '取消';
		this.cancelButton.element.style.width = '100%';
		this.cancelButton.element.style.height = '32px';
		this.cancelButton.element.style.fontSize = '13px';
		this.cancelButton.element.style.borderRadius = '6px';
		this.cancelButton.element.style.opacity = '0.6';
		this._register(this.cancelButton.onDidClick(() => {
			if (this.onCancelCallback) { this.onCancelCallback(); }
		}));

		// ── 底部提示 ──
		const footer = append(form, $('div'));
		footer.style.textAlign = 'center';
		footer.style.fontSize = '12px';
		footer.style.color = 'var(--vscode-descriptionForeground)';
		footer.style.opacity = '0.5';
		footer.style.paddingTop = '4px';
		footer.style.borderTop = '1px solid rgba(128,128,128,0.1)';
		footer.textContent = '首次登录？请联系管理员获取账号';
	}

	private handleSubmit(): void {
		const apiUrl = this.apiUrlInput.value.trim();
		const username = this.usernameInput.value.trim();
		const password = this.passwordInput.value;

		if (!apiUrl) {
			this.apiUrlInput.focus();
			this.apiUrlInput.showMessage({ content: '请输入后端 API 地址', type: 3 });
			return;
		}
		if (!username) {
			this.usernameInput.focus();
			this.usernameInput.showMessage({ content: '请输入用户名', type: 3 });
			return;
		}
		if (!password) {
			this.passwordInput.focus();
			this.passwordInput.showMessage({ content: '请输入密码', type: 3 });
			return;
		}

		if (this.onSubmitCallback) {
			this.onSubmitCallback({
				apiUrl,
				username,
				password,
				rememberMe: this.rememberMeCheckbox.checked
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
		this.apiUrlInput.showMessage({ content: message, type: 3 });
	}

	public focus(): void {
		if (this.apiUrlInput.value) {
			this.usernameInput.focus();
		} else {
			this.apiUrlInput.focus();
		}
	}
}
