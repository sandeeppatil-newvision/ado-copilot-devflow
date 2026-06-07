/**
 * Strategy Selection System
 * Determines optimal generation strategy based on work item complexity
 */

import { WorkItemData } from './prompt-templates';
import { ContextSummary } from './context-analyzer';

export type Strategy = 'RAPID' | 'BALANCED' | 'THOROUGH';

export interface StrategyRecommendation {
    strategy: Strategy;
    confidence: number; // 0-1
    reasoning: string[];
    estimatedTime: string;
    estimatedTokens: number;
}

interface ComplexityFactors {
    workItemType: string;
    descriptionLength: number;
    acceptanceCriteriaCount: number;
    testCasesCount: number;
    reproStepsPresent: boolean;
    relevantFilesCount: number;
    relevantFilesConfidence: number;
}

export class StrategySelector {
    
    /**
     * Select optimal strategy for work item
     */
    select(workItem: WorkItemData, context: ContextSummary): StrategyRecommendation {
        const factors = this.extractFactors(workItem, context);
        const score = this.calculateComplexityScore(factors);
        
        return this.mapScoreToStrategy(score, factors);
    }

    /**
     * Extract complexity factors from work item and context
     */
    private extractFactors(workItem: WorkItemData, context: ContextSummary): ComplexityFactors {
        // Count AC bullet points
        const acCount = (workItem.ac.match(/[-•*]\s/g) || []).length;
        
        // Average relevance of found files
        const avgRelevance = context.relevantFiles.length > 0
            ? context.relevantFiles.reduce((sum, f) => sum + f.relevanceScore, 0) / context.relevantFiles.length
            : 0;

        return {
            workItemType: workItem.workItemType,
            descriptionLength: workItem.description.length,
            acceptanceCriteriaCount: acCount,
            testCasesCount: workItem.testCases.length,
            reproStepsPresent: !!workItem.reproSteps,
            relevantFilesCount: context.relevantFiles.length,
            relevantFilesConfidence: avgRelevance
        };
    }

    /**
     * Calculate complexity score (0-10)
     */
    private calculateComplexityScore(factors: ComplexityFactors): number {
        let score = 0;

        // Work item type complexity
        const typeScores: Record<string, number> = {
            'Bug': 2,
            'Defect': 2,
            'Task': 3,
            'User Story': 5,
            'Feature': 6,
            'Epic': 9
        };
        score += typeScores[factors.workItemType] || 5;

        // Description length (indicates scope)
        if (factors.descriptionLength < 200) score += 0;
        else if (factors.descriptionLength < 500) score += 1;
        else if (factors.descriptionLength < 1000) score += 2;
        else score += 3;

        // Acceptance criteria count
        score += Math.min(factors.acceptanceCriteriaCount, 3);

        // Test cases
        score += Math.min(factors.testCasesCount * 0.5, 2);

        // Reproduction steps (bugs are often simpler)
        if (factors.reproStepsPresent) score -= 1;

        // Workspace confidence (high confidence = can go faster)
        if (factors.relevantFilesConfidence > 0.8) score -= 2;
        else if (factors.relevantFilesConfidence > 0.6) score -= 1;
        else if (factors.relevantFilesConfidence < 0.3) score += 2;

        // Relevant files count
        if (factors.relevantFilesCount === 0) score += 3; // New feature
        else if (factors.relevantFilesCount <= 2) score += 0; // Simple
        else if (factors.relevantFilesCount <= 5) score += 1; // Medium
        else score += 2; // Complex

        return Math.max(0, Math.min(10, score));
    }

    /**
     * Map complexity score to strategy
     */
    private mapScoreToStrategy(score: number, factors: ComplexityFactors): StrategyRecommendation {
        let strategy: Strategy;
        let reasoning: string[] = [];
        let estimatedTime: string;
        let estimatedTokens: number;

        if (score <= 3) {
            // RAPID: Simple tasks (60% of cases)
            strategy = 'RAPID';
            estimatedTime = '1-2 minutes';
            estimatedTokens = 2500;
            reasoning = [
                'Simple task detected',
                factors.relevantFilesCount <= 2 ? 'Few files to modify' : '',
                factors.relevantFilesConfidence > 0.7 ? 'High confidence in workspace match' : '',
                factors.workItemType === 'Bug' ? 'Bug fixes are typically focused' : ''
            ].filter(Boolean);

        } else if (score <= 6) {
            // BALANCED: Medium tasks (30% of cases)
            strategy = 'BALANCED';
            estimatedTime = '3-5 minutes';
            estimatedTokens = 4000;
            reasoning = [
                'Medium complexity detected',
                factors.acceptanceCriteriaCount > 3 ? 'Multiple acceptance criteria' : '',
                factors.relevantFilesCount > 2 ? 'Multiple files involved' : '',
                'Plan-then-implement approach recommended'
            ].filter(Boolean);

        } else {
            // THOROUGH: Complex tasks (10% of cases)
            strategy = 'THOROUGH';
            estimatedTime = '5-10 minutes';
            estimatedTokens = 5500;
            reasoning = [
                'Complex task detected',
                factors.relevantFilesCount > 5 ? 'Many files to coordinate' : '',
                factors.relevantFilesConfidence < 0.5 ? 'Low workspace confidence' : '',
                factors.workItemType === 'Epic' ? 'Epic requires detailed planning' : '',
                'Full analysis-plan-implement-verify cycle needed'
            ].filter(Boolean);
        }

        // Calculate confidence based on how clear the decision is
        const confidence = this.calculateConfidence(score, strategy);

        return {
            strategy,
            confidence,
            reasoning,
            estimatedTime,
            estimatedTokens
        };
    }

    /**
     * Calculate confidence in strategy selection
     */
    private calculateConfidence(score: number, strategy: Strategy): number {
        // High confidence if score is clearly in one range
        if (strategy === 'RAPID' && score <= 2) return 0.95;
        if (strategy === 'RAPID' && score === 3) return 0.80;
        
        if (strategy === 'BALANCED' && score >= 4 && score <= 6) return 0.90;
        if (strategy === 'BALANCED' && (score === 3 || score === 7)) return 0.75;
        
        if (strategy === 'THOROUGH' && score >= 8) return 0.95;
        if (strategy === 'THOROUGH' && score === 7) return 0.80;

        return 0.70; // Default moderate confidence
    }

    /**
     * Allow user override with explanation
     */
    explainStrategyDifferences(): Record<Strategy, string> {
        return {
            'RAPID': `⚡ RAPID Strategy (1-2 min, ~2500 tokens)
- Single optimized prompt
- Best for: Bug fixes, small tasks
- Auto-validation in background
- 0 manual approvals`,
            'BALANCED': `⚖️ BALANCED Strategy (3-5 min, ~4000 tokens)
- Plan first, then implement
- Best for: Features, enhancements
- 1 approval gate (after plan)
- Auto-verification`,
            'THOROUGH': `🔍 THOROUGH Strategy (5-10 min, ~5500 tokens)
- Full analysis → plan → implement → verify
- Best for: Complex features, epics
- 2 approval gates (strategic)
- Detailed quality checks`
        };
    }
}
