/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { IWorkbenchContribution, WorkbenchPhase, registerWorkbenchContribution2 } from '../../../common/contributions.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { IViewsRegistry, Extensions as ViewExtensions, ITreeViewDescriptor } from '../../../common/views.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { localize } from '../../../../nls.js';
import { ViewPaneContainer } from '../../../browser/parts/views/viewPaneContainer.js';
import { TreeView, TreeViewPane } from '../../../browser/parts/views/treeView.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { IExtensionService } from '../../../services/extensions/common/extensions.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IViewDescriptorService } from '../../../common/views.js';
import { DatabaseTreeViewDataProvider } from './databaseTreeView.js';
import { TableDesignerView, TABLE_DESIGNER_VIEW_ID } from './tableDesigner/tableDesignerView.js';
import { SQLGeneratorView, SQL_GENERATOR_VIEW_ID } from './sqlGenerator/sqlGeneratorView.js';
import { SQLOptimizerView, SQL_OPTIMIZER_VIEW_ID } from './sqlOptimizer/sqlOptimizerView.js';
import { TableAnalyzerView, TABLE_ANALYZER_VIEW_ID } from './tableAnalyzer/tableAnalyzerView.js';
import { HealthCheckView, HEALTH_CHECK_VIEW_ID } from './healthCheck/healthCheckView.js';
import { SQLDiagnosticsProvider } from './sqlEditor/sqlDiagnosticsProvider.js';
import { SQLFormatterProvider } from './sqlEditor/sqlFormatterProvider.js';
import { SQLCompletionProvider } from './sqlEditor/sqlCompletionProvider.js';
import { ILanguageFeaturesService } from '../../../../editor/common/services/languageFeatures.js';
import { IDesignRulesService, DesignRulesService } from '../common/designRulesService.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { createStructuredLogger } from '../../../common/structuredLogger.js';
import {
	HasDbNlToSqlPermission,
	HasDbSqlOptimizePermission,
	HasDbTableAnalyzePermission,
	HasDbHealthCheckPermission,
	HasDbTableDesignPermission
} from './databaseActions.js';

// 注册设计规则服务
registerSingleton(IDesignRulesService, DesignRulesService, InstantiationType.Delayed);

// 导入 Actions
import './databaseActions.js';

// 导入 CSS 样式
import './tableDesigner/tableDesignerView.css';
import './sqlGenerator/sqlGeneratorView.css';
import './sqlOptimizer/sqlOptimizerView.css';
import './tableAnalyzer/tableAnalyzerView.css';
import './healthCheck/healthCheckView.css';
const log = createStructuredLogger('DatabaseContribution');

/**
 * 数据库视图容器ID
 */
export const DATABASE_VIEW_CONTAINER_ID = 'workbench.view.database';

/**
 * 数据库资源管理器视图ID
 */
export const DATABASE_EXPLORER_VIEW_ID = 'workbench.view.database.explorer';

/**
 * 数据库视图容器类
 */
class DatabaseViewPaneContainer extends ViewPaneContainer {
	constructor(
		@IInstantiationService instantiationService: IInstantiationService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@IWorkspaceContextService contextService: IWorkspaceContextService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IExtensionService extensionService: IExtensionService,
		@IConfigurationService configurationService: IConfigurationService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService
	) {
		super(
			DATABASE_VIEW_CONTAINER_ID,
			{ mergeViewWithContainerWhenSingleView: false },
			instantiationService,
			configurationService,
			undefined as any,
			contextMenuService,
			telemetryService,
			extensionService,
			themeService,
			storageService,
			contextService,
			viewDescriptorService
		);
	}
}

/**
 * 数据库贡献主类
 * 负责注册数据库相关的视图、命令和服务
 */
class DatabaseContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.database';

	constructor(
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@ILanguageFeaturesService private readonly languageFeaturesService: ILanguageFeaturesService
	) {
		super();
		log.debug('constructor_called');
		this.registerViews();
		this.registerEditorProviders();
		log.debug('initialized');
	}

	/**
	 * 注册数据库视图
	 */
	private registerViews(): void {
		log.debug('register_views_started');

		const viewsRegistry = Registry.as<IViewsRegistry>(ViewExtensions.ViewsRegistry);
		const viewContainerRegistry = Registry.as<any>(ViewExtensions.ViewContainersRegistry);

		// 注册数据库视图容器
		try {
			const viewContainerDescriptor = {
				id: DATABASE_VIEW_CONTAINER_ID,
				title: localize('database', "数据库"),
				ctorDescriptor: new SyncDescriptor(DatabaseViewPaneContainer),
				storageId: DATABASE_VIEW_CONTAINER_ID,
				hideIfEmpty: false,
				order: 3,
				icon: {
					type: 1,
					id: 'server'
				}
			};

			viewContainerRegistry.registerViewContainer(viewContainerDescriptor, 0);
			log.debug('view_container_registered');
		} catch (error) {
			log.error('register_view_container_failed', { error: String(error) });
		}

		// 创建 TreeView实例
		const treeView = this.instantiationService.createInstance(TreeView, DATABASE_EXPLORER_VIEW_ID, localize('database.connections', '连接'));
		treeView.showRefreshAction = true;

		// 创建数据提供者(依赖注入会自动传入参数)
		const dataProvider = this.instantiationService.createInstance(DatabaseTreeViewDataProvider);
		treeView.dataProvider = dataProvider;

		// 注册数据库资源管理器树形视图
		try {
			const viewContainer = viewContainerRegistry.get(DATABASE_VIEW_CONTAINER_ID);

			const viewDescriptor: ITreeViewDescriptor = {
				id: DATABASE_EXPLORER_VIEW_ID,
				name: { value: '连接', original: 'Connections' },
				ctorDescriptor: new SyncDescriptor(TreeViewPane),
				canToggleVisibility: true,
				canMoveView: false,
				treeView,
				weight: 100,
				order: 1,
				collapsed: false
			};

			viewsRegistry.registerViews([viewDescriptor], viewContainer!);
			log.debug('tree_view_registered');
		} catch (error) {
			log.error('register_tree_view_failed', { error: String(error) });
		}

		// 注册表结构设计器视图
		try {
			const viewContainer = viewContainerRegistry.get(DATABASE_VIEW_CONTAINER_ID);

			const tableDesignerViewDescriptor = {
				id: TABLE_DESIGNER_VIEW_ID,
				name: { value: '表设计器', original: 'Table Designer' },
				ctorDescriptor: new SyncDescriptor(TableDesignerView),
				canToggleVisibility: true,
				canMoveView: false,
				weight: 50,
				order: 2,
				collapsed: true,
				when: HasDbTableDesignPermission
			};

			viewsRegistry.registerViews([tableDesignerViewDescriptor], viewContainer!);
			log.debug('table_designer_view_registered');
		} catch (error) {
			log.error('register_table_designer_view_failed', { error: String(error) });
		}

		// 注册 SQL 生成器视图
		try {
			const viewContainer = viewContainerRegistry.get(DATABASE_VIEW_CONTAINER_ID);

			const sqlGeneratorViewDescriptor = {
				id: SQL_GENERATOR_VIEW_ID,
				name: { value: 'SQL生成器', original: 'SQL Generator' },
				ctorDescriptor: new SyncDescriptor(SQLGeneratorView),
				canToggleVisibility: true,
				canMoveView: false,
				weight: 40,
				order: 3,
				collapsed: true,
				when: HasDbNlToSqlPermission
			};

			viewsRegistry.registerViews([sqlGeneratorViewDescriptor], viewContainer!);
			log.debug('sql_generator_view_registered');
		} catch (error) {
			log.error('register_sql_generator_view_failed', { error: String(error) });
		}

		// 注册 SQL 优化器视图
		try {
			const viewContainer = viewContainerRegistry.get(DATABASE_VIEW_CONTAINER_ID);

			const sqlOptimizerViewDescriptor = {
				id: SQL_OPTIMIZER_VIEW_ID,
				name: { value: 'SQL优化器', original: 'SQL Optimizer' },
				ctorDescriptor: new SyncDescriptor(SQLOptimizerView),
				canToggleVisibility: true,
				canMoveView: false,
				weight: 30,
				order: 4,
				collapsed: true,
				when: HasDbSqlOptimizePermission
			};

			viewsRegistry.registerViews([sqlOptimizerViewDescriptor], viewContainer!);
			log.debug('sql_optimizer_view_registered');
		} catch (error) {
			log.error('register_sql_optimizer_view_failed', { error: String(error) });
		}

		// 注册表结构分析器视图
		try {
			const viewContainer = viewContainerRegistry.get(DATABASE_VIEW_CONTAINER_ID);

			const tableAnalyzerViewDescriptor = {
				id: TABLE_ANALYZER_VIEW_ID,
				name: { value: '表结构分析', original: 'Table Analyzer' },
				ctorDescriptor: new SyncDescriptor(TableAnalyzerView),
				canToggleVisibility: true,
				canMoveView: false,
				weight: 20,
				order: 5,
				collapsed: true,
				when: HasDbTableAnalyzePermission
			};

			viewsRegistry.registerViews([tableAnalyzerViewDescriptor], viewContainer!);
			log.debug('table_analyzer_view_registered');
		} catch (error) {
			log.error('register_table_analyzer_view_failed', { error: String(error) });
		}

		// 注册数据库健康检查视图
		try {
			const viewContainer = viewContainerRegistry.get(DATABASE_VIEW_CONTAINER_ID);

			const healthCheckViewDescriptor = {
				id: HEALTH_CHECK_VIEW_ID,
				name: { value: '数据库健康检查', original: 'Health Check' },
				ctorDescriptor: new SyncDescriptor(HealthCheckView),
				canToggleVisibility: true,
				canMoveView: false,
				weight: 10,
				order: 6,
				collapsed: true,
				when: HasDbHealthCheckPermission
			};

			viewsRegistry.registerViews([healthCheckViewDescriptor], viewContainer!);
			log.debug('health_check_view_registered');
		} catch (error) {
			log.error('register_health_check_view_failed', { error: String(error) });
		}
	}

	/**
	 * 注册编辑器相关提供者
	 */
	private registerEditorProviders(): void {
		try {
			// 注册 SQL 诊断提供者
			const diagnosticsProvider = this.instantiationService.createInstance(SQLDiagnosticsProvider);
			this._register(diagnosticsProvider);
			log.debug('sql_diagnostics_provider_registered');

			// 注册 SQL 格式化提供者
			const formatterProvider = new SQLFormatterProvider();
			this._register(formatterProvider);

			// 为 SQL 文件注册格式化支持
			this._register(this.languageFeaturesService.documentFormattingEditProvider.register(
				{ pattern: '**/*.sql' },
				formatterProvider
			));

			// 为 MyBatis XML 文件注册格式化支持
			this._register(this.languageFeaturesService.documentFormattingEditProvider.register(
				{ pattern: '**/*Mapper.xml' },
				formatterProvider
			));

			// 为 SQL 文件注册范围格式化支持
			this._register(this.languageFeaturesService.documentRangeFormattingEditProvider.register(
				{ pattern: '**/*.sql' },
				formatterProvider
			));

			// 为 MyBatis XML 文件注册范围格式化支持
			this._register(this.languageFeaturesService.documentRangeFormattingEditProvider.register(
				{ pattern: '**/*Mapper.xml' },
				formatterProvider
			));
			log.debug('sql_formatter_provider_registered');

			// 注册 SQL 补全提供者
			const completionProvider = this.instantiationService.createInstance(SQLCompletionProvider);
			this._register(completionProvider);

			// 为 SQL 文件注册补全支持
			this._register(this.languageFeaturesService.completionProvider.register(
				{ pattern: '**/*.sql' },
				completionProvider
			));

			// 为 MyBatis XML 文件注册补全支持
			this._register(this.languageFeaturesService.completionProvider.register(
				{ pattern: '**/*Mapper.xml' },
				completionProvider
			));
			log.debug('sql_completion_provider_registered');
		} catch (error) {
			log.error('register_editor_providers_failed', { error: String(error) });
		}
	}
}

// 注册数据库贡献
registerWorkbenchContribution2(
	DatabaseContribution.ID,
	DatabaseContribution,
	WorkbenchPhase.BlockRestore
);
