/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { ICodeEditor } from '../../../../editor/browser/editorBrowser.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IMultiLanguageService } from '../../multilang/browser/multilang.contribution.js';
import { ConversationContext, CodeSnippet, FileContext } from './chatTypes.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';

/**
 * 上下文提取器
 * 负责从当前编辑器环境中提取上下文信息
 */
export class ContextExtractor {
	constructor(
		private readonly editorService: IEditorService,
		private readonly workspaceService: IWorkspaceContextService,
		private readonly multiLanguageService: IMultiLanguageService
	) { }

	/**
	 * 提取完整上下文
	 */
	async extractContext(token?: CancellationToken): Promise<ConversationContext> {
		const context: ConversationContext = {};

		// 当前工作区
		const workspace = this.workspaceService.getWorkspace();
		if (workspace.folders.length > 0) {
			context.workspaceFolder = workspace.folders[0].uri;
		}

		// 当前文件和选中代码
		const activeEditor = this.editorService.activeTextEditorControl;
		if (activeEditor && this.isCodeEditor(activeEditor)) {
			// 当前文件上下文
			context.currentFile = await this.extractFileContext(activeEditor);

			// 选中的代码
			const selection = activeEditor.getSelection();
			if (selection && !selection.isEmpty()) {
				context.selectedCode = this.extractSelectedCode(activeEditor);
			}
		}

		// 项目语言和框架
		if (context.workspaceFolder) {
			try {
				context.projectLanguage = await this.multiLanguageService.detectPrimaryLanguage(
					context.workspaceFolder,
					token
				);

				const frameworks = await this.multiLanguageService.detectFramework(
					context.workspaceFolder,
					token
				);
				context.projectFrameworks = frameworks.map(f => f.name);
			} catch (error) {
				console.warn('[Context Extractor] Failed to detect project info:', error);
			}
		}

		// 打开的文件列表
		context.openFiles = this.getOpenFiles();

		return context;
	}

	/**
	 * 提取当前文件上下文
	 */
	async extractFileContext(editor: ICodeEditor): Promise<FileContext | undefined> {
		const model = editor.getModel();
		if (!model) {
			return undefined;
		}

		const uri = model.uri;
		const language = model.getLanguageId();

		// 只包含小文件的内容（< 10KB）
		let content: string | undefined;
		const fileSize = model.getValue().length;
		if (fileSize < 10000) {
			content = model.getValue();
		}

		// 选中范围
		const selection = editor.getSelection();
		let selectionInfo;
		if (selection) {
			selectionInfo = {
				startLine: selection.startLineNumber,
				startColumn: selection.startColumn,
				endLine: selection.endLineNumber,
				endColumn: selection.endColumn
			};
		}

		// 提取代码结构信息（使用语言适配器）
		const codeStructure = await this.extractCodeStructure(uri, model.getValue());

		return {
			fileUri: uri,
			fileName: this.getFileName(uri),
			filePath: uri.fsPath,
			language: language,
			content: content,
			selection: selectionInfo,
			codeStructure: codeStructure
		};
	}

	/**
	 * 提取代码结构信息
	 */
	private async extractCodeStructure(fileUri: URI, code: string): Promise<any> {
		try {
			// 使用多语言服务提取代码元素
			const elements = await this.multiLanguageService.extractElements(fileUri, code);
			if (!elements) {
				return undefined;
			}

			// 转换为简化的结构
			const structure: any = {};

			// 提取类信息（简化）
			if (elements.classes && elements.classes.length > 0) {
				structure.classes = elements.classes.map(cls => ({
					name: cls.name,
					visibility: cls.visibility || 'public',
					methods: cls.methods.map(method => ({
						name: method.name,
						returnType: method.returnType
					})),
					properties: cls.properties.map(prop => ({
						name: prop.name,
						type: prop.type
					}))
				}));
			}

			// 提取函数信息（文件级别）
			if (elements.functions && elements.functions.length > 0) {
				structure.functions = elements.functions.map(func => ({
					name: func.name,
					returnType: func.returnType,
					parameters: func.parameters.map(param => ({
						name: param.name,
						type: param.type
					}))
				}));
			}

			// 提取导入信息
			if (elements.imports && elements.imports.length > 0) {
				structure.imports = elements.imports.map(imp => ({
					modulePath: imp.modulePath,
					importedNames: imp.importedNames
				}));
			}

			// 检测框架
			try {
				const frameworks = await this.multiLanguageService.detectFrameworkFromCode(fileUri, code);
				if (frameworks && frameworks.length > 0) {
					structure.frameworks = frameworks;
				}
			} catch (error) {
				console.warn('[Context Extractor] Failed to detect frameworks:', error);
			}

			return Object.keys(structure).length > 0 ? structure : undefined;
		} catch (error) {
			console.warn('[Context Extractor] Failed to extract code structure:', error);
			return undefined;
		}
	}

	/**
	 * 提取选中的代码
	 */
	extractSelectedCode(editor: ICodeEditor): CodeSnippet | undefined {
		const model = editor.getModel();
		const selection = editor.getSelection();

		if (!model || !selection || selection.isEmpty()) {
			return undefined;
		}

		const selectedText = model.getValueInRange(selection);
		const language = model.getLanguageId();

		return {
			code: selectedText,
			language: language,
			fileUri: model.uri,
			startLine: selection.startLineNumber,
			endLine: selection.endLineNumber
		};
	}

	/**
	 * 获取打开的文件列表
	 */
	private getOpenFiles(): string[] {
		const openFiles: string[] = [];

		try {
			const editors = this.editorService.editors;
			for (const editor of editors) {
				if (editor.resource) {
					openFiles.push(editor.resource.fsPath);
				}
			}
		} catch (error) {
			console.warn('[Context Extractor] Failed to get open files:', error);
		}

		return openFiles;
	}

	/**
	 * 检查是否是代码编辑器
	 */
	private isCodeEditor(editor: any): editor is ICodeEditor {
		return editor && typeof editor.getModel === 'function';
	}

	/**
	 * 获取文件名
	 */
	private getFileName(uri: URI): string {
		const path = uri.path;
		const lastSlash = path.lastIndexOf('/');
		return lastSlash >= 0 ? path.substring(lastSlash + 1) : path;
	}
}
