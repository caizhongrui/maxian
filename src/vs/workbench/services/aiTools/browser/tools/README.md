# AI Tools for VS Code

This directory contains AI tools adapted from kilocode for use in VS Code.

## Overview

All tools have been adapted to use VS Code services instead of Node.js APIs:
- `fs` module → `IFileService`
- `path` module → `URI` utilities
- Task class dependencies → Standalone functions

## Tools

### File Operation Tools

1. **readFileTool.ts** - Read file contents with optional line ranges
2. **writeToFileTool.ts** - Write content to files
3. **editFileTool.ts** - Edit existing files (simplified version without Fast Apply)
4. **insertContentTool.ts** - Insert content at specific line numbers
5. **applyDiffTool.ts** - Apply SEARCH/REPLACE diff blocks

### File Browsing Tools

6. **listFilesTool.ts** - List files and directories
7. **searchFilesTool.ts** - Search for text using regex patterns

### Interaction Tools

8. **attemptCompletionTool.ts** - Mark task as completed
9. **askFollowupQuestionTool.ts** - Ask follow-up questions with suggestions

### Command Execution Tool

10. **executeCommandTool.ts** - Execute terminal commands (requires terminal service integration)

## Key Changes from Original

### 1. Import Paths
- All imports now use `.js` extension (VS Code style)
- Imports from VS Code modules use relative paths from `vs/` directory

### 2. File System Operations
- `fs.readFile()` → `fileService.readFile()`
- `fs.writeFile()` → `fileService.writeFile()`
- `fs.access()` → `fileService.exists()`
- `path.resolve()` → `URI.joinPath()`

### 3. Standalone Functions
- Removed Task class dependencies
- All tools are now pure functions
- Services are passed as parameters

### 4. Simplified Features
- Fast Apply feature removed from editFileTool (no OpenAI API calls)
- Ripgrep integration simplified in searchFilesTool
- Terminal execution simplified in executeCommandTool

## Usage Example

```typescript
import { readFileTool } from './tools/readFileTool.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { URI } from '../../../../../base/common/uri.js';

const result = await readFileTool(
	{ path: 'src/file.ts' },
	fileService,
	workspaceRoot
);

if (result.success) {
	console.log(result.content);
} else {
	console.error(result.error);
}
```

## Dependencies

All tools require:
- `IFileService` - For file operations
- `URI` - For path resolution
- Workspace root URI - Base path for relative file paths

## Notes

1. All file paths in parameters are relative to workspace root
2. All tools return a result object with `success` boolean
3. Errors are captured and returned in the result object
4. No direct file system access - all operations go through IFileService
