/**
 * Multi-Stage Code Generation Orchestrator
 * Coordinates the 4-stage process for high-quality code generation
 */

import * as vscode from 'vscode';
import { TokenManager, PromptSection } from './token-manager';
import { ContextAnalyzer, ContextSummary } from './context-analyzer';
import { PromptTemplates, WorkItemData } from './prompt-templates';
import { QualityGates, QualityCheckResult } from './quality-gates';
import { outputChannel } from './extension';

export type Stage = 'analysis' | 'planning' | 'implementation' | 'verification';

export interface StageResult {
    stage: Stage;
    prompt: string;
    response?: string;
    qualityCheck?: QualityCheckResult;
    userApproved?: boolean;
    tokenUsage: number;
}

export class CodeGenerationOrchestrator {
    private tokenManager: TokenManager;
    private contextAnalyzer: ContextAnalyzer;
    private stageResults: StageResult[] = [];
    private context?: ContextSummary;
    private statusBarItem: vscode.StatusBarItem;

    constructor(
        // Injected from extension.ts so all code paths share the same
        // chatPanelInitialized flag and cold-start delay logic.
        private readonly openCopilotChat: (prompt: string) => Promise<void>
    ) {
        this.tokenManager = new TokenManager();
        this.contextAnalyzer = new ContextAnalyzer();

        // Create status bar item for progress tracking
        this.statusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Left,
            100
        );
        this.statusBarItem.text = "$(rocket) ADO Copilot";
        this.statusBarItem.show();
    }

    /**
     * Start the multi-stage code generation process
     */
    async start(workItem: WorkItemData): Promise<void> {
        try {
            // Initialize
            console.log('🚀 Multi-Stage Generation Started');
            console.log(`📋 Work Item: #${workItem.id} - ${workItem.workItemType}`);
            this.statusBarItem.text = "$(sync~spin) Initializing...";
            vscode.window.showInformationMessage('🚀 Starting multi-stage code generation...');
            
            // Analyze workspace context
            console.log('🔍 Analyzing workspace context...');
            this.statusBarItem.text = "$(search) Analyzing workspace...";
            this.context = await this.analyzeWorkspaceContext(workItem);
            
            // Stage 1: Analysis
            const analysisApproved = await this.runAnalysisStage(workItem);
            if (!analysisApproved) {
                this.statusBarItem.text = "$(x) Cancelled at Analysis";
                vscode.window.showWarningMessage('❌ Process cancelled at analysis stage');
                setTimeout(() => this.statusBarItem.text = "$(rocket) ADO Copilot", 3000);
                return;
            }

            // Stage 2: Planning
            const planningApproved = await this.runPlanningStage(workItem);
            if (!planningApproved) {
                this.statusBarItem.text = "$(x) Cancelled at Planning";
                vscode.window.showWarningMessage('❌ Process cancelled at planning stage');
                setTimeout(() => this.statusBarItem.text = "$(rocket) ADO Copilot", 3000);
                return;
            }

            // Stage 3: Implementation
            const implementationApproved = await this.runImplementationStage(workItem);
            if (!implementationApproved) {
                this.statusBarItem.text = "$(x) Cancelled at Implementation";
                vscode.window.showWarningMessage('❌ Process cancelled at implementation stage');
                setTimeout(() => this.statusBarItem.text = "$(rocket) ADO Copilot", 3000);
                return;
            }

            // Stage 4: Verification
            await this.runVerificationStage(workItem);

            // Show completion
            await this.showCompletionSummary();

        } catch (error: any) {
            this.statusBarItem.text = "$(error) Error occurred";
            vscode.window.showErrorMessage(`❌ Error: ${error.message}`);
            console.error('Code generation error:', error);
            setTimeout(() => this.statusBarItem.text = "$(rocket) ADO Copilot", 3000);
        }
    }

    /**
     * Analyze workspace context
     */
    private async analyzeWorkspaceContext(workItem: WorkItemData): Promise<ContextSummary> {
        vscode.window.showInformationMessage('🔍 Analyzing workspace...');
        
        const context = await this.contextAnalyzer.analyzeWorkspace(workItem.description);
        
        // Show context preview
        const preview = `
📊 Workspace Analysis Complete

Project: ${context.projectType}
Tech Stack: ${context   .techStack.primary}${context.techStack.version ? ' ' + context.techStack.version : ''}${context.techStack.framework ? ' (' + context.techStack.framework + ')' : ''}
Folders: ${context.folderStructure.length}
Relevant Files: ${context.relevantFiles.length}
Dependencies: ${context.dependencies.length}
        `.trim();

        await vscode.window.showInformationMessage(preview);
        
        return context;
    }

    /**
     * Stage 1: Analysis
     */
    private async runAnalysisStage(workItem: WorkItemData): Promise<boolean> {
        if (!this.context) {
            throw new Error('Context not initialized');
        }

        this.statusBarItem.text = "$(search) Stage 1/4: Analysis";
        vscode.window.showInformationMessage('📋 Stage 1: Analysis - Check Chat for AI response →');
        outputChannel.appendLine('\n📋 STAGE 1: ANALYSIS');

        // Build prompt
        const sections = PromptTemplates.analysisStage(workItem, this.context);
        const prompt = this.buildPromptFromSections(sections, 'analysis');

        // Check token budget
        const budgetCheck = this.tokenManager.checkBudget('analysis', prompt);
        outputChannel.appendLine(`   Token Usage: ${budgetCheck.estimatedTokens}/${budgetCheck.budgetLimit} tokens`);
        if (!budgetCheck.withinBudget) {
            outputChannel.appendLine(`   ⚠️ WARNING: ${budgetCheck.suggestion}`);
            vscode.window.showWarningMessage(`⚠️ ${budgetCheck.suggestion}`);
        } else {
            outputChannel.appendLine(`   ✅ Within budget (${Math.round((budgetCheck.estimatedTokens/budgetCheck.budgetLimit)*100)}% used)`);
        }

        // Save stage result
        this.stageResults.push({
            stage: 'analysis',
            prompt,
            tokenUsage: budgetCheck.estimatedTokens
        });

        // Open Copilot with analysis prompt
        await this.openCopilotChat(prompt);

        // Wait a moment for AI to start responding
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Wait for user to review and confirm (non-blocking)
        const userResponse = await vscode.window.showInformationMessage(
            '📋 Stage 1: Analysis\n\nReview the AI\'s workspace analysis in Chat →\n\n✓ Check if @workspace was searched\n✓ Verify work item relevance\n✓ Review files to modify',
            'Continue to Planning',
            'Cancel'
        );

        if (userResponse !== 'Continue to Planning') {
            return false;
        }

        // Quality gate check (if user provides AI response)
        const aiResponse = await vscode.window.showInputBox({
            prompt: 'Optional: Paste AI\'s analysis response for quality check',
            placeHolder: 'Skip this to continue without quality check',
            ignoreFocusOut: true
        });

        if (aiResponse) {
            const qualityCheck = QualityGates.checkAnalysisQuality(aiResponse);
            this.stageResults[this.stageResults.length - 1].response = aiResponse;
            this.stageResults[this.stageResults.length - 1].qualityCheck = qualityCheck;

            if (!qualityCheck.passed) {
                const continueAnyway = await vscode.window.showWarningMessage(
                    `⚠️ Analysis Quality Score: ${qualityCheck.score}/10\n\nIssues found:\n${qualityCheck.issues.map(i => `- ${i.description}`).join('\n')}\n\nContinue anyway?`,
                    { modal: true },
                    'Continue',
                    'Cancel'
                );

                if (continueAnyway !== 'Continue') {
                    return false;
                }
            } else {
                vscode.window.showInformationMessage(`✅ Analysis Quality: ${qualityCheck.score}/10`);
            }
        }

        this.stageResults[this.stageResults.length - 1].userApproved = true;
        return true;
    }

    /**
     * Stage 2: Planning
     */
    private async runPlanningStage(workItem: WorkItemData): Promise<boolean> {
        if (!this.context) {
            throw new Error('Context not initialized');
        }

        this.statusBarItem.text = "$(list-tree) Stage 2/4: Planning";
        vscode.window.showInformationMessage('🎯 Stage 2: Planning - Check Chat for plan →');
        outputChannel.appendLine('\n🎯 STAGE 2: PLANNING');

        // Get analysis findings from previous stage
        const analysisFindings = this.stageResults.find(r => r.stage === 'analysis')?.response || 
            'Workspace analyzed. Proceeding with planning.';

        // Build prompt
        const sections = PromptTemplates.planningStage(workItem, this.context, analysisFindings);
        const prompt = this.buildPromptFromSections(sections, 'planning');

        // Check token budget
        const budgetCheck = this.tokenManager.checkBudget('planning', prompt);
        outputChannel.appendLine(`   Token Usage: ${budgetCheck.estimatedTokens}/${budgetCheck.budgetLimit} tokens`);
        if (!budgetCheck.withinBudget) {
            outputChannel.appendLine(`   ⚠️ WARNING: ${budgetCheck.suggestion}`);
            vscode.window.showWarningMessage(`⚠️ ${budgetCheck.suggestion}`);
        } else {
            outputChannel.appendLine(`   ✅ Within budget (${Math.round((budgetCheck.estimatedTokens/budgetCheck.budgetLimit)*100)}% used)`);
        }

        // Save stage result
        this.stageResults.push({
            stage: 'planning',
            prompt,
            tokenUsage: budgetCheck.estimatedTokens
        });

        // Open Copilot with planning prompt
        await this.openCopilotChat(prompt);

        // Wait a moment for AI to start responding
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Wait for user to review and approve plan (non-blocking)
        const userResponse = await vscode.window.showInformationMessage(
            '🎯 Stage 2: Planning\n\nReview the implementation plan in Chat →\n\n✓ Check files to modify/create\n✓ Verify interfaces and types\n✓ Review test cases',
            'Approve & Continue',
            'Cancel'
        );

        if (userResponse !== 'Approve & Continue') {
            return false;
        }

        // Quality check
        const aiResponse = await vscode.window.showInputBox({
            prompt: 'Optional: Paste AI\'s planning response for quality check',
            placeHolder: 'Skip this to continue without quality check',
            ignoreFocusOut: true
        });

        if (aiResponse) {
            const qualityCheck = QualityGates.checkPlanningQuality(aiResponse);
            this.stageResults[this.stageResults.length - 1].response = aiResponse;
            this.stageResults[this.stageResults.length - 1].qualityCheck = qualityCheck;

            if (!qualityCheck.passed) {
                const continueAnyway = await vscode.window.showWarningMessage(
                    `⚠️ Planning Quality Score: ${qualityCheck.score}/10\n\nIssues found:\n${qualityCheck.issues.map(i => `- ${i.description}`).join('\n')}\n\nContinue anyway?`,
                    'Continue',
                    'Cancel'
                );

                if (continueAnyway !== 'Continue') {
                    return false;
                }
            } else {
                vscode.window.showInformationMessage(`✅ Planning Quality: ${qualityCheck.score}/10`);
            }
        }

        this.stageResults[this.stageResults.length - 1].userApproved = true;
        return true;
    }

    /**
     * Stage 3: Implementation
     */
    private async runImplementationStage(workItem: WorkItemData): Promise<boolean> {
        if (!this.context) {
            throw new Error('Context not initialized');
        }

        this.statusBarItem.text = "$(code) Stage 3/4: Implementation";
        vscode.window.showInformationMessage('💻 Stage 3: Implementation - Check Chat for code →');
        outputChannel.appendLine('\n💻 STAGE 3: IMPLEMENTATION');

        // Get approved plan from previous stage
        const approvedPlan = this.stageResults.find(r => r.stage === 'planning')?.response || 
            'Plan approved. Proceeding with implementation.';

        // Build prompt
        const sections = PromptTemplates.implementationStage(workItem, this.context, approvedPlan, this.context.techStack);
        const prompt = this.buildPromptFromSections(sections, 'implementation');

        // Check token budget
        const budgetCheck = this.tokenManager.checkBudget('implementation', prompt);
        outputChannel.appendLine(`   Token Usage: ${budgetCheck.estimatedTokens}/${budgetCheck.budgetLimit} tokens`);
        if (!budgetCheck.withinBudget) {
            outputChannel.appendLine(`   ⚠️ WARNING: ${budgetCheck.suggestion}`);
            vscode.window.showWarningMessage(`⚠️ ${budgetCheck.suggestion}`);
        } else {
            outputChannel.appendLine(`   ✅ Within budget (${Math.round((budgetCheck.estimatedTokens/budgetCheck.budgetLimit)*100)}% used)`);
        }

        // Save stage result
        this.stageResults.push({
            stage: 'implementation',
            prompt,
            tokenUsage: budgetCheck.estimatedTokens
        });

        // Open Copilot with implementation prompt
        await this.openCopilotChat(prompt);

        // Wait a moment for AI to start responding
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Wait for user to review generated code (non-blocking)
        const userResponse = await vscode.window.showInformationMessage(
            '💻 Stage 3: Implementation\n\nReview the generated code in Chat →\n\n✓ Check code completeness\n✓ Verify tests are included\n✓ Review patterns used',
            'Continue to Verification',
            'Cancel'
        );

        if (userResponse !== 'Continue to Verification') {
            return false;
        }

        // Quality check
        const aiResponse = await vscode.window.showInputBox({
            prompt: 'Optional: Paste AI\'s implementation response for quality check',
            placeHolder: 'Skip this to continue without quality check',
            ignoreFocusOut: true,
            validateInput: (value) => {
                if (value && value.length > 50000) {
                    return 'Response too long. Quality check may be inaccurate.';
                }
                return null;
            }
        });

        if (aiResponse) {
            const qualityCheck = QualityGates.checkImplementationQuality(aiResponse);
            this.stageResults[this.stageResults.length - 1].response = aiResponse;
            this.stageResults[this.stageResults.length - 1].qualityCheck = qualityCheck;

            if (!qualityCheck.passed) {
                const continueAnyway = await vscode.window.showWarningMessage(
                    `⚠️ Implementation Quality Score: ${qualityCheck.score}/10\n\nIssues:\n${qualityCheck.issues.slice(0, 5).map(i => `- ${i.description}`).join('\n')}\n\nContinue anyway?`,
                    'Continue',
                    'Cancel'
                );

                if (continueAnyway !== 'Continue') {
                    return false;
                }
            } else {
                vscode.window.showInformationMessage(`✅ Implementation Quality: ${qualityCheck.score}/10`);
            }
        }

        this.stageResults[this.stageResults.length - 1].userApproved = true;
        return true;
    }

    /**
     * Stage 4: Verification
     */
    private async runVerificationStage(workItem: WorkItemData): Promise<void> {
        this.statusBarItem.text = "$(checklist) Stage 4/4: Verification";
        vscode.window.showInformationMessage('✅ Stage 4: Verification - Final quality check →');

        // Get generated code from previous stage
        const generatedCode = this.stageResults.find(r => r.stage === 'implementation')?.response || 
            'Code generated. Performing verification.';

        // Build prompt
        const sections = PromptTemplates.verificationStage(workItem, generatedCode);
        const prompt = this.buildPromptFromSections(sections, 'verification');

        // Check token budget
        const budgetCheck = this.tokenManager.checkBudget('verification', prompt);

        // Save stage result
        this.stageResults.push({
            stage: 'verification',
            prompt,
            tokenUsage: budgetCheck.estimatedTokens
        });

        // Open Copilot with verification prompt
        await this.openCopilotChat(prompt);

        await vscode.window.showInformationMessage(
            '✅ Stage 4: Verification\n\nAI is now verifying the code quality.\n\nReview the verification results and test the code.',
            'OK'
        );
    }

    /**
     * Build prompt from sections
     */
    private buildPromptFromSections(sections: PromptSection[], stage: Stage): string {
        const separator = '\n\n═══════════════════════════════════════════\n\n';
        return sections
            .sort((a, b) => a.priority - b.priority)
            .map(s => s.content)
            .join(separator);
    }

    /**
     * Show completion summary
     */
    private async showCompletionSummary(): Promise<void> {
        const stats = this.tokenManager.getUsageStats();
        const totalTokens = Object.values(stats.byStage).reduce((sum, val) => sum + val, 0);

        // Calculate quality scores
        const qualityScores = this.stageResults
            .filter(r => r.qualityCheck)
            .map(r => r.qualityCheck!.score);
        
        const avgQuality = qualityScores.length > 0 
            ? (qualityScores.reduce((sum, s) => sum + s, 0) / qualityScores.length).toFixed(1)
            : 'N/A';

        const summary = `
🎉 CODE GENERATION COMPLETE!

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 SUMMARY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ Stages Completed: ${this.stageResults.filter(r => r.userApproved).length}/3
📝 Total Token Usage: ~${totalTokens} tokens
⭐ Average Quality: ${avgQuality}/10

📋 Stage Breakdown:
${this.stageResults.map(r => 
    `  ${this.getStageIcon(r.stage)} ${r.stage}: ${r.tokenUsage} tokens ${r.qualityCheck ? `(${r.qualityCheck.score}/10)` : ''}`
).join('\n')}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 NEXT STEPS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. Review the generated code in Copilot chat
2. Apply the code to your workspace
3. Run: npm test (verify all tests pass)
4. Run: ng lint (fix any linting errors)
5. Test the functionality manually
6. Commit and create PR

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

⚠️  Remember: Always review AI-generated code before committing!
        `.trim();

        // Log to output channel
        outputChannel.appendLine('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        outputChannel.appendLine('🎉 CODE GENERATION COMPLETE');
        outputChannel.appendLine('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        outputChannel.appendLine(`   Stages Completed: ${this.stageResults.filter(r => r.userApproved).length}/3`);
        outputChannel.appendLine(`   Total Tokens: ~${totalTokens} tokens`);
        outputChannel.appendLine(`   Average Quality: ${avgQuality}/10`);
        outputChannel.appendLine('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

        this.statusBarItem.text = "$(check) Complete! Total: ~" + totalTokens + " tokens";

        const result = await vscode.window.showInformationMessage(
            summary,
            'View Stats',
            'Close'
        );

        if (result === 'View Stats') {
            this.showDetailedStats();
        }
        
        // Reset status bar after completion
        setTimeout(() => {
            this.statusBarItem.text = "$(rocket) ADO Copilot";
        }, 5000);
    }

    /**
     * Show detailed statistics
     */
    private showDetailedStats(): void {
        const stats = this.tokenManager.getUsageStats();
        
        const details = `
📊 Detailed Statistics

Token Usage by Stage:
${Object.entries(stats.byStage).map(([stage, tokens]) => 
    `  - ${stage}: ${tokens} tokens (avg: ${stats.averagePerStage[stage]})`
).join('\n')}

Quality Checks:
${this.stageResults.filter(r => r.qualityCheck).map(r => {
    const qc = r.qualityCheck!;
    return `  - ${r.stage}: ${qc.score}/10 (${qc.passed ? 'PASSED' : 'FAILED'})
    Issues: ${qc.issues.length}`;
}).join('\n')}

Total Process Time: ${this.stageResults.length} stages completed
        `.trim();

        vscode.window.showInformationMessage(details, { modal: false });
    }

    /**
     * Get icon for stage
     */
    private getStageIcon(stage: Stage): string {
        const icons = {
            analysis: '🔍',
            planning: '🎯',
            implementation: '💻',
            verification: '✅'
        };
        return icons[stage];
    }

    /**
     * Dispose of resources
     */
    dispose(): void {
        this.statusBarItem.dispose();
    }
}
