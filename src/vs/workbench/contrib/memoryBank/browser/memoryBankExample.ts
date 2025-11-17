/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IMemoryBankService } from '../../../services/memoryBank/common/memoryBank.js';
import { IProjectAnalyzerService } from '../../../services/projectAnalyzer/common/projectAnalyzer.js';
import { IAIService } from '../../../../platform/ai/common/ai.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { MemoryBankEnhancedFeatures } from '../../../services/memoryBank/browser/memoryBankEnhanced.js';
import { MemoryBankAIIntegration } from './memoryBankIntegration.js';

/**
 * Memory Bank 完整使用示例
 * 演示如何在实际场景中使用 Memory Bank 系统
 */
export class MemoryBankCompleteExample {

	private readonly enhanced: MemoryBankEnhancedFeatures;
	private readonly integration: MemoryBankAIIntegration;

	constructor(
		private readonly memoryBankService: IMemoryBankService,
		_projectAnalyzer: IProjectAnalyzerService,
		private readonly aiService: IAIService,
		_fileService: IFileService,
		private readonly workspaceService: IWorkspaceContextService
	) {
		this.enhanced = new MemoryBankEnhancedFeatures(
			memoryBankService,
			_fileService,
			_projectAnalyzer,
			aiService
		);

		this.integration = new MemoryBankAIIntegration(
			memoryBankService,
			aiService
		);
	}

	/**
	 * 完整工作流：从项目初始化到代码生成
	 */
	async completeWorkflow(): Promise<void> {
		console.log('=== Memory Bank 完整工作流示例 ===\n');

		const workspace = this.workspaceService.getWorkspace();
		if (!workspace.folders.length) {
			console.error('请先打开一个工作区');
			return;
		}

		const workspaceUri = workspace.folders[0].uri;

		// 步骤1：初始化 Memory Bank
		console.log('步骤1：初始化 Memory Bank...');
		await this.memoryBankService.initialize(workspaceUri);
		console.log('✓ Memory Bank 初始化完成\n');

		// 步骤2：一键学习项目
		console.log('步骤2：自动学习项目...');
		await this.enhanced.autoLearnProject(workspaceUri);
		console.log('✓ 项目学习完成\n');

		// 步骤3：查看学习结果
		console.log('步骤3：查看学习结果...');
		const memories = await this.memoryBankService.getAllEntries(workspaceUri);
		console.log(`✓ 共生成 ${memories.length} 条记忆`);
		for (const memory of memories) {
			console.log(`  - [${memory.category}] ${memory.title}`);
		}
		console.log('');

		// 步骤4：生成项目上下文摘要
		console.log('步骤4：生成项目上下文摘要...');
		const summary = await this.memoryBankService.generateContextSummary(workspaceUri);
		console.log('✓ 上下文摘要：');
		console.log(summary.substring(0, 500) + '...\n');

		// 步骤5：使用记忆生成代码
		console.log('步骤5：基于记忆生成代码...');
		const generatedCode = await this.integration.generateContextAwareCode(
			workspaceUri,
			'创建一个产品管理的 Controller',
			'controller'
		);
		console.log('✓ 生成的代码：');
		console.log(generatedCode.substring(0, 500) + '...\n');

		// 步骤6：添加自定义记忆
		console.log('步骤6：添加自定义记忆...');
		await this.memoryBankService.addEntry(workspaceUri, {
			title: '分页查询标准实现',
			content: `# 分页查询规范

## 统一分页参数
- pageNum: 页码（从1开始）
- pageSize: 每页大小（默认10）

## 统一返回格式
\`\`\`json
{
  "total": 100,
  "pageNum": 1,
  "pageSize": 10,
  "data": []
}
\`\`\`

## 实现方式
使用 MyBatis-Plus 的 Page 对象统一处理分页。
`,
			category: 'best-practices',
			tags: ['pagination', 'api', 'mybatis-plus']
		});
		console.log('✓ 自定义记忆添加完成\n');

		// 步骤7：搜索相关记忆
		console.log('步骤7：智能搜索记忆...');
		const searchResults = await this.enhanced.smartSearch(
			workspaceUri,
			['controller', 'api', 'rest']
		);
		console.log(`✓ 找到 ${searchResults.length} 条相关记忆：`);
		for (const result of searchResults) {
			console.log(`  - ${result.title} (${result.tags.join(', ')})`);
		}
		console.log('');

		console.log('=== 工作流完成 ===');
	}

	/**
	 * 场景1：新功能开发
	 */
	async scenario1_newFeatureDevelopment(): Promise<void> {
		console.log('=== 场景1：新功能开发 ===\n');

		const workspace = this.workspaceService.getWorkspace();
		if (!workspace.folders.length) {
			console.error('请先打开一个工作区');
			return;
		}

		const workspaceUri = workspace.folders[0].uri;

		// 需求：开发订单管理模块
		const requirement = `
创建订单管理模块，包含以下功能：
1. 创建订单
2. 查询订单列表（支持分页）
3. 查询订单详情
4. 更新订单状态
5. 取消订单
`;

		console.log('需求：', requirement);
		console.log('');

		// 步骤1：生成 Controller
		console.log('步骤1：生成 OrderController...');
		const controller = await this.integration.generateContextAwareCode(
			workspaceUri,
			'创建订单管理 Controller，' + requirement,
			'controller'
		);
		console.log('✓ Controller 生成完成');
		console.log(controller.substring(0, 300) + '...\n');

		// 步骤2：生成 Service
		console.log('步骤2：生成 OrderService...');
		const service = await this.integration.generateContextAwareCode(
			workspaceUri,
			'创建订单服务，实现业务逻辑，' + requirement,
			'service'
		);
		console.log('✓ Service 生成完成');
		console.log(service.substring(0, 300) + '...\n');

		// 步骤3：生成 Model
		console.log('步骤3：生成 Order 实体类...');
		const model = await this.integration.generateContextAwareCode(
			workspaceUri,
			'创建订单实体类，包含字段：订单号、用户ID、商品列表、总金额、订单状态、创建时间',
			'model'
		);
		console.log('✓ Model 生成完成');
		console.log(model.substring(0, 300) + '...\n');

		// 步骤4：记录这次开发的模式
		console.log('步骤4：记录开发模式到 Memory Bank...');
		await this.memoryBankService.addEntry(workspaceUri, {
			title: '订单管理模块开发模式',
			content: `# 订单管理模块开发经验

## 模块结构
- Controller: 处理 HTTP 请求
- Service: 实现业务逻辑
- Model: 数据实体

## 关键点
- 订单状态使用枚举类型
- 订单号使用雪花算法生成
- 订单创建使用事务处理
- 订单查询支持多条件筛选和分页
`,
			category: 'common-patterns',
			tags: ['order', 'module', 'crud']
		});
		console.log('✓ 开发模式已记录\n');

		console.log('=== 场景完成 ===');
	}

	/**
	 * 场景2：代码重构
	 */
	async scenario2_codeRefactoring(): Promise<void> {
		console.log('=== 场景2：代码重构 ===\n');

		const workspace = this.workspaceService.getWorkspace();
		if (!workspace.folders.length) {
			console.error('请先打开一个工作区');
			return;
		}

		const workspaceUri = workspace.folders[0].uri;

		// 旧代码
		const oldCode = `
@RestController
public class UserController {
    @Autowired
    private UserService userService;

    @GetMapping("/user/list")
    public List<User> getUsers() {
        return userService.getAllUsers();
    }

    @PostMapping("/user/add")
    public String addUser(User user) {
        userService.saveUser(user);
        return "success";
    }
}
`;

		console.log('原始代码：');
		console.log(oldCode);
		console.log('');

		// 步骤1：代码审查
		console.log('步骤1：基于项目规范审查代码...');
		const review = await this.integration.reviewCode(workspaceUri, oldCode);
		console.log('审查结果：');
		console.log('问题：');
		for (const issue of review.issues) {
			console.log(`  [${issue.severity}] ${issue.message}`);
		}
		console.log('改进建议：');
		for (const suggestion of review.suggestions) {
			console.log(`  - ${suggestion}`);
		}
		console.log('');

		// 步骤2：根据建议重构代码
		console.log('步骤2：使用 AI 重构代码...');
		const refactoredCode = await this.aiService.modify(
			oldCode,
			'根据项目规范重构代码：1. 使用统一的响应格式 2. 添加请求路径前缀 3. 使用 @RequestBody 接收参数 4. 添加参数校验 5. 完善错误处理'
		);
		console.log('重构后的代码：');
		console.log(refactoredCode.modifiedCode);
		console.log('');

		console.log('=== 场景完成 ===');
	}

	/**
	 * 场景3：团队协作
	 */
	async scenario3_teamCollaboration(): Promise<void> {
		console.log('=== 场景3：团队协作 ===\n');

		const workspace = this.workspaceService.getWorkspace();
		if (!workspace.folders.length) {
			console.error('请先打开一个工作区');
			return;
		}

		const workspaceUri = workspace.folders[0].uri;

		// 场景：新成员加入团队
		console.log('场景：新成员加入团队，需要了解项目规范\n');

		// 步骤1：查看项目结构
		console.log('步骤1：查看项目结构...');
		const structureMemories = await this.memoryBankService.getEntriesByCategory(
			workspaceUri,
			'project-structure'
		);
		if (structureMemories.length > 0) {
			console.log('项目结构：');
			console.log(structureMemories[0].content.substring(0, 400));
		}
		console.log('');

		// 步骤2：学习编码规范
		console.log('步骤2：学习编码规范...');
		const styleMemories = await this.memoryBankService.getEntriesByCategory(
			workspaceUri,
			'coding-style'
		);
		if (styleMemories.length > 0) {
			console.log('编码规范：');
			console.log(styleMemories[0].content.substring(0, 400));
		}
		console.log('');

		// 步骤3：查看最佳实践
		console.log('步骤3：查看最佳实践...');
		const practicesMemories = await this.memoryBankService.getEntriesByCategory(
			workspaceUri,
			'best-practices'
		);
		if (practicesMemories.length > 0) {
			console.log('最佳实践：');
			console.log(practicesMemories[0].content.substring(0, 400));
		}
		console.log('');

		// 步骤4：新成员添加自己的发现
		console.log('步骤4：新成员添加自己的发现到 Memory Bank...');
		await this.memoryBankService.addEntry(workspaceUri, {
			title: '日志记录最佳实践',
			content: `# 日志记录规范

## 日志级别
- ERROR: 系统错误，需要立即处理
- WARN: 警告信息，需要关注
- INFO: 重要的业务流程信息
- DEBUG: 调试信息

## 日志格式
使用 SLF4J，格式：[时间] [级别] [类名] - 消息

## 敏感信息
不要在日志中记录密码、密钥等敏感信息。
`,
			category: 'best-practices',
			tags: ['logging', 'slf4j', 'best-practice']
		});
		console.log('✓ 新的最佳实践已添加\n');

		console.log('=== 场景完成 ===');
	}

	/**
	 * 场景4：持续改进
	 */
	async scenario4_continuousImprovement(): Promise<void> {
		console.log('=== 场景4：持续改进 ===\n');

		const workspace = this.workspaceService.getWorkspace();
		if (!workspace.folders.length) {
			console.error('请先打开一个工作区');
			return;
		}

		const workspaceUri = workspace.folders[0].uri;

		// 步骤1：定期审查记忆质量
		console.log('步骤1：审查 Memory Bank 质量...');
		const allMemories = await this.memoryBankService.getAllEntries(workspaceUri);
		console.log(`当前共有 ${allMemories.length} 条记忆`);

		const categoryCounts: Record<string, number> = {};
		for (const memory of allMemories) {
			categoryCounts[memory.category] = (categoryCounts[memory.category] || 0) + 1;
		}

		console.log('分类统计：');
		for (const [category, count] of Object.entries(categoryCounts)) {
			console.log(`  ${category}: ${count}`);
		}
		console.log('');

		// 步骤2：更新过时的记忆
		console.log('步骤2：更新过时的记忆...');
		const oldMemories = allMemories.filter(m =>
			Date.now() - m.updatedAt > 30 * 24 * 60 * 60 * 1000 // 30天未更新
		);
		console.log(`发现 ${oldMemories.length} 条可能过时的记忆`);
		// 实际应用中可以提示用户审查这些记忆
		console.log('');

		// 步骤3：删除不相关的记忆
		console.log('步骤3：清理不相关的记忆...');
		// 示例：删除某个测试记忆
		const testMemories = allMemories.filter(m => m.tags.includes('test-only'));
		for (const memory of testMemories) {
			await this.memoryBankService.deleteEntry(workspaceUri, memory.id);
		}
		console.log(`已删除 ${testMemories.length} 条测试记忆\n`);

		// 步骤4：重新学习项目变更
		console.log('步骤4：重新学习项目变更...');
		await this.memoryBankService.learnProjectStructure(workspaceUri);
		console.log('✓ 项目结构已更新\n');

		console.log('=== 场景完成 ===');
	}

	/**
	 * 性能测试
	 */
	async performanceTest(): Promise<void> {
		console.log('=== Memory Bank 性能测试 ===\n');

		const workspace = this.workspaceService.getWorkspace();
		if (!workspace.folders.length) {
			console.error('请先打开一个工作区');
			return;
		}

		const workspaceUri = workspace.folders[0].uri;

		// 测试1：批量添加记忆
		console.log('测试1：批量添加 100 条记忆...');
		const startAdd = Date.now();
		for (let i = 0; i < 100; i++) {
			await this.memoryBankService.addEntry(workspaceUri, {
				title: `测试记忆 ${i}`,
				content: `这是第 ${i} 条测试记忆，用于性能测试。`,
				category: 'custom',
				tags: ['test', `test-${i}`]
			});
		}
		const addTime = Date.now() - startAdd;
		console.log(`✓ 完成，耗时 ${addTime}ms (平均 ${addTime / 100}ms/条)\n`);

		// 测试2：查询所有记忆
		console.log('测试2：查询所有记忆...');
		const startQuery = Date.now();
		const memories = await this.memoryBankService.getAllEntries(workspaceUri);
		const queryTime = Date.now() - startQuery;
		console.log(`✓ 查询到 ${memories.length} 条记忆，耗时 ${queryTime}ms\n`);

		// 测试3：按类别查询
		console.log('测试3：按类别查询...');
		const startCategoryQuery = Date.now();
		const categoryMemories = await this.memoryBankService.getEntriesByCategory(
			workspaceUri,
			'custom'
		);
		const categoryQueryTime = Date.now() - startCategoryQuery;
		console.log(`✓ 查询到 ${categoryMemories.length} 条记忆，耗时 ${categoryQueryTime}ms\n`);

		// 测试4：标签搜索
		console.log('测试4：标签搜索...');
		const startTagSearch = Date.now();
		const tagMemories = await this.memoryBankService.searchByTags(
			workspaceUri,
			['test']
		);
		const tagSearchTime = Date.now() - startTagSearch;
		console.log(`✓ 搜索到 ${tagMemories.length} 条记忆，耗时 ${tagSearchTime}ms\n`);

		// 测试5：智能搜索
		console.log('测试5：智能搜索...');
		const startSmartSearch = Date.now();
		const smartResults = await this.enhanced.smartSearch(
			workspaceUri,
			['test', 'memory']
		);
		const smartSearchTime = Date.now() - startSmartSearch;
		console.log(`✓ 搜索到 ${smartResults.length} 条相关记忆，耗时 ${smartSearchTime}ms\n`);

		// 清理测试数据
		console.log('清理测试数据...');
		for (const memory of tagMemories) {
			await this.memoryBankService.deleteEntry(workspaceUri, memory.id);
		}
		console.log('✓ 测试数据已清理\n');

		console.log('=== 性能测试完成 ===');
	}
}
