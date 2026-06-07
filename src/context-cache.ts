/**
 * Context Cache System
 * Caches workspace analysis to avoid repeated scans
 * Saves ~300-500 tokens per generation after first
 */

import * as vscode from 'vscode';
import { ContextSummary } from './context-analyzer';

interface CachedContext {
    context: ContextSummary;
    timestamp: number;
    workspaceUri: string;
}

export class ContextCache {
    private static readonly CACHE_TTL = 30 * 60 * 1000; // 30 minutes
    private cache = new Map<string, CachedContext>();
    private fileWatcher?: vscode.FileSystemWatcher;

    constructor() {
        this.setupFileWatcher();
    }

    /**
     * Get cached context or trigger fresh analysis
     */
    async get(
        workspaceUri: vscode.Uri,
        analyzer: () => Promise<ContextSummary>
    ): Promise<ContextSummary> {
        const key = workspaceUri.fsPath;
        const cached = this.cache.get(key);

        // Return cached if valid
        if (cached && !this.isStale(cached)) {
            console.log('✓ Using cached workspace context');
            return cached.context;
        }

        // Fresh analysis needed
        console.log('🔄 Analyzing workspace (cache miss or stale)');
        const fresh = await analyzer();

        // Cache the result
        this.cache.set(key, {
            context: fresh,
            timestamp: Date.now(),
            workspaceUri: key
        });

        return fresh;
    }

    /**
     * Check if cached context is stale
     */
    private isStale(cached: CachedContext): boolean {
        return Date.now() - cached.timestamp > ContextCache.CACHE_TTL;
    }

    /**
     * Invalidate cache when files change
     */
    private setupFileWatcher(): void {
        // Watch for TypeScript file changes
        this.fileWatcher = vscode.workspace.createFileSystemWatcher(
            '**/*.{ts,js,json}',
            false, // onCreate
            false, // onChange
            false  // onDelete
        );

        const invalidateCache = () => {
            console.log('📝 Files changed - invalidating context cache');
            this.cache.clear();
        };

        this.fileWatcher.onDidChange(invalidateCache);
        this.fileWatcher.onDidCreate(invalidateCache);
        this.fileWatcher.onDidDelete(invalidateCache);
    }

    /**
     * Manual cache invalidation
     */
    invalidate(workspaceUri?: vscode.Uri): void {
        if (workspaceUri) {
            this.cache.delete(workspaceUri.fsPath);
        } else {
            this.cache.clear();
        }
    }

    /**
     * Get cache stats for debugging
     */
    getStats(): { size: number; oldestEntry: number | null } {
        const entries = Array.from(this.cache.values());
        const oldestEntry = entries.length > 0
            ? Math.min(...entries.map(e => e.timestamp))
            : null;

        return {
            size: this.cache.size,
            oldestEntry
        };
    }

    /**
     * Cleanup
     */
    dispose(): void {
        this.fileWatcher?.dispose();
        this.cache.clear();
    }
}
