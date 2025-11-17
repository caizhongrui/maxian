/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Custom Testing System Contribution
 *
 * This file registers the custom testing functionality that integrates with the
 * code analysis system. It provides automated test discovery and execution for
 * multiple programming languages and test frameworks.
 *
 * Features:
 * - Automatic test framework detection (Jest, Vitest, Pytest, JUnit, Go, Cargo)
 * - Test discovery across workspace
 * - Test execution with progress reporting
 * - Code coverage collection and reporting
 * - Folder-specific test runs
 *
 * Usage:
 * - Command Palette: "Discover Tests", "Run All Tests", "Run Tests with Coverage"
 * - Explorer Context Menu: Right-click folder -> "Run Tests in Folder"
 */

import { registerCustomTestActions } from './customTestActions.js';

// Register all custom testing actions
registerCustomTestActions();
