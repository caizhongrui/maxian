/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { Position } from '../../../../editor/common/core/position.js';
import { Range } from '../../../../editor/common/core/range.js';
import { ITextModel } from '../../../../editor/common/model.js';
import { IMultiLanguageService } from '../../multilang/browser/multilang.contribution.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { ILanguageFeaturesService } from '../../../../editor/common/services/languageFeatures.js';
import { IModelService } from '../../../../editor/common/services/model.js';

/**
 * 参数信息（增强版）
 */
export interface ParameterInfo {
	/** 参数名称 */
	name: string;
	/** 参数类型 */
	type: string;
	/** 是否是可变参数 */
	isVarargs?: boolean;
}

/**
 * 方法信息（增强版）
 */
export interface EnhancedMethodInfo {
	/** 方法名称 */
	name: string;
	/** 返回类型 */
	returnType: string;
	/** 参数列表 */
	parameters: ParameterInfo[];
	/** 访问修饰符 */
	accessModifier?: 'public' | 'protected' | 'private';
	/** 是否是静态方法 */
	isStatic?: boolean;
	/** 异常列表 */
	exceptions?: string[];
	/** 方法签名（完整格式） */
	signature?: string;
}

/**
 * 字段信息（增强版）
 */
export interface EnhancedFieldInfo {
	/** 字段名称 */
	name: string;
	/** 字段类型 */
	type: string;
	/** 访问修饰符 */
	accessModifier?: 'public' | 'protected' | 'private';
	/** 是否是静态字段 */
	isStatic?: boolean;
	/** 是否是final */
	isFinal?: boolean;
}

/**
 * 类型定义信息（用于上下文）- 增强版
 */
export interface TypeDefinitionContext {
	/** 类型名称 */
	typeName: string;
	/** 可用的方法名列表（简化版，向后兼容） */
	methods: string[];
	/** 可用的字段名列表（简化版，向后兼容） */
	fields: string[];
	/** 类型定义的源代码摘要 */
	summary?: string;
	/** 增强的方法信息 */
	enhancedMethods?: EnhancedMethodInfo[];
	/** 增强的字段信息 */
	enhancedFields?: EnhancedFieldInfo[];
	/** 父类名称 */
	parentClass?: string;
	/** 实现的接口列表 */
	interfaces?: string[];
	/** 继承的方法（来自父类/接口） */
	inheritedMethods?: string[];
}

/**
 * 方法引用上下文
 */
export interface MethodReferenceContext {
	/** 类名 */
	className: string;
	/** 用户已输入的方法前缀 */
	methodPrefix: string;
	/** 可用的候选方法 */
	candidates: string[];
}

/**
 * 代码补全的上下文信息
 */
export interface CompletionContext {
	/**
	 * 文件URI
	 */
	fileUri: URI;

	/**
	 * 语言ID
	 */
	languageId: string;

	/**
	 * 光标前的代码
	 */
	prefix: string;

	/**
	 * 光标后的代码
	 */
	suffix: string;

	/**
	 * 前面的代码行
	 */
	beforeLines: string[];

	/**
	 * 后面的代码行
	 */
	afterLines: string[];

	/**
	 * 当前所在的类名(如果有)
	 */
	currentClass?: string;

	/**
	 * 当前所在的方法名(如果有)
	 */
	currentMethod?: string;

	/**
	 * 文件中的导入信息
	 */
	imports?: Array<{
		modulePath: string;
		importedNames?: string[];
	}>;

	/**
	 * 检测到的框架
	 */
	frameworks?: string[];

	/**
	 * 文件中的类列表
	 */
	classes?: Array<{
		name: string;
		methods: string[];
		fields?: string[];
	}>;

	/**
	 * 当前类的字段列表
	 */
	currentClassFields?: string[];

	/**
	 * 方法参数信息
	 */
	methodParams?: string[];

	/**
	 * 文件级别的函数列表
	 */
	functions?: string[];

	/**
	 * ===== 新增：LSP 增强上下文 =====
	 */

	/**
	 * 当前位置相关的类型定义（从 LSP 获取）
	 */
	typeDefinitions?: TypeDefinitionContext[];

	/**
	 * 方法引用上下文（如 ClassName::methodName）
	 */
	methodReference?: MethodReferenceContext;

	/**
	 * 导入的类型定义内容
	 */
	importedTypeContents?: Map<string, string>;

	/**
	 * 变量类型映射（变量名 -> 类型名）
	 */
	variableTypes?: Map<string, string>;

	/**
	 * 当前光标处的变量/类型信息
	 */
	cursorContext?: {
		/** 光标处的标识符 */
		identifier?: string;
		/** 标识符的类型 */
		identifierType?: string;
		/** 是否在方法调用中 */
		inMethodCall?: boolean;
		/** 方法调用的参数位置 */
		argumentIndex?: number;
	};

	/**
	 * 最近的代码编辑
	 */
	recentEdits?: Array<{
		range: Range;
		text: string;
	}>;

	/**
	 * 相关文件的上下文（跨文件支持）
	 */
	relatedFiles?: RelatedFileContext[];

	/**
	 * 框架特化上下文
	 */
	frameworkContext?: FrameworkContext;
}

/**
 * 相关文件上下文
 */
export interface RelatedFileContext {
	/** 文件路径 */
	filepath: string;
	/** 文件类型 */
	fileType: 'import' | 'same_package' | 'test' | 'config';
	/** 相关类/函数定义 */
	definitions: string[];
	/** 摘要内容 */
	summary?: string;
}

/**
 * 框架特化上下文
 */
export interface FrameworkContext {
	/** 框架名称 */
	name: string;
	/** 框架版本 */
	version?: string;
	/** 当前上下文类型（如 Controller, Service, Component 等） */
	contextType?: string;
	/** 框架特定的注解/装饰器 */
	annotations?: string[];
	/** 框架特定的提示 */
	hints?: string[];
	/** 常用模式建议 */
	patterns?: string[];
}

/**
 * 代码补全上下文提取器
 * 负责为AI代码补全提供丰富的上下文信息
 * 集成 LSP 服务获取准确的类型信息
 */
export class CompletionContextExtractor {

	// 类型信息缓存，带时间戳用于 TTL 过期
	private typeCache: Map<string, { data: TypeDefinitionContext; timestamp: number }> = new Map();
	private readonly maxCacheSize = 100;
	private readonly cacheTTL = 5 * 60 * 1000; // 5分钟

	constructor(
		private readonly multiLanguageService: IMultiLanguageService,
		private readonly languageFeaturesService?: ILanguageFeaturesService,
		private readonly modelService?: IModelService
	) { }

	/**
	 * 提取代码补全的完整上下文
	 */
	async extractContext(
		model: ITextModel,
		position: Position,
		token?: CancellationToken
	): Promise<CompletionContext> {

		const uri = model.uri;
		const languageId = model.getLanguageId();

		// 基础上下文：光标周围的代码
		const lineContent = model.getLineContent(position.lineNumber);
		const prefix = lineContent.substring(0, position.column - 1);
		const suffix = lineContent.substring(position.column - 1);

		// 前后代码行
		const beforeLines = this.getBeforeLines(model, position);
		const afterLines = this.getAfterLines(model, position);

		// 提取方法参数和类字段（简单解析）
		const methodParams = this.extractMethodParams(beforeLines);
		const classFields = this.extractClassFields(beforeLines);

		// 创建基础上下文
		const context: CompletionContext = {
			fileUri: uri,
			languageId,
			prefix,
			suffix,
			beforeLines,
			afterLines,
			methodParams: methodParams.length > 0 ? methodParams : undefined,
			currentClassFields: classFields.length > 0 ? classFields : undefined
		};

		// === 新增：提取变量类型映射 ===
		context.variableTypes = this.extractVariableTypes(beforeLines, languageId);

		// === 新增：检测 Java 方法引用 ===
		if (languageId === 'java') {
			const methodRef = this.detectJavaMethodReference(prefix);
			if (methodRef) {
				context.methodReference = await this.resolveMethodReference(
					model, methodRef.className, methodRef.methodPrefix, token
				);
			}
		}

		// === 新增：获取光标上下文 ===
		context.cursorContext = this.extractCursorContext(prefix, suffix, beforeLines);

		// === 新增：使用 LSP 获取类型定义 ===
		if (this.languageFeaturesService && this.modelService) {
			const typeDefinitions = await this.extractTypeDefinitionsFromLSP(
				model, position, context, token
			);
			if (typeDefinitions.length > 0) {
				context.typeDefinitions = typeDefinitions;
			}
		}

		// 尝试提取结构化代码信息
		try {
			const fileContent = model.getValue();

			// 提取代码元素
			const elements = await this.multiLanguageService.extractElements(uri, fileContent);

			if (elements) {
				// 提取导入信息
				if (elements.imports && elements.imports.length > 0) {
					context.imports = elements.imports.map(imp => ({
						modulePath: imp.modulePath,
						importedNames: imp.importedNames
					}));
				}

				// 检测框架
				const frameworks = await this.multiLanguageService.detectFrameworkFromCode(uri, fileContent);
				if (frameworks && frameworks.length > 0) {
					context.frameworks = frameworks;
				}

				// 提取类信息
				if (elements.classes && elements.classes.length > 0) {
					context.classes = elements.classes.map(cls => ({
						name: cls.name,
						methods: cls.methods.map(m => m.name)
					}));

					// 确定当前所在的类和方法
					const currentLocation = this.getCurrentLocation(
						position.lineNumber,
						elements.classes
					);
					if (currentLocation) {
						context.currentClass = currentLocation.className;
						context.currentMethod = currentLocation.methodName;
					}
				}

				// 提取函数信息
				if (elements.functions && elements.functions.length > 0) {
					context.functions = elements.functions.map(func => func.name);
				}
			}

			// === 新增：框架特化上下文 ===
			context.frameworkContext = this.extractFrameworkContext(fileContent, languageId, context.frameworks);

			// === 新增：跨文件上下文 ===
			if (this.modelService && context.imports) {
				context.relatedFiles = await this.extractRelatedFileContext(
					model, context.imports, context.currentClass, token
				);
			}

		} catch (error) {
			console.warn('[Completion Context] Failed to extract structured info:', error);
		}

		return context;
	}

	/**
	 * 提取框架特化上下文
	 */
	private extractFrameworkContext(
		fileContent: string,
		languageId: string,
		detectedFrameworks?: string[]
	): FrameworkContext | undefined {
		// Java / Spring 框架检测
		if (languageId === 'java') {
			return this.extractSpringContext(fileContent, detectedFrameworks);
		}

		// TypeScript / Vue / React 框架检测
		if (['typescript', 'typescriptreact', 'javascript', 'javascriptreact', 'vue'].includes(languageId)) {
			return this.extractFrontendFrameworkContext(fileContent, languageId, detectedFrameworks);
		}

		return undefined;
	}

	/**
	 * 提取 Spring 框架上下文
	 */
	private extractSpringContext(fileContent: string, detectedFrameworks?: string[]): FrameworkContext | undefined {
		const annotations: string[] = [];
		const hints: string[] = [];
		const patterns: string[] = [];
		let contextType: string | undefined;

		// 检测 Spring 注解
		const springAnnotations = [
			'@Controller', '@RestController', '@Service', '@Repository', '@Component',
			'@Autowired', '@Resource', '@Value', '@Configuration', '@Bean',
			'@RequestMapping', '@GetMapping', '@PostMapping', '@PutMapping', '@DeleteMapping',
			'@PathVariable', '@RequestBody', '@RequestParam', '@ResponseBody',
			'@Transactional', '@Async', '@Scheduled', '@EnableAsync',
			'@Entity', '@Table', '@Column', '@Id', '@GeneratedValue',
			'@Data', '@Getter', '@Setter', '@Builder', '@NoArgsConstructor', '@AllArgsConstructor'
		];

		for (const annotation of springAnnotations) {
			if (fileContent.includes(annotation)) {
				annotations.push(annotation);
			}
		}

		if (annotations.length === 0) {
			return undefined;
		}

		// 确定上下文类型
		if (annotations.includes('@RestController') || annotations.includes('@Controller')) {
			contextType = 'Controller';
			hints.push('使用 @Autowired 注入服务');
			hints.push('使用 @GetMapping/@PostMapping 等处理HTTP请求');
			hints.push('返回值会自动序列化为JSON');
			patterns.push('public ResponseEntity<?> methodName(@RequestBody Dto dto)');
			patterns.push('public Result<T> methodName(@PathVariable Long id)');
		} else if (annotations.includes('@Service')) {
			contextType = 'Service';
			hints.push('使用 @Autowired 注入 Repository');
			hints.push('使用 @Transactional 管理事务');
			hints.push('业务逻辑应放在 Service 层');
			patterns.push('public void save(Entity entity)');
			patterns.push('public List<Entity> findAll()');
		} else if (annotations.includes('@Repository')) {
			contextType = 'Repository';
			hints.push('继承 JpaRepository 或 CrudRepository');
			hints.push('使用 @Query 自定义查询');
			patterns.push('List<Entity> findByFieldName(Type fieldName)');
			patterns.push('@Query("SELECT e FROM Entity e WHERE e.field = :value")');
		} else if (annotations.includes('@Entity')) {
			contextType = 'Entity';
			hints.push('使用 @Id 标注主键');
			hints.push('使用 @Column 配置字段映射');
			hints.push('使用 Lombok @Data 简化代码');
			patterns.push('@Id @GeneratedValue(strategy = GenerationType.IDENTITY)');
		} else if (annotations.includes('@Configuration')) {
			contextType = 'Configuration';
			hints.push('使用 @Bean 定义 Spring Bean');
			patterns.push('@Bean public ClassName beanName() { return new ClassName(); }');
		}

		return {
			name: 'Spring',
			contextType,
			annotations,
			hints,
			patterns
		};
	}

	/**
	 * 提取前端框架上下文（Vue/React）
	 */
	private extractFrontendFrameworkContext(
		fileContent: string,
		languageId: string,
		detectedFrameworks?: string[]
	): FrameworkContext | undefined {
		const hints: string[] = [];
		const patterns: string[] = [];
		const annotations: string[] = [];
		let frameworkName: string | undefined;
		let contextType: string | undefined;

		// Vue 3 检测
		if (languageId === 'vue' || fileContent.includes('defineComponent') || fileContent.includes('<script setup>')) {
			frameworkName = 'Vue';

			if (fileContent.includes('<script setup>')) {
				contextType = 'Composition API (setup)';
				hints.push('使用 ref() 创建响应式数据');
				hints.push('使用 computed() 创建计算属性');
				hints.push('使用 watch() 监听数据变化');
				hints.push('使用 onMounted() 等生命周期钩子');
				patterns.push('const state = ref(initialValue)');
				patterns.push('const computed = computed(() => state.value * 2)');
				patterns.push('watch(source, (newVal, oldVal) => { })');
			} else if (fileContent.includes('defineComponent')) {
				contextType = 'Composition API';
				hints.push('在 setup() 中使用 Composition API');
				patterns.push('setup(props, { emit }) { return { } }');
			}

			// 检测 Vue 装饰器
			if (fileContent.includes('@Component')) {
				annotations.push('@Component');
			}
			if (fileContent.includes('@Prop')) {
				annotations.push('@Prop');
			}
			if (fileContent.includes('@Emit')) {
				annotations.push('@Emit');
			}
		}

		// React 检测
		if (fileContent.includes('React') || fileContent.includes('useState') || fileContent.includes('useEffect')) {
			frameworkName = 'React';

			if (fileContent.includes('function') && fileContent.includes('return') && fileContent.includes('<')) {
				contextType = 'Functional Component';
				hints.push('使用 useState() 管理状态');
				hints.push('使用 useEffect() 处理副作用');
				hints.push('使用 useMemo() 和 useCallback() 优化性能');
				patterns.push('const [state, setState] = useState(initial)');
				patterns.push('useEffect(() => { return () => cleanup }, [deps])');
			} else if (fileContent.includes('class') && fileContent.includes('extends')) {
				contextType = 'Class Component';
				hints.push('使用 this.state 和 this.setState()');
				hints.push('在 componentDidMount() 中获取数据');
				patterns.push('this.setState({ key: value })');
			}
		}

		if (!frameworkName) {
			// 检测其他前端技术
			if (detectedFrameworks?.includes('axios') || fileContent.includes('axios')) {
				return {
					name: 'Axios',
					hints: ['使用 async/await 处理请求', '使用 try-catch 处理错误'],
					patterns: ['const response = await axios.get(url)', 'axios.post(url, data)']
				};
			}
			return undefined;
		}

		return {
			name: frameworkName,
			contextType,
			annotations: annotations.length > 0 ? annotations : undefined,
			hints,
			patterns
		};
	}

	/**
	 * 提取相关文件上下文
	 */
	private async extractRelatedFileContext(
		model: ITextModel,
		imports: Array<{ modulePath: string; importedNames?: string[] }>,
		currentClass?: string,
		_token?: CancellationToken
	): Promise<RelatedFileContext[]> {
		const relatedFiles: RelatedFileContext[] = [];

		if (!this.modelService) {
			return relatedFiles;
		}

		// 限制处理的导入数量，避免性能问题
		const maxImports = 5;
		let processedCount = 0;

		for (const imp of imports) {
			if (processedCount >= maxImports) {
				break;
			}

			// 跳过外部库导入
			if (this.isExternalImport(imp.modulePath)) {
				continue;
			}

			try {
				// 尝试解析相对导入路径
				const resolvedUri = this.resolveImportPath(model.uri, imp.modulePath);
				if (!resolvedUri) {
					continue;
				}

				// 获取模型
				const importedModel = this.modelService.getModel(resolvedUri);
				if (!importedModel) {
					continue;
				}

				const content = importedModel.getValue();
				const definitions: string[] = [];
				let summary: string | undefined;

				// 提取类/函数定义
				const classMatches = content.matchAll(/(?:export\s+)?(?:class|interface)\s+(\w+)/g);
				for (const match of classMatches) {
					definitions.push(`class ${match[1]}`);
				}

				const funcMatches = content.matchAll(/(?:export\s+)?(?:function|const)\s+(\w+)/g);
				for (const match of funcMatches) {
					if (!definitions.some(d => d.includes(match[1]))) {
						definitions.push(`function ${match[1]}`);
					}
				}

				// 如果导入的是特定名称，只保留相关定义
				if (imp.importedNames && imp.importedNames.length > 0) {
					const filteredDefs = definitions.filter(d =>
						imp.importedNames!.some(name => d.includes(name))
					);
					if (filteredDefs.length > 0) {
						definitions.length = 0;
						definitions.push(...filteredDefs);
					}
				}

				// 生成摘要（取文件前100行）
				const lines = content.split('\n').slice(0, 100);
				summary = lines.join('\n');
				if (summary.length > 1000) {
					summary = summary.substring(0, 1000) + '...';
				}

				// 确定文件类型
				let fileType: RelatedFileContext['fileType'] = 'import';
				const filePath = resolvedUri.fsPath || resolvedUri.path;
				if (filePath.includes('test') || filePath.includes('spec')) {
					fileType = 'test';
				} else if (filePath.includes('config') || filePath.endsWith('.config.ts') || filePath.endsWith('.config.js')) {
					fileType = 'config';
				} else if (currentClass && this.isSamePackage(model.uri, resolvedUri)) {
					fileType = 'same_package';
				}

				relatedFiles.push({
					filepath: filePath,
					fileType,
					definitions,
					summary
				});

				processedCount++;
			} catch (error) {
				// 忽略无法解析的导入
				console.warn('[Completion Context] Failed to resolve import:', imp.modulePath, error);
			}
		}

		return relatedFiles;
	}

	/**
	 * 判断是否是外部库导入
	 */
	private isExternalImport(modulePath: string): boolean {
		// 不以 ./ 或 ../ 开头的通常是外部库
		if (!modulePath.startsWith('.') && !modulePath.startsWith('/')) {
			return true;
		}
		// 常见的外部库前缀
		const externalPrefixes = ['@angular', '@vue', '@react', 'react', 'vue', 'lodash', 'axios', 'moment'];
		return externalPrefixes.some(prefix => modulePath.startsWith(prefix));
	}

	/**
	 * 解析导入路径为 URI
	 */
	private resolveImportPath(baseUri: URI, importPath: string): URI | undefined {
		try {
			// 简单的相对路径解析
			if (importPath.startsWith('./') || importPath.startsWith('../')) {
				const basePath = baseUri.path.substring(0, baseUri.path.lastIndexOf('/'));
				let resolvedPath = importPath;

				// 处理相对路径
				if (importPath.startsWith('./')) {
					resolvedPath = `${basePath}/${importPath.substring(2)}`;
				} else if (importPath.startsWith('../')) {
					const parts = basePath.split('/');
					let upCount = 0;
					let remaining = importPath;
					while (remaining.startsWith('../')) {
						upCount++;
						remaining = remaining.substring(3);
					}
					resolvedPath = parts.slice(0, -upCount).join('/') + '/' + remaining;
				}

				// 添加文件扩展名（如果没有）
				if (!resolvedPath.match(/\.(ts|tsx|js|jsx|vue)$/)) {
					// 尝试常见扩展名
					const extensions = ['.ts', '.tsx', '.js', '.jsx', '.vue', '/index.ts', '/index.js'];
					for (const ext of extensions) {
						const testPath = resolvedPath + ext;
						const testUri = baseUri.with({ path: testPath });
						if (this.modelService?.getModel(testUri)) {
							return testUri;
						}
					}
					// 默认尝试 .ts
					resolvedPath += '.ts';
				}

				return baseUri.with({ path: resolvedPath });
			}
		} catch (error) {
			// 忽略解析错误
		}
		return undefined;
	}

	/**
	 * 判断两个文件是否在同一个包/目录
	 */
	private isSamePackage(uri1: URI, uri2: URI): boolean {
		const dir1 = uri1.path.substring(0, uri1.path.lastIndexOf('/'));
		const dir2 = uri2.path.substring(0, uri2.path.lastIndexOf('/'));
		return dir1 === dir2;
	}

	/**
	 * 使用 LSP 提取类型定义
	 */
	private async extractTypeDefinitionsFromLSP(
		model: ITextModel,
		position: Position,
		context: CompletionContext,
		token?: CancellationToken
	): Promise<TypeDefinitionContext[]> {
		const results: TypeDefinitionContext[] = [];

		if (!this.languageFeaturesService || !this.modelService) {
			return results;
		}

		try {
			// 1. 从变量类型映射中获取需要查询的类型
			const typesToQuery: Set<string> = new Set();

			// 添加当前类
			if (context.currentClass) {
				typesToQuery.add(context.currentClass);
			}

			// 添加方法参数类型
			if (context.methodParams) {
				for (const param of context.methodParams) {
					const match = param.match(/^(\w+(?:<[^>]+>)?)\s+\w+$/);
					if (match) {
						typesToQuery.add(match[1].split('<')[0]); // 移除泛型
					}
				}
			}

			// 添加变量类型
			if (context.variableTypes) {
				for (const typeName of context.variableTypes.values()) {
					typesToQuery.add(typeName.split('<')[0]);
				}
			}

			// 添加方法引用的类
			if (context.methodReference) {
				typesToQuery.add(context.methodReference.className);
			}

			// 2. 查询每个类型的定义
			for (const typeName of typesToQuery) {
				// 跳过基本类型
				if (this.isPrimitiveType(typeName)) {
					continue;
				}

				// 检查缓存
				const cacheKey = `${model.uri.toString()}:${typeName}`;
				const cached = this.typeCache.get(cacheKey);
				if (cached && (Date.now() - cached.timestamp) < this.cacheTTL) {
					results.push(cached.data);
					continue;
				}

				// 尝试获取类型定义
				const typeInfo = await this.getTypeInfoFromLSP(model, typeName, token);
				if (typeInfo) {
					results.push(typeInfo);
					// 添加到缓存（已在 getTypeInfoFromLSP 中处理）
				}
			}

		} catch (error) {
			console.warn('[Completion Context] LSP type extraction failed:', error);
		}

		return results;
	}

	/**
	 * 通过 LSP 获取类型信息
	 */
	private async getTypeInfoFromLSP(
		model: ITextModel,
		typeName: string,
		token?: CancellationToken
	): Promise<TypeDefinitionContext | undefined> {
		if (!this.languageFeaturesService || !this.modelService) {
			return undefined;
		}

		// 检查缓存
		const cacheKey = `${model.uri.toString()}:${typeName}`;
		const cached = this.typeCache.get(cacheKey);
		if (cached && (Date.now() - cached.timestamp) < this.cacheTTL) {
			return cached.data;
		}

		try {
			// 在文件中查找类型名称的位置
			const text = model.getValue();
			const typePattern = new RegExp(`\\b${this.escapeRegExp(typeName)}\\b`);
			const match = typePattern.exec(text);

			if (!match || match.index === undefined) {
				return undefined;
			}

			const position = model.getPositionAt(match.index);

			// 使用定义提供者获取类型定义
			const defProviders = this.languageFeaturesService.definitionProvider.ordered(model);

			for (const provider of defProviders) {
				try {
					const definitions = await provider.provideDefinition(
						model,
						position,
						token || CancellationToken.None
					);

					if (!definitions) {
						continue;
					}

					const defArray = Array.isArray(definitions) ? definitions : [definitions];
					if (defArray.length === 0) {
						continue;
					}

					const firstDef = defArray[0];
					// 安全地获取 targetUri 和 targetRange
					const targetUri = 'targetUri' in firstDef ? firstDef.targetUri as URI : ('uri' in firstDef ? firstDef.uri as URI : undefined);
					const targetRange = 'targetRange' in firstDef ? firstDef.targetRange as Range : ('range' in firstDef ? firstDef.range as Range : undefined);

					if (!targetUri || !targetRange) {
						continue;
					}

					// 读取类型定义内容
					const targetModel = this.modelService.getModel(targetUri);
					if (targetModel) {
						const expandedRange = this.expandToClassDefinition(targetModel, targetRange);
						const content = targetModel.getValueInRange(expandedRange);

						// 解析类内容
						const typeContext = this.parseTypeContent(typeName, content);

						// 添加到缓存
						this.addToCache(cacheKey, typeContext);

						return typeContext;
					}
				} catch (e) {
					// 继续尝试下一个提供者
				}
			}
		} catch (error) {
			console.warn('[Completion Context] getTypeInfoFromLSP failed:', error);
		}

		return undefined;
	}

	/**
	 * 添加到缓存
	 */
	private addToCache(key: string, data: TypeDefinitionContext): void {
		// LRU 缓存：如果超过容量，删除最旧的
		if (this.typeCache.size >= this.maxCacheSize) {
			const firstKey = this.typeCache.keys().next().value;
			if (firstKey) {
				this.typeCache.delete(firstKey);
			}
		}
		this.typeCache.set(key, { data, timestamp: Date.now() });
	}

	/**
	 * 解析类型内容，提取方法和字段（增强版）
	 */
	private parseTypeContent(typeName: string, content: string): TypeDefinitionContext {
		const methods: string[] = [];
		const fields: string[] = [];
		const enhancedMethods: EnhancedMethodInfo[] = [];
		const enhancedFields: EnhancedFieldInfo[] = [];
		let parentClass: string | undefined;
		const interfaces: string[] = [];

		const lines = content.split('\n');

		// 解析类声明，获取父类和接口
		for (const line of lines) {
			const classMatch = line.match(/class\s+\w+\s+extends\s+(\w+)/);
			if (classMatch) {
				parentClass = classMatch[1];
			}
			const implementsMatch = line.match(/implements\s+([\w\s,]+)/);
			if (implementsMatch) {
				const impls = implementsMatch[1].split(',').map(s => s.trim());
				interfaces.push(...impls);
			}
		}

		for (const line of lines) {
			const trimmedLine = line.trim();

			// 解析字段（Java风格）- 增强版
			const fieldMatch = trimmedLine.match(
				/^\s*(private|protected|public)?\s*(static\s+)?(final\s+)?(\w+(?:<[^>]+>)?)\s+(\w+)\s*[;=]/
			);
			if (fieldMatch) {
				const fieldName = fieldMatch[5];
				fields.push(fieldName);
				enhancedFields.push({
					name: fieldName,
					type: fieldMatch[4],
					accessModifier: fieldMatch[1] as 'public' | 'protected' | 'private' | undefined,
					isStatic: !!fieldMatch[2],
					isFinal: !!fieldMatch[3]
				});
				continue;
			}

			// 解析方法 - 增强版（包括参数和异常）
			const methodMatch = trimmedLine.match(
				/^\s*(public|protected|private)?\s*(static\s+)?(\w+(?:<[^>]+>)?)\s+(\w+)\s*\(([^)]*)\)(?:\s+throws\s+([\w\s,]+))?/
			);
			if (methodMatch) {
				const methodName = methodMatch[4];
				// 跳过构造函数
				if (methodName !== typeName) {
					methods.push(methodName);

					// 解析参数
					const params: ParameterInfo[] = [];
					const paramsStr = methodMatch[5];
					if (paramsStr.trim()) {
						const paramParts = paramsStr.split(',');
						for (const part of paramParts) {
							const paramMatch = part.trim().match(/(\w+(?:<[^>]+>)?)\s*(\.\.\.)?(\w+)/);
							if (paramMatch) {
								params.push({
									type: paramMatch[1],
									isVarargs: !!paramMatch[2],
									name: paramMatch[3]
								});
							}
						}
					}

					// 解析异常
					const exceptions: string[] = [];
					if (methodMatch[6]) {
						exceptions.push(...methodMatch[6].split(',').map(s => s.trim()));
					}

					// 生成方法签名
					const signature = `${methodMatch[3]} ${methodName}(${params.map(p => `${p.type} ${p.name}`).join(', ')})`;

					enhancedMethods.push({
						name: methodName,
						returnType: methodMatch[3],
						parameters: params,
						accessModifier: methodMatch[1] as 'public' | 'protected' | 'private' | undefined,
						isStatic: !!methodMatch[2],
						exceptions: exceptions.length > 0 ? exceptions : undefined,
						signature
					});
				}
			}
		}

		// 检测 Lombok 注解生成的方法
		const lombokMethods = this.detectLombokMethods(content, enhancedFields);
		for (const lm of lombokMethods) {
			if (!methods.includes(lm.name)) {
				methods.push(lm.name);
				enhancedMethods.push(lm);
			}
		}

		// 生成摘要（限制长度）
		const summary = content.length > 500 ? content.substring(0, 500) + '...' : content;

		return {
			typeName,
			methods: [...new Set(methods)],
			fields: [...new Set(fields)],
			summary,
			enhancedMethods,
			enhancedFields,
			parentClass,
			interfaces: interfaces.length > 0 ? interfaces : undefined
		};
	}

	/**
	 * 检测 Lombok 注解生成的方法
	 */
	private detectLombokMethods(content: string, fields: EnhancedFieldInfo[]): EnhancedMethodInfo[] {
		const methods: EnhancedMethodInfo[] = [];

		// 检查类级别的 Lombok 注解
		const hasData = /@Data\b/.test(content);
		const hasGetter = /@Getter\b/.test(content) || hasData;
		const hasSetter = /@Setter\b/.test(content) || hasData;
		const hasBuilder = /@Builder\b/.test(content);

		if (hasGetter || hasSetter) {
			for (const field of fields) {
				const capitalizedName = field.name.charAt(0).toUpperCase() + field.name.slice(1);

				if (hasGetter) {
					// boolean 类型使用 is 前缀
					const getterName = field.type === 'boolean' || field.type === 'Boolean'
						? `is${capitalizedName}`
						: `get${capitalizedName}`;
					methods.push({
						name: getterName,
						returnType: field.type,
						parameters: [],
						accessModifier: 'public',
						isStatic: false,
						signature: `${field.type} ${getterName}()`
					});
				}

				if (hasSetter && !field.isFinal) {
					methods.push({
						name: `set${capitalizedName}`,
						returnType: 'void',
						parameters: [{ name: field.name, type: field.type }],
						accessModifier: 'public',
						isStatic: false,
						signature: `void set${capitalizedName}(${field.type} ${field.name})`
					});
				}
			}
		}

		if (hasBuilder) {
			methods.push({
				name: 'builder',
				returnType: 'Builder',
				parameters: [],
				accessModifier: 'public',
				isStatic: true,
				signature: 'Builder builder()'
			});
		}

		return methods;
	}

	/**
	 * 扩展范围以获取完整的类定义
	 */
	private expandToClassDefinition(model: ITextModel, range: Range): Range {
		let startLine = range.startLineNumber;
		let endLine = range.endLineNumber;

		// 向上查找类声明
		for (let i = startLine; i >= 1; i--) {
			const line = model.getLineContent(i);
			if (/^\s*(public\s+)?(class|interface|enum)\s+/.test(line)) {
				startLine = i;
				break;
			}
		}

		// 向下查找类结束（匹配大括号）
		let braceCount = 0;
		let foundOpenBrace = false;

		for (let i = startLine; i <= model.getLineCount(); i++) {
			const line = model.getLineContent(i);

			for (const char of line) {
				if (char === '{') {
					braceCount++;
					foundOpenBrace = true;
				} else if (char === '}') {
					braceCount--;
					if (foundOpenBrace && braceCount === 0) {
						endLine = i;
						break;
					}
				}
			}

			if (foundOpenBrace && braceCount === 0) {
				break;
			}
		}

		// 限制最大行数
		const maxLines = 100;
		endLine = Math.min(endLine, startLine + maxLines);

		return new Range(startLine, 1, endLine, model.getLineMaxColumn(endLine));
	}

	/**
	 * 检测 Java 方法引用模式
	 */
	private detectJavaMethodReference(prefix: string): { className: string; methodPrefix: string } | undefined {
		// 匹配 ClassName:: 或 ClassName::get 等模式
		const match = prefix.match(/([A-Z][a-zA-Z0-9_]*)::([a-zA-Z0-9_]*)?$/);
		if (match) {
			return {
				className: match[1],
				methodPrefix: match[2] || ''
			};
		}
		return undefined;
	}

	/**
	 * 解析方法引用，获取可用的候选方法
	 */
	private async resolveMethodReference(
		model: ITextModel,
		className: string,
		methodPrefix: string,
		token?: CancellationToken
	): Promise<MethodReferenceContext> {
		const context: MethodReferenceContext = {
			className,
			methodPrefix,
			candidates: []
		};

		// 尝试获取类的类型信息
		const typeInfo = await this.getTypeInfoFromLSP(model, className, token);
		if (typeInfo) {
			// 过滤出 getter 方法（最常用于 Lambda 表达式）
			let candidates = typeInfo.methods.filter(m =>
				m.startsWith('get') || m.startsWith('is') || m.startsWith('set')
			);

			// 按前缀过滤
			if (methodPrefix) {
				candidates = candidates.filter(m =>
					m.toLowerCase().startsWith(methodPrefix.toLowerCase())
				);
			}

			context.candidates = candidates;
		} else {
			// 降级：根据字段名生成可能的方法名
			const fieldMethods = this.generateMethodsFromFields(model, className);
			context.candidates = fieldMethods.filter(m =>
				!methodPrefix || m.toLowerCase().startsWith(methodPrefix.toLowerCase())
			);
		}

		return context;
	}

	/**
	 * 根据类中的字段生成可能的方法名
	 */
	private generateMethodsFromFields(model: ITextModel, className: string): string[] {
		const methods: string[] = [];
		const text = model.getValue();

		// 查找类定义
		const classPattern = new RegExp(`class\\s+${className}[^{]*\\{`, 'g');
		const classMatch = classPattern.exec(text);

		if (!classMatch) {
			return methods;
		}

		// 提取类内容（简单方法，可能不完全准确）
		const startIndex = classMatch.index + classMatch[0].length;
		let braceCount = 1;
		let endIndex = startIndex;

		for (let i = startIndex; i < text.length && braceCount > 0; i++) {
			if (text[i] === '{') {
				braceCount++;
			} else if (text[i] === '}') {
				braceCount--;
			}
			endIndex = i;
		}

		const classContent = text.substring(startIndex, endIndex);

		// 提取字段
		const fieldPattern = /(?:private|protected|public)\s+(?:final\s+)?(\w+(?:<[^>]+>)?)\s+(\w+)\s*[;=]/g;
		let fieldMatch;

		while ((fieldMatch = fieldPattern.exec(classContent)) !== null) {
			const fieldName = fieldMatch[2];
			const capitalizedName = fieldName.charAt(0).toUpperCase() + fieldName.slice(1);
			methods.push(`get${capitalizedName}`);
			methods.push(`set${capitalizedName}`);
		}

		return methods;
	}

	/**
	 * 提取变量类型映射
	 */
	private extractVariableTypes(beforeLines: string[], languageId: string): Map<string, string> {
		const variableTypes = new Map<string, string>();

		if (languageId === 'java') {
			// Java 变量声明模式
			const varPattern = /(\w+(?:<[^>]+>)?)\s+(\w+)\s*=/g;
			const paramPattern = /(\w+(?:<[^>]+>)?)\s+(\w+)\s*[,)]/g;

			for (const line of beforeLines) {
				// 匹配变量声明
				let match;
				while ((match = varPattern.exec(line)) !== null) {
					variableTypes.set(match[2], match[1]);
				}
				// 匹配方法参数
				while ((match = paramPattern.exec(line)) !== null) {
					variableTypes.set(match[2], match[1]);
				}
			}
		} else if (['typescript', 'typescriptreact', 'vue', 'html'].includes(languageId)) {
			// TypeScript / Vue / HTML 变量声明模式
			const tsVarPattern = /(?:let|const|var)\s+(\w+)\s*:\s*(\w+(?:<[^>]+>)?)/g;

			for (const line of beforeLines) {
				let match;
				while ((match = tsVarPattern.exec(line)) !== null) {
					variableTypes.set(match[1], match[2]);
				}
			}
		}

		return variableTypes;
	}

	/**
	 * 提取光标上下文
	 */
	private extractCursorContext(
		prefix: string,
		suffix: string,
		_beforeLines: string[]
	): CompletionContext['cursorContext'] {
		const context: CompletionContext['cursorContext'] = {};

		// 提取光标处的标识符
		const identifierMatch = prefix.match(/(\w+)$/);
		if (identifierMatch) {
			context.identifier = identifierMatch[1];
		}

		// 检查是否在方法调用中
		const openParenIndex = prefix.lastIndexOf('(');
		const closeParenIndex = prefix.lastIndexOf(')');
		if (openParenIndex > closeParenIndex) {
			context.inMethodCall = true;
			// 计算参数位置
			const argsText = prefix.substring(openParenIndex + 1);
			context.argumentIndex = argsText.split(',').length - 1;
		}

		return context;
	}

	/**
	 * 判断是否是基本类型
	 */
	private isPrimitiveType(typeName: string): boolean {
		const primitives = [
			'int', 'long', 'short', 'byte', 'float', 'double', 'boolean', 'char', 'void',
			'Integer', 'Long', 'Short', 'Byte', 'Float', 'Double', 'Boolean', 'Character', 'Void',
			'String', 'Object', 'Number',
			'number', 'string', 'boolean', 'any', 'void', 'null', 'undefined'
		];
		return primitives.includes(typeName);
	}

	/**
	 * 转义正则表达式特殊字符
	 */
	private escapeRegExp(str: string): string {
		return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	}

	/**
	 * 获取光标前的代码行（增加到50行，包含更多上下文）
	 */
	private getBeforeLines(model: ITextModel, position: Position): string[] {
		const startLine = Math.max(1, position.lineNumber - 50);
		const lines: string[] = [];

		for (let i = startLine; i < position.lineNumber; i++) {
			lines.push(model.getLineContent(i));
		}

		return lines;
	}

	/**
	 * 获取光标后的代码行（增加到50行，包含更多上下文）
	 */
	private getAfterLines(model: ITextModel, position: Position): string[] {
		const totalLines = model.getLineCount();
		const endLine = Math.min(totalLines, position.lineNumber + 50);
		const lines: string[] = [];

		for (let i = position.lineNumber + 1; i <= endLine; i++) {
			lines.push(model.getLineContent(i));
		}

		return lines;
	}

	/**
	 * 从代码中提取方法参数（简单解析）
	 */
	private extractMethodParams(beforeLines: string[]): string[] {
		const params: string[] = [];

		// 向上查找方法定义
		for (let i = beforeLines.length - 1; i >= 0; i--) {
			const line = beforeLines[i];
			// 匹配方法定义，如: public void method(Type1 param1, Type2 param2)
			const methodMatch = line.match(/(?:public|private|protected)?\s*\w+\s+\w+\s*\(([^)]*)\)/);
			if (methodMatch) {
				const paramStr = methodMatch[1];
				// 解析参数
				const paramParts = paramStr.split(',');
				for (const part of paramParts) {
					const trimmed = part.trim();
					if (trimmed) {
						// 提取类型和名称，如: "OtaVersionBo bo"
						params.push(trimmed);
					}
				}
				break;
			}
		}

		return params;
	}

	/**
	 * 从代码中提取当前类的字段定义
	 */
	private extractClassFields(beforeLines: string[]): string[] {
		const fields: string[] = [];

		for (const line of beforeLines) {
			// 匹配字段定义，如: private String name;
			const fieldMatch = line.match(/^\s*(?:private|protected|public)?\s*(\w+(?:<[^>]+>)?)\s+(\w+)\s*[;=]/);
			if (fieldMatch) {
				fields.push(`${fieldMatch[1]} ${fieldMatch[2]}`);
			}
		}

		return fields;
	}

	/**
	 * 确定当前光标所在的类和方法
	 */
	private getCurrentLocation(
		lineNumber: number,
		classes: any[]
	): { className: string; methodName?: string; } | undefined {

		for (const cls of classes) {
			// 检查是否在类的范围内
			if (lineNumber >= cls.startLine && lineNumber <= cls.endLine) {
				// 查找当前所在的方法
				for (const method of cls.methods) {
					if (lineNumber >= method.startLine && lineNumber <= method.endLine) {
						return {
							className: cls.name,
							methodName: method.name
						};
					}
				}

				// 在类中但不在任何方法中
				return {
					className: cls.name
				};
			}
		}

		return undefined;
	}

	/**
	 * 清除缓存
	 */
	clearCache(): void {
		this.typeCache.clear();
	}
}
