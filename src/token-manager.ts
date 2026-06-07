/**
 * Token Budget Management System
 * Tracks and optimizes token usage across prompt stages
 */

export interface TokenBudget {
    analysis: number;
    planning: number;
    implementation: number;
    verification: number;
    total: number;
}

export interface TokenUsage {
    stage: string;
    estimatedTokens: number;
    budgetRemaining: number;
    timestamp: Date;
}

export class TokenManager {
    private static readonly DEFAULT_BUDGET: TokenBudget = {
        analysis: 1000,
        planning: 1200,
        implementation: 3000,
        verification: 800,
        total: 6000
    };

    private static readonly MAX_TOKENS_PER_MESSAGE = 8000; // GPT-4 limit
    private usageLog: TokenUsage[] = [];

    constructor(private budget: TokenBudget = TokenManager.DEFAULT_BUDGET) {}

    /**
     * Estimate token count (rough approximation: chars/4)
     * More accurate: use tiktoken library in future
     */
    estimateTokens(text: string): number {
        // Basic estimation: ~4 characters per token
        // This is a conservative estimate
        const charCount = text.length;
        return Math.ceil(charCount / 4);
    }

    /**
     * Check if prompt fits within stage budget
     */
    checkBudget(stage: keyof Omit<TokenBudget, 'total'>, promptText: string): {
        withinBudget: boolean;
        estimatedTokens: number;
        budgetLimit: number;
        suggestion?: string;
    } {
        const estimatedTokens = this.estimateTokens(promptText);
        const budgetLimit = this.budget[stage];
        const withinBudget = estimatedTokens <= budgetLimit;

        // Log usage
        this.usageLog.push({
            stage,
            estimatedTokens,
            budgetRemaining: budgetLimit - estimatedTokens,
            timestamp: new Date()
        });

        const result = {
            withinBudget,
            estimatedTokens,
            budgetLimit,
            suggestion: undefined as string | undefined
        };

        if (!withinBudget) {
            const overage = estimatedTokens - budgetLimit;
            result.suggestion = `Prompt exceeds budget by ~${overage} tokens. Consider:
- Removing optional sections
- Compressing examples
- Summarizing context
- Using references instead of full content`;
        } else if (estimatedTokens > budgetLimit * 0.9) {
            result.suggestion = `Near budget limit (${Math.round((estimatedTokens/budgetLimit)*100)}%). Consider optimizing.`;
        }

        return result;
    }

    /**
     * Check if prompt fits within absolute message limit
     */
    checkMessageLimit(promptText: string): {
        withinLimit: boolean;
        estimatedTokens: number;
        maxTokens: number;
    } {
        const estimatedTokens = this.estimateTokens(promptText);
        return {
            withinLimit: estimatedTokens <= TokenManager.MAX_TOKENS_PER_MESSAGE,
            estimatedTokens,
            maxTokens: TokenManager.MAX_TOKENS_PER_MESSAGE
        };
    }

    /**
     * Optimize prompt to fit within budget
     */
    optimizePrompt(sections: PromptSection[], targetTokens: number): string {
        // Sort sections by priority
        const sorted = [...sections].sort((a, b) => a.priority - b.priority);
        
        let currentTokens = 0;
        const includedSections: string[] = [];

        for (const section of sorted) {
            const sectionTokens = this.estimateTokens(section.content);
            
            if (currentTokens + sectionTokens <= targetTokens) {
                includedSections.push(section.content);
                currentTokens += sectionTokens;
            } else if (section.priority === 0) {
                // Critical section - must include even if compressed
                const compressed = this.compressSection(section.content, targetTokens - currentTokens);
                includedSections.push(compressed);
                currentTokens += this.estimateTokens(compressed);
                break; // Stop adding more sections
            }
        }

        return includedSections.join('\n\n');
    }

    /**
     * Compress section to fit token budget
     */
    private compressSection(content: string, maxTokens: number): string {
        const currentTokens = this.estimateTokens(content);
        
        if (currentTokens <= maxTokens) {
            return content;
        }

        // Simple compression: truncate while preserving structure
        const targetChars = maxTokens * 4; // Rough conversion back to chars
        const lines = content.split('\n');
        
        let compressed = '';
        let charCount = 0;

        for (const line of lines) {
            if (charCount + line.length <= targetChars) {
                compressed += line + '\n';
                charCount += line.length;
            } else {
                compressed += '\n... (content truncated to fit token budget) ...';
                break;
            }
        }

        return compressed;
    }

    /**
     * Get token usage statistics
     */
    getUsageStats(): {
        totalTokensUsed: number;
        byStage: Record<string, number>;
        averagePerStage: Record<string, number>;
    } {
        const byStage: Record<string, number> = {};
        const countByStage: Record<string, number> = {};

        for (const usage of this.usageLog) {
            byStage[usage.stage] = (byStage[usage.stage] || 0) + usage.estimatedTokens;
            countByStage[usage.stage] = (countByStage[usage.stage] || 0) + 1;
        }

        const averagePerStage: Record<string, number> = {};
        for (const stage in byStage) {
            averagePerStage[stage] = Math.round(byStage[stage] / countByStage[stage]);
        }

        return {
            totalTokensUsed: Object.values(byStage).reduce((sum, val) => sum + val, 0),
            byStage,
            averagePerStage
        };
    }

    /**
     * Reset usage log
     */
    resetUsageLog(): void {
        this.usageLog = [];
    }

    /**
     * Get current budget configuration
     */
    getBudget(): TokenBudget {
        return { ...this.budget };
    }

    /**
     * Update budget configuration
     */
    updateBudget(newBudget: Partial<TokenBudget>): void {
        this.budget = { ...this.budget, ...newBudget };
    }
}

export interface PromptSection {
    name: string;
    content: string;
    priority: number; // 0 = critical, higher = lower priority
    optional?: boolean;
}

/**
 * Singleton instance for global token management
 */
export const globalTokenManager = new TokenManager();
