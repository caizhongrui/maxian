/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as path from 'path';
import { ISkill } from '../common/skillTypes.js';
import { SkillParser } from '../common/skillParser.js';
import { createStructuredLogger } from '../../../common/structuredLogger.js';

/**
 * Skill 扫描器
 *
 * 负责扫描指定目录，查找并解析所有 Skill 文件
 *
 * 目录结构：
 * ```
 * .claude/skills/
 * ├── code-review/
 * │   ├── SKILL.md        # Skill 主文件
 * │   ├── examples/       # 示例文件（可选）
 * │   │   └── example1.md
 * │   └── templates/      # 模板文件（可选）
 * │       └── template1.md
 * ├── git-workflow/
 * │   └── SKILL.md
 * └── debugging/
 *     └── SKILL.md
 * ```
 */
export class SkillScanner {
	private static readonly logger = createStructuredLogger('SkillScanner');

	private static readonly SKILL_FILENAME = 'SKILL.md';
	private static readonly EXAMPLES_DIR = 'examples';
	private static readonly TEMPLATES_DIR = 'templates';

	/**
	 * 扫描指定目录，查找所有 Skill
	 * @param skillsDir Skills 根目录路径
	 * @returns 所有找到的 Skill 数组
	 */
	static async scan(skillsDir: string): Promise<ISkill[]> {
		const skills: ISkill[] = [];

		try {
			// 检查目录是否存在
			if (!fs.existsSync(skillsDir)) {
				this.logger.warn('skills_directory_missing', { skillsDir });
				return skills;
			}

			// 读取目录
			const entries = fs.readdirSync(skillsDir, { withFileTypes: true });

			// 遍历每个子目录
			for (const entry of entries) {
				if (!entry.isDirectory()) {
					continue;
				}

				const skillDir = path.join(skillsDir, entry.name);
				const skillFilePath = path.join(skillDir, this.SKILL_FILENAME);

				// 检查 SKILL.md 是否存在
				if (!fs.existsSync(skillFilePath)) {
					this.logger.debug('skip_directory_without_skill_file', { skillDir });
					continue;
				}

				try {
					// 读取并解析 Skill 文件
					const content = fs.readFileSync(skillFilePath, 'utf-8');
					const skill = SkillParser.parse(content, skillFilePath);

					// 扫描示例和模板文件
					skill.examplePaths = this.scanSubdirectory(skillDir, this.EXAMPLES_DIR);
					skill.templatePaths = this.scanSubdirectory(skillDir, this.TEMPLATES_DIR);

					skills.push(skill);
					this.logger.debug('skill_loaded', { name: skill.name, slug: skill.slug });

				} catch (error) {
					this.logger.error('skill_parse_failed', { skillFilePath, error: String(error) });
				}
			}

			this.logger.debug('scan_completed', { skillsDir, count: skills.length });

		} catch (error) {
			this.logger.error('scan_directory_failed', { skillsDir, error: String(error) });
		}

		return skills;
	}

	/**
	 * 扫描子目录（examples 或 templates）
	 */
	private static scanSubdirectory(skillDir: string, subdirName: string): string[] | undefined {
		const subdirPath = path.join(skillDir, subdirName);

		if (!fs.existsSync(subdirPath)) {
			return undefined;
		}

		try {
			const files = fs.readdirSync(subdirPath, { withFileTypes: true });
			const filePaths = files
				.filter(file => file.isFile() && (file.name.endsWith('.md') || file.name.endsWith('.txt')))
				.map(file => path.join(subdirPath, file.name));

			return filePaths.length > 0 ? filePaths : undefined;

		} catch (error) {
			this.logger.warn('scan_subdirectory_failed', { subdirPath, error: String(error) });
			return undefined;
		}
	}

	/**
	 * 监听目录变化
	 * @param skillsDir Skills 根目录
	 * @param onChange 变化回调
	 * @returns 停止监听的函数
	 */
	static watch(skillsDir: string, onChange: () => void): () => void {
		if (!fs.existsSync(skillsDir)) {
			this.logger.warn('watch_directory_missing', { skillsDir });
			return () => { };
		}

		try {
			const watcher = fs.watch(skillsDir, { recursive: true }, (eventType, filename) => {
				if (filename && filename.includes(this.SKILL_FILENAME)) {
					this.logger.debug('skill_file_changed', { eventType, filename });
					onChange();
				}
			});

			this.logger.debug('watch_started', { skillsDir });

			return () => {
				watcher.close();
				this.logger.debug('watch_stopped', { skillsDir });
			};

		} catch (error) {
			this.logger.error('watch_failed', { skillsDir, error: String(error) });
			return () => { };
		}
	}

	/**
	 * 验证 Skills 目录结构
	 * @param skillsDir Skills 根目录
	 * @returns 验证结果
	 */
	static validate(skillsDir: string): { valid: boolean; errors: string[] } {
		const errors: string[] = [];

		// 检查根目录
		if (!fs.existsSync(skillsDir)) {
			errors.push(`Skills 目录不存在: ${skillsDir}`);
			return { valid: false, errors };
		}

		// 检查是否为目录
		const stats = fs.statSync(skillsDir);
		if (!stats.isDirectory()) {
			errors.push(`Skills 路径不是目录: ${skillsDir}`);
			return { valid: false, errors };
		}

		// 检查每个子目录
		const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
		const skillDirs = entries.filter(entry => entry.isDirectory());

		if (skillDirs.length === 0) {
			errors.push(`Skills 目录为空: ${skillsDir}`);
		}

		for (const dir of skillDirs) {
			const skillDir = path.join(skillsDir, dir.name);
			const skillFile = path.join(skillDir, this.SKILL_FILENAME);

			if (!fs.existsSync(skillFile)) {
				errors.push(`缺少 SKILL.md: ${skillDir}`);
			}
		}

		return {
			valid: errors.length === 0,
			errors
		};
	}
}
