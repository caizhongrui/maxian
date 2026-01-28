/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { IMarkerService, IMarker, MarkerSeverity } from '../../../../platform/markers/common/markers.js';
import { IModelService } from '../../../../editor/common/services/model.js';
import {
	ILspDiagnosticsService,
	Diagnostic,
	DiagnosticSeverity,
	DiagnosticRange,
} from '../common/lsp/lspDiagnostics.js';
import { Disposable } from '../../../../base/common/lifecycle.js';

/**
 * LSP 诊断服务实现
 * 基于 VS Code 的 IMarkerService 和 IModelService
 *
 * 功能：
 * - 从 VS Code 的 Marker 系统读取诊断信息
 * - 转换为统一的 Diagnostic 格式
 * - 支持实时更新和过滤
 */
export class LspDiagnosticsService extends Disposable implements ILspDiagnosticsService {

	declare readonly _serviceBrand: undefined;

	constructor(
		@IMarkerService private readonly markerService: IMarkerService,
		@IModelService private readonly modelService: IModelService,
	) {
		super();
		console.log('[LspDiagnosticsService] 服务已初始化');
	}

	/**
	 * 触发文件的诊断更新
	 * @param filePath 文件路径
	 * @param forceRefresh 是否强制刷新
	 */
	async touchFile(filePath: string, forceRefresh?: boolean): Promise<void> {
		try {
			const uri = URI.file(filePath);
			const model = this.modelService.getModel(uri);

			if (!model) {
				console.warn(`[LspDiagnosticsService] 文件未打开: ${filePath}`);
				return;
			}

			// 触发模型验证（会触发语言服务器重新计算诊断）
			// VS Code会自动在模型内容变化后触发诊断更新
			// 这里我们只需要确保模型已加载
			if (forceRefresh) {
				// 强制触发：通过获取内容来确保语言服务器已处理此文件
				model.getValue();
				console.log(`[LspDiagnosticsService] 已触发文件更新: ${filePath}`);
			}
		} catch (error) {
			console.error(`[LspDiagnosticsService] 触发文件更新失败: ${filePath}`, error);
		}
	}

	/**
	 * 获取文件的诊断信息
	 * @param filePath 文件路径
	 */
	async getDiagnostics(filePath: string): Promise<Diagnostic[]> {
		try {
			const uri = URI.file(filePath);

			// 从 MarkerService 读取此文件的所有 markers
			const markers = this.markerService.read({ resource: uri });

			console.log(`[LspDiagnosticsService] 获取诊断: ${filePath}, 共 ${markers.length} 个`);

			// 转换为 Diagnostic 格式
			return markers.map(marker => this.convertMarkerToDiagnostic(marker));
		} catch (error) {
			console.error(`[LspDiagnosticsService] 获取诊断失败: ${filePath}`, error);
			return [];
		}
	}

	/**
	 * 获取所有打开文件的诊断信息
	 */
	async getAllDiagnostics(): Promise<Map<string, Diagnostic[]>> {
		const result = new Map<string, Diagnostic[]>();

		try {
			// 获取所有打开的模型
			const models = this.modelService.getModels();

			console.log(`[LspDiagnosticsService] 获取所有诊断，共 ${models.length} 个文件`);

			// 为每个模型获取诊断
			for (const model of models) {
				const uri = model.uri;
				if (uri.scheme === 'file') {
					const filePath = uri.fsPath;
					const diagnostics = await this.getDiagnostics(filePath);
					if (diagnostics.length > 0) {
						result.set(filePath, diagnostics);
					}
				}
			}
		} catch (error) {
			console.error('[LspDiagnosticsService] 获取所有诊断失败', error);
		}

		return result;
	}

	/**
	 * 将 VS Code 的 Marker 转换为 Diagnostic
	 */
	private convertMarkerToDiagnostic(marker: IMarker): Diagnostic {
		return {
			range: this.convertMarkerRange(marker),
			message: marker.message,
			severity: this.convertMarkerSeverity(marker.severity),
			source: marker.source,
			code: this.convertMarkerCode(marker.code),
		};
	}

	/**
	 * 转换 Marker 位置范围
	 */
	private convertMarkerRange(marker: IMarker): DiagnosticRange {
		return {
			startLine: marker.startLineNumber,
			startColumn: marker.startColumn,
			endLine: marker.endLineNumber,
			endColumn: marker.endColumn,
		};
	}

	/**
	 * 转换严重程度
	 * VS Code MarkerSeverity: Hint=1, Info=2, Warning=4, Error=8
	 * 我们的 DiagnosticSeverity: Error=1, Warning=2, Information=3, Hint=4
	 */
	private convertMarkerSeverity(severity: MarkerSeverity): DiagnosticSeverity {
		switch (severity) {
			case MarkerSeverity.Error:
				return DiagnosticSeverity.Error;
			case MarkerSeverity.Warning:
				return DiagnosticSeverity.Warning;
			case MarkerSeverity.Info:
				return DiagnosticSeverity.Information;
			case MarkerSeverity.Hint:
				return DiagnosticSeverity.Hint;
			default:
				return DiagnosticSeverity.Information;
		}
	}

	/**
	 * 转换错误代码
	 */
	private convertMarkerCode(code: string | { value: string; target: URI } | undefined): string | number | undefined {
		if (!code) {
			return undefined;
		}
		if (typeof code === 'string') {
			return code;
		}
		return code.value;
	}
}
