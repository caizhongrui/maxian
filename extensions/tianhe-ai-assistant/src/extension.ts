import * as vscode from "vscode"
import * as path from "path"

/**
 * 天和 AI 助手扩展入口
 * 基于 Kilocode 完整实现
 * 主要模型: 千问 Qwen
 */

import { Package } from "./shared/package"
import { formatLanguage } from "./shared/language"
import { initializeI18n } from "./i18n"

let outputChannel: vscode.OutputChannel
let extensionContext: vscode.ExtensionContext

/**
 * 扩展激活函数
 */
export async function activate(context: vscode.ExtensionContext) {
	extensionContext = context
	outputChannel = vscode.window.createOutputChannel(Package.outputChannel)
	context.subscriptions.push(outputChannel)
	outputChannel.appendLine(`${Package.name} 扩展激活 - 版本 ${Package.version}`)

	try {
		initializeI18n(context.globalState.get("language") ?? formatLanguage(vscode.env.language))

		const { TelemetryService } = await import("./packages/telemetry")
		TelemetryService.createInstance()

		try {
			const { TerminalRegistry } = await import("./integrations/terminal/TerminalRegistry")
			TerminalRegistry.initialize()
		} catch (error) {
			outputChannel.appendLine(`⚠️ TerminalRegistry 初始化失败（终端功能可能受限）`)
		}

		const { ContextProxy } = await import("./core/config/ContextProxy")
		const contextProxy = await ContextProxy.getInstance(context)

		const { ClineProvider } = await import("./core/webview/ClineProvider")
		const provider = new ClineProvider(context, outputChannel, "sidebar", contextProxy, undefined)

		context.subscriptions.push(
			vscode.window.registerWebviewViewProvider(ClineProvider.sideBarId, provider, {
				webviewOptions: { retainContextWhenHidden: true },
			})
		)

		const { DIFF_VIEW_URI_SCHEME } = await import("./integrations/editor/DiffViewProvider")
		const diffContentProvider = new (class implements vscode.TextDocumentContentProvider {
			provideTextDocumentContent(uri: vscode.Uri): string {
				return Buffer.from(uri.query, "base64").toString("utf-8")
			}
		})()
		context.subscriptions.push(
			vscode.workspace.registerTextDocumentContentProvider(DIFF_VIEW_URI_SCHEME, diffContentProvider)
		)

		const { registerCommands, registerCodeActions, registerTerminalActions, handleUri } = await import("./activate")

		registerCommands({ context, outputChannel, provider })

		registerCodeActions(context)

		outputChannel.appendLine("✅ 天和 AI 助手扩展激活成功！")

	} catch (error) {
		outputChannel.appendLine(`❌ 扩展激活失败: ${error}`)
		throw error
	}
}

/**
 * 扩展停用函数
 */
export function deactivate() {
	if (outputChannel) {
		outputChannel.appendLine("🛑 天和 AI 助手扩展正在停用...")
		outputChannel.dispose()
	}
}
