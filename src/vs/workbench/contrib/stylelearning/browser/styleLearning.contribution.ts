/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IAIService } from '../../../../platform/ai/common/ai.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IProgressService, ProgressLocation } from '../../../../platform/progress/common/progress.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { URI } from '../../../../base/common/uri.js';
import { CancellationToken, CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { registerAction2, Action2, MenuId } from '../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { localize2 } from '../../../../nls.js';
import { KeyMod, KeyCode } from '../../../../base/common/keyCodes.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';

import { EnhancedProfile, LearningProgress } from '../common/styleTypes.js';
import { CodeScanner } from '../common/codeScanner.js';
import { StyleAnalyzer } from '../common/styleAnalyzer.js';
import { AIEnhancer } from '../common/aiEnhancer.js';
import { StyleStore, StyleProfileCache } from '../common/styleStore.js';

/**
 * 代码风格学习服务接口
 */
export interface IStyleLearningService {
	readonly _serviceBrand: undefined;

	/**
	 * 学习项目代码风格
	 */
	learnProjectStyle(
		workspaceFolder?: URI,
		options?: StyleLearningOptions
	): Promise<EnhancedProfile | null>;

	/**
	 * 获取当前项目的风格配置
	 */
	getProjectStyle(workspaceFolder?: URI): Promise<EnhancedProfile | null>;

	/**
	 * 检查项目是否有风格配置
	 */
	hasProjectStyle(workspaceFolder?: URI): Promise<boolean>;

	/**
	 * 刷新项目风格配置
	 */
	refreshProjectStyle(workspaceFolder?: URI): Promise<EnhancedProfile | null>;

	/**
	 * 删除项目风格配置
	 */
	deleteProjectStyle(workspaceFolder?: URI): Promise<void>;

	/**
	 * 获取风格配置作为 AI Prompt 的一部分
	 */
	getStylePromptContext(workspaceFolder?: URI): Promise<string>;
}

export const IStyleLearningService = createDecorator<IStyleLearningService>('styleLearningService');

/**
 * 风格学习选项
 */
export interface StyleLearningOptions {
	/** 是否强制重新学习（忽略现有配置） */
	force?: boolean;
	/** 是否使用 AI 增强 */
	useAI?: boolean;
	/** 取消令牌 */
	token?: CancellationToken;
}

/**
 * 代码风格学习服务实现
 */
class StyleLearningService extends Disposable implements IStyleLearningService {

	declare readonly _serviceBrand: undefined;

	private readonly scanner: CodeScanner;
	private readonly analyzer: StyleAnalyzer;
	private readonly enhancer: AIEnhancer;
	private readonly store: StyleStore;
	private readonly cache: StyleProfileCache;

	constructor(
		@IFileService fileService: IFileService,
		@IAIService aiService: IAIService,
		@IWorkspaceContextService private readonly workspaceService: IWorkspaceContextService,
		@INotificationService private readonly notificationService: INotificationService,
		@IProgressService private readonly progressService: IProgressService
	) {
		super();

		this.scanner = new CodeScanner(fileService);
		this.analyzer = new StyleAnalyzer();
		this.enhancer = new AIEnhancer(aiService);
		this.store = new StyleStore(fileService);
		this.cache = new StyleProfileCache();
	}

	/**
	 * 学习项目代码风格
	 */
	async learnProjectStyle(
		workspaceFolder?: URI,
		options?: StyleLearningOptions
	): Promise<EnhancedProfile | null> {
		const folder = workspaceFolder || this.getDefaultWorkspaceFolder();
		if (!folder) {
			this.notificationService.error('请先打开一个工作区');
			return null;
		}

		// 检查是否已有配置且不强制重新学习
		if (!options?.force) {
			const existing = await this.getProjectStyle(folder);
			if (existing) {
				return existing;
			}
		}

		const tokenSource = new CancellationTokenSource();
		const token = options?.token || tokenSource.token;

		try {
			return await this.progressService.withProgress({
				location: ProgressLocation.Notification,
				title: '正在学习项目代码风格...',
				cancellable: true
			}, async (progress) => {
				// 1. 扫描项目文件
				progress.report({ message: '正在扫描项目文件...', increment: 10 });
				const files = await this.scanner.scanProject(
					folder,
					(p) => this.reportProgress(progress, p),
					token
				);

				if (files.length === 0) {
					this.notificationService.warn('未找到可分析的源代码文件');
					return null;
				}

				// 2. 分析代码风格
				progress.report({ message: '正在分析代码风格...', increment: 30 });
				const projectId = this.generateProjectId(folder);
				const projectName = this.getProjectName(folder);

				const profile = await this.analyzer.analyzeProject(
					files,
					projectId,
					projectName,
					(p) => this.reportProgress(progress, p),
					token
				);

				// 3. AI 增强（可选）
				let enhanced: EnhancedProfile;
				if (options?.useAI !== false) {
					progress.report({ message: '正在使用 AI 增强分析...', increment: 50 });
					enhanced = await this.enhancer.enhanceProfile(
						profile,
						(p) => this.reportProgress(progress, p),
						token
					);
				} else {
					// 不使用 AI，创建基础增强配置
					enhanced = {
						...profile,
						bestPractices: [],
						patterns: [],
						styleSummary: '项目代码风格已分析完成。'
					};
				}

				// 4. 保存配置
				progress.report({ message: '正在保存配置...', increment: 90 });
				await this.store.saveProfile(folder, enhanced);

				// 5. 更新缓存
				this.cache.set(folder.fsPath, enhanced);

				progress.report({ message: '完成！', increment: 100 });

				this.notificationService.info(
					`代码风格学习完成！分析了 ${files.length} 个文件，${profile.totalLines} 行代码。`
				);

				return enhanced;
			});
		} catch (error) {
			this.notificationService.error('代码风格学习失败: ' + error);
			return null;
		} finally {
			tokenSource.dispose();
		}
	}

	/**
	 * 获取当前项目的风格配置
	 */
	async getProjectStyle(workspaceFolder?: URI): Promise<EnhancedProfile | null> {
		const folder = workspaceFolder || this.getDefaultWorkspaceFolder();
		if (!folder) {
			return null;
		}

		// 先检查缓存
		const cached = this.cache.get(folder.fsPath);
		if (cached) {
			return cached;
		}

		// 从文件加载
		const profile = await this.store.loadProfile(folder);
		if (profile) {
			this.cache.set(folder.fsPath, profile);
		}

		return profile;
	}

	/**
	 * 检查项目是否有风格配置
	 */
	async hasProjectStyle(workspaceFolder?: URI): Promise<boolean> {
		const folder = workspaceFolder || this.getDefaultWorkspaceFolder();
		if (!folder) {
			return false;
		}

		return await this.store.profileExists(folder);
	}

	/**
	 * 刷新项目风格配置
	 */
	async refreshProjectStyle(workspaceFolder?: URI): Promise<EnhancedProfile | null> {
		const folder = workspaceFolder || this.getDefaultWorkspaceFolder();
		if (!folder) {
			return null;
		}

		// 清除缓存
		this.cache.clear(folder.fsPath);

		// 重新学习
		return await this.learnProjectStyle(folder, { force: true });
	}

	/**
	 * 删除项目风格配置
	 */
	async deleteProjectStyle(workspaceFolder?: URI): Promise<void> {
		const folder = workspaceFolder || this.getDefaultWorkspaceFolder();
		if (!folder) {
			return;
		}

		await this.store.deleteProfile(folder);
		this.cache.clear(folder.fsPath);

		this.notificationService.info('项目代码风格配置已删除');
	}

	/**
	 * 获取风格配置作为 AI Prompt 的一部分
	 */
	async getStylePromptContext(workspaceFolder?: URI): Promise<string> {
		const profile = await this.getProjectStyle(workspaceFolder);
		if (!profile) {
			return '';
		}

		return this.buildStylePromptContext(profile);
	}

	// ==================== 私有辅助方法 ====================

	/**
	 * 获取默认工作区文件夹
	 */
	private getDefaultWorkspaceFolder(): URI | undefined {
		const workspace = this.workspaceService.getWorkspace();
		return workspace.folders[0]?.uri;
	}

	/**
	 * 生成项目 ID
	 */
	private generateProjectId(folder: URI): string {
		// 使用文件夹路径的哈希作为项目 ID
		const path = folder.fsPath;
		let hash = 0;
		for (let i = 0; i < path.length; i++) {
			const char = path.charCodeAt(i);
			hash = ((hash << 5) - hash) + char;
			hash = hash & hash; // Convert to 32bit integer
		}
		return 'project_' + Math.abs(hash).toString(16);
	}

	/**
	 * 获取项目名称
	 */
	private getProjectName(folder: URI): string {
		const parts = folder.fsPath.split('/');
		return parts[parts.length - 1] || 'Unknown Project';
	}

	/**
	 * 报告进度
	 */
	private reportProgress(
		progress: any,
		learningProgress: LearningProgress
	): void {
		progress.report({
			message: learningProgress.message,
			increment: learningProgress.progress
		});
	}

	/**
	 * 构建风格 Prompt 上下文
	 */
	private buildStylePromptContext(profile: EnhancedProfile): string {
		const parts: string[] = [];

		parts.push('【项目代码风格规范】');
		parts.push(`项目: ${profile.projectName}`);
		parts.push(`主要语言: ${profile.primaryLanguage}`);
		parts.push('');

		parts.push('命名规范:');
		parts.push(`- 类名使用 ${profile.naming.classPattern}`);
		if (profile.naming.classSuffix.length > 0) {
			parts.push(`- 常见类名后缀: ${profile.naming.classSuffix.join(', ')}`);
		}
		parts.push(`- 方法名使用 ${profile.naming.methodPattern}`);
		if (profile.naming.methodPrefix.length > 0) {
			parts.push(`- 常见方法名前缀: ${profile.naming.methodPrefix.join(', ')}`);
		}
		parts.push('');

		parts.push('代码格式:');
		parts.push(`- 缩进: ${profile.structure.indentation === 'tab' ? 'Tab' : profile.structure.indentSize + ' spaces'}`);
		parts.push(`- 大括号: ${profile.structure.braceStyle === 'same-line' ? '同行' : '换行'}`);
		parts.push(`- 引号: ${profile.structure.quoteStyle === 'single' ? '单引号' : '双引号'}`);
		parts.push(`- 分号: ${profile.structure.useSemicolon ? '使用' : '不使用'}`);
		parts.push('');

		if (profile.comments.requireMethodComment) {
			parts.push('注释要求:');
			parts.push(`- 方法需要 ${profile.comments.methodCommentStyle} 风格的注释`);
			parts.push(`- 注释语言: ${profile.comments.commentLanguage === 'zh' ? '中文' : profile.comments.commentLanguage === 'en' ? '英文' : '中英文混合'}`);
			parts.push('');
		}

		if (profile.bestPractices.length > 0) {
			parts.push('最佳实践:');
			profile.bestPractices.forEach(practice => {
				parts.push(`- ${practice}`);
			});
			parts.push('');
		}

		parts.push('请严格遵循以上项目代码风格生成代码。');

		return parts.join('\n');
	}
}

// 注册服务
registerSingleton(IStyleLearningService, StyleLearningService, InstantiationType.Delayed);

// ==================== 命令注册 ====================

/**
 * 学习项目代码风格命令
 */
registerAction2(class LearnProjectStyleAction extends Action2 {
	constructor() {
		super({
			id: 'zhikai.learnProjectStyle',
			title: localize2('learnProjectStyle.title', '学习项目代码风格'),
			category: localize2('zhikai.category', '天和·码弦'),
			f1: true,
			keybinding: {
				primary: KeyMod.Alt | KeyMod.Shift | KeyCode.KeyL,
				weight: 100,
				when: ContextKeyExpr.true()
			},
			menu: [
				{
					id: MenuId.ExplorerContext,
					group: 'zhikai@1',
					order: 1
				},
				{
					id: MenuId.EditorContext,
					group: 'zhikai@1',
					order: 1
				},
				{
					id: MenuId.CommandPalette
				}
			]
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const styleLearningService = accessor.get(IStyleLearningService);
		const quickInputService = accessor.get(IQuickInputService);

		// 询问是否使用 AI 增强
		const choice = await quickInputService.pick([
			{ label: '使用 AI 增强分析', description: '推荐：获得更详细的最佳实践和代码模式', value: true },
			{ label: '仅统计分析', description: '快速分析，不使用 AI', value: false }
		], {
			title: '选择分析模式',
			placeHolder: '请选择代码风格学习的分析模式'
		});

		if (!choice) {
			return;
		}

		await styleLearningService.learnProjectStyle(undefined, {
			force: true,
			useAI: choice.value
		});
	}
});

/**
 * 查看项目代码风格命令
 */
registerAction2(class ViewProjectStyleAction extends Action2 {
	constructor() {
		super({
			id: 'zhikai.viewProjectStyle',
			title: localize2('viewProjectStyle.title', '查看项目代码风格'),
			category: localize2('zhikai.category', '天和·码弦'),
			f1: true,
			menu: [
				{
					id: MenuId.ExplorerContext,
					group: 'zhikai@2',
					order: 2
				},
				{
					id: MenuId.EditorContext,
					group: 'zhikai@2',
					order: 2
				},
				{
					id: MenuId.CommandPalette
				}
			]
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const styleLearningService = accessor.get(IStyleLearningService);
		const quickInputService = accessor.get(IQuickInputService);
		const notificationService = accessor.get(INotificationService);

		const profile = await styleLearningService.getProjectStyle();

		if (!profile) {
			notificationService.info('当前项目还没有学习代码风格，请先运行"学习项目代码风格"命令');
			return;
		}

		// 显示风格总结
		const items = [
			{ label: '$(info) 项目信息', description: `${profile.projectName} - ${profile.primaryLanguage}` },
			{ label: '$(folder) 分析范围', description: `${profile.fileCount} 个文件，${profile.totalLines} 行代码` },
			{ label: '$(symbol-class) 命名规范', description: `类名: ${profile.naming.classPattern}, 方法名: ${profile.naming.methodPattern}` },
			{ label: '$(symbol-structure) 代码格式', description: `${profile.structure.indentation}缩进, ${profile.structure.braceStyle}大括号` },
			{ label: '$(comment) 注释风格', description: profile.comments.commentLanguage === 'zh' ? '中文注释' : profile.comments.commentLanguage === 'en' ? '英文注释' : '中英文混合' },
			{ label: '$(verified) 置信度', description: `${(profile.confidence * 100).toFixed(0)}%` }
		];

		if (profile.styleSummary) {
			items.push({ label: '', description: '' });
			items.push({ label: '$(book) 风格总结', description: '' });
			items.push({ label: profile.styleSummary, description: '' });
		}

		await quickInputService.pick(items, {
			title: '项目代码风格',
			placeHolder: '按 ESC 关闭'
		});
	}
});

/**
 * 刷新项目代码风格命令
 */
registerAction2(class RefreshProjectStyleAction extends Action2 {
	constructor() {
		super({
			id: 'zhikai.refreshProjectStyle',
			title: localize2('refreshProjectStyle.title', '刷新项目代码风格'),
			category: localize2('zhikai.category', '天和·码弦'),
			f1: true,
			menu: [
				{
					id: MenuId.ExplorerContext,
					group: 'zhikai@3',
					order: 3
				},
				{
					id: MenuId.CommandPalette
				}
			]
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const styleLearningService = accessor.get(IStyleLearningService);

		await styleLearningService.refreshProjectStyle();
	}
});

/**
 * 删除项目代码风格命令
 */
registerAction2(class DeleteProjectStyleAction extends Action2 {
	constructor() {
		super({
			id: 'zhikai.deleteProjectStyle',
			title: localize2('deleteProjectStyle.title', '删除项目代码风格配置'),
			category: localize2('zhikai.category', '天和·码弦'),
			f1: true,
			menu: [
				{
					id: MenuId.ExplorerContext,
					group: 'zhikai@4',
					order: 4
				},
				{
					id: MenuId.CommandPalette
				}
			]
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const styleLearningService = accessor.get(IStyleLearningService);
		const quickInputService = accessor.get(IQuickInputService);

		const confirmed = await quickInputService.pick([
			{ label: '是', value: true },
			{ label: '否', value: false }
		], {
			title: '确认删除',
			placeHolder: '确定要删除项目的代码风格配置吗？'
		});

		if (confirmed?.value) {
			await styleLearningService.deleteProjectStyle();
		}
	}
});
