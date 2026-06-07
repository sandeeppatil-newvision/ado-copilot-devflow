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
          const workItems = await this.searchWorkItems(message.query);
          this.panel!.webview.postMessage({
            type: "searchResults",
            workItems,
          });
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

      // Load initial work items (last modified)
      this.loadRecentWorkItems();
    });
  }

  private async loadRecentWorkItems() {
    try {
      const workItems = await this.fetchRecentWorkItems();
      this.panel?.webview.postMessage({
        type: "initialData",
        workItems,
      });
    } catch (error) {
      this.panel?.webview.postMessage({
        type: "error",
        message:
          error instanceof Error ? error.message : "Failed to load work items",
      });
    }
  }

  private async searchWorkItems(query: string): Promise<WorkItem[]> {
    if (!query.trim()) {
      return this.fetchRecentWorkItems();
    }

    try {
      const wiql = `Select [System.Id], [System.Title], [System.WorkItemType], [System.State], [System.AssignedTo], [System.Priority], [System.Severity] From WorkItems Where [System.TeamProject] = '${this.options.project}' AND ([System.Title] CONTAINS '${query}' OR [System.Id] = ${
        /^\d+$/.test(query) ? query : "-1"
      }) ORDER BY [System.Id] DESC`;

      const response = await fetch(
        `https://dev.azure.com/${this.options.org}/${this.options.project}/_apis/wit/wiql?api-version=7.0`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Basic ${Buffer.from(
              `:${this.options.pat}`,
            ).toString("base64")}`,
          },
          body: JSON.stringify({ query: wiql }),
        },
      );

      if (!response.ok) {
        throw new Error("Failed to search work items");
      }

      const result = (await response.json()) as {
        workItems: Array<{ id: number }>;
      };
      const ids = result.workItems.map((wi) => wi.id.toString());

      return this.fetchWorkItemDetails(ids);
    } catch (error) {
      console.error("Search error:", error);
      return [];
    }
  }

  private async fetchRecentWorkItems(): Promise<WorkItem[]> {
    try {
      const wiql = `Select [System.Id], [System.Title], [System.WorkItemType], [System.State], [System.AssignedTo], [System.Priority], [System.Severity] From WorkItems Where [System.TeamProject] = '${this.options.project}' ORDER BY [System.ChangedDate] DESC`;

      const response = await fetch(
        `https://dev.azure.com/${this.options.org}/${this.options.project}/_apis/wit/wiql?api-version=7.0`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Basic ${Buffer.from(
              `:${this.options.pat}`,
            ).toString("base64")}`,
          },
          body: JSON.stringify({ query: wiql }),
        },
      );

      if (!response.ok) {
        throw new Error("Failed to fetch recent work items");
      }

      const result = (await response.json()) as {
        workItems: Array<{ id: number }>;
      };
      const ids = result.workItems.slice(0, 20).map((wi) => wi.id.toString());

      return this.fetchWorkItemDetails(ids);
    } catch (error) {
      console.error("Fetch error:", error);
      throw error;
    }
  }

  private async fetchWorkItemDetails(ids: string[]): Promise<WorkItem[]> {
    if (ids.length === 0) return [];

    try {
      const idsParam = ids.join(",");
      const response = await fetch(
        `https://dev.azure.com/${this.options.org}/${this.options.project}/_apis/wit/workitems?ids=${idsParam}&fields=System.Id,System.Title,System.WorkItemType,System.State,System.AssignedTo,System.Priority,System.Severity&api-version=7.0`,
        {
          headers: {
            Authorization: `Basic ${Buffer.from(
              `:${this.options.pat}`,
            ).toString("base64")}`,
          },
        },
      );

      if (!response.ok) {
        throw new Error("Failed to fetch work item details");
      }

      const result = (await response.json()) as {
        value: Array<{
          id: number;
          fields: {
            "System.Title": string;
            "System.WorkItemType": string;
            "System.State": string;
            "System.AssignedTo"?: { displayName: string };
            "System.Priority"?: number;
            "System.Severity"?: string;
          };
        }>;
      };

      return result.value.map((item) => ({
        id: item.id.toString(),
        title: item.fields["System.Title"],
        type: item.fields["System.WorkItemType"],
        state: item.fields["System.State"],
        assignedTo: item.fields["System.AssignedTo"]?.displayName,
        priority: item.fields["System.Priority"]?.toString(),
        severity: item.fields["System.Severity"],
      }));
    } catch (error) {
      console.error("Detail fetch error:", error);
      throw error;
    }
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
