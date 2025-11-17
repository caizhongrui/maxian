/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { URI } from '../../../../base/common/uri.js';
import { ITreeSitterService } from '../common/treeSitter.js';
import { TreeSitterService } from '../browser/treeSitterService.js';
import { NullLogService } from '../../../../platform/log/common/log.js';
import { FileService } from '../../../../platform/files/common/fileService.js';
import { InMemoryFileSystemProvider } from '../../../../platform/files/common/inMemoryFilesystemProvider.js';
import { Schemas } from '../../../../base/common/network.js';
import { VSBuffer } from '../../../../base/common/buffer.js';

suite('TreeSitterService', () => {

	let service: ITreeSitterService;
	let fileService: FileService;

	setup(() => {
		// Create file service with in-memory provider
		fileService = new FileService(new NullLogService());
		const provider = new InMemoryFileSystemProvider();
		fileService.registerProvider(Schemas.file, provider);

		// Create tree-sitter service
		service = new TreeSitterService(fileService, new NullLogService());
	});

	test('should support Java files', () => {
		const uri = URI.file('/test/Example.java');
		assert.strictEqual(service.isSupported(uri), true);
	});

	test('should support TypeScript files', () => {
		const uri = URI.file('/test/example.ts');
		assert.strictEqual(service.isSupported(uri), true);
	});

	test('should support Python files', () => {
		const uri = URI.file('/test/example.py');
		assert.strictEqual(service.isSupported(uri), true);
	});

	test('should not support unsupported files', () => {
		const uri = URI.file('/test/example.txt');
		assert.strictEqual(service.isSupported(uri), false);
	});

	test('should return supported extensions', () => {
		const extensions = service.getSupportedExtensions();
		assert.ok(extensions.includes('.java'));
		assert.ok(extensions.includes('.ts'));
		assert.ok(extensions.includes('.py'));
		assert.ok(extensions.includes('.js'));
	});

	test('should parse Java class definition', async function () {
		this.timeout(5000); // Tree-sitter initialization may take time

		const javaCode = `
package com.example;

public class HelloWorld {
    public static void main(String[] args) {
        System.out.println("Hello, World!");
    }

    public void greet(String name) {
        System.out.println("Hello, " + name);
    }
}
`;

		const uri = URI.file('/test/HelloWorld.java');
		await fileService.writeFile(uri, VSBuffer.fromString(javaCode));

		const result = await service.parseFile(uri);

		assert.strictEqual(result.error, undefined, 'Should not have error');
		assert.ok(result.definitions.length > 0, 'Should find definitions');

		// Should find the class
		const classDef = result.definitions.find(d => d.type === 'class');
		assert.ok(classDef, 'Should find class definition');
		assert.ok(classDef!.name.includes('HelloWorld'), 'Class name should include HelloWorld');
	});

	test('should parse TypeScript interface', async function () {
		this.timeout(5000);

		const tsCode = `
interface Person {
    name: string;
    age: number;
}

class User implements Person {
    constructor(public name: string, public age: number) {}

    greet(): void {
        console.log(\`Hello, I'm \${this.name}\`);
    }
}
`;

		const uri = URI.file('/test/example.ts');
		await fileService.writeFile(uri, VSBuffer.fromString(tsCode));

		const result = await service.parseFile(uri);

		assert.strictEqual(result.error, undefined, 'Should not have error');
		assert.ok(result.definitions.length > 0, 'Should find definitions');

		// Should find interface
		const interfaceDef = result.definitions.find(d => d.type === 'interface');
		assert.ok(interfaceDef, 'Should find interface definition');

		// Should find class
		const classDef = result.definitions.find(d => d.type === 'class');
		assert.ok(classDef, 'Should find class definition');
	});

	test('should parse Python class and function', async function () {
		this.timeout(5000);

		const pyCode = `
class Calculator:
    def __init__(self):
        self.result = 0

    def add(self, x, y):
        return x + y

    def subtract(self, x, y):
        return x - y

def main():
    calc = Calculator()
    print(calc.add(5, 3))

if __name__ == "__main__":
    main()
`;

		const uri = URI.file('/test/calculator.py');
		await fileService.writeFile(uri, VSBuffer.fromString(pyCode));

		const result = await service.parseFile(uri);

		assert.strictEqual(result.error, undefined, 'Should not have error');
		assert.ok(result.definitions.length > 0, 'Should find definitions');

		// Should find class
		const classDef = result.definitions.find(d => d.type === 'class');
		assert.ok(classDef, 'Should find class definition');

		// Should find function
		const functionDef = result.definitions.find(d => d.type === 'function');
		assert.ok(functionDef, 'Should find function definition');
	});

	test('should handle unsupported file with error', async () => {
		const uri = URI.file('/test/example.txt');
		const result = await service.parseFile(uri);

		assert.ok(result.error, 'Should have error for unsupported file');
		assert.strictEqual(result.definitions.length, 0, 'Should have no definitions');
	});

	test('should handle non-existent file', async () => {
		const uri = URI.file('/test/nonexistent.java');
		const result = await service.parseFile(uri);

		assert.ok(result.error, 'Should have error for non-existent file');
		assert.strictEqual(result.definitions.length, 0, 'Should have no definitions');
	});

	test('should parse multiple files', async function () {
		this.timeout(5000);

		// Create test files
		const javaUri = URI.file('/test/Test.java');
		await fileService.writeFile(javaUri, VSBuffer.fromString('public class Test {}'));

		const tsUri = URI.file('/test/test.ts');
		await fileService.writeFile(tsUri, VSBuffer.fromString('class Test {}'));

		const results = await service.parseFiles([javaUri, tsUri]);

		assert.strictEqual(results.length, 2, 'Should return results for both files');
		assert.ok(results.every(r => r.definitions.length > 0 || r.error), 'Each result should have definitions or error');
	});
});
