/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Get build artifact patterns to exclude from checkpoints
 */
function getBuildArtifactPatterns(): string[] {
	return [
		'.gradle/',
		'.idea/',
		'.parcel-cache/',
		'.pytest_cache/',
		'.next/',
		'.nuxt/',
		'.sass-cache/',
		'.terraform/',
		'.terragrunt-cache/',
		'.vs/',
		'.vscode/',
		'Pods/',
		'__pycache__/',
		'bin/',
		'build/',
		'bundle/',
		'coverage/',
		'deps/',
		'dist/',
		'env/',
		'node_modules/',
		'obj/',
		'out/',
		'pkg/',
		'pycache/',
		'target/dependency/',
		'temp/',
		'vendor/',
		'venv/',
	];
}

/**
 * Get media file patterns to exclude from checkpoints
 */
function getMediaFilePatterns(): string[] {
	return [
		'*.jpg',
		'*.jpeg',
		'*.png',
		'*.gif',
		'*.bmp',
		'*.ico',
		'*.webp',
		'*.tiff',
		'*.tif',
		'*.raw',
		'*.heic',
		'*.avif',
		'*.eps',
		'*.psd',
		'*.3gp',
		'*.aac',
		'*.aiff',
		'*.asf',
		'*.avi',
		'*.divx',
		'*.flac',
		'*.m4a',
		'*.m4v',
		'*.mkv',
		'*.mov',
		'*.mp3',
		'*.mp4',
		'*.mpeg',
		'*.mpg',
		'*.ogg',
		'*.opus',
		'*.rm',
		'*.rmvb',
		'*.vob',
		'*.wav',
		'*.webm',
		'*.wma',
		'*.wmv',
	];
}

/**
 * Get cache file patterns to exclude from checkpoints
 */
function getCacheFilePatterns(): string[] {
	return [
		'*.DS_Store',
		'*.bak',
		'*.cache',
		'*.crdownload',
		'*.dmp',
		'*.dump',
		'*.eslintcache',
		'*.lock',
		'*.log',
		'*.old',
		'*.part',
		'*.partial',
		'*.pyc',
		'*.pyo',
		'*.stackdump',
		'*.swo',
		'*.swp',
		'*.temp',
		'*.tmp',
		'*.Thumbs.db',
	];
}

/**
 * Get config file patterns to exclude from checkpoints
 */
function getConfigFilePatterns(): string[] {
	return [
		'*.env*',
		'*.local',
		'*.development',
		'*.production'
	];
}

/**
 * Get large data file patterns to exclude from checkpoints
 */
function getLargeDataFilePatterns(): string[] {
	return [
		'*.zip',
		'*.tar',
		'*.gz',
		'*.rar',
		'*.7z',
		'*.iso',
		'*.bin',
		'*.exe',
		'*.dll',
		'*.so',
		'*.dylib',
		'*.dat',
		'*.dmg',
		'*.msi',
	];
}

/**
 * Get database file patterns to exclude from checkpoints
 */
function getDatabaseFilePatterns(): string[] {
	return [
		'*.arrow',
		'*.accdb',
		'*.aof',
		'*.avro',
		'*.bak',
		'*.bson',
		'*.csv',
		'*.db',
		'*.dbf',
		'*.dmp',
		'*.frm',
		'*.ibd',
		'*.mdb',
		'*.myd',
		'*.myi',
		'*.orc',
		'*.parquet',
		'*.pdb',
		'*.rdb',
		'*.sql',
		'*.sqlite',
	];
}

/**
 * Get log file patterns to exclude from checkpoints
 */
function getLogFilePatterns(): string[] {
	return [
		'*.error',
		'*.log',
		'*.logs',
		'*.npm-debug.log*',
		'*.out',
		'*.stdout',
		'yarn-debug.log*',
		'yarn-error.log*',
	];
}

/**
 * Get all exclude patterns for checkpoints
 */
export function getExcludePatterns(): string[] {
	return [
		'.git/',
		...getBuildArtifactPatterns(),
		...getMediaFilePatterns(),
		...getCacheFilePatterns(),
		...getConfigFilePatterns(),
		...getLargeDataFilePatterns(),
		...getDatabaseFilePatterns(),
		...getLogFilePatterns(),
	];
}
