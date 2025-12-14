/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IAIService, AIGenerationRequest, AIGeneratedCode, AICodeModification, AIStreamCallback, AIResponse, AIUsage } from '../../../../platform/ai/common/ai.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IRequestService, asJson } from '../../../../platform/request/common/request.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { IStorageService, StorageScope } from '../../../../platform/storage/common/storage.js';
import { IAILogService } from '../../../../platform/aiLog/common/aiLog.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { isWindows, isMacintosh, isLinux } from '../../../../base/common/platform.js';

export class AIService implements IAIService {

	declare readonly _serviceBrand: undefined;

	private credentials: { username: string; password: string } | undefined;
	private currentTraceId: string | null = null;
	private currentCallStartTime: Date | null = null;

	constructor(
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@ILogService private readonly logService: ILogService,
		@IRequestService private readonly requestService: IRequestService,
		@IStorageService private readonly storageService: IStorageService,
		@IAILogService private readonly aiLogService: IAILogService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService
	) {
		this.logService.info('[AI Service] Initialized');
		this.credentials = this.loadAuthCredentials();
	}

	/**
	 * 从 StorageService 加载认证凭据
	 */
	private loadAuthCredentials(): { username: string; password: string } | undefined {
		try {
			const stored = this.storageService.get('zhikai.auth.credentials', StorageScope.APPLICATION);
			if (!stored) {
				this.logService.warn('[AI Service] 未找到认证凭据，AI功能将不可用');
				return undefined;
			}

			const parsed = JSON.parse(stored);
			if (parsed && parsed.username && parsed.password) {
				this.logService.info('[AI Service] 成功加载认证凭据，将使用AI代理服务');
				return { username: parsed.username, password: parsed.password };
			}
			return undefined;
		} catch (error) {
			this.logService.error('[AI Service] 加载认证凭据失败:', error);
			return undefined;
		}
	}

	async complete(prompt: string, options?: { temperature?: number; maxTokens?: number; systemMessage?: string; businessCode?: string }): Promise<string> {
		const response = await this.completeWithUsage(prompt, options);
		return response.content;
	}

	async completeWithUsage(prompt: string, options?: { temperature?: number; maxTokens?: number; systemMessage?: string; businessCode?: string }): Promise<AIResponse> {
		const model = this.configurationService.getValue<string>('zhikai.ai.model') || 'qwen-plus';
		const provider = this.configurationService.getValue<string>('zhikai.ai.provider') || 'qwen';
		const apiUrl = this.configurationService.getValue<string>('zhikai.auth.apiUrl');

		// 优化的默认参数
		const temperature = options?.temperature ?? 0.15;
		const maxTokens = options?.maxTokens ?? 1000;
		const systemMessage = options?.systemMessage;
		const businessCode = options?.businessCode;  // 新增：从选项中获取businessCode

		// 构建消息数组
		const messages: any[] = [];
		if (systemMessage) {
			messages.push({ role: 'system', content: systemMessage });
		}
		messages.push({ role: 'user', content: prompt });

		// 初始化日志追踪
		this.currentTraceId = this.generateTraceId();
		this.currentCallStartTime = new Date();

		// 必须使用代理服务
		if (!apiUrl || !this.credentials) {
			const errorMsg = '未配置 AI 代理服务。请先登录或配置 zhikai.auth.apiUrl';
			this.logService.error('[AI Service] ' + errorMsg);

			// 记录失败日志
			await this.logAICall({
				provider: provider,
				model: model,
				operation: businessCode || 'chat',  // 使用businessCode作为operation，如果没有则降级使用'chat'
				mode: 'code_action',
				status: 'failed',
				errorMessage: errorMsg,
				deviceInfo: this.getDeviceInfo(),
				ideInfo: this.getIdeInfo()
			});

			return { content: 'Error: ' + errorMsg };
		}

		// 使用AI代理服务
		this.logService.info('[AI Service] 使用AI代理服务');
		return this.completeWithProxy(apiUrl, provider, model, messages, temperature, maxTokens, businessCode);
	}

	/**
	 * 使用AI代理服务完成（推荐）
	 */
	private async completeWithProxy(
		apiUrl: string,
		provider: string,
		model: string,
		messages: any[],
		temperature: number,
		maxTokens: number,
		businessCode?: string  // 新增：可选的businessCode参数
	): Promise<AIResponse> {
		const endpoint = `${apiUrl.replace(/\/$/, '')}/ai/proxy/chat/completions`;

		try {
			const requestData: any = {
				provider: provider,
				model: model,
				messages: messages,
				temperature: temperature,
				maxTokens: maxTokens,
				username: btoa(this.credentials!.username),
				password: btoa(this.credentials!.password)
			};

			// 如果提供了businessCode，则添加到请求中
			if (businessCode) {
				requestData.businessCode = businessCode;
			}

			const response = await this.requestService.request({
				type: 'POST',
				url: endpoint,
				headers: {
					'Content-Type': 'application/json'
				},
				data: JSON.stringify(requestData)
			}, CancellationToken.None);

			const data = await asJson<any>(response);

			if (data && data.data && data.data.choices && data.data.choices[0]) {
				const content = data.data.choices[0].message.content;
				const usage: AIUsage | undefined = data.data.usage ? {
					promptTokens: data.data.usage.promptTokens || 0,
					completionTokens: data.data.usage.completionTokens || 0,
					totalTokens: data.data.usage.totalTokens || 0
				} : undefined;

				this.logService.info('[AI Service] 代理服务调用成功, response length:', content.length, 'usage:', usage);

				// 记录成功日志
				await this.logAICall({
					provider: provider,
					model: model,
					operation: businessCode || 'chat',  // 使用businessCode作为operation，如果没有则降级使用'chat'
					mode: 'code_action',
					inputTokens: usage?.promptTokens,
					outputTokens: usage?.completionTokens,
					status: 'success',
					deviceInfo: this.getDeviceInfo(),
					ideInfo: this.getIdeInfo()
				});

				return { content, usage };
			}

			this.logService.error('[AI Service] 代理服务返回格式错误:', data);

			// 记录失败日志
			await this.logAICall({
				provider: provider,
				model: model,
				operation: businessCode || 'chat',  // 使用businessCode作为operation，如果没有则降级使用'chat'
				mode: 'code_action',
				status: 'failed',
				errorMessage: 'Invalid proxy response',
				deviceInfo: this.getDeviceInfo(),
				ideInfo: this.getIdeInfo()
			});

			return { content: 'Error: Invalid proxy response' };
		} catch (error) {
			this.logService.error('[AI Service] 代理服务调用失败:', error);

			// 记录失败日志
			await this.logAICall({
				provider: provider,
				model: model,
				operation: businessCode || 'chat',  // 使用businessCode作为operation，如果没有则降级使用'chat'
				mode: 'code_action',
				status: 'failed',
				errorMessage: String(error),
				deviceInfo: this.getDeviceInfo(),
				ideInfo: this.getIdeInfo()
			});

			return { content: `Error: ${error}` };
		}
	}



	/**
	 * 流式完成 - 使用AI代理服务
	 */
	async completeStream(prompt: string, onChunk: AIStreamCallback, abortSignal?: AbortSignal): Promise<void> {
		const model = this.configurationService.getValue<string>('zhikai.ai.model') || 'qwen-plus';
		const provider = this.configurationService.getValue<string>('zhikai.ai.provider') || 'qwen';
		const apiUrl = this.configurationService.getValue<string>('zhikai.auth.apiUrl');
		const messages = [{ role: 'user', content: prompt }];

		// 必须使用代理服务
		if (!apiUrl || !this.credentials) {
			const errorMsg = '未配置 AI 代理服务。请先登录或配置 zhikai.auth.apiUrl';
			this.logService.error('[AI Service] ' + errorMsg);
			onChunk({ content: 'Error: ' + errorMsg, isComplete: true });
			return;
		}

		this.logService.info('[AI Service] 使用AI代理服务流式响应');
		return this.completeStreamWithProxy(apiUrl, provider, model, messages, onChunk, abortSignal);
	}

	/**
	 * 使用AI代理服务的流式完成
	 */
	private async completeStreamWithProxy(
		apiUrl: string,
		provider: string,
		model: string,
		messages: any[],
		onChunk: AIStreamCallback,
		abortSignal?: AbortSignal
	): Promise<void> {
		const endpoint = `${apiUrl.replace(/\/$/, '')}/ai/proxy/stream/chat/completions`;

		try {
			const response = await fetch(endpoint, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({
					provider: provider,
					model: model,
					messages: messages,
					temperature: 0.7,
					stream: true,
					username: btoa(this.credentials!.username),
					password: btoa(this.credentials!.password)
				}),
				signal: abortSignal
			});

			if (!response.ok) {
				throw new Error(`HTTP ${response.status}: ${response.statusText}`);
			}

			const reader = response.body?.getReader();
			if (!reader) {
				throw new Error('No response body reader available');
			}

			const decoder = new TextDecoder('utf-8');
			let buffer = '';
			let fullContent = '';
			let usage: AIUsage | undefined;

			while (true) {
				const { done, value } = await reader.read();
				if (done) {
					break;
				}

				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split('\n');
				buffer = lines.pop() || '';

				for (const line of lines) {
					if (!line.trim() || line.startsWith(':')) {
						continue;
					}

					if (line.startsWith('data: ')) {
						const data = line.substring(6).trim();

						if (data === '[DONE]') {
							onChunk({ content: fullContent, isComplete: true, usage });
							this.logService.info('[AI Service] 代理服务流式响应完成, usage:', usage);
							return;
						}

						try {
							const json = JSON.parse(data);
							const delta = json.choices?.[0]?.delta?.content;

							// 提取文本内容
							if (delta) {
								fullContent += delta;
								onChunk({ content: fullContent, isComplete: false });
							}

							// 提取usage信息（通常在最后一个chunk中）
							if (json.usage) {
								usage = {
									promptTokens: json.usage.promptTokens || json.usage.prompt_tokens || 0,
									completionTokens: json.usage.completionTokens || json.usage.completion_tokens || 0,
									totalTokens: json.usage.totalTokens || json.usage.total_tokens || 0
								};
							}
						} catch (e) {
							this.logService.warn('[AI Service] Failed to parse proxy SSE chunk:', e);
						}
					}
				}
			}

			onChunk({ content: fullContent, isComplete: true, usage });
			this.logService.info('[AI Service] 代理服务流式响应结束, usage:', usage);

		} catch (error: any) {
			if (error.name === 'AbortError') {
				this.logService.info('[AI Service] 代理服务流式响应被用户中止');
				return;
			}
			this.logService.error('[AI Service] 代理服务流式响应失败:', error);
			onChunk({ content: `抱歉，流式响应失败: ${error}`, isComplete: true });
		}
	}


	async generate(request: AIGenerationRequest, token?: any): Promise<AIGeneratedCode> {
		this.logService.info('[AI Service] Generating code, type:', request.type);

		// 构建不同类型的 prompt
		let prompt = '';
		let options: { temperature?: number; maxTokens?: number; systemMessage?: string; businessCode?: string } = {};

		switch (request.type) {
			case 'test':
				prompt = await this.buildTestPrompt(request);
				options = {
					businessCode: 'IDE_TEST_GENERATION'
				};
				break;
			case 'comment':
				prompt = await this.buildCommentPrompt(request);
				// 注释生成使用特殊参数（参考Java实现）
				options = {
					temperature: 0.3,
					maxTokens: 800,
					systemMessage: 'You are an expert at writing clear, concise code documentation comments.',
					businessCode: 'IDE_COMMENT_GENERATION'
				};
				break;
			case 'commit':
				// Git commit message 生成
				prompt = request.requirement || ''; // commit message的prompt已经在Git扩展中构建好了
				options = {
					temperature: 0.3,
					maxTokens: 500,
					businessCode: 'IDE_COMMIT_MESSAGE_GENERATION'
				};
				break;
			case 'business':
				prompt = await this.buildBusinessCodePrompt(request);
				options = {
					businessCode: 'IDE_CODE_GENERATION'
				};
				break;
		}

		const result = await this.complete(prompt, options);

		// 对于注释类型，使用专门的提取方法
		const extractedCode = request.type === 'comment'
			? this.extractComment(result, request.language || 'java')
			: this.extractCode(result);

		return {
			code: extractedCode,
			description: ''
		};
	}

	async modify(code: string, instruction: string, token?: any): Promise<AICodeModification> {
		this.logService.info('[AI Service] Modifying code, instruction:', instruction);

		const prompt = `你是一个专业的代码重构专家。请根据以下指令修改代码。

修改指令：${instruction}

原始代码：
\`\`\`
${code}
\`\`\`

要求：
1. 严格按照指令修改代码
2. 保持代码的原有功能和逻辑（除非指令要求改变）
3. 保持代码风格的一致性
4. 确保修改后的代码语法正确
5. 【重要】只返回修改后的完整代码，不要返回任何解释
6. 【重要】不要包含markdown代码块标记
7. 【重要】保持原有的缩进和格式风格

请直接返回修改后的代码：`;

		const result = await this.complete(prompt, {
			businessCode: 'IDE_CODE_MODIFICATION'
		});

		return {
			modifiedCode: this.extractCode(result),
			summary: instruction
		};
	}

	private async buildTestPrompt(request: AIGenerationRequest): Promise<string> {
		const framework = request.context?.framework || 'junit5';
		const testType = request.context?.testType || 'unit';

		// 尝试从后端获取提示词
		const backendPrompt = await this.fetchPromptFromBackend('/generation/test', {
			language: request.language,
			sourceCode: request.sourceCode,
			framework: framework,
			testType: testType
		});

		if (backendPrompt) {
			return backendPrompt;
		}

		// 降级：使用默认提示词
		this.logService.warn('[AI Service] 使用默认测试生成提示词');
		const methodName = request.context?.methodName || '目标方法';

		return `你是一个专业的单元测试编写专家。请为以下${request.language}代码生成${framework}单元测试。

源代码：
\`\`\`${request.language}
${request.sourceCode}
\`\`\`

要求：
1. 为方法"${methodName}"生成完整的测试方法
2. 包含以下测试场景：
   - 正常情况测试
   - 边界条件测试
   - 异常情况测试
3. 使用${framework}的标准断言方法
4. 测试方法命名要清晰，反映测试意图
5. 【重要】只返回测试方法的代码，不要返回类声明、导入语句
6. 【重要】不要包含任何解释性文字或markdown标记
7. 代码要规范、易读

请直接返回测试方法代码：`;
	}

	private async buildCommentPrompt(request: AIGenerationRequest): Promise<string> {
		const elementType = request.context?.elementType || 'method';

		let style = 'JavaDoc';
		if (request.language === 'typescript' || request.language === 'javascript') {
			style = 'JSDoc';
		} else if (request.language === 'python') {
			style = 'DocString';
		}

		// 使用结构化prompt模板
		if (elementType === 'class') {
			return await this.buildClassCommentPrompt(request, style);
		} else {
			return await this.buildMethodCommentPrompt(request, style);
		}
	}

	/**
	 * 构建方法注释prompt（使用结构化模板）
	 */
	private async buildMethodCommentPrompt(request: AIGenerationRequest, style: string): Promise<string> {
		// 尝试从后端获取提示词
		const backendPrompt = await this.fetchPromptFromBackend('/comment/method', {
			language: request.language,
			sourceCode: request.sourceCode,
			commentStyle: style
		});

		if (backendPrompt) {
			return backendPrompt;
		}

		// 降级：使用默认提示词
		this.logService.warn('[AI Service] 使用默认方法注释提示词');
		return `- Role: 代码注释专家
- Profile: 你是一位经验丰富的软件开发工程师，精通${request.language}语言及其注释规范。你擅长通过简洁明了的语言描述代码的功能和逻辑。
- Goals: 为以下${request.language}方法生成高质量的${style}注释，包含方法功能描述、参数说明、返回值说明、异常说明。
- Constrains: 注释应简洁准确，遵循${style}规范。只返回注释内容 (/**  ... */),不要返回方法代码。

代码：
\`\`\`${request.language}
${request.sourceCode}
\`\`\`

要求：
1. 使用标准${style}格式
2. 包含方法功能描述（用中文描述）
3. 为每个参数添加@param标签，说明参数类型和用途（描述用中文）
4. 如有返回值添加@return标签，说明返回值类型和含义（描述用中文）
5. 如有异常添加@throws标签，说明可能抛出的异常（描述用中文）
6. 【重要】除了@param、@return、@throws等关键字外，所有描述使用中文
7. 描述要简洁准确
8. 只返回注释内容 (/**  ... */),不要返回方法代码
`;
	}

	/**
	 * 构建类注释prompt（使用结构化模板）
	 */
	private async buildClassCommentPrompt(request: AIGenerationRequest, style: string): Promise<string> {
		// 尝试从后端获取提示词
		const backendPrompt = await this.fetchPromptFromBackend('/comment/class', {
			language: request.language,
			sourceCode: request.sourceCode,
			commentStyle: style
		});

		if (backendPrompt) {
			return backendPrompt;
		}

		// 降级：使用默认提示词
		this.logService.warn('[AI Service] 使用默认类注释提示词');
		return `- Role: 代码注释专家
- Profile: 你是一位经验丰富的软件开发工程师，精通${request.language}语言及其注释规范。你擅长分析类的结构和职责，通过清晰的注释帮助其他开发者理解代码设计意图。
- Goals: 为以下${request.language}类生成高质量的${style}注释，描述类的功能、职责、设计意图。
- Constrains: 注释应简洁准确，遵循${style}规范。只返回注释块 (/** ... */),不要返回类的代码。

代码：
\`\`\`${request.language}
${request.sourceCode}
\`\`\`

要求：
1. 使用标准${style}格式
2. 描述类的功能和职责（用中文描述）
3. 说明类的主要成员和核心方法（用中文描述）
4. 添加@author标签
5. 添加@since标签
6. 【重要】除了@author、@since等关键字外，所有描述使用中文
7. 描述要简洁准确
8. 【重要】只返回${style}注释 (/** ... */),不要返回任何代码
9. 【重要】不要重复类的代码,只返回注释块
`;
	}

	private async buildBusinessCodePrompt(request: AIGenerationRequest): Promise<string> {
		const contextInfo = request.context || {};
		const generationType = contextInfo.generationType || 'code_snippet';

		// 根据生成类型构建不同的prompt
		if (generationType === 'full_class') {
			return await this.buildFullClassPrompt(request, contextInfo);
		} else if (generationType === 'full_method') {
			return await this.buildFullMethodPrompt(request, contextInfo);
		} else {
			return await this.buildCodeSnippetPrompt(request, contextInfo);
		}
	}

	/**
	 * 构建完整类的prompt
	 */
	private async buildFullClassPrompt(request: AIGenerationRequest, contextInfo: any): Promise<string> {
		// 尝试从后端获取提示词
		const backendPrompt = await this.fetchPromptFromBackend('/generation/class', {
			language: request.language,
			className: contextInfo.className || 'MyClass',
			requirement: request.requirement,
			interfaces: contextInfo.interfaces,
			baseClass: contextInfo.baseClass
		});

		if (backendPrompt) {
			return backendPrompt;
		}

		// 降级：使用默认提示词
		this.logService.warn('[AI Service] 使用默认完整类生成提示词');
		let contextSection = `\n当前上下文：`;
		contextSection += `\n- 编程语言：${request.language}`;
		contextSection += `\n- 位置：文件级别（将生成完整的类）`;

		if (contextInfo.imports && contextInfo.imports.length > 0) {
			contextSection += `\n- 已有导入语句：\n${contextInfo.imports.slice(0, 10).join('\n')}`;
		}

		return `你是一个专业的代码生成专家。请根据以下需求生成完整的${request.language}类。

需求描述：${request.requirement}
${contextSection}

要求：
1. 生成完整的类定义，包括：
   - 类声明（类名要清晰反映功能）
   - 必要的字段
   - 构造方法/构造函数
   - 所有需要的方法
2. 包含适当的访问修饰符（public/private/protected）
3. 使用恰当的设计模式和最佳实践
4. 包含必要的错误处理和边界检查
5. 【重要】生成完整的类代码，包括类声明和所有成员
6. 【重要】可以包含必要的导入语句
7. 【重要】不要包含任何解释性文字或markdown标记
8. 代码要规范、易读、易维护

请直接返回完整的类代码：`;
	}

	/**
	 * 构建完整方法的prompt
	 */
	private async buildFullMethodPrompt(request: AIGenerationRequest, contextInfo: any): Promise<string> {
		// 尝试从后端获取提示词
		const backendPrompt = await this.fetchPromptFromBackend('/generation/method', {
			language: request.language,
			methodSignature: contextInfo.methodSignature || '',
			requirement: request.requirement,
			classContext: contextInfo.currentClass
		});

		if (backendPrompt) {
			return backendPrompt;
		}

		// 降级：使用默认提示词
		this.logService.warn('[AI Service] 使用默认完整方法生成提示词');
		let contextSection = `\n当前上下文：`;
		contextSection += `\n- 编程语言：${request.language}`;
		contextSection += `\n- 位置：类级别（将生成完整的方法）`;

		if (contextInfo.currentClass) {
			contextSection += `\n- 当前类：\n\`\`\`${request.language}\n${contextInfo.currentClass}\n\`\`\``;
		}

		if (contextInfo.imports && contextInfo.imports.length > 0) {
			contextSection += `\n- 已导入的包/模块：\n${contextInfo.imports.slice(0, 10).join('\n')}`;
		}

		return `你是一个专业的代码生成专家。请根据以下需求生成完整的${request.language}方法。

需求描述：${request.requirement}
${contextSection}

要求：
1. 生成完整的方法，包括：
   - 方法签名（访问修饰符、返回类型、方法名、参数）
   - 完整的方法体实现
2. 代码风格要与当前类中的代码保持一致
3. 使用恰当的算法和数据结构
4. 包含必要的错误处理和边界检查
5. 使用有意义的变量名
6. 【重要】生成完整的方法代码（包括方法签名和实现）
7. 【重要】不要生成类声明，只生成方法
8. 【重要】不要包含导入语句
9. 【重要】不要包含任何解释性文字或markdown标记
10. 代码要规范、易读、易维护

请直接返回完整的方法代码：`;
	}

	/**
	 * 构建代码片段的prompt
	 */
	private async buildCodeSnippetPrompt(request: AIGenerationRequest, contextInfo: any): Promise<string> {
		// 尝试从后端获取提示词
		const backendPrompt = await this.fetchPromptFromBackend('/generation/snippet', {
			language: request.language,
			requirement: request.requirement,
			contextCode: contextInfo.surroundingCode || contextInfo.currentMethod
		});

		if (backendPrompt) {
			return backendPrompt;
		}

		// 降级：使用默认提示词
		this.logService.warn('[AI Service] 使用默认代码片段生成提示词');
		let contextSection = `\n当前上下文：`;
		contextSection += `\n- 编程语言：${request.language}`;
		contextSection += `\n- 位置：方法内部（将生成代码片段）`;

		if (contextInfo.currentMethod) {
			contextSection += `\n- 当前方法：\n\`\`\`${request.language}\n${contextInfo.currentMethod}\n\`\`\``;
		}

		if (contextInfo.surroundingCode) {
			contextSection += `\n- 周围代码：\n\`\`\`${request.language}\n${contextInfo.surroundingCode}\n\`\`\``;
		}

		return `你是一个专业的代码生成专家。请根据以下需求生成${request.language}代码片段。

需求描述：${request.requirement}
${contextSection}

要求：
1. 生成实现功能的代码片段（几行到十几行代码）
2. 代码风格要与周围代码保持一致
3. 可以使用当前方法中已定义的变量
4. 包含必要的错误处理
5. 使用有意义的变量名
6. 【重要】只生成代码片段，不要生成方法签名或类声明
7. 【重要】不要包含导入语句
8. 【重要】不要包含任何解释性文字或markdown标记
9. 【重要】保持与周围代码相同的缩进风格
10. 代码要简洁、高效

请直接返回代码片段：`;
	}

	private extractCode(response: string): string {
		// 去除 markdown 代码块标记
		let code = response.trim();

		// 匹配 ```language\n代码\n```
		const codeBlockMatch = code.match(/```(?:\w+)?\s*\n([\s\S]*?)```/);
		if (codeBlockMatch) {
			code = codeBlockMatch[1].trim();
		}

		// 去除其他 markdown 标记
		code = code.replace(/```/g, '').trim();

		return code;
	}

	/**
	 * 提取注释内容
	 * 参考Java的extractCodeBlock实现
	 */
	private extractComment(response: string, language: string): string {
		let comment = response.trim();

		// 1. 先清理markdown代码块标记（参考Java实现）
		if (comment.startsWith('```')) {
			const firstNewline = comment.indexOf('\n');
			if (firstNewline > 0) {
				comment = comment.substring(firstNewline + 1);
			}
		}
		if (comment.endsWith('```')) {
			comment = comment.substring(0, comment.length - 3);
		}
		comment = comment.trim();

		// 2. 如果已经是完整的注释格式，直接返回
		if (language === 'python') {
			if (comment.startsWith('"""') && comment.endsWith('"""')) {
				return comment;
			}
		} else {
			if (comment.startsWith('/**') && comment.endsWith('*/')) {
				return comment;
			}
		}

		// 3. 尝试从文本中提取注释块
		if (language === 'python') {
			const docstringMatch = comment.match(/"""([\s\S]*?)"""/);
			if (docstringMatch) {
				return `"""${docstringMatch[1].trim()}\n"""`;
			}
			// 没有找到，包装一下
			return `"""\n${comment}\n"""`;
		} else {
			const javaDocMatch = comment.match(/\/\*\*([\s\S]*?)\*\//);
			if (javaDocMatch) {
				return `/**${javaDocMatch[1]}*/`;
			}
			// 没有找到完整格式，尝试修复
			if (comment.startsWith('/*') && !comment.startsWith('/**')) {
				comment = '/**' + comment.substring(2);
			}
			if (!comment.startsWith('/**')) {
				comment = '/**\n' + comment;
			}
			if (!comment.endsWith('*/')) {
				comment = comment + '\n*/';
			}
			return comment;
		}
	}

	/**
	 * 生成追踪ID (UUID v4)
	 */
	private generateTraceId(): string {
		return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
			const r = Math.random() * 16 | 0;
			const v = c === 'x' ? r : (r & 0x3 | 0x8);
			return v.toString(16);
		});
	}

	/**
	 * 获取用户邮箱
	 */
	private getUserEmail(): string | undefined {
		return this.credentials?.username;
	}

	/**
	 * 获取设备信息
	 */
	private getDeviceInfo(): any {
		let osType = 'unknown';
		let osVersion = '';

		if (isWindows) {
			osType = 'Windows';
			// 可以通过navigator.userAgent获取详细版本
			osVersion = navigator.userAgent.match(/Windows NT (\d+\.\d+)/)?.[1] || '';
		} else if (isMacintosh) {
			osType = 'macOS';
			osVersion = navigator.userAgent.match(/Mac OS X (\d+[_\.]\d+[_\.]\d+)/)?.[1]?.replace(/_/g, '.') || '';
		} else if (isLinux) {
			osType = 'Linux';
		}

		return {
			type: osType,
			id: '', // 可以生成设备ID
			name: '', // 可以获取计算机名
			osVersion: osVersion || osType
		};
	}

	/**
	 * 获取IDE信息
	 */
	private getIdeInfo(): any {
		// 从VSCode配置中获取版本信息
		return {
			type: 'vscode',
			version: '1.90.0', // 可以从vscode API获取
			pluginVersion: '1.0.0', // 插件版本
			projectName: this.workspaceContextService.getWorkspace().folders[0]?.name || ''
		};
	}

	/**
	 * 从后端API获取提示词
	 */
	private async fetchPromptFromBackend(endpoint: string, context: Record<string, any>): Promise<string | null> {
		const apiUrl = this.configurationService.getValue<string>('zhikai.auth.apiUrl');
		if (!apiUrl) {
			this.logService.warn('[AI Service] 未配置API URL，无法从后端获取提示词');
			return null;
		}

		try {
			const url = `${apiUrl.replace(/\/$/, '')}/system/ai/prompt${endpoint}`;
			this.logService.info('[AI Service] 从后端获取提示词:', url);

			const response = await this.requestService.request({
				type: 'POST',
				url: url,
				headers: {
					'Content-Type': 'application/json'
				},
				data: JSON.stringify(context)
			}, CancellationToken.None);

			const data = await asJson<any>(response);

			if (data && data.code === 200 && data.data) {
				this.logService.info('[AI Service] 从后端获取提示词成功');
				return data.data;
			}

			this.logService.warn('[AI Service] 后端返回提示词失败:', data);
			return null;
		} catch (error) {
			this.logService.error('[AI Service] 从后端获取提示词失败:', error);
			return null;
		}
	}

	/**
	 * 记录AI调用日志
	 */
	private async logAICall(options: {
		provider: string;
		model: string;
		operation: string;
		mode: string;
		inputTokens?: number;
		outputTokens?: number;
		status: 'success' | 'failed';
		errorMessage?: string;
		deviceInfo: any;
		ideInfo: any;
	}): Promise<void> {
		if (!this.currentTraceId || !this.currentCallStartTime) {
			return;
		}

		try {
			const endTime = new Date();
			const durationMs = endTime.getTime() - this.currentCallStartTime.getTime();

			await this.aiLogService.logAICall({
				traceId: this.currentTraceId,
				userEmail: this.getUserEmail(),
				deviceInfo: options.deviceInfo,
				ideInfo: options.ideInfo,
				provider: options.provider,
				model: options.model,
				operation: options.operation,
				mode: options.mode,
				inputTokens: options.inputTokens,
				outputTokens: options.outputTokens,
				durationMs: durationMs,
				status: options.status,
				errorMessage: options.errorMessage,
				startTime: this.currentCallStartTime,
				endTime: endTime
			});
		} catch (error) {
			this.logService.error('[AI Service] 记录AI调用日志失败:', error);
		}
	}
}

registerSingleton(IAIService, AIService, InstantiationType.Delayed);
