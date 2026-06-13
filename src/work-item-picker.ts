import * as vscode from "vscode";
import fetch from "node-fetch";

export interface WorkItem {
  id: string;
  title: string;
  type: string;
  state: string;
  assignedTo?: string;
  priority?: string;
  severity?: string;
}

export interface WorkItemPickerOptions {
  org: string;
  project: string;
  pat: string;
  context: vscode.ExtensionContext;
}

export class WorkItemPicker {
  private panel: vscode.WebviewPanel | undefined;

  constructor(private options: WorkItemPickerOptions) {}

  async show(): Promise<string | undefined> {
    return new Promise((resolve) => {
      this.panel = vscode.window.createWebviewPanel(
        "adoCopilot.workItemPicker",
        "Select Work Item",
        vscode.ViewColumn.Beside,
        {
          enableScripts: true,
          enableFindWidget: true,
          retainContextWhenHidden: true,
        },
      );

      this.panel.webview.html = this.getHtmlContent();

      let selectedId: string | undefined;

      this.panel.webview.onDidReceiveMessage(async (message) => {
        if (message.command === "search") {
          try {
            const workItems = await this.searchWorkItems(message.query);
            this.panel!.webview.postMessage({
              type: "searchResults",
              workItems,
            });
          } catch (error) {
            this.panel!.webview.postMessage({
              type: "error",
              message: error instanceof Error ? error.message : "Failed to load work items",
            });
          }
        } else if (message.command === "select") {
          selectedId = message.workItemId;
          this.panel?.dispose();
          resolve(selectedId);
        } else if (message.command === "cancel") {
          this.panel?.dispose();
          resolve(undefined);
        }
      });

      this.panel.onDidDispose(() => {
        resolve(selectedId);
      });
    });
  }

  private async searchWorkItems(query: string): Promise<WorkItem[]> {
    if (!query.trim()) {
      return this.fetchRecentWorkItems();
    }

    // Numeric ID — fetch directly, same pattern as getWorkItem() in extension.ts
    if (/^\d+$/.test(query.trim())) {
      return this.fetchWorkItemById(query.trim());
    }

    // Text search — use WIQL to get matching IDs, then bulk-fetch details
    const wiql = `Select [System.Id] From WorkItems Where [System.TeamProject] = '${this.options.project}' AND [System.Title] Contains '${query.trim().replace(/'/g, "''")}' ORDER BY [System.ChangedDate] DESC`;

    const wiqlResponse = await fetch(
      `https://dev.azure.com/${this.options.org}/${this.options.project}/_apis/wit/wiql?api-version=7.0`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Basic ${Buffer.from(`:${this.options.pat}`).toString("base64")}`,
        },
        body: JSON.stringify({ query: wiql, $top: 50 }),
      },
    );

    if (!wiqlResponse.ok) {
      const body = await wiqlResponse.text().catch(() => "");
      throw new Error(`Search failed (HTTP ${wiqlResponse.status})${body ? ": " + body.slice(0, 120) : ""}`);
    }

    const wiqlResult = (await wiqlResponse.json()) as { workItems?: Array<{ id: number }> };
    const ids = (wiqlResult.workItems ?? []).slice(0, 50).map((wi) => wi.id.toString());
    return this.fetchWorkItemDetails(ids);
  }

  // Fetch a single work item by ID — mirrors getWorkItem() in extension.ts exactly
  private async fetchWorkItemById(id: string): Promise<WorkItem[]> {
    const response = await fetch(
      `https://dev.azure.com/${this.options.org}/${this.options.project}/_apis/wit/workitems/${id}?api-version=7.0`,
      {
        headers: {
          Authorization: `Basic ${Buffer.from(`:${this.options.pat}`).toString("base64")}`,
        },
      },
    );

    if (!response.ok) {
      if (response.status === 404) return [];
      throw new Error(`Work item not found (HTTP ${response.status})`);
    }

    const item = (await response.json()) as any;
    return [this.mapWorkItem(item.id, item.fields)];
  }

  private async fetchRecentWorkItems(): Promise<WorkItem[]> {
    const wiql = `Select [System.Id] From WorkItems Where [System.TeamProject] = '${this.options.project}' ORDER BY [System.ChangedDate] DESC`;

    const response = await fetch(
      `https://dev.azure.com/${this.options.org}/${this.options.project}/_apis/wit/wiql?api-version=7.0`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Basic ${Buffer.from(`:${this.options.pat}`).toString("base64")}`,
        },
        body: JSON.stringify({ query: wiql, $top: 50 }),
      },
    );

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Failed to load recent work items (HTTP ${response.status})${body ? ": " + body.slice(0, 120) : ""}`);
    }

    const result = (await response.json()) as { workItems?: Array<{ id: number }> };
    const ids = (result.workItems ?? []).slice(0, 50).map((wi) => wi.id.toString());
    return this.fetchWorkItemDetails(ids);
  }

  // Bulk-fetch work item details — mirrors getTestCases() in extension.ts:
  // no `fields` filter, reads all fields, uses correct Microsoft.VSTS field names
  private async fetchWorkItemDetails(ids: string[]): Promise<WorkItem[]> {
    if (ids.length === 0) return [];

    const response = await fetch(
      `https://dev.azure.com/${this.options.org}/${this.options.project}/_apis/wit/workitems?ids=${ids.join(",")}&api-version=7.0`,
      {
        headers: {
          Authorization: `Basic ${Buffer.from(`:${this.options.pat}`).toString("base64")}`,
        },
      },
    );

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Failed to fetch work item details (HTTP ${response.status})${body ? ": " + body.slice(0, 120) : ""}`);
    }

    const result = (await response.json()) as { value: Array<any> };
    return (result.value ?? []).map((item) =>
      this.mapWorkItem(item.id, item.fields)
    );
  }

  // Single mapping function — uses the same field names as extension.ts
  private mapWorkItem(id: number, fields: any): WorkItem {
    return {
      id: id.toString(),
      title: fields["System.Title"] ?? "",
      type: fields["System.WorkItemType"] ?? "",
      state: fields["System.State"] ?? "",
      assignedTo: fields["System.AssignedTo"]?.displayName,
      priority: fields["Microsoft.VSTS.Common.Priority"]?.toString(),
      severity: fields["Microsoft.VSTS.Common.Severity"],
    };
  }

  private getHtmlContent(): string {
    return `
    <!DOCTYPE html>
    <html>
    <head>
        <style>
            * {
                margin: 0;
                padding: 0;
                box-sizing: border-box;
            }

            body {
                font-family: var(--vscode-font-family);
                font-size: var(--vscode-font-size);
                color: var(--vscode-foreground);
                background-color: var(--vscode-editor-background);
                padding: 16px;
            }

            .header {
                margin-bottom: 16px;
            }

            .header h1 {
                font-size: 18px;
                font-weight: 600;
                margin-bottom: 12px;
            }

            .search-container {
                display: flex;
                gap: 8px;
                margin-bottom: 16px;
            }

            #searchInput {
                flex: 1;
                padding: 8px 12px;
                background-color: var(--vscode-input-background);
                border: 1px solid var(--vscode-input-border);
                color: var(--vscode-input-foreground);
                border-radius: 4px;
                font-family: inherit;
                font-size: inherit;
            }

            #searchInput::placeholder {
                color: var(--vscode-input-placeholderForeground);
            }

            .button {
                padding: 8px 16px;
                background-color: var(--vscode-button-background);
                color: var(--vscode-button-foreground);
                border: none;
                border-radius: 4px;
                cursor: pointer;
                font-family: inherit;
                font-size: inherit;
                font-weight: 500;
            }

            .button:hover {
                background-color: var(--vscode-button-hoverBackground);
            }

            .button.cancel {
                background-color: var(--vscode-button-secondaryBackground);
                color: var(--vscode-button-secondaryForeground);
            }

            .button.cancel:hover {
                background-color: var(--vscode-button-secondaryHoverBackground);
            }

            .work-items-container {
                max-height: 600px;
                overflow-y: auto;
                border: 1px solid var(--vscode-input-border);
                border-radius: 4px;
            }

            .work-item {
                padding: 12px;
                border-bottom: 1px solid var(--vscode-input-border);
                cursor: pointer;
                transition: background-color 0.2s;
            }

            .work-item:last-child {
                border-bottom: none;
            }

            .work-item:hover {
                background-color: var(--vscode-list-hoverBackground);
            }

            .work-item.selected {
                background-color: var(--vscode-list-activeSelectionBackground);
                color: var(--vscode-list-activeSelectionForeground);
            }

            .work-item-id {
                font-size: 12px;
                color: var(--vscode-descriptionForeground);
                margin-bottom: 4px;
            }

            .work-item-title {
                font-weight: 500;
                margin-bottom: 6px;
            }

            .work-item-meta {
                display: flex;
                gap: 12px;
                font-size: 12px;
                color: var(--vscode-descriptionForeground);
                flex-wrap: wrap;
            }

            .badge {
                padding: 2px 6px;
                border-radius: 3px;
                background-color: var(--vscode-badge-background);
                color: var(--vscode-badge-foreground);
                font-size: 11px;
            }

            .state-badge {
                background-color: var(--vscode-statusBar-background);
            }

            .type-badge {
                background-color: var(--vscode-editorGroupHeader-tabsBorder);
            }

            .loading {
                text-align: center;
                padding: 24px;
                color: var(--vscode-descriptionForeground);
            }

            .error {
                padding: 12px;
                background-color: var(--vscode-editorError-background);
                color: var(--vscode-editorError-foreground);
                border-radius: 4px;
                margin-bottom: 12px;
            }

            .empty {
                text-align: center;
                padding: 24px;
                color: var(--vscode-descriptionForeground);
            }

            .action-buttons {
                display: flex;
                gap: 8px;
                justify-content: flex-end;
                margin-top: 16px;
            }
        </style>
    </head>
    <body>
        <div class="header">
            <h1>📋 Select Work Item to Generate Code</h1>
            <p style="font-size: 12px; color: var(--vscode-descriptionForeground);">
                Recent items shown below • Search to find more
            </p>
        </div>

        <div class="search-container">
            <input
                type="text"
                id="searchInput"
                placeholder="Search by title or work item ID..."
                autocomplete="off"
            />
            <button class="button" id="searchBtn">🔍 Search</button>
        </div>

        <div id="errorContainer"></div>

        <div class="work-items-container" id="workItemsContainer">
            <div class="loading">Loading work items...</div>
        </div>

        <div class="action-buttons">
            <button class="button cancel" id="cancelBtn">Cancel</button>
            <button class="button" id="generateBtn" disabled>Generate Code</button>
        </div>

        <script>
            let workItems = [];
            let selectedWorkItem = null;

            const vscode = acquireVsCodeApi();
            const searchInput = document.getElementById('searchInput');
            const searchBtn = document.getElementById('searchBtn');
            const generateBtn = document.getElementById('generateBtn');
            const cancelBtn = document.getElementById('cancelBtn');
            const container = document.getElementById('workItemsContainer');
            const errorContainer = document.getElementById('errorContainer');

            searchBtn.addEventListener('click', () => {
                const query = searchInput.value.trim();
                vscode.postMessage({ command: 'search', query });
                container.innerHTML = '<div class="loading">Searching...</div>';
            });

            searchInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    searchBtn.click();
                }
            });

            generateBtn.addEventListener('click', () => {
                if (selectedWorkItem) {
                    vscode.postMessage({
                        command: 'select',
                        workItemId: selectedWorkItem.id,
                    });
                }
            });

            cancelBtn.addEventListener('click', () => {
                vscode.postMessage({ command: 'cancel' });
            });

            window.addEventListener('message', (event) => {
                const message = event.data;

                if (message.type === 'initialData' || message.type === 'searchResults') {
                    workItems = message.workItems;
                    renderWorkItems();
                } else if (message.type === 'error') {
                    errorContainer.innerHTML = \`<div class="error">❌ \${message.message}</div>\`;
                    container.innerHTML = '<div class="empty">Failed to load work items</div>';
                }
            });

            function renderWorkItems() {
                errorContainer.innerHTML = '';

                if (workItems.length === 0) {
                    container.innerHTML = '<div class="empty">📭 No work items found</div>';
                    return;
                }

                container.innerHTML = workItems
                    .map(
                        (item) => \`
                    <div class="work-item" data-id="\${item.id}">
                        <div class="work-item-id">#\${item.id}</div>
                        <div class="work-item-title">\${escapeHtml(item.title)}</div>
                        <div class="work-item-meta">
                            <span class="badge type-badge">\${item.type}</span>
                            <span class="badge state-badge">\${item.state}</span>
                            \${item.priority ? \`<span class="badge">P\${item.priority}</span>\` : ''}
                            \${item.assignedTo ? \`<span>👤 \${escapeHtml(item.assignedTo)}</span>\` : ''}
                        </div>
                    </div>
                \`
                    )
                    .join('');

                document.querySelectorAll('.work-item').forEach((element) => {
                    element.addEventListener('click', () => {
                        document.querySelectorAll('.work-item').forEach((e) => {
                            e.classList.remove('selected');
                        });
                        element.classList.add('selected');
                        selectedWorkItem = workItems.find(
                            (w) => w.id === element.dataset.id
                        );
                        generateBtn.disabled = !selectedWorkItem;
                    });
                });
            }

            function escapeHtml(text) {
                const div = document.createElement('div');
                div.textContent = text;
                return div.innerHTML;
            }

            // Load initial data
            vscode.postMessage({ command: 'search', query: '' });
        </script>
    </body>
    </html>
    `;
  }
}
