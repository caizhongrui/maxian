/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { URI } from '../../../../base/common/uri.js';

export const IProjectAnalyzerService = createDecorator<IProjectAnalyzerService>('projectAnalyzerService');

export interface ProjectStructure {
	readonly type: ProjectType;
	readonly framework: string | null;
	readonly language: string;
	readonly directories: DirectoryStructure;
	readonly dependencies: ProjectDependency[];
}

export interface DirectoryStructure {
	readonly src: string | null;
	readonly test: string | null;
	readonly config: string | null;
	readonly frontend: string | null;
	readonly backend: string | null;
}

export interface ProjectDependency {
	readonly name: string;
	readonly version: string;
	readonly type: 'runtime' | 'dev' | 'peer';
}

export type ProjectType =
	| 'spring-boot'
	| 'express'
	| 'react'
	| 'vue'
	| 'angular'
	| 'django'
	| 'fastapi'
	| 'go-gin'
	| 'rust-actix'
	| 'unknown';

export interface IProjectAnalyzerService {
	readonly _serviceBrand: undefined;

	/**
	 * Analyze project structure
	 */
	analyzeProject(workspaceUri: URI): Promise<ProjectStructure>;

	/**
	 * Detect project type
	 */
	detectProjectType(workspaceUri: URI): Promise<ProjectType>;

	/**
	 * Find best location for new file
	 */
	suggestFileLocation(fileName: string, fileType: 'controller' | 'service' | 'model' | 'component' | 'test'): Promise<string>;

	/**
	 * Get project dependencies
	 */
	getDependencies(workspaceUri: URI): Promise<ProjectDependency[]>;

	/**
	 * Detect base package from existing Java files
	 */
	detectBasePackage(workspaceUri: URI): Promise<string | null>;

	/**
	 * Detect package structure (controller, service, dto packages)
	 */
	detectPackageStructure(workspaceUri: URI): Promise<Record<string, string>>;

	/**
	 * Search for files related to a requirement
	 */
	searchRelatedFiles(workspaceUri: URI, keywords: string[]): Promise<Array<{ path: string; content: string; type: string }>>;
}
