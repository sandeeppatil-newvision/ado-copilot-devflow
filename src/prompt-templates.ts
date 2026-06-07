/**
 * Prompt Templates for Multi-Stage Code Generation
 * Optimized for token efficiency and quality
 */

import { ContextSummary, TechStackInfo } from './context-analyzer';
import { PromptSection } from './token-manager';

export interface WorkItemData {
    id: string;
    workItemType: string;
    title: string;
    description: string;
    ac: string;
    priority?: string;
    severity?: string;
    reproSteps?: string;
    rootCause?: string;
    resolution?: string;
    discussion?: string;
    testCases: TestCase[];
    attachments: Attachment[];
}

export interface TestCase {
    id: string;
    title: string;
    steps?: string;
}

export interface Attachment {
    name: string;
    url: string;
}

export class PromptTemplates {

    /**
     * STAGE 1: Analysis Stage
     * Goal: Understand workspace and verify relevance
     */
    static analysisStage(workItem: WorkItemData, context: ContextSummary): PromptSection[] {
        const isBug = ['Bug', 'Defect'].includes(workItem.workItemType);

        return [
            {
                name: 'analysis-header',
                priority: 0,
                content: `🔍 STAGE 1: WORKSPACE ANALYSIS

You are a software developer. Your task is to analyze the workspace and determine if this work item is relevant.

📋 Work Item: #${workItem.id} - ${workItem.workItemType}
📝 Title: ${workItem.title}

🏢 WORKSPACE INFO:
- Project: ${context.projectType}
- Project Version: ${context.projectVersion || 'N/A'}
- Dependencies: ${context.dependencies.slice(0, 5).join(', ')}

🎯 YOUR TASK:
1. Review the work item description below
2. Search @workspace for related files
3. Determine if this work item belongs to this codebase
4. Report your findings
5. Ask for confirmation before proceeding`
            },
            {
                name: 'work-item-details',
                priority: 0,
                content: `
📖 WORK ITEM DESCRIPTION:
${workItem.description}
${isBug && workItem.reproSteps ? `\n🔁 REPRODUCTION STEPS:\n${workItem.reproSteps}` : ''}

✅ ACCEPTANCE CRITERIA:
${workItem.ac || 'Not specified'}`
            },
            {
                name: 'workspace-structure',
                priority: 1,
                content: `
📁 DETECTED FOLDER STRUCTURE:
${context.folderStructure.map(f => `  - ${f.path}`).join('\n')}

${context.relevantFiles.length > 0 ? `
📂 POTENTIALLY RELEVANT FILES:
${context.relevantFiles.map(f => `  - ${f.path} (${f.type}) - Relevance: ${Math.round(f.relevanceScore * 100)}%`).join('\n')}
` : 'No relevant files found yet.'}
`
            },
            {
                name: 'analysis-instructions',
                priority: 0,
                content: `
⚠️ CRITICAL INSTRUCTIONS:

1. Search @workspace for files related to: "${workItem.title}"
2. Look for patterns matching: ${isBug ? 'bug symptoms' : 'similar features'}
3. Report what you found (or didn't find)
4. Answer: "Is this work item for THIS codebase?"
5. If relevant, list 3-5 files that will likely need changes
6. If NOT relevant, explain why and ask for clarification

DO NOT PROCEED TO IMPLEMENTATION YET. Only analyze and report.

📤 YOUR RESPONSE SHOULD INCLUDE:
✓ Search results from @workspace
✓ Relevance assessment (Yes/No/Uncertain)
✓ List of files to modify/create
✓ Any questions or concerns
✓ Request for user confirmation to proceed`
            }
        ];
    }

    /**
     * STAGE 2: Planning Stage
     * Goal: Create detailed implementation plan
     */
    static planningStage(workItem: WorkItemData, context: ContextSummary, analysisFindings: string): PromptSection[] {
        const isBug = ['Bug', 'Defect'].includes(workItem.workItemType);

        return [
            {
                name: 'planning-header',
                priority: 0,
                content: `🎯 STAGE 2: IMPLEMENTATION PLANNING

Based on your analysis, create a detailed implementation plan.

📋 Work Item: #${workItem.id} - ${workItem.workItemType}

🔍 YOUR ANALYSIS:
${analysisFindings}

🎯 YOUR TASK:
Create a detailed plan including:
1. Exact files to modify/create
2. Interfaces and types needed
3. Test cases to implement
4. Step-by-step implementation approach
5. Integration points and dependencies`
            },
            {
                name: 'test-cases',
                priority: 0,
                content: `
🧪 TEST CASES TO SATISFY:
${workItem.testCases.map((tc, i) => `${i + 1}. [TC-${tc.id}] ${tc.title}`).join('\n')}

${workItem.ac ? `
✅ ACCEPTANCE CRITERIA (must be testable):
${workItem.ac}
` : ''}`
            },
            {
                name: 'code-conventions',
                priority: 1,
                content: `
📏 CODE CONVENTIONS DETECTED:
${context.conventions.map(c => `  - ${c.type}: ${c.description}`).join('\n')}

🛠️ PATTERNS TO FOLLOW:
${JSON.stringify(context.patterns, null, 2)}`
            },
            {
                name: 'planning-instructions',
                priority: 0,
                content: `
⚠️ PLANNING REQUIREMENTS:

${isBug ? `
🐛 BUG FIX PLAN MUST INCLUDE:
1. Root cause analysis
2. Files to fix (exact paths from @workspace)
3. Code changes (what to add/modify/remove)
4. Test cases to add (prevent regression)
5. Verification steps
` : `
✨ FEATURE PLAN MUST INCLUDE:
1. Component architecture (files and relationships)
2. Services and data models
3. Module updates and routing
4. Form validation strategy (if applicable)
5. Unit tests for each component/service
6. Integration points with existing code
`}

📋 REQUIRED OUTPUT FORMAT:

## Implementation Plan

### Files to Modify:
- [ ] file/path.ts - What to change
- [ ] file/path.html - What to change

### Files to Create:
- [ ] new/file.component.ts - Purpose
- [ ] new/file.service.ts - Purpose

### Interfaces/Models:
\`\`\`typescript
export interface NewInterface {
  // ...
}
\`\`\`

### Test Cases:
- [ ] Test 1: Description
- [ ] Test 2: Description

### Implementation Steps:
1. Step 1
2. Step 2
3. ...

### Risks/Questions:
- Question 1?
- Question 2?

WAIT FOR USER APPROVAL BEFORE PROCEEDING TO IMPLEMENTATION.`
            }
        ];
    }

    /**
     * STAGE 3: Implementation Stage
     * Goal: Generate production-ready code
     */
    static implementationStage(
        workItem: WorkItemData,
        context: ContextSummary,
        approvedPlan: string,
        techStack?: TechStackInfo
    ): PromptSection[] {
        return [
            {
                name: 'implementation-header',
                priority: 0,
                content: `💻 STAGE 3: CODE IMPLEMENTATION

Generate production-ready code based on the approved plan.

📋 Work Item: #${workItem.id}

✅ APPROVED PLAN:
${approvedPlan}

🎯 YOUR TASK:
Generate complete, production-ready code following the plan exactly.`
            },
            {
                name: 'quality-requirements',
                priority: 0,
                content: this.getQualityRequirements(techStack)
            },
            {
                name: 'relevant-patterns',
                priority: 1,
                content: context.relevantFiles.length > 0 ? `
📂 REFERENCE FILES (follow these patterns):
${context.relevantFiles.slice(0, 3).map(f => `
File: ${f.path}
Type: ${f.type}
Exports: ${f.exports?.slice(0, 3).join(', ') || 'N/A'}
Interfaces: ${f.interfaces?.slice(0, 3).join(', ') || 'N/A'}
`).join('\n')}

⚠️ FOLLOW THE PATTERNS IN THESE FILES EXACTLY.
` : ''
            },
            {
                name: 'implementation-instructions',
                priority: 0,
                content: `
📤 REQUIRED OUTPUT:

For EACH file in the plan, provide:

### 1. File: path/to/file.ts

\`\`\`typescript
// Complete, production-ready code
// Include all imports
// Include all types/interfaces
// Include proper error handling
\`\`\`

**Explanation:** What this file does and why

### 2. File: path/to/file.spec.ts

\`\`\`typescript
// Complete test suite
// Test all methods/functionality
// Mock dependencies
// Cover edge cases
\`\`\`

**Tests Covered:** List test cases

---

CONTINUE FOR ALL FILES IN THE PLAN.

At the end, provide:

## Integration Instructions:
1. How to integrate this code
2. What to import/configure
3. How to run tests
4. What to verify

## Verification Checklist:
- [ ] Code compiles without errors
- [ ] All tests pass
- [ ] No TypeScript errors
- [ ] Follows workspace conventions
- [ ] Meets acceptance criteria`
            }
        ];
    }

    /**
     * STAGE 4: Verification Stage
     * Goal: Validate code quality
     */
    static verificationStage(
        workItem: WorkItemData,
        generatedCode: string
    ): PromptSection[] {
        return [
            {
                name: 'verification-header',
                priority: 0,
                content: `✅ STAGE 4: CODE VERIFICATION

Review the generated code for quality issues.

📋 Work Item: #${workItem.id}

🎯 YOUR TASK:
Perform a thorough quality review of the generated code.`
            },
            {
                name: 'verification-checklist',
                priority: 0,
                content: `
🔍 VERIFICATION CHECKLIST:

## 1. Correctness:
- [ ] Implements all acceptance criteria
- [ ] Handles all test cases
- [ ] No logical errors
- [ ] Proper error handling

## 2. Code Quality:
- [ ] No \`any\` types
- [ ] Proper TypeScript typing
- [ ] Follows @workspace tech style guide
- [ ] No code duplication
- [ ] Clear naming conventions

## 3. Testing:
- [ ] All components have tests
- [ ] All services have tests
- [ ] Tests cover edge cases
- [ ] Mocks are properly configured
- [ ] Tests would pass if run

## 4. Integration:
- [ ] Follows workspace patterns
- [ ] Imports are correct
- [ ] Module declarations correct
- [ ] Routing configured properly
- [ ] No breaking changes

## 5. Performance:
- [ ] Uses OnPush where appropriate
- [ ] Proper unsubscribe patterns
- [ ] No memory leaks
- [ ] Optimized change detection

## 6. Security:
- [ ] Input validation
- [ ] XSS prevention
- [ ] Proper authentication checks
- [ ] No hardcoded secrets`
            },
            {
                name: 'verification-instructions',
                priority: 0,
                content: `
📤 YOUR RESPONSE:

For each checklist item, provide:

### ✅ Passed Items:
- Item: Why it passes

### ⚠️ Issues Found:
- Issue: Description
  - Severity: High/Medium/Low
  - Fix: How to fix it
  - Updated Code: Show the fix

### 📊 Quality Score:
- Correctness: X/10
- Code Quality: X/10
- Testing: X/10
- Integration: X/10
- **Overall: X/10**

### 🎯 Recommendations:
1. Recommendation 1
2. Recommendation 2

If Overall Score < 8/10, provide corrected code.
If Overall Score >= 8/10, approve for user testing.`
            }
        ];
    }

    /**
     * Format test cases for prompts
     */
    static formatTestCases(testCases: TestCase[]): string {
        if (!testCases || testCases.length === 0) {
            return 'No test cases provided.';
        }
        return testCases.map((tc, i) =>
            `${i + 1}. [TC-${tc.id}] ${tc.title}${tc.steps ? '\n   Steps: ' + tc.steps : ''}`
        ).join('\n');
    }

    /**
     * Format attachments for prompts
     */
    static formatAttachments(attachments: Attachment[]): string {
        if (!attachments || attachments.length === 0) {
            return 'No attachments available.';
        }
        return attachments.map((att, i) =>
            `${i + 1}. 📎 ${att.name}${att.url ? ` - ${att.url}` : ''}`
        ).join('\n');
    }

    /**
     * Get framework-specific quality requirements
     */
    private static getQualityRequirements(techStack?: TechStackInfo): string {
        const framework = techStack?.primary || 'JavaScript/TypeScript';

        let bestPractices = '';
        let testingFramework = techStack?.testing || 'Jest';

        // Framework-specific best practices
        switch (framework) {
            case 'Angular':
                bestPractices = `
✓ **Angular Best Practices:**
  - Follow @workspace Angular conventions
  - Proper unsubscribe (takeUntil pattern or async pipe)
  - Use Reactive Forms with validators
  - RxJS operators in pipe()
  - OnPush change detection where possible
  - Dependency injection for services
  - Avoid memory leaks with lifecycle hooks`;
                break;

            case 'React':
                bestPractices = `
✓ **React Best Practices:**
  - Follow @workspace React conventions
  - Use functional components with hooks
  - Implement proper useEffect cleanup
  - Memoize with useMemo/useCallback for performance
  - Follow React hooks rules (top-level only)
  - Use custom hooks for reusable logic (use* prefix)
  - Proper prop validation with TypeScript`;
                if (techStack?.framework === 'Next.js') {
                    bestPractices += `
  - Use Server Components where appropriate
  - Add 'use client' directive for client components
  - Optimize for server-side rendering`;
                }
                break;

            case 'Vue':
                const isVue3 = !techStack?.version || techStack.version.startsWith('3');
                bestPractices = `
✓ **Vue Best Practices:**
  - Follow @workspace Vue conventions
  - ${isVue3 ? 'Use Composition API with <script setup>' : 'Use Options API or Composition API'}
  - ${isVue3 ? 'Use composables for reusable logic' : 'Use mixins or composables'}
  - Computed properties for derived state
  - Proper watchers with cleanup
  - Props validation with TypeScript
  - Scoped styles in SFC`;
                break;

            case 'Node.js':
                const isNestJs = techStack?.framework === 'NestJS';
                bestPractices = `
✓ **Node.js Best Practices:**
  - Follow @workspace backend conventions
  - ${isNestJs ? 'Use dependency injection with decorators' : 'Use service pattern'}
  - Proper error handling middleware
  - Input validation with DTOs
  - Environment-based configuration
  - Async/await over callbacks
  - Repository pattern for data access`;
                break;

            default:
                bestPractices = `
✓ **Best Practices:**
  - Follow @workspace conventions
  - Follow SOLID principles
  - Write clean, maintainable code
  - Proper error handling
  - Use async/await for asynchronous operations
  - Clear and descriptive naming`;
        }

        // State management mention
        let stateManagement = '';
        if (techStack?.stateManagement) {
            stateManagement = `
  - Use ${techStack.stateManagement} for state management
  - Follow ${techStack.stateManagement} best practices`;
        }

        return `
⚠️ CODE QUALITY REQUIREMENTS:

✓ **TypeScript Strict Mode:**
  - No \`any\` types (use proper typing)
  - Enable strict null checks
  - All functions have return types
  - Proper interface definitions${bestPractices}${stateManagement}

✓ **Testing Requirements:**
  - ${testingFramework} tests for ALL components/modules
  - ${testingFramework} tests for ALL services/utilities
  - Mock external dependencies
  - Test coverage > 80%
  - Tests must pass acceptance criteria
  - Cover edge cases and error scenarios

✓ **Code Structure:**
  - Single Responsibility Principle
  - DRY (Don't Repeat Yourself)
  - Clear, descriptive naming
  - JSDoc for public methods
  - Inline comments for complex logic
  - Proper file organization

✓ **Error Handling:**
  - Try-catch for async operations
  - User-friendly error messages
  - Proper HTTP/API error handling
  - Loading states for async operations
  - Validation of inputs`;
    }
}
