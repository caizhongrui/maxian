/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { EditorInput } from '../../../common/editor/editorInput.js';
import { EditorInputCapabilities } from '../../../common/editor.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { Codicon } from '../../../../base/common/codicons.js';

/**
 * Solo 模式编辑器 Input
 * 采用单例模式——整个工作区只存在一个 Solo 面板
 */
export class SoloEditorInput extends EditorInput {

	static readonly TypeID = 'maxian.solo.input';
	static readonly EditorID = 'maxian.solo.editor';

	/** 全局单例 */
	private static _instance: SoloEditorInput | undefined;

	static get instance(): SoloEditorInput {
		if (!SoloEditorInput._instance || SoloEditorInput._instance.isDisposed()) {
			SoloEditorInput._instance = new SoloEditorInput();
		}
		return SoloEditorInput._instance;
	}

	/** EditorInput 要求的 resource，Solo 面板无文件，返回 undefined */
	readonly resource = undefined;

	override get typeId(): string {
		return SoloEditorInput.TypeID;
	}

	override get editorId(): string {
		return SoloEditorInput.EditorID;
	}

	override get capabilities(): EditorInputCapabilities {
		// Singleton：同一 input 在所有 group 中共享
		return EditorInputCapabilities.Singleton | EditorInputCapabilities.Readonly;
	}

	override getName(): string {
		return '⚡ Coding 自主模式';
	}

	override getIcon(): ThemeIcon {
		return Codicon.rocket;
	}

	override matches(other: unknown): boolean {
		return other instanceof SoloEditorInput;
	}
}
