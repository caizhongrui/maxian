/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ITextModel } from '../../../../editor/common/model.js';
import { SecurityIssue, IssueSeverity, IssueCategory } from './analysisTypes.js';

/**
 * Security vulnerability scanner
 * Detects:
 * - SQL injection vulnerabilities
 * - XSS (Cross-Site Scripting) vulnerabilities
 * - CSRF (Cross-Site Request Forgery) vulnerabilities
 * - Sensitive data exposure (hardcoded passwords, API keys)
 */
export class SecurityAnalyzer {

	/**
	 * Analyze security vulnerabilities for a given model
	 */
	async analyze(model: ITextModel, filePath: string): Promise<SecurityIssue[]> {
		const issues: SecurityIssue[] = [];
		const content = model.getValue();
		const languageId = model.getLanguageId();

		// Run all security checks
		issues.push(...this.checkSQLInjection(content, model, filePath, languageId));
		issues.push(...this.checkXSS(content, model, filePath, languageId));
		issues.push(...this.checkCSRF(content, model, filePath, languageId));
		issues.push(...this.checkSensitiveData(content, model, filePath));

		console.log(`[Security Analyzer] Found ${issues.length} security issues in ${filePath}`);
		return issues;
	}

	/**
	 * Check for SQL injection vulnerabilities
	 */
	private checkSQLInjection(
		content: string,
		model: ITextModel,
		filePath: string,
		languageId: string
	): SecurityIssue[] {
		const issues: SecurityIssue[] = [];
		const lines = content.split('\n');

		// Patterns that indicate potential SQL injection
		const sqlPatterns = [
			// String concatenation in SQL queries
			{
				pattern: /(SELECT|INSERT|UPDATE|DELETE|FROM|WHERE).*\+\s*[a-zA-Z_][a-zA-Z0-9_]*/gi,
				message: 'Potential SQL injection: avoid string concatenation in SQL queries',
				cwe: 'CWE-89'
			},
			// Template strings with user input
			{
				pattern: /(SELECT|INSERT|UPDATE|DELETE|FROM|WHERE).*\$\{[^}]+\}/gi,
				message: 'Potential SQL injection: avoid template literals with user input in SQL',
				cwe: 'CWE-89'
			},
			// Direct variable interpolation
			{
				pattern: /execute\s*\(\s*['"](SELECT|INSERT|UPDATE|DELETE).*['"]\s*\+/gi,
				message: 'Potential SQL injection: use parameterized queries instead',
				cwe: 'CWE-89'
			}
		];

		lines.forEach((line, lineIndex) => {
			for (const { pattern, message, cwe } of sqlPatterns) {
				const matches = line.matchAll(new RegExp(pattern.source, pattern.flags));
				for (const match of matches) {
					issues.push({
						category: IssueCategory.Security,
						type: 'sql-injection',
						severity: IssueSeverity.Error,
						message,
						filePath,
						cwe,
						range: {
							startLineNumber: lineIndex + 1,
							startColumn: match.index! + 1,
							endLineNumber: lineIndex + 1,
							endColumn: match.index! + match[0].length + 1
						},
						suggestion: 'Use parameterized queries or prepared statements'
					});
				}
			}
		});

		return issues;
	}

	/**
	 * Check for XSS (Cross-Site Scripting) vulnerabilities
	 */
	private checkXSS(
		content: string,
		model: ITextModel,
		filePath: string,
		languageId: string
	): SecurityIssue[] {
		const issues: SecurityIssue[] = [];
		const lines = content.split('\n');

		// Only check web-related languages
		if (!['javascript', 'typescript', 'html', 'vue', 'react'].includes(languageId)) {
			return issues;
		}

		// Patterns that indicate potential XSS
		const xssPatterns = [
			// innerHTML with user input
			{
				pattern: /\.innerHTML\s*=\s*[^'"]/gi,
				message: 'Potential XSS: avoid setting innerHTML with user input',
				cwe: 'CWE-79'
			},
			// document.write with variables
			{
				pattern: /document\.write\s*\(\s*[^'"]/gi,
				message: 'Potential XSS: avoid using document.write with dynamic content',
				cwe: 'CWE-79'
			},
			// eval with user input
			{
				pattern: /eval\s*\(\s*[^'"]/gi,
				message: 'Potential XSS: avoid using eval() with user input',
				cwe: 'CWE-95'
			},
			// dangerouslySetInnerHTML in React
			{
				pattern: /dangerouslySetInnerHTML\s*=\s*\{\{/gi,
				message: 'Potential XSS: be cautious with dangerouslySetInnerHTML',
				cwe: 'CWE-79'
			}
		];

		lines.forEach((line, lineIndex) => {
			for (const { pattern, message, cwe } of xssPatterns) {
				const matches = line.matchAll(new RegExp(pattern.source, pattern.flags));
				for (const match of matches) {
					issues.push({
						category: IssueCategory.Security,
						type: 'xss',
						severity: IssueSeverity.Error,
						message,
						filePath,
						cwe,
						range: {
							startLineNumber: lineIndex + 1,
							startColumn: match.index! + 1,
							endLineNumber: lineIndex + 1,
							endColumn: match.index! + match[0].length + 1
						},
						suggestion: 'Use safe DOM manipulation methods or sanitize user input'
					});
				}
			}
		});

		return issues;
	}

	/**
	 * Check for CSRF (Cross-Site Request Forgery) vulnerabilities
	 */
	private checkCSRF(
		content: string,
		model: ITextModel,
		filePath: string,
		languageId: string
	): SecurityIssue[] {
		const issues: SecurityIssue[] = [];
		const lines = content.split('\n');

		// Only check backend languages
		if (!['javascript', 'typescript', 'java', 'python', 'go'].includes(languageId)) {
			return issues;
		}

		// Check for POST/PUT/DELETE endpoints without CSRF protection
		const csrfPatterns = [
			// Express.js routes without csrf middleware
			{
				pattern: /app\.(post|put|delete)\s*\([^)]*\)\s*,\s*(?!.*csrf).*function/gi,
				message: 'Potential CSRF: state-changing endpoint without CSRF protection',
				cwe: 'CWE-352'
			},
			// Spring @PostMapping without CSRF
			{
				pattern: /@(PostMapping|PutMapping|DeleteMapping).*\n\s*(?!.*@CsrfToken)/gi,
				message: 'Potential CSRF: state-changing endpoint may need CSRF token',
				cwe: 'CWE-352'
			}
		];

		lines.forEach((line, lineIndex) => {
			for (const { pattern, message, cwe } of csrfPatterns) {
				const matches = line.matchAll(new RegExp(pattern.source, pattern.flags));
				for (const match of matches) {
					issues.push({
						category: IssueCategory.Security,
						type: 'csrf',
						severity: IssueSeverity.Warning,
						message,
						filePath,
						cwe,
						range: {
							startLineNumber: lineIndex + 1,
							startColumn: match.index! + 1,
							endLineNumber: lineIndex + 1,
							endColumn: match.index! + match[0].length + 1
						},
						suggestion: 'Add CSRF token validation for state-changing operations'
					});
				}
			}
		});

		return issues;
	}

	/**
	 * Check for sensitive data exposure
	 */
	private checkSensitiveData(
		content: string,
		model: ITextModel,
		filePath: string
	): SecurityIssue[] {
		const issues: SecurityIssue[] = [];
		const lines = content.split('\n');

		// Patterns for sensitive data
		const sensitivePatterns = [
			// Hardcoded passwords
			{
				pattern: /(password|passwd|pwd)\s*=\s*['"'][^'"']{3,}['"']/gi,
				message: 'Hardcoded password detected',
				cwe: 'CWE-798',
				severity: IssueSeverity.Error
			},
			// API keys
			{
				pattern: /(api[_-]?key|apikey|access[_-]?key)\s*=\s*['"'][a-zA-Z0-9]{16,}['"']/gi,
				message: 'Hardcoded API key detected',
				cwe: 'CWE-798',
				severity: IssueSeverity.Error
			},
			// AWS credentials
			{
				pattern: /(AKIA[0-9A-Z]{16})/g,
				message: 'AWS access key detected',
				cwe: 'CWE-798',
				severity: IssueSeverity.Error
			},
			// Private keys
			{
				pattern: /-----BEGIN (RSA |EC |DSA )?PRIVATE KEY-----/gi,
				message: 'Private key in source code',
				cwe: 'CWE-312',
				severity: IssueSeverity.Error
			},
			// JWT tokens (simplified check)
			{
				pattern: /['"']eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}['"']/g,
				message: 'Hardcoded JWT token detected',
				cwe: 'CWE-798',
				severity: IssueSeverity.Warning
			},
			// Database connection strings
			{
				pattern: /(mongodb|mysql|postgresql|redis):\/\/[^'"'\s]+:[^'"'\s]+@/gi,
				message: 'Database credentials in connection string',
				cwe: 'CWE-798',
				severity: IssueSeverity.Error
			}
		];

		lines.forEach((line, lineIndex) => {
			// Skip comments (simplified check)
			if (line.trim().startsWith('//') || line.trim().startsWith('/*') || line.trim().startsWith('*')) {
				return;
			}

			for (const { pattern, message, cwe, severity } of sensitivePatterns) {
				const matches = line.matchAll(new RegExp(pattern.source, pattern.flags));
				for (const match of matches) {
					issues.push({
						category: IssueCategory.Security,
						type: 'sensitive-data',
						severity,
						message,
						filePath,
						cwe,
						range: {
							startLineNumber: lineIndex + 1,
							startColumn: match.index! + 1,
							endLineNumber: lineIndex + 1,
							endColumn: match.index! + match[0].length + 1
						},
						suggestion: 'Use environment variables or secure secret management instead'
					});
				}
			}
		});

		return issues;
	}
}
