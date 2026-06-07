/**
 * Framework-Specific Prompt Builder
 * Generates appropriate prompts based on detected tech stack
 */

import { TechStack, TechStackInfo } from './context-analyzer';

export interface FrameworkConfig {
    name: string;
    fileExtensions: string[];
    componentPattern: string;
    testingFramework: string;
    bestPractices: string[];
    codeStructure: string;
    commonPatterns: string[];
}

export class FrameworkPromptBuilder {
    
    /**
     * Get framework-specific configuration
     */
    static getFrameworkConfig(techStack: TechStackInfo): FrameworkConfig {
        switch (techStack.primary) {
            case 'Angular':
                return this.getAngularConfig(techStack);
            case 'React':
                return this.getReactConfig(techStack);
            case 'Vue':
                return this.getVueConfig(techStack);
            case 'Node.js':
                return this.getNodeJsConfig(techStack);
            default:
                return this.getGenericConfig(techStack);
        }
    }

    /**
     * Angular-specific configuration
     */
    private static getAngularConfig(techStack: TechStackInfo): FrameworkConfig {
        return {
            name: 'Angular',
            fileExtensions: ['.component.ts', '.service.ts', '.module.ts', '.spec.ts'],
            componentPattern: 'Component/Service/Module pattern',
            testingFramework: techStack.testing || 'Jasmine/Karma',
            bestPractices: [
                'Use OnPush change detection strategy where possible',
                'Implement proper unsubscribe patterns (takeUntil, async pipe)',
                'Use Reactive Forms with FormBuilder and validators',
                'Follow reactive programming with RxJS',
                'Use dependency injection properly',
                'Avoid memory leaks with proper lifecycle management'
            ],
            codeStructure: `
**Angular Component Structure:**
\`\`\`typescript
@Component({
  selector: 'app-component-name',
  templateUrl: './component-name.component.html',
  styleUrls: ['./component-name.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ComponentNameComponent implements OnInit, OnDestroy {
  // Use proper typing, no 'any'
  // Implement ngOnInit and ngOnDestroy
  // Use takeUntil for subscription management
}
\`\`\``,
            commonPatterns: [
                'Smart (container) vs Dumb (presentational) components',
                'Services for business logic and API calls',
                'RxJS operators: pipe, map, switchMap, catchError, takeUntil',
                'HttpClient with interceptors for API calls',
                techStack.stateManagement ? `State management with ${techStack.stateManagement}` : 'Component state management'
            ]
        };
    }

    /**
     * React-specific configuration
     */
    private static getReactConfig(techStack: TechStackInfo): FrameworkConfig {
        const isNextJs = techStack.framework === 'Next.js';
        const isRemix = techStack.framework === 'Remix';
        
        return {
            name: techStack.framework || 'React',
            fileExtensions: ['.tsx', '.ts', '.jsx', '.test.tsx'],
            componentPattern: 'Functional components with hooks',
            testingFramework: techStack.testing || 'Jest + React Testing Library',
            bestPractices: [
                'Use functional components with hooks (avoid class components)',
                'Implement proper useEffect cleanup',
                'Use TypeScript for type safety',
                'Memoize expensive computations with useMemo/useCallback',
                'Follow React hooks rules (call hooks at top level)',
                'Use custom hooks for reusable logic'
            ],
            codeStructure: isNextJs ? `
**Next.js Component Structure:**
\`\`\`typescript
// app/components/ComponentName.tsx (App Router)
// or pages/components/ComponentName.tsx (Pages Router)

interface ComponentNameProps {
  // Properly typed props
}

export function ComponentName({ prop1, prop2 }: ComponentNameProps) {
  // Use hooks: useState, useEffect, useContext, etc.
  // Return JSX with proper TypeScript types
  return <div>...</div>;
}

// For App Router, also consider Server Components
\`\`\`` : `
**React Component Structure:**
\`\`\`typescript
interface ComponentNameProps {
  // Properly typed props
}

export const ComponentName: React.FC<ComponentNameProps> = ({ prop1, prop2 }) => {
  // Use hooks: useState, useEffect, useContext, etc.
  const [state, setState] = useState<Type>(initialValue);
  
  useEffect(() => {
    // Effect logic
    return () => {
      // Cleanup
    };
  }, [dependencies]);
  
  return <div>...</div>;
};
\`\`\``,
            commonPatterns: [
                'Functional components with hooks',
                'Custom hooks for reusable logic (use prefix)',
                isNextJs ? 'Server and Client Components (use "use client" directive)' : 'Component composition',
                techStack.stateManagement ? `State management with ${techStack.stateManagement}` : 'Context API for state',
                isNextJs ? 'Data fetching with Server Components or SWR/React Query' : 'Data fetching with useEffect or React Query',
                techStack.uiLibrary ? `UI components from ${techStack.uiLibrary}` : 'Custom styled components'
            ]
        };
    }

    /**
     * Vue-specific configuration
     */
    private static getVueConfig(techStack: TechStackInfo): FrameworkConfig {
        const isVue3 = !techStack.version || techStack.version.startsWith('3');
        
        return {
            name: techStack.framework || 'Vue',
            fileExtensions: ['.vue', '.ts', '.js', '.spec.ts'],
            componentPattern: 'Single File Components (SFC)',
            testingFramework: techStack.testing || 'Vitest + Vue Test Utils',
            bestPractices: [
                isVue3 ? 'Use Composition API (setup script)' : 'Use Options API or Composition API',
                'Keep components small and focused',
                'Use computed properties for derived state',
                'Implement proper watchers with cleanup',
                'Use proper TypeScript types with defineComponent',
                'Follow Vue 3 best practices'
            ],
            codeStructure: isVue3 ? `
**Vue 3 Component Structure (Composition API):**
\`\`\`vue
<template>
  <div>...</div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';

// Define props and emits with TypeScript
interface Props {
  prop1: string;
}

const props = defineProps<Props>();
const emit = defineEmits<{
  (e: 'update', value: string): void;
}>();

// Reactive state
const state = ref<Type>(initialValue);

// Computed properties
const computedValue = computed(() => state.value * 2);

// Lifecycle hooks
onMounted(() => {
  // Initialization
});
</script>

<style scoped>
/* Component styles */
</style>
\`\`\`` : `
**Vue 2 Component Structure:**
\`\`\`vue
<template>
  <div>...</div>
</template>

<script lang="ts">
import { defineComponent } from 'vue';

export default defineComponent({
  props: {
    prop1: String
  },
  data() {
    return {
      state: initialValue
    };
  },
  computed: {
    computedValue(): Type {
      return this.state * 2;
    }
  },
  mounted() {
    // Initialization
  }
});
</script>
\`\`\``,
            commonPatterns: [
                isVue3 ? 'Composition API with <script setup>' : 'Options API',
                isVue3 ? 'Composables for reusable logic' : 'Mixins or Composition API',
                techStack.stateManagement ? `State management with ${techStack.stateManagement}` : 'Vuex or Pinia for state',
                'Single File Components (SFC)',
                'Scoped styles',
                'Props validation and TypeScript interfaces'
            ]
        };
    }

    /**
     * Node.js-specific configuration
     */
    private static getNodeJsConfig(techStack: TechStackInfo): FrameworkConfig {
        const isNestJs = techStack.framework === 'NestJS';
        
        return {
            name: techStack.framework || 'Node.js',
            fileExtensions: ['.ts', '.js', '.test.ts', '.spec.ts'],
            componentPattern: isNestJs ? 'Controllers/Services/Modules' : 'Routes/Controllers/Services',
            testingFramework: techStack.testing || 'Jest',
            bestPractices: [
                'Use TypeScript for type safety',
                'Implement proper error handling and logging',
                'Use environment variables for configuration',
                'Validate input data',
                'Implement proper authentication and authorization',
                'Use async/await over callbacks'
            ],
            codeStructure: isNestJs ? `
**NestJS Structure:**
\`\`\`typescript
// Controller
@Controller('resource')
export class ResourceController {
  constructor(private readonly service: ResourceService) {}
  
  @Get(':id')
  async findOne(@Param('id') id: string): Promise<ResourceDto> {
    return this.service.findOne(id);
  }
}

// Service
@Injectable()
export class ResourceService {
  async findOne(id: string): Promise<Resource> {
    // Business logic
  }
}
\`\`\`` : `
**Express/Node.js Structure:**
\`\`\`typescript
// Route
router.get('/resource/:id', async (req, res, next) => {
  try {
    const result = await resourceService.findOne(req.params.id);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// Service
export class ResourceService {
  async findOne(id: string): Promise<Resource> {
    // Business logic
  }
}
\`\`\``,
            commonPatterns: [
                isNestJs ? 'Dependency injection with decorators' : 'Service pattern',
                'Repository pattern for data access',
                'Middleware for cross-cutting concerns',
                'Error handling middleware',
                'Environment-based configuration',
                'API validation with DTOs'
            ]
        };
    }

    /**
     * Generic configuration for unknown frameworks
     */
    private static getGenericConfig(techStack: TechStackInfo): FrameworkConfig {
        return {
            name: techStack.primary || 'JavaScript/TypeScript',
            fileExtensions: ['.ts', '.js', '.tsx', '.jsx'],
            componentPattern: 'Module/Function pattern',
            testingFramework: 'Jest or similar',
            bestPractices: [
                'Use TypeScript for type safety',
                'Follow SOLID principles',
                'Write clean, maintainable code',
                'Implement proper error handling',
                'Add comprehensive tests',
                'Use async/await for asynchronous operations'
            ],
            codeStructure: `
**Generic TypeScript/JavaScript Structure:**
\`\`\`typescript
// Use proper types
interface DataType {
  // Define structure
}

export class ServiceName {
  async methodName(param: Type): Promise<ReturnType> {
    // Implementation
  }
}

// Or functional approach
export async function functionName(param: Type): Promise<ReturnType> {
  // Implementation
}
\`\`\``,
            commonPatterns: [
                'Module pattern',
                'Functional programming',
                'Promise-based async operations',
                'Proper error handling',
                'Type safety with TypeScript'
            ]
        };
    }

    /**
     * Build framework-specific mission section
     */
    static buildFrameworkMission(techStack: TechStackInfo, workItemType: string): string {
        const config = this.getFrameworkConfig(techStack);
        const isBug = ['Bug', 'Defect'].includes(workItemType);
        const isEpic = workItemType === 'Epic';

        return `
🎯 YOUR MISSION (${config.name}-specific):

${isBug ? `
**1. ANALYZE THE BUG:**
   - Review reproduction steps carefully
   - Understand the root cause
   - Identify affected ${config.componentPattern} files

**2. SEARCH EXISTING CODE:**
   - Use @workspace to locate relevant ${config.name} files
   - Check ${config.fileExtensions.join(', ')} files
   - Review similar patterns in codebase

**3. FIX THE BUG:**
   - Provide corrected code with explanations
   - Follow ${config.name} best practices
   - Maintain existing code style and patterns
   - Ensure backward compatibility

**4. TEST THE FIX:**
   - Update existing ${config.testingFramework} tests
   - Add new test cases for the bug scenario
   - Cover edge cases
` : isEpic ? `
**1. EPIC ANALYSIS:**
   - Break down epic into ${config.componentPattern}
   - Design architecture using ${config.name} patterns
   - Plan project structure
   - Identify reusable components/modules

**2. SEARCH EXISTING CODE:**
   - Use @workspace to find similar features
   - Identify integration points
   - Check existing patterns to extend

**3. ARCHITECTURE DESIGN:**
   - ${config.componentPattern} hierarchy
   - Data flow and state management${techStack.stateManagement ? ` (${techStack.stateManagement})` : ''}
   - API integration plan
   - Shared modules/components

**4. IMPLEMENTATION ROADMAP:**
   - Phase breakdown
   - File structure recommendations
   - Dependencies needed
   - Testing strategy with ${config.testingFramework}
` : `
**1. UNDERSTAND THE REQUIREMENT:**
   - Analyze the feature description
   - Review acceptance criteria carefully
   - Understand business logic needed

**2. SEARCH EXISTING CODE:**
   - Use @workspace to find similar features
   - Check for reusable ${config.componentPattern}
   - Review existing patterns to follow
   - Check project structure

**3. DESIGN THE SOLUTION:**
   - Plan ${config.componentPattern} architecture
   - Design data models and types
   - Plan API integration (if needed)
   - Consider validation needs

**4. IMPLEMENT THE FEATURE:**
   - Generate ${config.name} code following best practices
   - Create necessary ${config.fileExtensions.join(', ')} files
   - Implement business logic
   - Add proper error handling
   - Create loading/error states

**5. CREATE TESTS:**
   - Write ${config.testingFramework} tests
   - Test all acceptance criteria
   - Cover edge cases
   - Mock external dependencies
`}

═══════════════════════════════════════════

🛠️ ${config.name.toUpperCase()} TECH STACK:
${techStack.version ? `- **Version:** ${techStack.version}` : ''}
${techStack.framework ? `- **Framework:** ${techStack.framework}` : ''}
${techStack.testing ? `- **Testing:** ${techStack.testing}` : `- **Testing:** ${config.testingFramework}`}
${techStack.stateManagement ? `- **State Management:** ${techStack.stateManagement}` : ''}
${techStack.uiLibrary ? `- **UI Library:** ${techStack.uiLibrary}` : ''}

═══════════════════════════════════════════

⚠️ ${config.name.toUpperCase()} BEST PRACTICES:

${config.bestPractices.map(bp => `✓ ${bp}`).join('\n')}

═══════════════════════════════════════════

${config.codeStructure}

═══════════════════════════════════════════

🔍 ${config.name.toUpperCase()} PATTERNS TO USE:

${config.commonPatterns.map(pattern => `✓ ${pattern}`).join('\n')}
`;
    }
}
