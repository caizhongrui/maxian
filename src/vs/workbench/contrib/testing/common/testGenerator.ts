/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { TestFramework } from './testingTypes.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { IAIService } from '../../../../platform/ai/common/ai.js';

/**
 * Test generator service
 * Generates test files for source code files using AI
 */
export class TestGenerator {

	constructor(
		private readonly _fileService: IFileService,
		private readonly _aiService: IAIService
	) { }

	/**
	 * Generate tests for a file or directory
	 */
	async generateTests(
		uri: URI,
		framework: TestFramework
	): Promise<GenerateTestsResult> {
		const errors: string[] = [];
		const generatedFiles: URI[] = [];

		try {
			// Check if it's a directory or file
			const stat = await this._fileService.resolve(uri);

			if (stat.isDirectory) {
				// Generate tests for all source files in directory
				await this.generateTestsForDirectory(uri, framework, generatedFiles, errors);
			} else {
				// Generate test for single file
				const testFile = await this.generateTestForFile(uri, framework);
				if (testFile) {
					generatedFiles.push(testFile);
				}
			}

			return {
				generatedFiles,
				errors,
				framework
			};
		} catch (error) {
			errors.push(error instanceof Error ? error.message : String(error));
			return {
				generatedFiles,
				errors,
				framework
			};
		}
	}

	/**
	 * Generate tests for all source files in a directory
	 */
	private async generateTestsForDirectory(
		dirUri: URI,
		framework: TestFramework,
		generatedFiles: URI[],
		errors: string[]
	): Promise<void> {
		try {
			const dirStat = await this._fileService.resolve(dirUri);

			if (!dirStat.children) {
				return;
			}

			for (const child of dirStat.children) {
				if (child.isDirectory) {
					// Skip common directories
					const dirName = child.name;
					if (dirName === 'node_modules' || dirName === '.git' || dirName === 'dist' || dirName === 'build' || dirName.startsWith('__')) {
						continue;
					}

					// Recursively process subdirectory
					await this.generateTestsForDirectory(child.resource, framework, generatedFiles, errors);
				} else {
					// Check if it's a source file
					if (this.isSourceFile(child.name, framework)) {
						try {
							const testFile = await this.generateTestForFile(child.resource, framework);
							if (testFile) {
								generatedFiles.push(testFile);
							}
						} catch (error) {
							errors.push(`Error generating test for ${child.name}: ${error instanceof Error ? error.message : String(error)}`);
						}
					}
				}
			}
		} catch (error) {
			errors.push(`Error processing directory ${dirUri.fsPath}: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	/**
	 * Check if a file is a source file (not a test file)
	 */
	private isSourceFile(fileName: string, framework: TestFramework): boolean {
		// Skip if already a test file
		if (fileName.includes('.test.') || fileName.includes('.spec.') || fileName.startsWith('test_') || fileName.includes('_test.') || fileName.match(/Test\.java$/) || fileName.match(/Tests\.java$/)) {
			return false;
		}

		// Check by framework
		switch (framework) {
			case TestFramework.Jest:
			case TestFramework.Vitest:
			case TestFramework.Mocha:
				return fileName.endsWith('.ts') || fileName.endsWith('.tsx') || fileName.endsWith('.js') || fileName.endsWith('.jsx');

			case TestFramework.Pytest:
				return fileName.endsWith('.py') && !fileName.startsWith('__');

			case TestFramework.JUnit:
				return fileName.endsWith('.java');

			case TestFramework.Go:
				return fileName.endsWith('.go');

			case TestFramework.Cargo:
				return fileName.endsWith('.rs');

			default:
				return false;
		}
	}

	/**
	 * Generate test file for a source file
	 */
	private async generateTestForFile(
		sourceUri: URI,
		framework: TestFramework
	): Promise<URI | undefined> {
		// Read source file
		const sourceContent = await this._fileService.readFile(sourceUri);
		const sourceCode = sourceContent.value.toString();

		// Generate test file path
		const testUri = this.getTestFilePath(sourceUri, framework);

		// Check if test file already exists
		try {
			await this._fileService.resolve(testUri);
			console.log(`[Test Generator] Test file already exists: ${testUri.fsPath}`);
			return undefined; // Skip if already exists
		} catch {
			// File doesn't exist, continue
		}

		// Generate test content
		const testContent = await this.generateTestContent(sourceUri, sourceCode, framework);

		// Write test file
		await this._fileService.writeFile(testUri, VSBuffer.fromString(testContent));

		console.log(`[Test Generator] Generated test file: ${testUri.fsPath}`);
		return testUri;
	}

	/**
	 * Get test file path for a source file
	 */
	private getTestFilePath(sourceUri: URI, framework: TestFramework): URI {
		const sourceFile = sourceUri.fsPath;
		const dirPath = sourceUri.path.substring(0, sourceUri.path.lastIndexOf('/'));
		const fileName = sourceUri.path.substring(sourceUri.path.lastIndexOf('/') + 1);

		switch (framework) {
			case TestFramework.Jest:
			case TestFramework.Vitest:
			case TestFramework.Mocha:
				// For JS/TS: file.ts -> file.test.ts
				const ext = fileName.match(/\.(ts|tsx|js|jsx)$/)?.[1] || 'ts';
				return URI.file(`${sourceFile.replace(/\.(ts|tsx|js|jsx)$/, '')}.test.${ext}`);

			case TestFramework.Pytest:
				// For Python: module.py -> test_module.py
				return URI.parse(`${dirPath}/test_${fileName}`);

			case TestFramework.JUnit:
				// For Java: src/main/java/com/example/Class.java -> src/test/java/com/example/ClassTest.java
				// Try to detect Maven/Gradle structure and use src/test/java if found
				if (sourceFile.includes('/src/main/java/')) {
					// Maven/Gradle structure: replace src/main/java with src/test/java
					const testFile = sourceFile.replace('/src/main/java/', '/src/test/java/').replace('.java', 'Test.java');
					return URI.file(testFile);
				} else {
					// Fallback: same directory with Test suffix
					return URI.file(sourceFile.replace('.java', 'Test.java'));
				}

			case TestFramework.Go:
				// For Go: file.go -> file_test.go
				return URI.file(sourceFile.replace('.go', '_test.go'));

			case TestFramework.Cargo:
				// For Rust: keep in same directory
				return URI.file(sourceFile.replace('.rs', '_test.rs'));

			default:
				return URI.file(`${sourceFile}.test`);
		}
	}

	/**
	 * Generate test content based on source code analysis with AI
	 */
	private async generateTestContent(
		sourceUri: URI,
		sourceCode: string,
		framework: TestFramework
	): Promise<string> {
		// Extract functions/classes/methods from source code
		const entities = this.extractTestableEntities(sourceCode, framework);
		const fileName = sourceUri.path.substring(sourceUri.path.lastIndexOf('/') + 1);
		const moduleName = fileName.replace(/\.(ts|tsx|js|jsx|py|java|go|rs)$/, '');

		// Try AI generation first, fallback to template if fails
		try {
			return await this.generateTestContentWithAI(sourceCode, moduleName, fileName, entities, framework);
		} catch (error) {
			console.warn('[Test Generator] AI generation failed, using template:', error);
			return this.generateTestContentTemplate(moduleName, fileName, entities, framework);
		}
	}

	/**
	 * Generate test content using AI
	 */
	private async generateTestContentWithAI(
		sourceCode: string,
		moduleName: string,
		fileName: string,
		entities: TestableEntity[],
		framework: TestFramework
	): Promise<string> {
		const languageId = this.getLanguageIdForFramework(framework);
		const frameworkName = this.getFrameworkName(framework);

		// Build comprehensive prompt for AI
		const prompt = this.buildAITestPrompt(sourceCode, moduleName, entities, frameworkName, languageId);

		// Call AI service with higher token limit for complete test generation
		// Default is 800 tokens which is too small for complete test files
		// Increased to 3000 tokens to ensure complete test class generation
		const result = await this._aiService.complete(prompt, {
			maxTokens: 3000,
			temperature: 0.3
		});

		// Extract and clean the generated code
		return this.extractAndCleanTestCode(result, languageId);
	}

	/**
	 * Build prompt for AI test generation
	 */
	private buildAITestPrompt(
		sourceCode: string,
		moduleName: string,
		entities: TestableEntity[],
		framework: string,
		language: string
	): string {
		const entityList = entities.map(e => `${e.type}: ${e.name}`).join('\n');

		// Framework-specific requirements
		let frameworkSpecificRequirements = '';
		if (framework === 'JUnit 5') {
			frameworkSpecificRequirements = `\n9. 【JUnit 5特殊要求】
   - 每个测试方法必须使用@Test注解
   - 测试方法必须是public void类型
   - 使用标准的JUnit 5断言：assertEquals, assertNotNull, assertTrue等
   - 测试类命名：${moduleName}Test
   - 测试方法命名：test + 方法名（首字母大写）`;
		} else if (framework === 'Jest' || framework === 'Vitest' || framework === 'Mocha') {
			frameworkSpecificRequirements = `\n9. 【${framework}特殊要求】
   - 使用describe()创建测试套件
   - 使用it()或test()创建测试用例
   - 使用expect()进行断言`;
		} else if (framework === 'Pytest') {
			frameworkSpecificRequirements = `\n9. 【Pytest特殊要求】
   - 测试函数必须以test_开头
   - 使用assert语句进行断言
   - 测试类必须以Test开头`;
		}

		return `你是一个专业的单元测试专家。请为以下${language}代码生成完整的${framework}测试文件。

源代码：
\`\`\`${language}
${sourceCode}
\`\`\`

需要测试的模块：${moduleName}

需要测试的实体（函数/类/方法）：
${entityList}

要求：
1. 为每个实体生成完整的测试用例
2. 包含以下测试场景：
   - 正常功能测试
   - 边界条件测试
   - 异常情况测试（如果适用）
3. 使用${framework}的标准断言和语法
4. 测试命名要清晰，反映测试意图
5. 生成完整的测试文件，包含：
   - 必要的import/导入语句
   - 完整的测试套件结构
   - 实际的测试实现（不要只写TODO）
6. 【重要】返回完整可运行的测试代码
7. 【重要】不要返回解释性文字，只返回代码
8. 【重要】代码应该直接可以运行${frameworkSpecificRequirements}

请生成完整的${framework}测试文件：`;
	}

	/**
	 * Extract and clean test code from AI response
	 */
	private extractAndCleanTestCode(aiResponse: string, languageId: string): string {
		let code = aiResponse.trim();

		// Remove markdown code block markers
		const codeBlockRegex = /```(?:\w+)?\s*\n?([\s\S]*?)\n?```/g;
		const codeBlockMatch = codeBlockRegex.exec(code);
		if (codeBlockMatch) {
			code = codeBlockMatch[1].trim();
		}

		// Remove any leading/trailing explanation text
		const lines = code.split('\n');
		const codeStartIndex = lines.findIndex(line =>
			line.trim().startsWith('import') ||
			line.trim().startsWith('from') ||
			line.trim().startsWith('package') ||
			line.trim().startsWith('describe(') ||
			line.trim().startsWith('class ') ||
			line.trim().startsWith('def test_') ||
			line.trim().startsWith('@Test') ||
			line.trim().startsWith('func Test')
		);

		if (codeStartIndex > 0) {
			code = lines.slice(codeStartIndex).join('\n');
		}

		return code.trim();
	}

	/**
	 * Get framework display name
	 */
	private getFrameworkName(framework: TestFramework): string {
		const names: Record<TestFramework, string> = {
			[TestFramework.Jest]: 'Jest',
			[TestFramework.Vitest]: 'Vitest',
			[TestFramework.Mocha]: 'Mocha',
			[TestFramework.Pytest]: 'Pytest',
			[TestFramework.JUnit]: 'JUnit 5',
			[TestFramework.Go]: 'Go Testing',
			[TestFramework.Cargo]: 'Rust Cargo',
			[TestFramework.Unknown]: 'Unknown'
		};
		return names[framework] || 'Unknown';
	}

	/**
	 * Get language ID for framework
	 */
	private getLanguageIdForFramework(framework: TestFramework): string {
		switch (framework) {
			case TestFramework.Jest:
			case TestFramework.Vitest:
			case TestFramework.Mocha:
				return 'typescript';
			case TestFramework.Pytest:
				return 'python';
			case TestFramework.JUnit:
				return 'java';
			case TestFramework.Go:
				return 'go';
			case TestFramework.Cargo:
				return 'rust';
			default:
				return 'text';
		}
	}

	/**
	 * Generate test content using template (fallback)
	 */
	private generateTestContentTemplate(
		moduleName: string,
		fileName: string,
		entities: TestableEntity[],
		framework: TestFramework
	): string {
		// Use original template generation as fallback
		switch (framework) {
			case TestFramework.Jest:
			case TestFramework.Vitest:
				return this.generateJestTestContent(moduleName, fileName, entities);

			case TestFramework.Mocha:
				return this.generateMochaTestContent(moduleName, fileName, entities);

			case TestFramework.Pytest:
				return this.generatePytestTestContent(moduleName, fileName, entities);

			case TestFramework.JUnit:
				return this.generateJUnitTestContent(moduleName, entities);

			case TestFramework.Go:
				return this.generateGoTestContent(moduleName, entities);

			case TestFramework.Cargo:
				return this.generateCargoTestContent(moduleName, entities);

			default:
				return `// Tests for ${fileName}\n`;
		}
	}

	/**
	 * Extract testable entities (functions, classes, methods) from source code
	 */
	private extractTestableEntities(sourceCode: string, framework: TestFramework): TestableEntity[] {
		const entities: TestableEntity[] = [];
		let match: RegExpExecArray | null;

		switch (framework) {
			case TestFramework.Jest:
			case TestFramework.Vitest:
			case TestFramework.Mocha:
				// Extract exported functions and classes
				const functionRegex = /export\s+(async\s+)?function\s+(\w+)/g;
				const classRegex = /export\s+class\s+(\w+)/g;
				const arrowFunctionRegex = /export\s+const\s+(\w+)\s*=\s*(?:async\s*)?\(/g;

				while ((match = functionRegex.exec(sourceCode)) !== null) {
					entities.push({ type: 'function', name: match[2] });
				}
				while ((match = classRegex.exec(sourceCode)) !== null) {
					entities.push({ type: 'class', name: match[1] });
				}
				while ((match = arrowFunctionRegex.exec(sourceCode)) !== null) {
					entities.push({ type: 'function', name: match[1] });
				}
				break;

			case TestFramework.Pytest:
				// Extract functions and classes
				const pyFunctionRegex = /def\s+(\w+)\s*\(/g;
				const pyClassRegex = /class\s+(\w+)/g;

				while ((match = pyFunctionRegex.exec(sourceCode)) !== null) {
					if (!match[1].startsWith('_')) {
						entities.push({ type: 'function', name: match[1] });
					}
				}
				while ((match = pyClassRegex.exec(sourceCode)) !== null) {
					entities.push({ type: 'class', name: match[1] });
				}
				break;

			case TestFramework.JUnit:
				// Extract public methods
				const javaMethodRegex = /public\s+\w+\s+(\w+)\s*\(/g;
				const javaClassNameRegex = /public\s+class\s+(\w+)/;

				const classMatch = javaClassNameRegex.exec(sourceCode);
				if (classMatch) {
					entities.push({ type: 'class', name: classMatch[1] });
				}

				while ((match = javaMethodRegex.exec(sourceCode)) !== null) {
					entities.push({ type: 'method', name: match[1] });
				}
				break;

			case TestFramework.Go:
				// Extract exported functions
				const goFunctionRegex = /func\s+([A-Z]\w*)\s*\(/g;

				while ((match = goFunctionRegex.exec(sourceCode)) !== null) {
					entities.push({ type: 'function', name: match[1] });
				}
				break;

			case TestFramework.Cargo:
				// Extract public functions
				const rustFunctionRegex = /pub\s+fn\s+(\w+)/g;

				while ((match = rustFunctionRegex.exec(sourceCode)) !== null) {
					entities.push({ type: 'function', name: match[1] });
				}
				break;
		}

		return entities;
	}

	/**
	 * Generate Jest/Vitest test content
	 */
	private generateJestTestContent(moduleName: string, fileName: string, entities: TestableEntity[]): string {
		let content = `import { describe, it, expect } from '@jest/globals';\n`;
		content += `import { ${entities.map(e => e.name).join(', ')} } from './${fileName.replace(/\.test\.(ts|tsx|js|jsx)$/, '')}';\n\n`;

		content += `describe('${moduleName}', () => {\n`;

		for (const entity of entities) {
			if (entity.type === 'function') {
				content += `\tdescribe('${entity.name}', () => {\n`;
				content += `\t\tit('should work correctly', () => {\n`;
				content += `\t\t\t// TODO: Add test implementation\n`;
				content += `\t\t\texpect(${entity.name}).toBeDefined();\n`;
				content += `\t\t});\n`;
				content += `\t});\n\n`;
			} else if (entity.type === 'class') {
				content += `\tdescribe('${entity.name}', () => {\n`;
				content += `\t\tit('should instantiate correctly', () => {\n`;
				content += `\t\t\t// TODO: Add test implementation\n`;
				content += `\t\t\tconst instance = new ${entity.name}();\n`;
				content += `\t\t\texpect(instance).toBeInstanceOf(${entity.name});\n`;
				content += `\t\t});\n`;
				content += `\t});\n\n`;
			}
		}

		content += `});\n`;
		return content;
	}

	/**
	 * Generate Mocha test content
	 */
	private generateMochaTestContent(moduleName: string, fileName: string, entities: TestableEntity[]): string {
		let content = `import { describe, it } from 'mocha';\n`;
		content += `import { expect } from 'chai';\n`;
		content += `import { ${entities.map(e => e.name).join(', ')} } from './${fileName.replace(/\.test\.(ts|tsx|js|jsx)$/, '')}';\n\n`;

		content += `describe('${moduleName}', () => {\n`;

		for (const entity of entities) {
			if (entity.type === 'function') {
				content += `\tdescribe('${entity.name}', () => {\n`;
				content += `\t\tit('should work correctly', () => {\n`;
				content += `\t\t\t// TODO: Add test implementation\n`;
				content += `\t\t\texpect(${entity.name}).to.exist;\n`;
				content += `\t\t});\n`;
				content += `\t});\n\n`;
			}
		}

		content += `});\n`;
		return content;
	}

	/**
	 * Generate Pytest test content
	 */
	private generatePytestTestContent(moduleName: string, fileName: string, entities: TestableEntity[]): string {
		let content = `import pytest\n`;
		content += `from ${moduleName} import ${entities.map(e => e.name).join(', ')}\n\n`;

		for (const entity of entities) {
			if (entity.type === 'function') {
				content += `def test_${entity.name}():\n`;
				content += `\t"""Test ${entity.name} function"""\n`;
				content += `\t# TODO: Add test implementation\n`;
				content += `\tassert ${entity.name} is not None\n\n`;
			} else if (entity.type === 'class') {
				content += `class Test${entity.name}:\n`;
				content += `\t"""Test ${entity.name} class"""\n\n`;
				content += `\tdef test_instantiation(self):\n`;
				content += `\t\t"""Test class instantiation"""\n`;
				content += `\t\t# TODO: Add test implementation\n`;
				content += `\t\tinstance = ${entity.name}()\n`;
				content += `\t\tassert instance is not None\n\n`;
			}
		}

		return content;
	}

	/**
	 * Generate JUnit test content
	 */
	private generateJUnitTestContent(moduleName: string, entities: TestableEntity[]): string {
		let content = `import org.junit.jupiter.api.Test;\n`;
		content += `import static org.junit.jupiter.api.Assertions.*;\n\n`;

		const className = entities.find(e => e.type === 'class')?.name || moduleName;
		content += `class ${className}Test {\n\n`;

		for (const entity of entities) {
			if (entity.type === 'method') {
				content += `\t@Test\n`;
				content += `\tvoid test${entity.name.charAt(0).toUpperCase() + entity.name.slice(1)}() {\n`;
				content += `\t\t// TODO: Add test implementation\n`;
				content += `\t\t${className} instance = new ${className}();\n`;
				content += `\t\tassertNotNull(instance);\n`;
				content += `\t}\n\n`;
			}
		}

		content += `}\n`;
		return content;
	}

	/**
	 * Generate Go test content
	 */
	private generateGoTestContent(moduleName: string, entities: TestableEntity[]): string {
		let content = `package ${moduleName}\n\n`;
		content += `import "testing"\n\n`;

		for (const entity of entities) {
			if (entity.type === 'function') {
				content += `func Test${entity.name}(t *testing.T) {\n`;
				content += `\t// TODO: Add test implementation\n`;
				content += `\tif ${entity.name} == nil {\n`;
				content += `\t\tt.Error("${entity.name} should not be nil")\n`;
				content += `\t}\n`;
				content += `}\n\n`;
			}
		}

		return content;
	}

	/**
	 * Generate Cargo (Rust) test content
	 */
	private generateCargoTestContent(moduleName: string, entities: TestableEntity[]): string {
		let content = `#[cfg(test)]\n`;
		content += `mod tests {\n`;
		content += `\tuse super::*;\n\n`;

		for (const entity of entities) {
			if (entity.type === 'function') {
				content += `\t#[test]\n`;
				content += `\tfn test_${entity.name}() {\n`;
				content += `\t\t// TODO: Add test implementation\n`;
				content += `\t\t// assert!(condition);\n`;
				content += `\t}\n\n`;
			}
		}

		content += `}\n`;
		return content;
	}
}

/**
 * Testable entity (function, class, method)
 */
interface TestableEntity {
	readonly type: 'function' | 'class' | 'method';
	readonly name: string;
}

/**
 * Generate tests result
 */
export interface GenerateTestsResult {
	readonly generatedFiles: URI[];
	readonly errors: string[];
	readonly framework: TestFramework;
}
