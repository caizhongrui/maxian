/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { IDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { DatabaseType, IDatabaseConnectionConfig } from '../common/databaseConnection.js';

/**
 * 数据库连接表单结果
 */
export interface IDatabaseConnectionFormResult {
	name: string;
	type: DatabaseType;
	host: string;
	port: number;
	username: string;
	password: string;
	database: string;
}

/**
 * 显示数据库连接表单对话框
 * 使用VS Code原生的input对话框,一次性显示所有字段
 */
export async function showDatabaseConnectionDialog(
	dialogService: IDialogService,
	existingConfig?: IDatabaseConnectionConfig
): Promise<IDatabaseConnectionFormResult | undefined> {

	// 准备默认值
	const defaultName = existingConfig?.name || '';
	const defaultType = existingConfig?.type || DatabaseType.MySQL;
	const defaultHost = existingConfig?.host || 'localhost';
	const defaultPort = existingConfig?.port || (existingConfig?.type === DatabaseType.PostgreSQL ? 5432 : 3306);
	const defaultUsername = existingConfig?.username || 'root';
	const defaultPassword = existingConfig?.password || '';
	const defaultDatabase = existingConfig?.database || '';

	// 构建详细描述,包含数据库类型选择说明
	const detailMessage = [
		localize('database.dialog.detail', '请填写数据库连接信息:'),
		'',
		localize('database.dialog.typeInfo', '数据库类型: 在名称中使用 [MySQL] 或 [PostgreSQL] 前缀来指定类型'),
		localize('database.dialog.typeExample', '例如: [MySQL] 本地数据库 或 [PostgreSQL] 生产环境'),
		'',
		localize('database.dialog.portInfo', '端口: MySQL默认3306, PostgreSQL默认5432')
	].join('\n');

	// 使用 input 对话框,一次性显示所有输入字段
	const result = await dialogService.input({
		type: 'question',
		message: existingConfig
			? localize('database.dialog.editTitle', '编辑数据库连接')
			: localize('database.dialog.addTitle', '添加数据库连接'),
		detail: detailMessage,
		primaryButton: localize('database.dialog.ok', '确定'),
		cancelButton: localize('database.dialog.cancel', '取消'),
		inputs: [
			{
				type: 'text',
				value: defaultName,
				placeholder: localize('database.connectionName.placeholder', '连接名称 (例如: [MySQL] 本地数据库)')
			},
			{
				type: 'text',
				value: defaultHost,
				placeholder: localize('database.host.placeholder', '主机地址 (例如: localhost)')
			},
			{
				type: 'text',
				value: defaultPort.toString(),
				placeholder: localize('database.port.placeholder', '端口号 (MySQL: 3306, PostgreSQL: 5432)')
			},
			{
				type: 'text',
				value: defaultUsername,
				placeholder: localize('database.username.placeholder', '用户名 (例如: root)')
			},
			{
				type: 'password',
				value: defaultPassword,
				placeholder: localize('database.password.placeholder', '密码 (可选)')
			},
			{
				type: 'text',
				value: defaultDatabase,
				placeholder: localize('database.database.placeholder', '数据库名 (可选)')
			}
		]
	});

	// 用户取消了
	if (!result.confirmed || !result.values || result.values.length !== 6) {
		return undefined;
	}

	const [name, host, portStr, username, password, database] = result.values;

	// 验证必填字段
	if (!name || !name.trim()) {
		await dialogService.error(
			localize('database.validation.nameRequired', '连接名称不能为空'),
			localize('database.validation.nameRequiredDetail', '请输入一个有意义的连接名称')
		);
		return undefined;
	}

	if (!host || !host.trim()) {
		await dialogService.error(
			localize('database.validation.hostRequired', '主机地址不能为空'),
			localize('database.validation.hostRequiredDetail', '请输入数据库服务器的主机地址')
		);
		return undefined;
	}

	if (!username || !username.trim()) {
		await dialogService.error(
			localize('database.validation.usernameRequired', '用户名不能为空'),
			localize('database.validation.usernameRequiredDetail', '请输入数据库连接用户名')
		);
		return undefined;
	}

	// 验证端口号
	const port = parseInt(portStr, 10);
	if (isNaN(port) || port <= 0 || port > 65535) {
		await dialogService.error(
			localize('database.validation.invalidPort', '端口号无效'),
			localize('database.validation.invalidPortDetail', '端口号必须是1-65535之间的数字')
		);
		return undefined;
	}

	// 从名称中解析数据库类型
	let type = defaultType;
	let cleanName = name.trim();

	if (name.toLowerCase().includes('[mysql]') || name.toLowerCase().includes('mysql')) {
		type = DatabaseType.MySQL;
		cleanName = name.replace(/\[mysql\]/gi, '').replace(/mysql/gi, '').trim();
	} else if (name.toLowerCase().includes('[postgresql]') || name.toLowerCase().includes('postgres')) {
		type = DatabaseType.PostgreSQL;
		cleanName = name.replace(/\[postgresql\]/gi, '').replace(/postgres/gi, '').trim();
	}

	// 如果清理后的名称为空,使用原始名称
	if (!cleanName) {
		cleanName = name.trim();
	}

	return {
		name: cleanName,
		type,
		host: host.trim(),
		port,
		username: username.trim(),
		password: password, // 密码不trim,可能包含空格
		database: database.trim()
	};
}
