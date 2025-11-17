/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ToolDefinition } from './aiToolTypes.js';

/**
 * Tool Definitions for Function Calling - Based on Kilocode
 */

export const READ_FILE_TOOL: ToolDefinition = {
	type: 'function',
	function: {
		name: 'read_file',
		description: 'Read the contents of a file at the specified path. Use this when you need to examine the contents of an existing file you do not know the contents of, for example to analyze code, review text files, or extract information from configuration files.',
		parameters: {
			type: 'object',
			properties: {
				path: {
					type: 'string',
					description: 'The path of the file to read (relative to the current working directory)'
				}
			},
			required: ['path']
		}
	}
};

export const WRITE_TO_FILE_TOOL: ToolDefinition = {
	type: 'function',
	function: {
		name: 'write_to_file',
		description: 'Write content to a file at the specified path. If the file exists, it will be overwritten. If the file does not exist, it will be created. Always provide the COMPLETE intended content of the file, without any truncation or omissions.',
		parameters: {
			type: 'object',
			properties: {
				path: {
					type: 'string',
					description: 'The path of the file to write to (relative to the current working directory)'
				},
				content: {
					type: 'string',
					description: 'The COMPLETE content to write to the file. MUST include ALL parts of the file without any truncation.'
				}
			},
			required: ['path', 'content']
		}
	}
};

export const EDIT_FILE_TOOL: ToolDefinition = {
	type: 'function',
	function: {
		name: 'edit_file',
		description: 'Make line-based edits to a text file. Each edit replaces exact line sequences with new content. The new content can be a different number of lines than the original.',
		parameters: {
			type: 'object',
			properties: {
				path: {
					type: 'string',
					description: 'The path of the file to edit'
				},
				diff: {
					type: 'string',
					description: 'The diff content in unified diff format'
				},
				search: {
					type: 'string',
					description: 'The exact text to search for (will be replaced with replace parameter)'
				},
				replace: {
					type: 'string',
					description: 'The text to replace the search text with'
				}
			},
			required: ['path']
		}
	}
};

export const LIST_FILES_TOOL: ToolDefinition = {
	type: 'function',
	function: {
		name: 'list_files',
		description: 'List all files and directories at the top level of the specified directory. This will help you understand the structure of the project.',
		parameters: {
			type: 'object',
			properties: {
				path: {
					type: 'string',
					description: 'The path of the directory to list (relative to the current working directory, use "." for the root)'
				},
				recursive: {
					type: 'string',
					description: 'Whether to list files recursively (true/false)'
				}
			},
			required: ['path']
		}
	}
};

export const SEARCH_FILES_TOOL: ToolDefinition = {
	type: 'function',
	function: {
		name: 'search_files',
		description: 'Search for text/regex patterns in file contents. Returns matching lines with file paths and line numbers. Use file_pattern to filter which files to search (e.g., "*.java" for Java files).',
		parameters: {
			type: 'object',
			properties: {
				path: {
					type: 'string',
					description: 'The path of the directory to search in (use "." for current directory)'
				},
				regex: {
					type: 'string',
					description: 'The regular expression pattern to search for in file contents (e.g., "class.*Menu", "enableMobile")'
				},
				file_pattern: {
					type: 'string',
					description: 'Optional glob pattern to filter which files to search (e.g., "*.ts", "**/*.java", "**/entity/*.java")'
				}
			},
			required: ['path', 'regex']
		}
	}
};

export const EXECUTE_COMMAND_TOOL: ToolDefinition = {
	type: 'function',
	function: {
		name: 'execute_command',
		description: 'Execute a command in the terminal. This can be used to run build commands, tests, linters, or any other command line tools.',
		parameters: {
			type: 'object',
			properties: {
				command: {
					type: 'string',
					description: 'The command to execute'
				},
				cwd: {
					type: 'string',
					description: 'The working directory for the command (optional)'
				}
			},
			required: ['command']
		}
	}
};

export const ATTEMPT_COMPLETION_TOOL: ToolDefinition = {
	type: 'function',
	function: {
		name: 'attempt_completion',
		description: 'After each tool use, the user will respond with the result of that tool use. Once you have completed the task, use this tool to present the result of your work to the user.',
		parameters: {
			type: 'object',
			properties: {
				result: {
					type: 'string',
					description: 'The result of the task'
				},
				command: {
					type: 'string',
					description: 'Optional command to demonstrate the result'
				}
			},
			required: ['result']
		}
	}
};

export const ASK_FOLLOWUP_QUESTION_TOOL: ToolDefinition = {
	type: 'function',
	function: {
		name: 'ask_followup_question',
		description: 'Ask the user a question to gather additional information needed to complete the task.',
		parameters: {
			type: 'object',
			properties: {
				question: {
					type: 'string',
					description: 'The question to ask the user'
				}
			},
			required: ['question']
		}
	}
};

export const UPDATE_TODO_LIST_TOOL: ToolDefinition = {
	type: 'function',
	function: {
		name: 'update_todo_list',
		description: 'Update the task TODO list to track progress and organize work. The todo list helps break down complex tasks into manageable steps.',
		parameters: {
			type: 'object',
			properties: {
				todos: {
					type: 'string',
					description: 'JSON array of todo items'
				}
			},
			required: ['todos']
		}
	}
};

export const APPLY_DIFF_TOOL: ToolDefinition = {
	type: 'function',
	function: {
		name: 'apply_diff',
		description: 'Apply precise, targeted modifications to an existing file using search/replace blocks. This tool is for surgical edits only; the SEARCH block must exactly match the existing content, including whitespace and indentation.',
		parameters: {
			type: 'object',
			properties: {
				path: {
					type: 'string',
					description: 'The path of the file to modify, relative to the current workspace directory'
				},
				diff: {
					type: 'string',
					description: 'A string containing search/replace block. Format:\n<<<<<<< SEARCH\n:start_line:[line_number]\n-------\n[exact content to find]\n=======\n[new content to replace with]\n>>>>>>> REPLACE'
				}
			},
			required: ['path', 'diff']
		}
	}
};

export const INSERT_CONTENT_TOOL: ToolDefinition = {
	type: 'function',
	function: {
		name: 'insert_content',
		description: 'Insert new lines into a file without modifying existing content. Choose a line number to insert before, or use 0 to append to the end.',
		parameters: {
			type: 'object',
			properties: {
				path: {
					type: 'string',
					description: 'File path to modify, expressed relative to the workspace'
				},
				line: {
					type: 'number',
					description: '1-based line number to insert before, or 0 to append at the end of the file'
				},
				content: {
					type: 'string',
					description: 'Exact text to insert at the chosen location'
				}
			},
			required: ['path', 'line', 'content']
		}
	}
};

export const LIST_CODE_DEFINITION_NAMES_TOOL: ToolDefinition = {
	type: 'function',
	function: {
		name: 'list_code_definition_names',
		description: 'List definition names (classes, functions, methods, etc.) from source files to understand code structure. Works on a single file or across all top-level files in a directory.',
		parameters: {
			type: 'object',
			properties: {
				path: {
					type: 'string',
					description: 'Path to the file or directory to analyze, relative to the workspace'
				}
			},
			required: ['path']
		}
	}
};

export const CODEBASE_SEARCH_TOOL: ToolDefinition = {
	type: 'function',
	function: {
		name: 'codebase_search',
		description: 'Run a semantic search across the workspace to find files relevant to a natural-language query. Reuse the user\'s wording where possible and keep queries in English.',
		parameters: {
			type: 'object',
			properties: {
				query: {
					type: 'string',
					description: 'Meaning-based search query describing the information you need'
				},
				path: {
					type: 'string',
					description: 'Optional subdirectory (relative to the workspace) to limit the search scope'
				}
			},
			required: ['query']
		}
	}
};

export const BROWSER_ACTION_TOOL: ToolDefinition = {
	type: 'function',
	function: {
		name: 'browser_action',
		description: 'Interact with a Puppeteer-controlled browser session. Always start by launching at a URL and always finish by closing the browser.',
		parameters: {
			type: 'object',
			properties: {
				action: {
					type: 'string',
					description: 'Browser action to perform',
					enum: ['launch', 'hover', 'click', 'type', 'resize', 'scroll_down', 'scroll_up', 'close']
				},
				url: {
					type: 'string',
					description: 'URL to open when performing the launch action'
				},
				coordinate: {
					type: 'string',
					description: 'Screen coordinate for hover or click actions (format: "x,y")'
				},
				text: {
					type: 'string',
					description: 'Text to type when performing the type action'
				}
			},
			required: ['action']
		}
	}
};

export const SWITCH_MODE_TOOL: ToolDefinition = {
	type: 'function',
	function: {
		name: 'switch_mode',
		description: 'Request a switch to a different assistant mode. The user must approve the change before it takes effect.',
		parameters: {
			type: 'object',
			properties: {
				mode_slug: {
					type: 'string',
					description: 'Slug of the mode to switch to (e.g., chat, agent, architect)'
				},
				reason: {
					type: 'string',
					description: 'Explanation for why the mode switch is needed'
				}
			},
			required: ['mode_slug', 'reason']
		}
	}
};

export const NEW_TASK_TOOL: ToolDefinition = {
	type: 'function',
	function: {
		name: 'new_task',
		description: 'Create a new task instance in a specified mode, supplying the initial instructions.',
		parameters: {
			type: 'object',
			properties: {
				mode: {
					type: 'string',
					description: 'Slug of the mode to begin the new task in (e.g., chat, agent, architect)'
				},
				message: {
					type: 'string',
					description: 'Initial user instructions or context for the new task'
				}
			},
			required: ['mode', 'message']
		}
	}
};

export const RUN_SLASH_COMMAND_TOOL: ToolDefinition = {
	type: 'function',
	function: {
		name: 'run_slash_command',
		description: 'Execute a predefined slash command to receive detailed instructions or content for a common task.',
		parameters: {
			type: 'object',
			properties: {
				command: {
					type: 'string',
					description: 'Name of the slash command to run (e.g., init, test, deploy)'
				},
				args: {
					type: 'string',
					description: 'Optional additional context or arguments for the command'
				}
			},
			required: ['command']
		}
	}
};

export const GENERATE_IMAGE_TOOL: ToolDefinition = {
	type: 'function',
	function: {
		name: 'generate_image',
		description: 'Create a new image or edit an existing one using image models. Provide a prompt describing the desired output.',
		parameters: {
			type: 'object',
			properties: {
				prompt: {
					type: 'string',
					description: 'Text description of the image to generate or the edits to apply'
				},
				path: {
					type: 'string',
					description: 'Filesystem path (relative to the workspace) where the resulting image should be saved'
				},
				image: {
					type: 'string',
					description: 'Optional path (relative to the workspace) to an existing image to edit'
				}
			},
			required: ['prompt', 'path']
		}
	}
};

export const FETCH_INSTRUCTIONS_TOOL: ToolDefinition = {
	type: 'function',
	function: {
		name: 'fetch_instructions',
		description: 'Retrieve detailed instructions for performing a predefined task.',
		parameters: {
			type: 'object',
			properties: {
				task: {
					type: 'string',
					description: 'Task identifier to fetch instructions for',
					enum: ['create_mcp_server', 'create_mode']
				}
			},
			required: ['task']
		}
	}
};

// All tools array - now includes all 19 tools
export const ALL_TOOLS: ToolDefinition[] = [
	READ_FILE_TOOL,
	WRITE_TO_FILE_TOOL,
	EDIT_FILE_TOOL,
	LIST_FILES_TOOL,
	SEARCH_FILES_TOOL,
	EXECUTE_COMMAND_TOOL,
	ATTEMPT_COMPLETION_TOOL,
	ASK_FOLLOWUP_QUESTION_TOOL,
	UPDATE_TODO_LIST_TOOL,
	APPLY_DIFF_TOOL,
	INSERT_CONTENT_TOOL,
	LIST_CODE_DEFINITION_NAMES_TOOL,
	CODEBASE_SEARCH_TOOL,
	BROWSER_ACTION_TOOL,
	SWITCH_MODE_TOOL,
	NEW_TASK_TOOL,
	RUN_SLASH_COMMAND_TOOL,
	GENERATE_IMAGE_TOOL,
	FETCH_INSTRUCTIONS_TOOL
];

// Get tools for a specific mode
export function getToolsForMode(mode: 'chat' | 'agent' | 'architect'): ToolDefinition[] {
	switch (mode) {
		case 'agent':
			// Agent mode has all tools
			return ALL_TOOLS;
		case 'architect':
			// Architect mode only has read tools and task management
			return [
				READ_FILE_TOOL,
				LIST_FILES_TOOL,
				SEARCH_FILES_TOOL,
				ASK_FOLLOWUP_QUESTION_TOOL,
				UPDATE_TODO_LIST_TOOL
			];
		case 'chat':
		default:
			// Chat mode only has read tools
			return [
				READ_FILE_TOOL,
				LIST_FILES_TOOL,
				SEARCH_FILES_TOOL
			];
	}
}
