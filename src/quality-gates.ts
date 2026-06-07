/**
 * Quality Gates System
 * Validates code quality before proceeding to next stage
 */

export interface QualityGate {
    name: string;
    check: (input: string) => QualityCheckResult;
    severity: 'critical' | 'warning' | 'info';
}

export interface QualityCheckResult {
    passed: boolean;
    score: number; // 0-10
    issues: QualityIssue[];
    recommendations: string[];
}

export interface QualityIssue {
    type: string;
    description: string;
    severity: 'high' | 'medium' | 'low';
    line?: number;
    fix?: string;
}

export class QualityGates {
    
    /**
     * Check if analysis stage output is sufficient
     */
    static checkAnalysisQuality(analysisOutput: string): QualityCheckResult {
        const issues: QualityIssue[] = [];
        let score = 10;

        // Check if files were found
        if (!analysisOutput.includes('@workspace') && !analysisOutput.toLowerCase().includes('search')) {
            issues.push({
                type: 'missing-workspace-search',
                description: 'AI did not search @workspace for relevant files',
                severity: 'high',
                fix: 'Prompt AI to search @workspace before analyzing'
            });
            score -= 3;
        }

        // Check if relevance was assessed
        if (!analysisOutput.toLowerCase().includes('relevant') && 
            !analysisOutput.toLowerCase().includes('related')) {
            issues.push({
                type: 'missing-relevance',
                description: 'AI did not assess work item relevance',
                severity: 'high',
                fix: 'Ask AI to explicitly state if work item is relevant'
            });
            score -= 3;
        }

        // Check if files were listed
        if (!analysisOutput.includes('.ts') && !analysisOutput.includes('component') && 
            !analysisOutput.includes('service')) {
            issues.push({
                type: 'missing-files',
                description: 'AI did not identify specific files',
                severity: 'medium',
                fix: 'Ask AI to list specific files to modify/create'
            });
            score -= 2;
        }

        // Check if AI asked for confirmation
        if (!analysisOutput.includes('?') && 
            !analysisOutput.toLowerCase().includes('confirm') &&
            !analysisOutput.toLowerCase().includes('proceed')) {
            issues.push({
                type: 'missing-confirmation',
                description: 'AI did not ask for confirmation to proceed',
                severity: 'low',
                fix: 'Remind AI to ask for user confirmation'
            });
            score -= 1;
        }

        const recommendations: string[] = [];
        if (issues.length > 0) {
            recommendations.push('Review AI analysis and provide missing information');
            recommendations.push('Ensure AI searched @workspace comprehensively');
        }

        return {
            passed: score >= 7,
            score: Math.max(0, score),
            issues,
            recommendations
        };
    }

    /**
     * Check if planning stage output is detailed enough
     */
    static checkPlanningQuality(planOutput: string): QualityCheckResult {
        const issues: QualityIssue[] = [];
        let score = 10;

        // Check for file list
        if (!planOutput.toLowerCase().includes('files to') && 
            !planOutput.toLowerCase().includes('file:')) {
            issues.push({
                type: 'missing-file-list',
                description: 'Plan does not include specific files',
                severity: 'high',
                fix: 'Ask AI to list exact files to modify/create'
            });
            score -= 3;
        }

        // Check for implementation steps
        if (!planOutput.toLowerCase().includes('step') && 
            !planOutput.toLowerCase().includes('phase')) {
            issues.push({
                type: 'missing-steps',
                description: 'Plan lacks implementation steps',
                severity: 'high',
                fix: 'Request detailed step-by-step implementation plan'
            });
            score -= 3;
        }

        // Check for tests
        if (!planOutput.toLowerCase().includes('test')) {
            issues.push({
                type: 'missing-tests',
                description: 'Plan does not mention tests',
                severity: 'medium',
                fix: 'Require test cases in the plan'
            });
            score -= 2;
        }

        // Check for interfaces/types
        if (!planOutput.toLowerCase().includes('interface') && 
            !planOutput.toLowerCase().includes('type') &&
            !planOutput.toLowerCase().includes('model')) {
            issues.push({
                type: 'missing-types',
                description: 'Plan does not define data structures',
                severity: 'low',
                fix: 'Ask AI to define interfaces and types needed'
            });
            score -= 1;
        }

        // Check for approval request
        if (!planOutput.toLowerCase().includes('approval') && 
            !planOutput.toLowerCase().includes('confirm')) {
            issues.push({
                type: 'missing-approval-request',
                description: 'Plan does not request approval',
                severity: 'low',
                fix: 'Remind AI to wait for user approval'
            });
            score -= 1;
        }

        const recommendations: string[] = [];
        if (issues.length > 0) {
            recommendations.push('Request more detailed planning');
            recommendations.push('Ensure all acceptance criteria are addressed');
        }

        return {
            passed: score >= 7,
            score: Math.max(0, score),
            issues,
            recommendations
        };
    }

    /**
     * Check if implementation output meets quality standards
     */
    static checkImplementationQuality(codeOutput: string): QualityCheckResult {
        const issues: QualityIssue[] = [];
        let score = 10;

        // Check for code blocks
        const codeBlocks = (codeOutput.match(/```typescript/g) || []).length;
        if (codeBlocks === 0) {
            issues.push({
                type: 'missing-code',
                description: 'No code blocks found in implementation',
                severity: 'high',
                fix: 'Request complete code in TypeScript code blocks'
            });
            score -= 4;
        }

        // Check for 'any' type usage
        if (codeOutput.includes(': any') || codeOutput.includes('<any>')) {
            issues.push({
                type: 'any-type-usage',
                description: 'Code uses "any" type (discouraged)',
                severity: 'medium',
                fix: 'Replace any types with proper TypeScript types'
            });
            score -= 2;
        }

        // Check for tests
        if (!codeOutput.includes('.spec.ts') && !codeOutput.includes('describe(')) {
            issues.push({
                type: 'missing-tests',
                description: 'No test files generated',
                severity: 'high',
                fix: 'Generate test files for all components/services'
            });
            score -= 3;
        }

        // Check for error handling
        if (!codeOutput.includes('try') && !codeOutput.includes('catch') &&
            !codeOutput.includes('catchError')) {
            issues.push({
                type: 'missing-error-handling',
                description: 'No error handling detected',
                severity: 'medium',
                fix: 'Add proper error handling to async operations'
            });
            score -= 2;
        }

        // Check for imports
        if (!codeOutput.includes('import {') && !codeOutput.includes('import *')) {
            issues.push({
                type: 'missing-imports',
                description: 'No import statements found',
                severity: 'medium',
                fix: 'Include all necessary imports'
            });
            score -= 1;
        }

        // Check for TypeScript typing
        const functionDeclarations = (codeOutput.match(/function\s+\w+\(/g) || []).length;
        const typedReturns = (codeOutput.match(/\):\s*\w+\s*{/g) || []).length;
        if (functionDeclarations > 0 && typedReturns < functionDeclarations * 0.5) {
            issues.push({
                type: 'insufficient-typing',
                description: 'Many functions lack return type annotations',
                severity: 'low',
                fix: 'Add return type annotations to all functions'
            });
            score -= 1;
        }

        const recommendations: string[] = [];
        if (score < 8) {
            recommendations.push('Review and fix code quality issues before testing');
        }
        if (issues.some(i => i.severity === 'high')) {
            recommendations.push('Address high-severity issues immediately');
        }
        recommendations.push('Run linter and fix all warnings');
        recommendations.push('Ensure all tests pass');

        return {
            passed: score >= 7,
            score: Math.max(0, score),
            issues,
            recommendations
        };
    }

    /**
     * Check verification stage output
     */
    static checkVerificationQuality(verificationOutput: string): QualityCheckResult {
        const issues: QualityIssue[] = [];
        let score = 10;

        // Check if checklist was used
        if (!verificationOutput.includes('✅') && !verificationOutput.includes('[ ]')) {
            issues.push({
                type: 'missing-checklist',
                description: 'Verification did not use checklist format',
                severity: 'medium',
                fix: 'Use checklist format for verification'
            });
            score -= 2;
        }

        // Check if score was provided
        if (!verificationOutput.toLowerCase().includes('score') && 
            !verificationOutput.includes('/10')) {
            issues.push({
                type: 'missing-score',
                description: 'No quality score provided',
                severity: 'low',
                fix: 'Provide numerical quality score'
            });
            score -= 1;
        }

        // Check if issues were identified
        if (!verificationOutput.toLowerCase().includes('issue') && 
            !verificationOutput.toLowerCase().includes('problem') &&
            !verificationOutput.toLowerCase().includes('fix')) {
            issues.push({
                type: 'superficial-review',
                description: 'Verification appears superficial (no issues found)',
                severity: 'medium',
                fix: 'Perform more thorough review'
            });
            score -= 2;
        }

        const recommendations: string[] = [];
        if (issues.length > 0) {
            recommendations.push('Ensure verification is thorough and systematic');
        }

        return {
            passed: score >= 7,
            score: Math.max(0, score),
            issues,
            recommendations
        };
    }

    /**
     * Overall quality gate for entire process
     */
    static checkOverallQuality(
        analysisResult: QualityCheckResult,
        planningResult: QualityCheckResult,
        implementationResult: QualityCheckResult,
        verificationResult: QualityCheckResult
    ): QualityCheckResult {
        const avgScore = (
            analysisResult.score +
            planningResult.score +
            implementationResult.score +
            verificationResult.score
        ) / 4;

        const allIssues = [
            ...analysisResult.issues,
            ...planningResult.issues,
            ...implementationResult.issues,
            ...verificationResult.issues
        ];

        const criticalIssues = allIssues.filter(i => i.severity === 'high');

        const recommendations: string[] = [];
        if (avgScore < 8) {
            recommendations.push('Overall quality below target (8/10)');
            recommendations.push('Review and address issues before finalizing');
        }
        if (criticalIssues.length > 0) {
            recommendations.push(`${criticalIssues.length} critical issues must be fixed`);
        }

        return {
            passed: avgScore >= 8 && criticalIssues.length === 0,
            score: avgScore,
            issues: allIssues,
            recommendations
        };
    }
}
