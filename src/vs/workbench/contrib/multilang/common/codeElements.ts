/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';

/**
 * 统一代码元素模型
 * 用于跨语言抽象代码结构
 */
export interface UnifiedCodeElements {
	/**
	 * 文件信息
	 */
	file: FileInfo;

	/**
	 * 导入语句
	 */
	imports: ImportInfo[];

	/**
	 * 类定义
	 */
	classes: ClassInfo[];

	/**
	 * 接口定义
	 */
	interfaces: InterfaceInfo[];

	/**
	 * 函数/方法定义（文件级别）
	 */
	functions: FunctionInfo[];

	/**
	 * 变量定义（文件级别）
	 */
	variables: VariableInfo[];

	/**
	 * 枚举定义
	 */
	enums: EnumInfo[];

	/**
	 * 类型别名（TypeScript）
	 */
	typeAliases: TypeAliasInfo[];

	/**
	 * 命名空间/包信息
	 */
	namespace?: NamespaceInfo;
}

/**
 * 文件信息
 */
export interface FileInfo {
	/**
	 * 文件 URI
	 */
	uri: URI;

	/**
	 * 文件名
	 */
	fileName: string;

	/**
	 * 文件路径
	 */
	filePath: string;

	/**
	 * 语言标识符
	 */
	language: string;

	/**
	 * 文件行数
	 */
	lineCount: number;

	/**
	 * 文件大小（字节）
	 */
	size: number;

	/**
	 * 文件注释（文件头部的注释）
	 */
	fileComment?: string;
}

/**
 * 导入信息
 */
export interface ImportInfo {
	/**
	 * 导入类型 (module, class, function, variable)
	 */
	type: 'module' | 'class' | 'function' | 'variable' | 'namespace';

	/**
	 * 导入的模块/包路径
	 */
	modulePath: string;

	/**
	 * 导入的名称
	 */
	importedNames: string[];

	/**
	 * 别名
	 */
	alias?: string;

	/**
	 * 是否是默认导入
	 */
	isDefault?: boolean;

	/**
	 * 是否是通配符导入 (import * as ...)
	 */
	isWildcard?: boolean;

	/**
	 * 原始导入语句
	 */
	raw: string;

	/**
	 * 行号
	 */
	line: number;
}

/**
 * 类信息
 */
export interface ClassInfo {
	/**
	 * 类名
	 */
	name: string;

	/**
	 * 修饰符 (public, private, protected, abstract, final, etc.)
	 */
	modifiers: string[];

	/**
	 * 父类名
	 */
	superClass?: string;

	/**
	 * 实现的接口
	 */
	interfaces: string[];

	/**
	 * 泛型参数
	 */
	typeParameters: string[];

	/**
	 * 属性列表
	 */
	properties: PropertyInfo[];

	/**
	 * 方法列表
	 */
	methods: FunctionInfo[];

	/**
	 * 构造函数
	 */
	constructors: FunctionInfo[];

	/**
	 * 内部类
	 */
	innerClasses: ClassInfo[];

	/**
	 * 注释/文档
	 */
	comment?: string;

	/**
	 * 注解/装饰器
	 */
	annotations: AnnotationInfo[];

	/**
	 * 起始行号
	 */
	startLine: number;

	/**
	 * 结束行号
	 */
	endLine: number;

	/**
	 * 可见性
	 */
	visibility: 'public' | 'private' | 'protected' | 'internal' | 'package';
}

/**
 * 接口信息
 */
export interface InterfaceInfo {
	/**
	 * 接口名
	 */
	name: string;

	/**
	 * 修饰符
	 */
	modifiers: string[];

	/**
	 * 继承的接口
	 */
	extends: string[];

	/**
	 * 泛型参数
	 */
	typeParameters: string[];

	/**
	 * 方法签名
	 */
	methods: MethodSignatureInfo[];

	/**
	 * 属性签名
	 */
	properties: PropertySignatureInfo[];

	/**
	 * 注释/文档
	 */
	comment?: string;

	/**
	 * 起始行号
	 */
	startLine: number;

	/**
	 * 结束行号
	 */
	endLine: number;
}

/**
 * 函数/方法信息
 */
export interface FunctionInfo {
	/**
	 * 函数名
	 */
	name: string;

	/**
	 * 修饰符
	 */
	modifiers: string[];

	/**
	 * 参数列表
	 */
	parameters: ParameterInfo[];

	/**
	 * 返回类型
	 */
	returnType: string;

	/**
	 * 泛型参数
	 */
	typeParameters: string[];

	/**
	 * 抛出的异常
	 */
	throws: string[];

	/**
	 * 函数体
	 */
	body?: string;

	/**
	 * 注释/文档
	 */
	comment?: string;

	/**
	 * 注解/装饰器
	 */
	annotations: AnnotationInfo[];

	/**
	 * 起始行号
	 */
	startLine: number;

	/**
	 * 结束行号
	 */
	endLine: number;

	/**
	 * 可见性
	 */
	visibility: 'public' | 'private' | 'protected' | 'internal' | 'package';

	/**
	 * 是否是异步函数
	 */
	isAsync: boolean;

	/**
	 * 是否是静态函数
	 */
	isStatic: boolean;

	/**
	 * 是否是抽象函数
	 */
	isAbstract: boolean;
}

/**
 * 属性信息
 */
export interface PropertyInfo {
	/**
	 * 属性名
	 */
	name: string;

	/**
	 * 类型
	 */
	type: string;

	/**
	 * 修饰符
	 */
	modifiers: string[];

	/**
	 * 默认值
	 */
	defaultValue?: string;

	/**
	 * 注释/文档
	 */
	comment?: string;

	/**
	 * 注解/装饰器
	 */
	annotations: AnnotationInfo[];

	/**
	 * 行号
	 */
	line: number;

	/**
	 * 可见性
	 */
	visibility: 'public' | 'private' | 'protected' | 'internal' | 'package';

	/**
	 * 是否是静态属性
	 */
	isStatic: boolean;

	/**
	 * 是否是只读
	 */
	isReadonly: boolean;
}

/**
 * 参数信息
 */
export interface ParameterInfo {
	/**
	 * 参数名
	 */
	name: string;

	/**
	 * 类型
	 */
	type: string;

	/**
	 * 默认值
	 */
	defaultValue?: string;

	/**
	 * 是否是可选参数
	 */
	isOptional: boolean;

	/**
	 * 是否是可变参数 (varargs, ...rest)
	 */
	isVariadic: boolean;

	/**
	 * 注解/装饰器
	 */
	annotations: AnnotationInfo[];
}

/**
 * 变量信息
 */
export interface VariableInfo {
	/**
	 * 变量名
	 */
	name: string;

	/**
	 * 类型
	 */
	type: string;

	/**
	 * 修饰符
	 */
	modifiers: string[];

	/**
	 * 初始值
	 */
	initialValue?: string;

	/**
	 * 注释/文档
	 */
	comment?: string;

	/**
	 * 行号
	 */
	line: number;

	/**
	 * 是否是常量
	 */
	isConstant: boolean;
}

/**
 * 枚举信息
 */
export interface EnumInfo {
	/**
	 * 枚举名
	 */
	name: string;

	/**
	 * 修饰符
	 */
	modifiers: string[];

	/**
	 * 枚举值
	 */
	values: EnumValueInfo[];

	/**
	 * 注释/文档
	 */
	comment?: string;

	/**
	 * 起始行号
	 */
	startLine: number;

	/**
	 * 结束行号
	 */
	endLine: number;
}

/**
 * 枚举值信息
 */
export interface EnumValueInfo {
	/**
	 * 枚举值名称
	 */
	name: string;

	/**
	 * 枚举值
	 */
	value?: string | number;

	/**
	 * 注释/文档
	 */
	comment?: string;
}

/**
 * 类型别名信息（TypeScript）
 */
export interface TypeAliasInfo {
	/**
	 * 别名名称
	 */
	name: string;

	/**
	 * 类型定义
	 */
	typeDefinition: string;

	/**
	 * 泛型参数
	 */
	typeParameters: string[];

	/**
	 * 注释/文档
	 */
	comment?: string;

	/**
	 * 行号
	 */
	line: number;
}

/**
 * 方法签名信息（用于接口）
 */
export interface MethodSignatureInfo {
	/**
	 * 方法名
	 */
	name: string;

	/**
	 * 参数列表
	 */
	parameters: ParameterInfo[];

	/**
	 * 返回类型
	 */
	returnType: string;

	/**
	 * 泛型参数
	 */
	typeParameters: string[];

	/**
	 * 注释/文档
	 */
	comment?: string;

	/**
	 * 是否是可选方法
	 */
	isOptional: boolean;
}

/**
 * 属性签名信息（用于接口）
 */
export interface PropertySignatureInfo {
	/**
	 * 属性名
	 */
	name: string;

	/**
	 * 类型
	 */
	type: string;

	/**
	 * 注释/文档
	 */
	comment?: string;

	/**
	 * 是否是可选属性
	 */
	isOptional: boolean;

	/**
	 * 是否是只读
	 */
	isReadonly: boolean;
}

/**
 * 注解/装饰器信息
 */
export interface AnnotationInfo {
	/**
	 * 注解名称
	 */
	name: string;

	/**
	 * 注解参数
	 */
	parameters: { [key: string]: any };

	/**
	 * 原始文本
	 */
	raw: string;
}

/**
 * 命名空间/包信息
 */
export interface NamespaceInfo {
	/**
	 * 命名空间/包名
	 */
	name: string;

	/**
	 * 完整路径
	 */
	fullPath: string;

	/**
	 * 子命名空间
	 */
	children: NamespaceInfo[];
}

/**
 * 代码元素工厂
 */
export class CodeElementsFactory {
	/**
	 * 创建空的代码元素模型
	 */
	static createEmpty(fileUri: URI, language: string): UnifiedCodeElements {
		return {
			file: {
				uri: fileUri,
				fileName: this.getFileName(fileUri),
				filePath: fileUri.fsPath,
				language: language,
				lineCount: 0,
				size: 0
			},
			imports: [],
			classes: [],
			interfaces: [],
			functions: [],
			variables: [],
			enums: [],
			typeAliases: []
		};
	}

	private static getFileName(uri: URI): string {
		const path = uri.path;
		const lastSlash = path.lastIndexOf('/');
		return lastSlash >= 0 ? path.substring(lastSlash + 1) : path;
	}
}
