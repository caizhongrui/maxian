/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IListFilesOptions, IListFilesResult, IRegexSearchOptions, IRipgrepService, ISearchFileResult, ISearchLineResult } from '../common/ripgrep.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { URI } from '../../../../base/common/uri.js';
import { rgPath } from '@vscode/ripgrep';
import * as cp from 'child_process';
import * as path from 'path';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { isWindows, isMacintosh } from '../../../../base/common/platform.js';
import * as os from 'os';

// If @vscode/ripgrep is in an .asar file, then the binary is unpacked.
const rgDiskPath = rgPath.replace(/\bnode_modules\.asar\b/, 'node_modules.asar.unpacked');

// Constants
const MAX_RESULTS = 300;
const MAX_LINE_LENGTH = 500;
// const DEFAULT_FILE_LIMIT = 200; // Unused
const RG_TIMEOUT = 10000; // 10 seconds

/**
 * Directories to ignore during file listing
 */
const DIRS_TO_IGNORE = [
	'node_modules',
	'.git',
	'__pycache__',
	'venv',
	'env',
	'.venv',
	'dist',
	'build',
	'out',
	'.*', // Hidden directories pattern
];

/**
 * Critical directories that should always be ignored
 */
// const CRITICAL_IGNORE_PATTERNS = new Set(['node_modules', '.git', '__pycache__', 'venv', 'env']); // Unused

/**
 * Ripgrep service implementation using VS Code's built-in ripgrep
 */
export class RipgrepService extends Disposable implements IRipgrepService {
	declare readonly _serviceBrand: undefined;

	constructor(
		@IFileService private readonly fileService: IFileService,
		@ILogService private readonly logService: ILogService
	) {
		super();
	}

	/**
	 * Get the path to the ripgrep binary
	 */
	async getRipgrepPath(): Promise<string> {
		return rgDiskPath;
	}

	/**
	 * List files in a directory with optional recursive traversal
	 */
	async listFiles(options: IListFilesOptions): Promise<IListFilesResult> {
		const { dirPath, recursive, limit, token } = options;

		// Early return for limit of 0
		if (limit === 0) {
			return { files: [], limitReached: false };
		}

		// Check if directory exists
		const dirUri = URI.file(dirPath);
		const exists = await this.fileService.exists(dirUri);
		if (!exists) {
			this.logService.warn(`RipgrepService: Directory does not exist: ${dirPath}`);
			return { files: [], limitReached: false };
		}

		try {
			// Handle special directories (root, home)
			const specialResult = this.handleSpecialDirectories(dirPath);
			if (specialResult) {
				return specialResult;
			}

			// Use ripgrep to list files
			const files = await this.listFilesWithRipgrep(dirPath, recursive, limit, token);

			return {
				files,
				limitReached: files.length >= limit
			};
		} catch (error) {
			this.logService.error('RipgrepService: Error listing files', error);
			return { files: [], limitReached: false };
		}
	}

	/**
	 * Perform regex search across files
	 */
	async regexSearch(options: IRegexSearchOptions): Promise<string> {
		const { cwd, directoryPath, regex, filePattern, token } = options;

		try {
			const args = ['--json', '-e', regex];

			// Only add --glob if a specific file pattern is provided
			if (filePattern) {
				args.push('--glob', filePattern);
			}

			args.push('--context', '1', '--no-messages', directoryPath);

			const output = await this.execRipgrep(args, token);
			const results = this.parseSearchOutput(output);
			return this.formatSearchResults(results, cwd);
		} catch (error) {
			this.logService.error('RipgrepService: Error executing regex search', error);
			return 'No results found';
		}
	}

	/**
	 * Handle special directories that should not be fully listed
	 */
	private handleSpecialDirectories(dirPath: string): IListFilesResult | null {
		const absolutePath = path.resolve(dirPath);

		// Do not allow listing files in root directory
		const root = isWindows ? path.parse(absolutePath).root : '/';
		if (this.arePathsEqual(absolutePath, root)) {
			return { files: [root], limitReached: false };
		}

		// Do not allow listing files in home directory
		const homeDir = os.homedir();
		if (this.arePathsEqual(absolutePath, homeDir)) {
			return { files: [homeDir], limitReached: false };
		}

		return null;
	}

	/**
	 * List files using ripgrep
	 */
	private async listFilesWithRipgrep(
		dirPath: string,
		recursive: boolean,
		limit: number,
		token?: CancellationToken
	): Promise<string[]> {
		const args = this.buildRipgrepArgs(dirPath, recursive);
		const relativePaths = await this.execRipgrepForFiles(args, limit, token);

		// Convert relative paths to absolute paths
		const absolutePath = path.resolve(dirPath);
		return relativePaths.map(relativePath => path.join(absolutePath, relativePath));
	}

	/**
	 * Build ripgrep arguments for file listing
	 */
	private buildRipgrepArgs(dirPath: string, recursive: boolean): string[] {
		const args = ['--files', '--hidden', '--follow'];

		if (recursive) {
			// Recursive mode: respect .gitignore and apply exclusions
			this.applyDirectoryExclusions(args, dirPath, recursive);
		} else {
			// Non-recursive mode: limit to current directory level
			args.push('-g', '*');
			args.push('--max-depth', '1');
			this.applyDirectoryExclusions(args, dirPath, recursive);
		}

		args.push(dirPath);
		return args;
	}

	/**
	 * Apply directory exclusion patterns
	 */
	private applyDirectoryExclusions(args: string[], dirPath: string, recursive: boolean): void {
		const targetDirName = path.basename(dirPath);
		const normalizedPath = path.normalize(dirPath);
		const pathParts = normalizedPath.split(path.sep).filter(part => part.length > 0);
		const isTargetingHiddenDir = pathParts.some(part => part.startsWith('.'));
		const isTargetInIgnoreList = DIRS_TO_IGNORE.includes(targetDirName);

		if (isTargetingHiddenDir || isTargetInIgnoreList) {
			args.push('--no-ignore-vcs', '--no-ignore');
			args.push('-g', '*', '-g', '**/*');
		}

		for (const dir of DIRS_TO_IGNORE) {
			if (dir === '.*') {
				if (!isTargetingHiddenDir) {
					args.push('-g', recursive ? `!**/.*/**` : `!.*`);
				}
				continue;
			}

			if (dir === targetDirName && isTargetInIgnoreList) {
				continue;
			}

			if (recursive) {
				args.push('-g', `!**/${dir}/**`);
			} else {
				args.push('-g', `!${dir}`, '-g', `!${dir}/**`);
			}
		}
	}

	/**
	 * Execute ripgrep for file listing
	 */
	private async execRipgrepForFiles(
		args: string[],
		limit: number,
		token?: CancellationToken
	): Promise<string[]> {
		return new Promise((resolve, reject) => {
			const rgProcess = cp.spawn(rgDiskPath, args);
			let output = '';
			let results: string[] = [];

			// Set timeout
			const timeoutId = setTimeout(() => {
				rgProcess.kill();
				this.logService.warn('RipgrepService: Process timed out, returning partial results');
				resolve(results.slice(0, limit));
			}, RG_TIMEOUT);

			// Handle cancellation
			const cancellationListener = token?.onCancellationRequested(() => {
				rgProcess.kill();
				clearTimeout(timeoutId);
				reject(new Error('Operation cancelled'));
			});

			// Process stdout
			rgProcess.stdout.on('data', (data) => {
				output += data.toString();
				output = this.processOutputBuffer(output, results, limit);

				if (results.length >= limit) {
					rgProcess.kill();
					clearTimeout(timeoutId);
				}
			});

			// Process stderr
			rgProcess.stderr.on('data', (data) => {
				this.logService.error(`RipgrepService stderr: ${data}`);
			});

			// Handle process completion
			rgProcess.on('close', (code) => {
				clearTimeout(timeoutId);
				cancellationListener?.dispose();

				this.processOutputBuffer(output, results, limit, true);

				if (code !== 0 && code !== null && code !== 143 /* SIGTERM */) {
					this.logService.warn(`RipgrepService: Process exited with code ${code}, returning partial results`);
				}

				resolve(results.slice(0, limit));
			});

			// Handle process errors
			rgProcess.on('error', (error) => {
				clearTimeout(timeoutId);
				cancellationListener?.dispose();
				reject(new Error(`RipgrepService: Process error: ${error.message}`));
			});
		});
	}

	/**
	 * Process ripgrep output buffer
	 */
	private processOutputBuffer(output: string, results: string[], limit: number, isFinal = false): string {
		const lines = output.split('\n');
		const remaining = isFinal ? '' : (lines.pop() || '');

		for (const line of lines) {
			if (line.trim() && results.length < limit) {
				results.push(line);
			} else if (results.length >= limit) {
				break;
			}
		}

		return remaining;
	}

	/**
	 * Execute ripgrep and return output
	 */
	private async execRipgrep(args: string[], token?: CancellationToken): Promise<string> {
		return new Promise((resolve, reject) => {
			const rgProcess = cp.spawn(rgDiskPath, args);
			let output = '';
			let lineCount = 0;
			const maxLines = MAX_RESULTS * 5;

			// Handle cancellation
			const cancellationListener = token?.onCancellationRequested(() => {
				rgProcess.kill();
				reject(new Error('Operation cancelled'));
			});

			rgProcess.stdout.on('data', (data) => {
				const lines = data.toString().split('\n');
				for (const line of lines) {
					if (lineCount < maxLines) {
						output += line + '\n';
						lineCount++;
					} else {
						rgProcess.kill();
						break;
					}
				}
			});

			let errorOutput = '';
			rgProcess.stderr.on('data', (data) => {
				errorOutput += data.toString();
			});

			rgProcess.on('close', () => {
				cancellationListener?.dispose();
				if (errorOutput) {
					reject(new Error(`ripgrep process error: ${errorOutput}`));
				} else {
					resolve(output);
				}
			});

			rgProcess.on('error', (error) => {
				cancellationListener?.dispose();
				reject(new Error(`ripgrep process error: ${error.message}`));
			});
		});
	}

	/**
	 * Parse ripgrep JSON output for search results
	 */
	private parseSearchOutput(output: string): ISearchFileResult[] {
		const results: ISearchFileResult[] = [];
		let currentFile: ISearchFileResult | null = null;

		output.split('\n').forEach(line => {
			if (!line) {
				return;
			}

			try {
				const parsed = JSON.parse(line);

				if (parsed.type === 'begin') {
					currentFile = {
						file: parsed.data.path.text.toString(),
						searchResults: []
					};
				} else if (parsed.type === 'end') {
					if (currentFile) {
						results.push(currentFile);
						currentFile = null;
					}
				} else if ((parsed.type === 'match' || parsed.type === 'context') && currentFile) {
					const lineResult: ISearchLineResult = {
						line: parsed.data.line_number,
						text: this.truncateLine(parsed.data.lines.text),
						isMatch: parsed.type === 'match',
						...(parsed.type === 'match' && { column: parsed.data.absolute_offset })
					};

					const lastResult = currentFile.searchResults[currentFile.searchResults.length - 1];
					if (lastResult?.lines.length > 0) {
						const lastLine = lastResult.lines[lastResult.lines.length - 1];
						if (parsed.data.line_number <= lastLine.line + 1) {
							lastResult.lines.push(lineResult);
						} else {
							currentFile.searchResults.push({ lines: [lineResult] });
						}
					} else {
						currentFile.searchResults.push({ lines: [lineResult] });
					}
				}
			} catch (error) {
				this.logService.error('RipgrepService: Error parsing ripgrep output', error);
			}
		});

		return results;
	}

	/**
	 * Format search results for display
	 */
	private formatSearchResults(fileResults: ISearchFileResult[], cwd: string): string {
		const totalResults = fileResults.reduce((sum, file) => sum + file.searchResults.length, 0);
		let output = '';

		if (totalResults >= MAX_RESULTS) {
			output += `Showing first ${MAX_RESULTS} of ${MAX_RESULTS}+ results. Use a more specific search if necessary.\n\n`;
		} else {
			output += `Found ${totalResults === 1 ? '1 result' : `${totalResults.toLocaleString()} results`}.\n\n`;
		}

		const limitedResults = fileResults.slice(0, MAX_RESULTS);
		for (const fileResult of limitedResults) {
			const relativePath = path.relative(cwd, fileResult.file);
			output += `# ${relativePath}\n`;

			for (const result of fileResult.searchResults) {
				if (result.lines.length > 0) {
					for (const line of result.lines) {
						const lineNumber = String(line.line).padStart(3, ' ');
						output += `${lineNumber} | ${line.text.trimEnd()}\n`;
					}
					output += '----\n';
				}
			}

			output += '\n';
		}

		return output.trim();
	}

	/**
	 * Truncate a line if it exceeds the maximum length
	 */
	private truncateLine(line: string, maxLength: number = MAX_LINE_LENGTH): string {
		return line.length > maxLength ? line.substring(0, maxLength) + ' [truncated...]' : line;
	}

	/**
	 * Compare two paths for equality
	 */
	private arePathsEqual(path1: string, path2: string): boolean {
		if (isWindows) {
			return path1.toLowerCase() === path2.toLowerCase();
		}
		if (isMacintosh) {
			// Normalize for case-insensitive file systems on macOS
			return path1.normalize() === path2.normalize();
		}
		return path1 === path2;
	}
}

// Register the service
registerSingleton(IRipgrepService, RipgrepService, InstantiationType.Delayed);
