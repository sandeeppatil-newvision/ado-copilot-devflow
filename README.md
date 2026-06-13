# Synapse Code

**Where Azure DevOps meets GitHub Copilot — intelligently. Turn work items into production-ready code, directly inside VS Code.**

> Built for the Microsoft Agents League Hackathon 2026

---

## Overview

Synapse Code is a VS Code extension that bridges Azure DevOps and GitHub Copilot. You point it at a work item (user story, bug, feature, epic), and it orchestrates a structured, multi-stage generation process that produces framework-correct, test-covered, production-quality code — directly inside your editor.

Instead of copy-pasting acceptance criteria into Copilot chat, this extension:

- Fetches the full work item context from ADO (title, description, acceptance criteria, test cases, attachments, discussion history)
- Analyzes your workspace to detect framework, patterns, conventions, and relevant files
- Selects an appropriate generation strategy based on task complexity
- Injects a structured, token-optimized prompt into GitHub Copilot chat
- Optionally orchestrates a 4-stage Analysis → Planning → Implementation → Verification pipeline with quality gates at each step

---

## Features

### Intelligent Strategy Selection

The extension scores work item complexity (0–10) across multiple dimensions and automatically picks the right approach:

| Strategy | Time | Best For | Approval Gates |
|----------|------|----------|----------------|
| RAPID | 1–2 min | Bug fixes, small tasks | 0 |
| BALANCED | 3–5 min | Features, enhancements | 1 (after plan) |
| THOROUGH | 5–10 min | Epics, complex features | 2 (strategic) |

Complexity factors: work item type, description length, acceptance criteria count, test case count, repro steps presence, number of relevant workspace files, and workspace confidence.

An **Intelligent Preview modal** appears before generation, showing the recommended strategy, confidence score, relevant files found, and tech stack — with the option to override the strategy before proceeding.

### Framework-Aware Code Generation

Auto-detects your tech stack and injects framework-specific best practices, patterns, and conventions into every prompt:

| Framework | Detection | Key Patterns Injected |
|-----------|-----------|-----------------------|
| Angular | `angular.json` + `@angular/core` | OnPush, RxJS, NgRx, signals |
| React | `react` dependency + variant detection | Functional components, hooks, Next.js/Remix/Gatsby, Redux/Zustand |
| Vue | `vue` dependency | Composition API, Pinia/Vuex, Vue Test Utils |
| Node.js | NestJS/Express/Fastify | Decorators, middleware, DI patterns |
| TypeScript | Fallback | Strict typing, interfaces, module patterns |

### Deep Workspace Context Analysis

Before generating, the extension analyzes your codebase:

- Scans `src/app` folder structure (up to 50 TypeScript files)
- Extracts interfaces, exports, types, and naming conventions
- Scores file relevance against work item keywords
- Detects code patterns (component structure, service patterns, imports)
- Extracts and injects relevant dependencies
- Caches results for 30 minutes with automatic invalidation on file changes (saves 300–500 tokens per run)

### Multi-Stage Orchestration

When enabled, generation runs through 4 validated stages:

```
Stage 1: Analysis       — @workspace search, relevance check, file identification
Stage 2: Planning       — File list, implementation steps, interface definitions, test plan
Stage 3: Implementation — Production code with tests, error handling, proper imports
Stage 4: Verification   — Quality checks across correctness, typing, testing, integration, performance, security
```

Each stage has:
- Token budget management
- Quality gate validation (blocks progression on failed checks)
- User approval checkpoints (configurable)
- Detailed logging to the ADO Copilot output channel
- Status bar progress updates

### Interactive Work Item Browser

A built-in panel lets you search, filter, and browse ADO work items with full metadata display — no need to leave VS Code or remember item IDs.

### Redesigned Settings Panel

The activity bar panel provides a streamlined UI with three sections:

1. **Generate Code** — Enter a Work Item ID and click **Generate Code**, or click **Browse Work Items** to open the interactive picker. Both buttons are disabled until you are connected.
2. **Azure DevOps Credentials** — Fill in Organization, Project, and PAT, then click **Connect**. Use **Test** to verify the connection without saving, **Reset** to discard unsaved edits, and **Disconnect** to clear stored credentials (with confirmation).
3. **Options** — Toggle **Enable Multi-Stage Generation** to switch between single-prompt and the full 4-stage pipeline.

### Secure Credential Management

Credentials are stored in the VS Code Secrets API (never in `settings.json`). The status bar shows live connection state, and the settings panel provides a rich UI for configuration and testing the connection. On first connect, credentials are automatically migrated from legacy settings to the secure store.

---

## Requirements

- VS Code 1.85.0 or later
- GitHub Copilot extension (installed and signed in)
- Azure DevOps account with a Personal Access Token (PAT)
  - Required scopes: **Work Items (Read)**

---

## Setup

### 1. Install the Extension

Build and install from source:

```bash
npm install
npm run compile
```

Then install the `.vsix` or open the folder in VS Code with the extension host.

### 2. Configure Credentials

**Option A — Activity Bar (recommended)**

Click the Synapse Code icon in the activity bar (left sidebar). Fill in:
- Azure DevOps Organization (e.g., `mycompany`)
- Project name
- Personal Access Token

Click **Connect**. The status bar updates to show your connection state.

**Option B — Command Palette**

Open the Command Palette (`Ctrl+Shift+P`) and run:
```
ADO Copilot: Configure Credentials
```

**Option C — Chat**

In GitHub Copilot chat, type:
```
@synapse /configure
```

### 3. (Optional) Set Repository Context

In the settings panel, set the **Repository Context** field to a brief description of your repo (e.g., `"Customer Portal Angular App"`). This helps the AI understand your workspace without re-analyzing files every time.

---

## Usage

### Generate Code from a Work Item

**From the Activity Bar**

1. Click the Synapse Code icon
2. Enter a Work Item ID and click **Generate Code**, or click **Browse Work Items** to search
3. Review the strategy recommendation in the Intelligent Preview modal
4. Optionally override the strategy (RAPID / BALANCED / THOROUGH)
5. Click **Continue** — Copilot chat opens with the structured prompt

**From the Command Palette**

```
ADO Copilot: Generate Code from Work Item
```

The Work Item Picker opens so you can search and select an item.

**From GitHub Copilot Chat**

```
@synapse 12345
```
or
```
@synapse /generate 12345
```

The `@synapse` chat participant fetches the work item, analyzes your workspace, and opens the full generation flow.

### Chat Commands

| Command | Description |
|---------|-------------|
| `@synapse /generate {id}` | Generate code for work item ID |
| `@synapse /configure` | Open credential configuration |
| `@synapse {id}` | Shorthand — generate directly from an ID |

---

## How It Works

```
Work Item ID
     │
     ▼
ADO REST API v7.0  ──────────────────────────────────────────────────────►
(title, description, acceptance criteria, test cases, attachments,         │
 discussion history)                                                        │
                                                                           │
Workspace Analysis (ContextAnalyzer)                                       │
(framework detection, pattern extraction, file relevance scoring)          │
                                                                           ▼
Strategy Selection (StrategySelector)
(complexity score → RAPID / BALANCED / THOROUGH)
                                                                           │
                                                                           ▼
Intelligent Preview Modal
(strategy, confidence, relevant files, tech stack, override option)
                                                                           │
                     ┌─────────────────────────────────────────────────────┘
                     │
            Multi-Stage Mode?
           /              \
          No               Yes
          │                │
          ▼                ▼
Token-Optimized Prompt   Orchestrator (4 stages)
→ GitHub Copilot Chat    Stage 1: Analysis
                         Stage 2: Planning  ← approval gate
                         Stage 3: Implementation
                         Stage 4: Verification ← quality gate
                              │
                              ▼
                        GitHub Copilot Chat
                        (auto-injected prompt, auto-submitted,
                         retried up to 3× with exponential back-off)
```

### Architecture Diagram

```mermaid
flowchart TD
    User(["👤 User"])

    subgraph EntryPoints["Entry Points"]
        CMD["⌨️ Command Palette\nadoCopilot.*"]
        CHAT["💬 @synapse\nChat Participant"]
        PANEL["🖥️ Settings Panel\nActivity Bar Webview"]
    end

    subgraph CredMgmt["Credential Management"]
        CM["🔐 CredentialManager\nVS Code Secrets API"]
        SB["📊 Status Bar\n$(azure) ADO Copilot"]
    end

    subgraph CoreFlow["Core Generation Flow"]
        PREWARM["🔥 Pre-warm Copilot Panel"]
        ADO["📡 ADO REST API v7.0\ngetWorkItem · getTestCases\n+expand=relations"]
        CA["🔍 ContextAnalyzer\nframework detection\nfile relevance scoring"]
        CC["💾 ContextCache\n30-min TTL + FileSystemWatcher"]
        SS["🎯 StrategySelector\nComplexity Score 0–10"]
        PREVIEW["📋 Intelligent Preview Modal\nstrategy · confidence · relevant files · override"]
    end

    subgraph SinglePath["Single-Prompt Path"]
        BP["📝 buildPrompt\nframework-aware · safety protocol"]
        FPB["🏗️ FrameworkPromptBuilder\nAngular · React · Vue · Node.js"]
    end

    subgraph MultiPath["Multi-Stage Path — Orchestrator"]
        S1["Stage 1\nAnalysis"]
        S2["Stage 2\nPlanning 🔒"]
        S3["Stage 3\nImplementation"]
        S4["Stage 4\nVerification 🔒"]
        TM["📊 TokenManager\nbudget tracking"]
        QG["✅ QualityGates\nscore 0–10 per stage"]
        S1 --> S2 --> S3 --> S4
    end

    ADOSVC(["☁️ Azure DevOps\ndev.azure.com"])
    GHCP(["🟢 GitHub Copilot\nExtension"])
    WIP["📋 WorkItemPicker\nWIQL search · filter · metadata"]
    COPILOT["🤖 GitHub Copilot Chat\nauto-inject · 3× retry with back-off"]

    User --> EntryPoints
    CMD & CHAT & PANEL --> CM
    CM <--> SB
    EntryPoints -->|"credentials OK"| PREWARM
    PREWARM --> ADO
    ADO <-->|"REST API v7.0"| ADOSVC
    ADO --> CA
    CA <--> CC
    CA --> SS
    SS --> PREVIEW
    PREVIEW -->|"multi-stage OFF"| SinglePath
    PREVIEW -->|"multi-stage ON"| MultiPath
    BP --> FPB
    SinglePath --> COPILOT
    S4 --> COPILOT
    TM & QG -.->|"supports"| MultiPath
    PANEL -->|"Browse Work Items"| WIP
    WIP <-->|"WIQL query"| ADOSVC
    WIP -->|"selected ID"| PREWARM
    COPILOT <-->|"workbench.action.chat.open"| GHCP
```

### Token Management

- **Estimation:** ~4 characters = 1 token
- **Stage budgets:** Analysis (1,000) · Planning (1,200) · Implementation (3,000) · Verification (800)
- **Optimization:** Prompt sections are prioritized (0 = critical); optional sections are dropped if budget is exceeded
- **Total per generation:** ~6,000 tokens across all stages

### Quality Gates

Each stage validates output before proceeding. Example checks:

| Stage | Gate Checks |
|-------|------------|
| Analysis | @workspace searched, relevance assessed, relevant files identified |
| Planning | File list present, implementation steps defined, tests planned, interfaces defined |
| Implementation | Code blocks present, no `any` types, tests included, error handling, proper imports |
| Verification | Correctness, strict typing, test coverage, integration, memory/performance, security |

---

## Extension Commands

| Command | Description |
|---------|-------------|
| `ADO Copilot: Generate Code from Work Item` | Main generation flow |
| `ADO Copilot: Configure Credentials` | Set up ADO credentials |
| `ADO Copilot: Open Settings` | Open the settings panel |
| `ADO Copilot: Clear Saved Credentials` | Remove stored credentials |

---

## Configuration

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `adoCopilot.repositoryContext` | string | `""` | Brief repo description to help AI understand context |
| `adoCopilot.useMultiStageGeneration` | boolean | `false` | Enable 4-stage Analysis → Planning → Implementation → Verification pipeline |

> The `adoCopilot.organization`, `adoCopilot.project`, and `adoCopilot.pat` settings are deprecated. Use the settings panel or `@synapse /configure` instead. Existing values are automatically migrated to the VS Code Secrets store on first use.

---

## Project Structure

```
src/
├── extension.ts          # Entry point — commands, chat participant (@synapse), settings webview, credential management
├── orchestrator.ts       # Multi-stage generation pipeline with token tracking and quality gates
├── context-analyzer.ts   # Workspace analysis — tech stack, patterns, relevance scoring, conventions
├── context-cache.ts      # 30-min TTL cache for workspace analysis with file-watcher invalidation
├── framework-prompts.ts  # Framework-specific prompt configs (Angular, React, Vue, Node.js)
├── prompt-templates.ts   # Stage prompt templates with token-aware section prioritization
├── strategy-selector.ts  # Complexity scoring algorithm → RAPID / BALANCED / THOROUGH
├── token-manager.ts      # Token budget tracking, estimation, and prompt optimization
├── quality-gates.ts      # Stage-level quality validation, scoring, and recommendations
└── work-item-picker.ts   # Interactive ADO work item browser with search and metadata display
resources/
├── activity-icon.svg     # Activity bar icon
└── chat-icon.svg         # Chat participant icon
```

---

## Development

```bash
# Install dependencies
npm install

# Compile TypeScript
npm run compile

# Watch mode
npm run watch
```

Open the project in VS Code and press `F5` to launch the Extension Development Host.

---

## Architecture Highlights

- **No custom chat UI** — generation is injected directly into GitHub Copilot chat, keeping the familiar interface and Copilot's full reasoning capability
- **Secrets API** — PAT tokens are never stored in `settings.json`; always encrypted via VS Code's native secrets store, with automatic migration from legacy settings
- **Chat panel pre-warming** — the Copilot chat panel is opened immediately when generation starts (before any async ADO/workspace work), giving it time to fully initialize and eliminating cold-start failures
- **Retry with back-off** — Copilot chat prompt injection retries up to 3 times (0 ms → 500 ms → 1,000 ms) with a plain-string fallback to handle edge cases
- **Intelligent Preview modal** — before any code is generated, users see the recommended strategy, confidence score, relevant files, and tech stack, with the ability to override the strategy
- **Prompt compression** — sections are sorted by priority and dropped gracefully when token budgets are exceeded, never truncating critical instructions mid-sentence
- **Cache invalidation** — a `FileSystemWatcher` monitors the workspace for changes and invalidates the context cache automatically, ensuring stale patterns are never injected
- **WIQL queries** — work item search uses the Azure DevOps Query Language for flexible, server-side filtering

---

## License

See [LICENSE](LICENSE).
