/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Skills视图注册
 *
 * 注释：Skills 已全部内置到 IDE 的 resources/skills/ 目录，
 * 用户无需通过 UI 管理 Skills，因此禁用 Skills 视图
 *
 * 原有 imports 已注释掉，因为不再需要注册视图
 */

// import { localize2 } from '../../../../nls.js';
// import { Registry } from '../../../../platform/registry/common/platform.js';
// import { IViewsRegistry, Extensions as ViewExtensions, IViewDescriptor } from '../../../common/views.js';
// import { SkillsView } from './skillsView.js';
// import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
// import { VIEW_CONTAINER } from '../../maxian/browser/maxian.contribution.js';
// const VIEW_ID = 'workbench.view.skills';
//
// // 注册Skills视图
// const viewsRegistry = Registry.as<IViewsRegistry>(ViewExtensions.ViewsRegistry);
//
// const skillsViewDescriptor: IViewDescriptor = {
// 	id: VIEW_ID,
// 	name: localize2('skills', "Skills"),
// 	containerIcon: undefined,
// 	ctorDescriptor: new SyncDescriptor(SkillsView),
// 	order: 2, // 在MaXian视图之后
// 	weight: 30,
// 	canToggleVisibility: true,
// 	canMoveView: true,
// 	collapsed: false,
// 	when: undefined
// };
//
// viewsRegistry.registerViews([skillsViewDescriptor], VIEW_CONTAINER);
