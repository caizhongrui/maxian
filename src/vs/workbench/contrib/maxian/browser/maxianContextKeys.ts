/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RawContextKey } from '../../../../platform/contextkey/common/contextkey.js';

/**
 * 码弦输入框是否获得焦点
 * 用于限定快捷键仅在输入框聚焦时生效
 */
export const MAXIAN_INPUT_FOCUSED = new RawContextKey<boolean>('maxianInputFocused', false, {
	type: 'boolean',
	description: '码弦输入框是否获得焦点'
});

/**
 * 码弦 @mention 下拉列表是否正在显示
 * 用于防止 Enter 快捷键在选择文件时触发发送消息
 */
export const MAXIAN_MENTION_DROPDOWN_VISIBLE = new RawContextKey<boolean>('maxianMentionDropdownVisible', false, {
	type: 'boolean',
	description: '码弦 @mention 下拉列表是否可见'
});
