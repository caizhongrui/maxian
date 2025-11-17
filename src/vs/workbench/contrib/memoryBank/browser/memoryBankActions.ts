/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize2 } from '../../../../nls.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { IMemoryBankService } from '../../../services/memoryBank/common/memoryBank.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { URI } from '../../../../base/common/uri.js';

/**
 * 初始化 Memory Bank
 */
class InitializeMemoryBankAction extends Action2 {
	constructor() {
		super({
			id: 'memoryBank.initialize',
			title: localize2('memoryBank.initialize', '初始化项目记忆库'),
			category: localize2('memoryBank.category', 'Memory Bank'),
			f1: true
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const memoryBankService = accessor.get(IMemoryBankService);
		const workspaceService = accessor.get(IWorkspaceContextService);
		const notificationService = accessor.get(INotificationService);

		const workspace = workspaceService.getWorkspace();
		if (!workspace.folders.length) {
			notificationService.warn('请先打开一个工作区');
			return;
		}

		const workspaceUri = workspace.folders[0].uri;

		try {
			await memoryBankService.initialize(workspaceUri);
			notificationService.info('Memory Bank 初始化成功！');
		} catch (error) {
			notificationService.error(`初始化失败: ${error}`);
		}
	}
}

/**
 * 学习项目结构
 */
class LearnProjectStructureAction extends Action2 {
	constructor() {
		super({
			id: 'memoryBank.learnProjectStructure',
			title: localize2('memoryBank.learnProjectStructure', '学习项目结构'),
			category: localize2('memoryBank.category', 'Memory Bank'),
			f1: true
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const memoryBankService = accessor.get(IMemoryBankService);
		const workspaceService = accessor.get(IWorkspaceContextService);
		const notificationService = accessor.get(INotificationService);

		const workspace = workspaceService.getWorkspace();
		if (!workspace.folders.length) {
			notificationService.warn('请先打开一个工作区');
			return;
		}

		const workspaceUri = workspace.folders[0].uri;

		try {
			notificationService.info('正在分析项目结构...');
			await memoryBankService.learnProjectStructure(workspaceUri);
			notificationService.info('项目结构学习完成！');
		} catch (error) {
			notificationService.error(`学习失败: ${error}`);
		}
	}
}

/**
 * 学习编码规范
 */
class LearnCodingStyleAction extends Action2 {
	constructor() {
		super({
			id: 'memoryBank.learnCodingStyle',
			title: localize2('memoryBank.learnCodingStyle', '学习编码规范'),
			category: localize2('memoryBank.category', 'Memory Bank'),
			f1: true
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const memoryBankService = accessor.get(IMemoryBankService);
		const workspaceService = accessor.get(IWorkspaceContextService);
		const notificationService = accessor.get(INotificationService);
		const fileService = accessor.get(IFileService);

		const workspace = workspaceService.getWorkspace();
		if (!workspace.folders.length) {
			notificationService.warn('请先打开一个工作区');
			return;
		}

		const workspaceUri = workspace.folders[0].uri;

		try {
			notificationService.info('正在分析代码风格...');

			// 查找示例文件
			const sampleFiles = await this.findSampleFiles(workspaceUri, fileService);

			if (sampleFiles.length === 0) {
				notificationService.warn('未找到可分析的代码文件');
				return;
			}

			await memoryBankService.learnCodingStyle(workspaceUri, sampleFiles);
			notificationService.info('编码规范学习完成！');
		} catch (error) {
			notificationService.error(`学习失败: ${error}`);
		}
	}

	private async findSampleFiles(workspaceUri: URI, fileService: IFileService): Promise<URI[]> {
		const sampleFiles: URI[] = [];

		try {
			// 尝试在 src 目录中查找文件
			const srcDir = URI.joinPath(workspaceUri, 'src');
			await this.scanDirectory(srcDir, sampleFiles, fileService, 0);
		} catch {
			// src 目录不存在，尝试根目录
			await this.scanDirectory(workspaceUri, sampleFiles, fileService, 0);
		}

		return sampleFiles;
	}

	private async scanDirectory(
		dirUri: URI,
		files: URI[],
		fileService: IFileService,
		depth: number
	): Promise<void> {
		if (depth > 3 || files.length >= 5) {
			return;
		}

		try {
			const dir = await fileService.resolve(dirUri);

			if (dir.children) {
				for (const child of dir.children) {
					if (files.length >= 5) break;

					if (child.isDirectory && !['node_modules', 'target', 'build', 'dist'].includes(child.name)) {
						await this.scanDirectory(child.resource, files, fileService, depth + 1);
					} else if (
						child.name.endsWith('.ts') ||
						child.name.endsWith('.js') ||
						child.name.endsWith('.java') ||
						child.name.endsWith('.py')
					) {
						files.push(child.resource);
					}
				}
			}
		} catch {
			// 目录不存在或无法访问
		}
	}
}

/**
 * 添加自定义记忆条目
 */
class AddCustomMemoryAction extends Action2 {
	constructor() {
		super({
			id: 'memoryBank.addCustomMemory',
			title: localize2('memoryBank.addCustomMemory', '添加自定义记忆'),
			category: localize2('memoryBank.category', 'Memory Bank'),
			f1: true
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const memoryBankService = accessor.get(IMemoryBankService);
		const workspaceService = accessor.get(IWorkspaceContextService);
		const notificationService = accessor.get(INotificationService);
		const quickInputService = accessor.get(IQuickInputService);

		const workspace = workspaceService.getWorkspace();
		if (!workspace.folders.length) {
			notificationService.warn('请先打开一个工作区');
			return;
		}

		const workspaceUri = workspace.folders[0].uri;

		// 输入标题
		const title = await quickInputService.input({
			prompt: '输入记忆条目标题',
			placeHolder: '例如: 数据库连接规范'
		});

		if (!title) {
			return;
		}

		// 输入内容
		const content = await quickInputService.input({
			prompt: '输入记忆条目内容',
			placeHolder: '详细描述...'
		});

		if (!content) {
			return;
		}

		// 选择类别
		const category = await quickInputService.pick([
			{ label: '架构设计', value: 'architecture' },
			{ label: '编码规范', value: 'coding-style' },
			{ label: '项目结构', value: 'project-structure' },
			{ label: '依赖关系', value: 'dependencies' },
			{ label: '最佳实践', value: 'best-practices' },
			{ label: '常用模式', value: 'common-patterns' },
			{ label: '自定义', value: 'custom' }
		], {
			placeHolder: '选择记忆类别'
		});

		if (!category) {
			return;
		}

		// 输入标签
		const tagsInput = await quickInputService.input({
			prompt: '输入标签（用逗号分隔）',
			placeHolder: 'tag1, tag2, tag3'
		});

		const tags = tagsInput ? tagsInput.split(',').map(t => t.trim()) : [];

		try {
			await memoryBankService.addEntry(workspaceUri, {
				title,
				content,
				category: category.value as any,
				tags
			});

			notificationService.info('记忆条目已添加！');
		} catch (error) {
			notificationService.error(`添加失败: ${error}`);
		}
	}
}

/**
 * 查看所有记忆条目
 */
class ViewAllMemoriesAction extends Action2 {
	constructor() {
		super({
			id: 'memoryBank.viewAll',
			title: localize2('memoryBank.viewAll', '查看所有记忆'),
			category: localize2('memoryBank.category', 'Memory Bank'),
			f1: true
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const memoryBankService = accessor.get(IMemoryBankService);
		const workspaceService = accessor.get(IWorkspaceContextService);
		const notificationService = accessor.get(INotificationService);
		const quickInputService = accessor.get(IQuickInputService);

		const workspace = workspaceService.getWorkspace();
		if (!workspace.folders.length) {
			notificationService.warn('请先打开一个工作区');
			return;
		}

		const workspaceUri = workspace.folders[0].uri;

		try {
			const entries = await memoryBankService.getAllEntries(workspaceUri);

			if (entries.length === 0) {
				notificationService.info('暂无记忆条目，请先学习项目或添加自定义记忆');
				return;
			}

			const picks = entries.map(entry => ({
				label: entry.title,
				description: entry.category,
				detail: entry.content.substring(0, 100) + '...',
				entry
			}));

			const selected = await quickInputService.pick(picks, {
				placeHolder: '选择要查看的记忆条目'
			});

			if (selected) {
				notificationService.info(`
标题: ${selected.entry.title}
类别: ${selected.entry.category}
标签: ${selected.entry.tags.join(', ')}

${selected.entry.content}
				`);
			}
		} catch (error) {
			notificationService.error(`查看失败: ${error}`);
		}
	}
}

/**
 * 生成项目上下文摘要
 */
class GenerateContextSummaryAction extends Action2 {
	constructor() {
		super({
			id: 'memoryBank.generateContextSummary',
			title: localize2('memoryBank.generateContextSummary', '生成项目上下文摘要'),
			category: localize2('memoryBank.category', 'Memory Bank'),
			f1: true
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const memoryBankService = accessor.get(IMemoryBankService);
		const workspaceService = accessor.get(IWorkspaceContextService);
		const notificationService = accessor.get(INotificationService);

		const workspace = workspaceService.getWorkspace();
		if (!workspace.folders.length) {
			notificationService.warn('请先打开一个工作区');
			return;
		}

		const workspaceUri = workspace.folders[0].uri;

		try {
			const summary = await memoryBankService.generateContextSummary(workspaceUri);

			if (!summary) {
				notificationService.info('暂无记忆条目，无法生成摘要');
				return;
			}

			console.log('=== 项目上下文摘要 ===');
			console.log(summary);
			console.log('======================');

			notificationService.info('项目上下文摘要已生成并输出到控制台');
		} catch (error) {
			notificationService.error(`生成失败: ${error}`);
		}
	}
}

// 注册所有 actions
registerAction2(InitializeMemoryBankAction);
registerAction2(LearnProjectStructureAction);
registerAction2(LearnCodingStyleAction);
registerAction2(AddCustomMemoryAction);
registerAction2(ViewAllMemoriesAction);
registerAction2(GenerateContextSummaryAction);
