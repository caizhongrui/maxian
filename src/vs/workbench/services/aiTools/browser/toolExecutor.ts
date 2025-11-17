/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { ITextFileService } from '../../../services/textfile/common/textfiles.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { ToolResponse } from '../common/aiToolTypes.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { applyDiffTool } from './tools/applyDiffTool.js';
import { insertContentTool } from './tools/insertContentTool.js';
import { parseCodeDefinitions, formatCodeDefinitions } from './tools/listCodeDefinitionNamesTool.js';

/**
 * Tool Executor - Executes AI tools based on Kilocode implementation
 */
export class ToolExecutor {
	constructor(
		private readonly fileService: IFileService,
		_textFileService: ITextFileService,
		private readonly workspaceRoot: URI,
		private readonly editorService: IEditorService
	) { }

	/**
	 * Execute read_file tool
	 */
	async executeReadFile(params: { path: string; start_line?: string; end_line?: string }): Promise<ToolResponse> {
		try {
			const filePath = params.path;
			const fileUri = URI.joinPath(this.workspaceRoot, filePath);

			// Check if file exists
			const exists = await this.fileService.exists(fileUri);
			if (!exists) {
				return `Error: File not found: ${filePath}`;
			}

			// Read file content
			const content = await this.fileService.readFile(fileUri);
			const text = content.value.toString();
			const lines = text.split('\n');

			// Handle line range
			if (params.start_line && params.end_line) {
				const startLine = parseInt(params.start_line, 10) - 1; // Convert to 0-based
				const endLine = parseInt(params.end_line, 10);

				if (!isNaN(startLine) && !isNaN(endLine) && startLine >= 0 && endLine <= lines.length) {
					const selectedLines = lines.slice(startLine, endLine);
					// Add line numbers
					const numberedLines = selectedLines.map((line, idx) =>
						`${startLine + idx + 1}: ${line}`
					).join('\n');

					return `File: ${filePath} (lines ${startLine + 1}-${endLine})\n\n${numberedLines}`;
				}
			}

			// Return full file with line numbers
			const numberedLines = lines.map((line, idx) => `${idx + 1}: ${line}`).join('\n');
			return `File: ${filePath}\n\n${numberedLines}`;

		} catch (error) {
			return `Error reading file: ${error instanceof Error ? error.message : String(error)}`;
		}
	}

	/**
	 * Execute write_to_file tool
	 */
	async executeWriteToFile(params: { path: string; content: string }): Promise<ToolResponse> {
		try {
			const filePath = params.path;
			const content = params.content;
			const fileUri = URI.joinPath(this.workspaceRoot, filePath);

			console.log('[ToolExecutor] write_to_file:');
			console.log('  - Workspace root:', this.workspaceRoot.fsPath);
			console.log('  - Relative path:', filePath);
			console.log('  - Full URI:', fileUri.toString());
			console.log('  - Content length:', content.length);

			// Create parent directories if needed
			const dirUri = URI.joinPath(fileUri, '..');
			console.log('  - Creating directory:', dirUri.fsPath);
			await this.fileService.createFolder(dirUri);

			// Write file using fileService (triggers file watchers)
			console.log('  - Writing file...');
			await this.fileService.writeFile(fileUri, VSBuffer.fromString(content));

			// Open the file in editor to trigger refresh
			console.log('  - Opening file in editor to trigger refresh...');
			await this.editorService.openEditor({ resource: fileUri });

			// Verify file was written
			const exists = await this.fileService.exists(fileUri);
			console.log('  - File exists after write:', exists);

			if (!exists) {
				return `Error: File was not created (write failed silently): ${filePath}`;
			}

			// Read back to verify content
			const written = await this.fileService.readFile(fileUri);
			const writtenContent = written.value.toString();
			console.log('  - Written content length:', writtenContent.length);

			return `Successfully created file: ${filePath} (${writtenContent.length} bytes)\n文件已在编辑器中打开。`;

		} catch (error) {
			console.error('[ToolExecutor] write_to_file error:', error);
			return `Error writing file: ${error instanceof Error ? error.message : String(error)}`;
		}
	}

	/**
	 * Execute edit_file tool (search/replace or full rewrite)
	 */
	async executeEditFile(params: { path: string; search?: string; replace: string }): Promise<ToolResponse> {
		try {
			const filePath = params.path;
			const search = params.search || '';
			const replace = params.replace;
			const fileUri = URI.joinPath(this.workspaceRoot, filePath);

			// Check if file exists
			const exists = await this.fileService.exists(fileUri);
			if (!exists) {
				return `Error: File not found: ${filePath}`;
			}

			// If search is empty, treat as full file rewrite
			if (!search || search.trim() === '') {
				console.log('[ToolExecutor] edit_file: Empty search, rewriting entire file');
				console.log('  - File URI:', fileUri.toString());
				console.log('  - New content length:', replace.length);

				// Write using fileService to trigger watchers
				await this.fileService.writeFile(fileUri, VSBuffer.fromString(replace));

				// Open file to trigger refresh in editor
				console.log('  - Opening file to trigger editor refresh...');
				await this.editorService.openEditor({ resource: fileUri });

				// Verify
				const written = await this.fileService.readFile(fileUri);
				console.log('  - Written content length:', written.value.toString().length);

				return `Successfully rewrote entire file: ${filePath} (${written.value.toString().length} bytes)\n文件已在编辑器中打开并刷新。`;
			}

			// Read current content
			const content = await this.fileService.readFile(fileUri);
			const text = content.value.toString();

			// Perform search/replace
			const newText = text.replace(search, replace);

			if (text === newText) {
				return `Warning: Search text not found in ${filePath}. File unchanged.`;
			}

			// Write back using fileService
			await this.fileService.writeFile(fileUri, VSBuffer.fromString(newText));

			// Open file to trigger refresh
			await this.editorService.openEditor({ resource: fileUri });

			return `Successfully edited file: ${filePath}\n文件已在编辑器中打开并刷新。`;

		} catch (error) {
			return `Error editing file: ${error instanceof Error ? error.message : String(error)}`;
		}
	}

	/**
	 * Execute list_files tool (with file count limit like Kilocode)
	 */
	async executeListFiles(params: { path: string; recursive?: string }): Promise<ToolResponse> {
		try {
			const dirPath = params.path === '.' ? '' : params.path;
			const dirUri = dirPath ? URI.joinPath(this.workspaceRoot, dirPath) : this.workspaceRoot;
			const recursive = params.recursive === 'true';

			console.log('[ToolExecutor] list_files:');
			console.log('  - Workspace root:', this.workspaceRoot.fsPath);
			console.log('  - Requested path:', params.path);
			console.log('  - Resolved dirUri:', dirUri.fsPath);
			console.log('  - Recursive:', recursive);

			// Check if directory exists
			const exists = await this.fileService.exists(dirUri);
			if (!exists) {
				return `Error: Directory not found: ${params.path}\n\n提示：这是一个多模块项目，文件可能在子模块中（如 boyo-system/src/main/java/）。请尝试：\n- list_files path="." recursive="true" （列出所有子模块）\n- 或指定具体的子模块路径`;
			}

			// Read directory
			const stat = await this.fileService.resolve(dirUri);

			if (!stat.isDirectory) {
				return `Error: ${dirPath || '.'} is not a directory`;
			}

			const results: string[] = [];
			const MAX_FILES = 200; // Limit like Kilocode
			let fileCount = 0;
			let hitLimit = false;

			const collectFiles = async (uri: URI, currentPath: string, depth: number) => {
				// Limit recursion depth
				if (depth > 10 || fileCount >= MAX_FILES) {
					if (fileCount >= MAX_FILES) {
						hitLimit = true;
					}
					return;
				}

				try {
					const children = await this.fileService.resolve(uri);

					if (!children.children) {
						return;
					}

					// Filter out common ignored directories
					const filteredChildren = children.children.filter(child => {
						const name = child.name;
						return !name.startsWith('.') &&
							name !== 'node_modules' &&
							name !== 'target' &&
							name !== 'dist' &&
							name !== 'out' &&
							name !== 'build';
					});

					for (const child of filteredChildren) {
						if (fileCount >= MAX_FILES) {
							hitLimit = true;
							break;
						}

						const childPath = currentPath ? `${currentPath}/${child.name}` : child.name;

						if (child.isDirectory) {
							results.push(`📁 ${childPath}/`);
							fileCount++;
							if (recursive) {
								await collectFiles(child.resource, childPath, depth + 1);
							}
						} else {
							results.push(`📄 ${childPath}`);
							fileCount++;
						}
					}
				} catch (error) {
					// Skip directories we can't read
					console.warn(`[ToolExecutor] Cannot read directory: ${uri.fsPath}`);
				}
			};

			await collectFiles(dirUri, dirPath, 0);

			let response = `Directory: ${params.path}\n\n${results.slice(0, 200).join('\n')}`;

			if (hitLimit) {
				response += `\n\n... (showing first ${MAX_FILES} items, more files exist)`;
			}

			console.log(`  - Listed ${fileCount} items`);

			return response;

		} catch (error) {
			console.error('[ToolExecutor] list_files error:', error);
			return `Error listing files: ${error instanceof Error ? error.message : String(error)}`;
		}
	}

	/**
	 * Execute search_files tool
	 */
	async executeSearchFiles(params: { path: string; regex: string; file_pattern?: string }): Promise<ToolResponse> {
		try {
			const dirPath = params.path === '.' ? '' : params.path;
			const dirUri = dirPath ? URI.joinPath(this.workspaceRoot, dirPath) : this.workspaceRoot;
			const searchRegex = new RegExp(params.regex, 'i');
			const filePattern = params.file_pattern;

			const results: string[] = [];

			const searchInFile = async (fileUri: URI, relativePath: string) => {
				try {
					// Check file pattern if specified
					if (filePattern) {
						const pattern = new RegExp(filePattern.replace(/\*/g, '.*'));
						if (!pattern.test(relativePath)) {
							return;
						}
					}

					const content = await this.fileService.readFile(fileUri);
					const text = content.value.toString();
					const lines = text.split('\n');

					for (let i = 0; i < lines.length; i++) {
						if (searchRegex.test(lines[i])) {
							results.push(`${relativePath}:${i + 1}: ${lines[i].trim()}`);
						}
					}
				} catch (error) {
					// Skip files that can't be read
				}
			};

			const searchDirectory = async (uri: URI, currentPath: string) => {
				try {
					const stat = await this.fileService.resolve(uri);

					if (!stat.children) {
						return;
					}

					for (const child of stat.children) {
						const childPath = currentPath ? `${currentPath}/${child.name}` : child.name;

						if (child.isDirectory) {
							await searchDirectory(child.resource, childPath);
						} else {
							await searchInFile(child.resource, childPath);
						}
					}
				} catch (error) {
					// Skip directories that can't be read
				}
			};

			await searchDirectory(dirUri, dirPath);

			if (results.length === 0) {
				return `No matches found for pattern: ${params.regex}`;
			}

			return `Search results for "${params.regex}":\n\n${results.slice(0, 100).join('\n')}${results.length > 100 ? `\n\n... and ${results.length - 100} more matches` : ''}`;

		} catch (error) {
			return `Error searching files: ${error instanceof Error ? error.message : String(error)}`;
		}
	}

	/**
	 * Execute execute_command tool
	 * Note: This is a placeholder. Real implementation would use a terminal service.
	 */
	async executeCommand(params: { command: string; cwd?: string }): Promise<ToolResponse> {
		// TODO: Implement actual command execution using terminal service
		return `Command execution not yet implemented: ${params.command}`;
	}

	/**
	 * Execute apply_diff tool
	 */
	async executeApplyDiff(params: { path: string; diff: string; start_line?: number }): Promise<ToolResponse> {
		const result = await applyDiffTool(params, this.fileService, this.workspaceRoot);
		if (result.success) {
			return result.message || 'Diff applied successfully';
		} else {
			return `Error: ${result.error || 'Unknown error'}`;
		}
	}

	/**
	 * Execute insert_content tool
	 */
	async executeInsertContent(params: { path: string; line: number; content: string }): Promise<ToolResponse> {
		const result = await insertContentTool(params, this.fileService, this.workspaceRoot);
		if (result.success) {
			return result.message || 'Content inserted successfully';
		} else {
			return `Error: ${result.error || 'Unknown error'}`;
		}
	}

	/**
	 * Execute list_code_definition_names tool
	 */
	async executeListCodeDefinitions(params: { path: string }): Promise<ToolResponse> {
		try {
			const filePath = params.path;
			const fileUri = URI.joinPath(this.workspaceRoot, filePath);

			const exists = await this.fileService.exists(fileUri);
			if (!exists) {
				return `Error: File not found: ${filePath}`;
			}

			const content = await this.fileService.readFile(fileUri);
			const text = content.value.toString();

			const definitions = parseCodeDefinitions(text);
			const formatted = formatCodeDefinitions(definitions);

			return `Code definitions in ${filePath}:\n\n${formatted}`;
		} catch (error) {
			return `Error: ${error instanceof Error ? error.message : String(error)}`;
		}
	}

	/**
	 * Execute simple_read_file tool (basic file reading without line numbers)
	 */
	async executeSimpleReadFile(params: { path: string }): Promise<ToolResponse> {
		try {
			const filePath = params.path;
			const fileUri = URI.joinPath(this.workspaceRoot, filePath);

			const exists = await this.fileService.exists(fileUri);
			if (!exists) {
				return `Error: File not found: ${filePath}`;
			}

			const content = await this.fileService.readFile(fileUri);
			const text = content.value.toString();

			return `File: ${filePath}\n\n${text}`;
		} catch (error) {
			return `Error: ${error instanceof Error ? error.message : String(error)}`;
		}
	}

	/**
	 * Execute codebase_search tool (semantic search - placeholder)
	 */
	async executeCodebaseSearch(params: { query: string; path?: string }): Promise<ToolResponse> {
		// This requires vector store integration
		return `Codebase semantic search not yet implemented. Query: ${params.query}`;
	}

	/**
	 * Execute browser_action tool (placeholder)
	 */
	async executeBrowserAction(params: { action: string; url?: string; coordinate?: string; text?: string }): Promise<ToolResponse> {
		return `Browser automation not yet implemented. Action: ${params.action}`;
	}

	/**
	 * Execute fetch_instructions tool (placeholder)
	 */
	async executeFetchInstructions(params: any): Promise<ToolResponse> {
		return `Fetch instructions tool not yet implemented`;
	}

	/**
	 * Execute generate_image tool (placeholder)
	 */
	async executeGenerateImage(params: { prompt: string }): Promise<ToolResponse> {
		return `Image generation not yet implemented. Prompt: ${params.prompt}`;
	}

	/**
	 * Execute access_mcp_resource tool (placeholder)
	 */
	async executeAccessMcpResource(params: any): Promise<ToolResponse> {
		return `MCP resource access not yet implemented`;
	}

	/**
	 * Execute use_mcp_tool (placeholder)
	 */
	async executeUseMcpTool(params: any): Promise<ToolResponse> {
		return `MCP tool usage not yet implemented`;
	}

	/**
	 * Execute report_bug tool (placeholder)
	 */
	async executeReportBug(params: { description: string }): Promise<ToolResponse> {
		return `Bug reporting not yet implemented. Description: ${params.description}`;
	}

	/**
	 * Execute run_slash_command tool (placeholder)
	 */
	async executeRunSlashCommand(params: { command: string }): Promise<ToolResponse> {
		return `Slash command execution not yet implemented. Command: ${params.command}`;
	}

	/**
	 * Execute new_rule tool (placeholder)
	 */
	async executeNewRule(params: any): Promise<ToolResponse> {
		return `New rule creation not yet implemented`;
	}

	/**
	 * Execute new_task tool (placeholder)
	 */
	async executeNewTask(params: { task: string }): Promise<ToolResponse> {
		return `New task creation not yet implemented. Task: ${params.task}`;
	}

	/**
	 * Execute update_todo_list tool (placeholder)
	 */
	async executeUpdateTodoList(params: { todos: any[] }): Promise<ToolResponse> {
		// This would integrate with a todo list UI
		return `Todo list update not yet implemented. ${params.todos.length} todos`;
	}

	/**
	 * Execute switch_mode tool (placeholder)
	 */
	async executeSwitchMode(params: { mode: string }): Promise<ToolResponse> {
		return `Mode switching not yet implemented. Target mode: ${params.mode}`;
	}

	/**
	 * Execute condense tool (placeholder)
	 */
	async executeCondense(params: any): Promise<ToolResponse> {
		return `Condense tool not yet implemented`;
	}

	/**
	 * Execute multi_apply_diff tool (batch diff operations - placeholder)
	 */
	async executeMultiApplyDiff(params: any): Promise<ToolResponse> {
		return `Multi-file diff application not yet implemented`;
	}
}
