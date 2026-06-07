/**
 * Workspace Context Analyzer
 * Extracts relevant context from workspace for high-quality code generation
 */

import * as vscode from 'vscode';
import { ContextCache } from './context-cache';

export interface WorkspacePattern {
    componentPattern: string;
    servicePattern: string;
    modulePattern: string;
    testPattern: string;
}

export type TechStack = 'Angular' | 'React' | 'Vue' | 'Node.js' | 'JavaScript' | 'TypeScript' | 'Unknown';

export interface TechStackInfo {
    primary: TechStack;
    version?: string;
    framework?: string; // e.g., Next.js, Gatsby, Remix for React
    testing?: string; // e.g., Jasmine, Jest, Vitest
    stateManagement?: string; // e.g., Redux, MobX, NgRx
    uiLibrary?: string; // e.g., Material UI, Ant Design, PrimeNG
}

export interface ContextSummary {
    projectType: string; // Legacy - for backward compatibility
    techStack: TechStackInfo; // New detailed tech stack info
    projectVersion?: string; // Legacy - for backward compatibility
    folderStructure: FolderNode[];
    patterns: WorkspacePattern;
    relevantFiles: RelevantFile[];
    dependencies: string[];
    conventions: CodeConvention[];
}

export interface FolderNode {
    name: string;
    path: string;
    type: 'folder' | 'file';
    children?: FolderNode[];
}

export interface RelevantFile {
    path: string;
    type: 'component' | 'service' | 'module' | 'model' | 'test' | 'other';
    interfaces?: string[];
    exports?: string[];
    relevanceScore: number;
}

export interface CodeConvention {
    type: 'naming' | 'structure' | 'import' | 'pattern';
    description: string;
    example?: string;
}

export class ContextAnalyzer {
    private workspaceRoot: vscode.Uri | undefined;
    private cache: ContextCache;

    constructor() {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0) {
            this.workspaceRoot = workspaceFolders[0].uri;
        }
        this.cache = new ContextCache();
    }

    /**
     * Analyze workspace and extract relevant context (with caching)
     */
    async analyzeWorkspace(workItemDescription: string): Promise<ContextSummary> {
        if (!this.workspaceRoot) {
            throw new Error('No workspace folder opened');
        }

        // Use cache to avoid re-analyzing workspace
        return this.cache.get(this.workspaceRoot, async () => {
            const techStack = await this.detectTechStack();
            const patterns = await this.detectPatterns(techStack.primary);
            const dependencies = await this.extractDependencies();
            const folderStructure = await this.getFolderStructure();
            const relevantFiles = await this.findRelevantFiles(workItemDescription, techStack.primary);
            const conventions = await this.extractConventions(relevantFiles);

            return {
                projectType: techStack.primary, // Legacy compatibility
                techStack,
                angularVersion: techStack.primary === 'Angular' ? techStack.version : undefined, // Legacy
                folderStructure,
                patterns,
                relevantFiles,
                dependencies,
                conventions
            };
        });
    }

    /**
     * Detect tech stack with detailed framework information
     */
    private async detectTechStack(): Promise<TechStackInfo> {
        if (!this.workspaceRoot) {
            return { primary: 'Unknown' };
        }

        try {
            const packageJsonUri = vscode.Uri.joinPath(this.workspaceRoot, 'package.json');
            const packageJsonExists = await this.fileExists(packageJsonUri);

            if (!packageJsonExists) {
                return { primary: 'Unknown' };
            }

            const packageJson = await this.readJsonFile(packageJsonUri);
            const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };

            // Detect Angular
            const angularJsonUri = vscode.Uri.joinPath(this.workspaceRoot, 'angular.json');
            const angularJsonExists = await this.fileExists(angularJsonUri);
            if (angularJsonExists || deps['@angular/core']) {
                return {
                    primary: 'Angular',
                    version: deps['@angular/core']?.replace(/[^0-9.]/g, ''),
                    testing: deps['jasmine-core'] ? 'Jasmine/Karma' : deps['jest'] ? 'Jest' : undefined,
                    stateManagement: deps['@ngrx/store'] ? 'NgRx' : deps['@ngxs/store'] ? 'NGXS' : deps['akita'] ? 'Akita' : undefined,
                    uiLibrary: deps['@angular/material'] ? 'Angular Material' : deps['primeng'] ? 'PrimeNG' : deps['ng-bootstrap'] ? 'ng-bootstrap' : undefined
                };
            }

            // Detect React
            if (deps['react']) {
                let framework = 'React';
                if (deps['next']) framework = 'Next.js';
                else if (deps['gatsby']) framework = 'Gatsby';
                else if (deps['@remix-run/react']) framework = 'Remix';
                else if (deps['react-router-dom']) framework = 'React Router';

                return {
                    primary: 'React',
                    version: deps['react']?.replace(/[^0-9.]/g, ''),
                    framework,
                    testing: deps['@testing-library/react'] ? 'React Testing Library' : deps['jest'] ? 'Jest' : deps['vitest'] ? 'Vitest' : undefined,
                    stateManagement: deps['redux'] ? 'Redux' : deps['mobx'] ? 'MobX' : deps['zustand'] ? 'Zustand' : deps['recoil'] ? 'Recoil' : undefined,
                    uiLibrary: deps['@mui/material'] ? 'Material UI' : deps['antd'] ? 'Ant Design' : deps['@chakra-ui/react'] ? 'Chakra UI' : undefined
                };
            }

            // Detect Vue
            if (deps['vue']) {
                return {
                    primary: 'Vue',
                    version: deps['vue']?.replace(/[^0-9.]/g, ''),
                    framework: deps['nuxt'] ? 'Nuxt' : 'Vue',
                    testing: deps['@vue/test-utils'] ? 'Vue Test Utils' : deps['vitest'] ? 'Vitest' : undefined,
                    stateManagement: deps['vuex'] ? 'Vuex' : deps['pinia'] ? 'Pinia' : undefined
                };
            }

            // Detect Node.js backend
            if (deps['express'] || deps['fastify'] || deps['koa'] || deps['nestjs']) {
                return {
                    primary: 'Node.js',
                    framework: deps['@nestjs/core'] ? 'NestJS' : deps['express'] ? 'Express' : deps['fastify'] ? 'Fastify' : undefined,
                    testing: deps['jest'] ? 'Jest' : deps['mocha'] ? 'Mocha' : undefined
                };
            }

            // Generic TypeScript/JavaScript
            if (deps['typescript']) {
                return { primary: 'TypeScript' };
            }

            return { primary: 'JavaScript' };

        } catch {
            return { primary: 'Unknown' };
        }
    }

    /**
     * Legacy: Detect project type (for backward compatibility)
     */
    private async detectProjectType(): Promise<[string, string | undefined]> {
        const techStack = await this.detectTechStack();
        return [techStack.primary, techStack.version];
    }

    /**
     * Detect code patterns based on tech stack
     */
    private async detectPatterns(techStack: TechStack): Promise<WorkspacePattern> {
        const srcPath = this.workspaceRoot ? vscode.Uri.joinPath(this.workspaceRoot, 'src') : undefined;
        
        switch (techStack) {
            case 'Angular':
                return {
                    componentPattern: '*.component.ts (Angular)',
                    servicePattern: '*.service.ts (Angular)',
                    modulePattern: '*.module.ts (Angular)',
                    testPattern: '*.spec.ts (Jasmine/Karma)'
                };
            
            case 'React':
                return {
                    componentPattern: '*.tsx or *.jsx (React)',
                    servicePattern: '*.service.ts or hooks/*.ts (React)',
                    modulePattern: 'N/A (React uses components)',
                    testPattern: '*.test.tsx or *.spec.tsx (Jest/RTL)'
                };
            
            case 'Vue':
                return {
                    componentPattern: '*.vue (Vue SFC)',
                    servicePattern: '*.service.ts or composables/*.ts',
                    modulePattern: 'N/A (Vue uses components)',
                    testPattern: '*.spec.ts (Vue Test Utils)'
                };
            
            case 'Node.js':
                return {
                    componentPattern: 'controllers/*.ts',
                    servicePattern: 'services/*.ts',
                    modulePattern: 'modules/*.ts',
                    testPattern: '*.test.ts or *.spec.ts'
                };
            
            default:
                return {
                    componentPattern: '*.ts or *.js',
                    servicePattern: '*.service.ts or *.ts',
                    modulePattern: '*.module.ts or *.ts',
                    testPattern: '*.test.ts or *.spec.ts'
                };
        }
    }

    /**
     * Extract dependencies from package.json
     */
    private async extractDependencies(): Promise<string[]> {
        if (!this.workspaceRoot) {
            return [];
        }

        try {
            const packageJsonUri = vscode.Uri.joinPath(this.workspaceRoot, 'package.json');
            const packageJson = await this.readJsonFile(packageJsonUri);

            const deps = Object.keys(packageJson?.dependencies || {});
            const devDeps = Object.keys(packageJson?.devDependencies || {});

            return [...deps, ...devDeps].filter(dep => 
                dep.startsWith('@angular') || 
                dep.includes('rxjs') || 
                dep.includes('ngrx') ||
                dep.includes('material')
            );
        } catch {
            return [];
        }
    }

    /**
     * Get folder structure (simplified for token efficiency)
     */
    private async getFolderStructure(): Promise<FolderNode[]> {
        if (!this.workspaceRoot) {
            return [];
        }

        try {
            const srcUri = vscode.Uri.joinPath(this.workspaceRoot, 'src', 'app');
            const srcExists = await this.fileExists(srcUri);

            if (!srcExists) {
                return [];
            }

            const entries = await vscode.workspace.fs.readDirectory(srcUri);
            const nodes: FolderNode[] = [];

            // Only include first level folders (to save tokens)
            for (const [name, type] of entries) {
                if (type === vscode.FileType.Directory) {
                    nodes.push({
                        name,
                        path: `src/app/${name}`,
                        type: 'folder'
                    });
                }
            }

            return nodes;
        } catch {
            return [];
        }
    }

    /**
     * Find relevant files based on work item description and tech stack
     */
    private async findRelevantFiles(description: string, techStack: TechStack): Promise<RelevantFile[]> {
        if (!this.workspaceRoot) {
            return [];
        }

        // Extract keywords from description
        const keywords = this.extractKeywords(description);
        const files: RelevantFile[] = [];

        try {
            const srcUri = vscode.Uri.joinPath(this.workspaceRoot, 'src');
            const allFiles = await this.findSourceFiles(srcUri, techStack);

            for (const fileUri of allFiles.slice(0, 10)) { // Limit to 10 files
                const relevanceScore = this.calculateRelevance(fileUri.fsPath, keywords);
                
                if (relevanceScore > 0.3) {
                    const fileType = this.determineFileType(fileUri.fsPath);
                    const content = await this.readFileContent(fileUri);
                    const interfaces = this.extractInterfaces(content);
                    const exports = this.extractExports(content);

                    files.push({
                        path: vscode.workspace.asRelativePath(fileUri),
                        type: fileType,
                        interfaces,
                        exports,
                        relevanceScore
                    });
                }
            }

            // Sort by relevance and return top 5
            return files.sort((a, b) => b.relevanceScore - a.relevanceScore).slice(0, 5);
        } catch {
            return [];
        }
    }

    /**
     * Extract code conventions from relevant files
     */
    private async extractConventions(relevantFiles: RelevantFile[]): Promise<CodeConvention[]> {
        const conventions: CodeConvention[] = [];

        // Analyze file naming patterns
        const componentFiles = relevantFiles.filter(f => f.type === 'component');
        if (componentFiles.length > 0) {
            conventions.push({
                type: 'naming',
                description: 'Component files: name.component.ts pattern',
                example: componentFiles[0].path
            });
        }

        // Analyze import patterns
        if (relevantFiles.length > 0) {
            conventions.push({
                type: 'import',
                description: 'Use path aliases (@app/, @shared/, @core/) if configured',
                example: "import { Service } from '@app/services';"
            });
        }

        // Analyze structure patterns
        const hasModules = relevantFiles.some(f => f.type === 'module');
        if (hasModules) {
            conventions.push({
                type: 'structure',
                description: 'Feature modules pattern detected',
                example: 'Each feature has its own module'
            });
        }

        return conventions;
    }

    /**
     * Helper: Check if file exists
     */
    private async fileExists(uri: vscode.Uri): Promise<boolean> {
        try {
            await vscode.workspace.fs.stat(uri);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Helper: Read JSON file
     */
    private async readJsonFile(uri: vscode.Uri): Promise<any> {
        const content = await vscode.workspace.fs.readFile(uri);
        return JSON.parse(content.toString());
    }

    /**
     * Helper: Read file content
     */
    private async readFileContent(uri: vscode.Uri): Promise<string> {
        const content = await vscode.workspace.fs.readFile(uri);
        return content.toString();
    }

    /**
     * Helper: Find source files based on tech stack
     */
    private async findSourceFiles(uri: vscode.Uri, techStack: TechStack): Promise<vscode.Uri[]> {
        const files: vscode.Uri[] = [];
        
        // Define file patterns based on tech stack
        const filePatterns: Record<TechStack, string[]> = {
            'Angular': ['.ts', '.component.ts', '.service.ts'],
            'React': ['.tsx', '.ts', '.jsx', '.js'],
            'Vue': ['.vue', '.ts', '.js'],
            'Node.js': ['.ts', '.js'],
            'JavaScript': ['.js', '.jsx'],
            'TypeScript': ['.ts', '.tsx'],
            'Unknown': ['.ts', '.js', '.tsx', '.jsx']
        };

        const patterns = filePatterns[techStack] || ['.ts', '.js'];
        
        try {
            const entries = await vscode.workspace.fs.readDirectory(uri);

            for (const [name, type] of entries) {
                const childUri = vscode.Uri.joinPath(uri, name);

                if (type === vscode.FileType.File) {
                    // Check if file matches any pattern and is not a test file
                    const isSourceFile = patterns.some(pattern => name.endsWith(pattern));
                    const isTestFile = name.includes('.test.') || name.includes('.spec.');
                    
                    if (isSourceFile && !isTestFile) {
                        files.push(childUri);
                    }
                } else if (type === vscode.FileType.Directory && !name.includes('node_modules') && files.length < 50) {
                    const childFiles = await this.findSourceFiles(childUri, techStack);
                    files.push(...childFiles);
                }
            }
        } catch {
            // Ignore errors
        }

        return files;
    }

    /**
     * Helper: Find TypeScript files recursively (legacy)
     */
    private async findTypeScriptFiles(uri: vscode.Uri): Promise<vscode.Uri[]> {
        return this.findSourceFiles(uri, 'TypeScript');
    }

    /**
     * Helper: Extract keywords from text
     */
    private extractKeywords(text: string): string[] {
        const words = text.toLowerCase()
            .replace(/[^a-z0-9\s]/g, ' ')
            .split(/\s+/)
            .filter(word => word.length > 3);
        
        return [...new Set(words)];
    }

    /**
     * Helper: Calculate relevance score
     */
    private calculateRelevance(filePath: string, keywords: string[]): number {
        const filePathLower = filePath.toLowerCase();
        let score = 0;

        for (const keyword of keywords) {
            if (filePathLower.includes(keyword)) {
                score += 0.2;
            }
        }

        return Math.min(score, 1.0);
    }

    /**
     * Helper: Determine file type based on path and extension
     */
    private determineFileType(filePath: string): RelevantFile['type'] {
        // Angular patterns
        if (filePath.includes('.component.ts')) return 'component';
        if (filePath.includes('.service.ts')) return 'service';
        if (filePath.includes('.module.ts')) return 'module';
        
        // React patterns
        if (filePath.match(/\.(tsx|jsx)$/)) return 'component';
        if (filePath.includes('/hooks/') || filePath.includes('use')) return 'service';
        if (filePath.includes('/context/')) return 'service';
        
        // Vue patterns
        if (filePath.endsWith('.vue')) return 'component';
        if (filePath.includes('/composables/')) return 'service';
        
        // Common patterns
        if (filePath.includes('.model.') || filePath.includes('.interface.') || filePath.includes('/types/')) return 'model';
        if (filePath.includes('.test.') || filePath.includes('.spec.')) return 'test';
        if (filePath.includes('/utils/') || filePath.includes('/helpers/')) return 'other';
        
        return 'other';
    }

    /**
     * Helper: Extract interfaces from TypeScript code
     */
    private extractInterfaces(content: string): string[] {
        const interfaceRegex = /export\s+interface\s+(\w+)/g;
        const matches = content.matchAll(interfaceRegex);
        return Array.from(matches, m => m[1]);
    }

    /**
     * Helper: Extract exports from TypeScript code
     */
    private extractExports(content: string): string[] {
        const exportRegex = /export\s+(?:class|const|function|interface)\s+(\w+)/g;
        const matches = content.matchAll(exportRegex);
        return Array.from(matches, m => m[1]);
    }

    /**
     * Cleanup cache resources
     */
    dispose(): void {
        this.cache.dispose();
    }
}
