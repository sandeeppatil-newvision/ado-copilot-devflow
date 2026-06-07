import * as vscode from "vscode";
import fetch from "node-fetch";
import { CodeGenerationOrchestrator } from "./orchestrator";
import { WorkItemData } from "./prompt-templates";
import {
  StrategySelector,
  Strategy,
  StrategyRecommendation,
} from "./strategy-selector";
import { ContextAnalyzer } from "./context-analyzer";
import { FrameworkPromptBuilder } from "./framework-prompts";
import { WorkItemPicker } from "./work-item-picker";

// Create output channel for logging
export const outputChannel = vscode.window.createOutputChannel("ADO Copilot");

// Create analyzer and selector instances
const contextAnalyzer = new ContextAnalyzer();
const strategySelector = new StrategySelector();

// Track whether the chat panel has been opened in this session.
// On first open VS Code needs extra time to fully initialize the panel.
let chatPanelInitialized = false;

// Credential Manager using VS Code Secrets API
class CredentialManager {
  public static readonly ORG_KEY = "adoCopilot.organization";
  public static readonly PROJECT_KEY = "adoCopilot.project";
  public static readonly PAT_KEY = "adoCopilot.pat";

  constructor(private context: vscode.ExtensionContext) {}

  async getCredentials(): Promise<{
    org: string;
    project: string;
    pat: string;
  } | null> {
    // First try secrets API (new method)
    const org = await this.context.secrets.get(CredentialManager.ORG_KEY);
    const project = await this.context.secrets.get(
      CredentialManager.PROJECT_KEY,
    );
    const pat = await this.context.secrets.get(CredentialManager.PAT_KEY);

    if (org && project && pat) {
      return { org, project, pat };
    }

    // Fallback to settings (legacy method for backward compatibility)
    const config = vscode.workspace.getConfiguration("adoCopilot");
    const settingsOrg = config.get<string>("organization");
    const settingsProject = config.get<string>("project");
    const settingsPat = config.get<string>("pat");

    if (settingsOrg && settingsProject && settingsPat) {
      // Migrate to secrets
      await this.saveCredentials(settingsOrg, settingsProject, settingsPat);
      return { org: settingsOrg, project: settingsProject, pat: settingsPat };
    }

    return null;
  }

  async saveCredentials(
    org: string,
    project: string,
    pat: string,
  ): Promise<void> {
    await this.context.secrets.store(CredentialManager.ORG_KEY, org);
    await this.context.secrets.store(CredentialManager.PROJECT_KEY, project);
    await this.context.secrets.store(CredentialManager.PAT_KEY, pat);
  }

  async clearCredentials(): Promise<void> {
    await this.context.secrets.delete(CredentialManager.ORG_KEY);
    await this.context.secrets.delete(CredentialManager.PROJECT_KEY);
    await this.context.secrets.delete(CredentialManager.PAT_KEY);
  }

  async promptForCredentials(): Promise<{
    org: string;
    project: string;
    pat: string;
  } | null> {
    const org = await vscode.window.showInputBox({
      prompt: "Enter your Azure DevOps Organization",
      placeHolder: "e.g., mycompany",
      ignoreFocusOut: true,
    });
    if (!org) return null;

    const project = await vscode.window.showInputBox({
      prompt: "Enter your Azure DevOps Project",
      placeHolder: "e.g., MyProject",
      ignoreFocusOut: true,
    });
    if (!project) return null;

    const pat = await vscode.window.showInputBox({
      prompt: "Enter your Azure DevOps Personal Access Token (PAT)",
      placeHolder: "Your PAT token (will be stored securely)",
      password: true,
      ignoreFocusOut: true,
    });
    if (!pat) return null;

    await this.saveCredentials(org, project, pat);
    vscode.window.showInformationMessage("✅ Credentials saved securely!");

    return { org, project, pat };
  }
}

// Chat Participant Handler
async function handleChatRequest(
  request: vscode.ChatRequest,
  context: vscode.ChatContext,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken,
  credentialManager: CredentialManager,
): Promise<void> {
  // Parse command
  const command = request.command;
  const userMessage = request.prompt.trim();

  try {
    // Handle /configure command
    if (command === "configure") {
      stream.markdown("🔧 **Configuring ADO Credentials**\n\n");
      stream.markdown(
        "Please enter your Azure DevOps details in the prompts...\n\n",
      );

      const credentials = await credentialManager.promptForCredentials();
      if (credentials) {
        stream.markdown("✅ Credentials saved successfully!\n\n");
        stream.markdown(`Organization: \`${credentials.org}\`\n`);
        stream.markdown(`Project: \`${credentials.project}\`\n`);
        stream.markdown(
          "\nYou can now use `@ado <work-item-id>` to generate code!\n",
        );
      } else {
        stream.markdown("❌ Configuration cancelled.\n");
      }
      return;
    }

    // Handle /generate or direct work item ID
    let workItemId: string | undefined;

    if (command === "generate") {
      // Extract work item ID from prompt
      const match = userMessage.match(/\b(\d+)\b/);
      workItemId = match ? match[1] : undefined;
    } else if (/^\d+$/.test(userMessage)) {
      // Direct work item ID
      workItemId = userMessage;
    } else {
      // Try to extract work item ID from natural language
      const match = userMessage.match(/\b(\d{4,})\b/);
      workItemId = match ? match[1] : undefined;
    }

    if (!workItemId) {
      stream.markdown("❌ **No work item ID found**\n\n");
      stream.markdown("Please provide a work item ID. Examples:\n");
      stream.markdown("- `@ado 12345`\n");
      stream.markdown("- `@ado /generate 12345`\n");
      stream.markdown("- `@ado generate code for work item 12345`\n");
      return;
    }

    // Get credentials
    let credentials = await credentialManager.getCredentials();

    if (!credentials) {
      stream.markdown("⚠️ **No credentials configured**\n\n");
      stream.markdown("Setting up credentials...\n\n");
      credentials = await credentialManager.promptForCredentials();

      if (!credentials) {
        stream.markdown(
          "❌ Configuration cancelled. Please run `@ado /configure` to set up credentials.\n",
        );
        return;
      }
    }

    // Show progress
    stream.markdown(`🔄 **Fetching ADO Work Item ${workItemId}**\n\n`);
    stream.progress("Connecting to Azure DevOps...");

    // Call existing generation logic
    await generateCodeFromChat(
      workItemId,
      credentials.org,
      credentials.project,
      credentials.pat,
      stream,
      token,
    );
  } catch (error) {
    stream.markdown(
      `❌ **Error:** ${error instanceof Error ? error.message : "Unknown error"}\n`,
    );
  }
}

// Settings Webview Provider
class SettingsViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "adoCopilot.settingsView";

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly credentialManager: CredentialManager,
    private readonly onGenerateWorkItem: (workItemId?: string) => Promise<void>,
    private readonly onConnectionChanged?: () => Promise<void>,
  ) {}

  public async resolveWebviewView(webviewView: vscode.WebviewView) {
    webviewView.webview.options = {
      enableScripts: true,
    };

    const getState = async () => {
      const org =
        (await this.context.secrets.get(CredentialManager.ORG_KEY)) || "";
      const project =
        (await this.context.secrets.get(CredentialManager.PROJECT_KEY)) || "";
      const pat = (await this.context.secrets.get(CredentialManager.PAT_KEY))
        ? "••••••••"
        : "";
      const config = vscode.workspace.getConfiguration("adoCopilot");
      const useMulti = config.get<boolean>("useMultiStageGeneration", false);
      const repoContext = config.get<string>("repositoryContext", "");
      return { org, project, pat, useMulti, repoContext };
    };

    const state = await getState();

    webviewView.webview.html = this.getHtmlForWebview(state);

    webviewView.webview.onDidReceiveMessage(async (msg) => {
      try {
        if (msg.command === "save") {
          const { org, project, pat, repoContext } = msg.payload;
          await this.credentialManager.saveCredentials(org, project, pat);
          const config = vscode.workspace.getConfiguration("adoCopilot");
          if (repoContext !== undefined) {
            await config.update(
              "repositoryContext",
              repoContext,
              vscode.ConfigurationTarget.Workspace,
            );
          }
          vscode.window.showInformationMessage(
            "✅ Connected to ADO board securely!",
          );
          // Notify the webview via postMessage so it can update the DOM in-place.
          // Replacing webview.html destroys the JS context, which breaks vscode
          // postMessage round-trips on subsequent operations.
          webviewView.webview.postMessage({ type: "connected", payload: { org, project } });
          if (this.onConnectionChanged) await this.onConnectionChanged();
        } else if (msg.command === "disconnect") {
          // window.confirm() is blocked in WebViews; show the modal from the extension host
          const choice = await vscode.window.showWarningMessage(
            "Disconnect from ADO board and clear all saved credentials?",
            { modal: true },
            "Disconnect",
          );
          if (choice === "Disconnect") {
            await this.credentialManager.clearCredentials();
            vscode.window.showInformationMessage("✅ Disconnected from ADO board");
            webviewView.webview.postMessage({ type: "disconnected" });
            if (this.onConnectionChanged) await this.onConnectionChanged();
          } else {
            webviewView.webview.postMessage({ type: "disconnectCancelled" });
          }
        } else if (msg.command === "clear") {
          await this.credentialManager.clearCredentials();
          vscode.window.showInformationMessage("✅ Disconnected from ADO board");
          webviewView.webview.postMessage({ type: "disconnected" });
          if (this.onConnectionChanged) await this.onConnectionChanged();
        } else if (msg.command === "test") {
          const { org, project } = msg.payload;
          // When already connected the PAT field is blank; fall back to the
          // value stored in VS Code secrets so the user doesn't have to retype it.
          const pat: string =
            msg.payload.pat ||
            (await this.context.secrets.get(CredentialManager.PAT_KEY)) ||
            "";
          if (!pat) {
            webviewView.webview.postMessage({ type: "testFailed" });
          } else {
            try {
              const response = await fetch(
                `https://dev.azure.com/${org}/_apis/projects/${project}?api-version=7.0`,
                {
                  headers: {
                    Authorization: `Basic ${Buffer.from(`:${pat}`).toString("base64")}`,
                  },
                },
              );
              if (response.ok) {
                webviewView.webview.postMessage({ type: "testSuccess" });
              } else {
                webviewView.webview.postMessage({ type: "testFailed" });
              }
            } catch {
              webviewView.webview.postMessage({ type: "testFailed" });
            }
          }
        } else if (msg.command === "toggleMulti") {
          const val = !!msg.payload;
          const config = vscode.workspace.getConfiguration("adoCopilot");
          await config.update(
            "useMultiStageGeneration",
            val,
            vscode.ConfigurationTarget.Workspace,
          );
          webviewView.webview.postMessage({ type: "multiToggled", payload: val });
        } else if (msg.command === "reset") {
          // Send current stored state so the webview can restore field values
          // without a full HTML re-render.
          const s = await getState();
          webviewView.webview.postMessage({
            type: "stateReset",
            payload: {
              org: s.org,
              project: s.project,
              repoContext: s.repoContext,
              isConnected: !!(s.org && s.project && s.pat),
            },
          });
        } else if (msg.command === "generate") {
          // User clicked "Generate Code" with a specific work item ID
          const workItemId: string | undefined = msg.payload?.workItemId?.trim() || undefined;
          await this.onGenerateWorkItem(workItemId);
        } else if (msg.command === "openPicker") {
          // User clicked "Browse Work Items" — open the picker (no pre-set ID)
          await this.onGenerateWorkItem(undefined);
        }
      } catch (err) {
        console.error(err);
        vscode.window.showErrorMessage("Error handling settings action");
      }
    });
  }

  private getHtmlForWebview(state: {
    org: string;
    project: string;
    pat: string;
    useMulti: boolean;
    repoContext: string;
  }) {
    const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    const isConfigured = !!(state.org && state.project && state.pat);

    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:var(--vscode-font-family);font-size:var(--vscode-font-size);color:var(--vscode-foreground);background:var(--vscode-editor-background);padding:12px;line-height:1.5}
    .banner{padding:10px 12px;border-radius:6px;margin-bottom:14px;font-size:12px;font-weight:600}
    .banner.ok{background:rgba(0,200,83,.15);border:1px solid rgba(0,200,83,.35);color:#00c853}
    .banner.warn{background:rgba(255,193,7,.15);border:1px solid rgba(255,193,7,.35);color:#ffc107}
    .section{margin-bottom:16px}
    .section-title{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:var(--vscode-descriptionForeground);margin-bottom:8px}
    .form-group{margin-bottom:8px}
    label{font-size:11px;font-weight:600;display:block;margin-bottom:3px}
    .hint{font-size:10px;color:var(--vscode-descriptionForeground);margin-top:2px}
    input[type=text],input[type=password],textarea{width:100%;padding:6px 10px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border);color:var(--vscode-input-foreground);border-radius:4px;font-family:inherit;font-size:12px;resize:vertical}
    input:focus,textarea:focus{outline:none;border-color:var(--vscode-focusBorder);box-shadow:0 0 0 1px var(--vscode-focusBorder)}
    input::placeholder,textarea::placeholder{color:var(--vscode-input-placeholderForeground)}
    .btn-row{display:flex;gap:6px;margin-top:10px;flex-wrap:wrap}
    button{flex:1;min-width:80px;padding:7px 10px;border:none;border-radius:4px;font-family:inherit;font-size:12px;font-weight:600;cursor:pointer;background:var(--vscode-button-background);color:var(--vscode-button-foreground)}
    button:hover{background:var(--vscode-button-hoverBackground)}
    button.sec{background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground)}
    button.sec:hover{background:var(--vscode-button-secondaryHoverBackground)}
    button.danger{background:rgba(244,67,54,.2);color:#f44336;border:1px solid rgba(244,67,54,.3)}
    button:disabled{opacity:.45;cursor:default}
    .generate-box{background:var(--vscode-textBlockQuote-background);border:1px solid var(--vscode-textBlockQuote-border);border-radius:6px;padding:12px;margin-bottom:16px}
    .generate-box .title{font-size:13px;font-weight:700;margin-bottom:10px}
    .generate-box input{margin-bottom:8px}
    .divider{height:1px;background:var(--vscode-input-border);margin:14px 0}
    .checkbox-row{display:flex;align-items:center;gap:8px;padding:8px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border);border-radius:4px}
    .checkbox-row label{font-size:12px;font-weight:500;margin:0;cursor:pointer}
    .msg{padding:8px 10px;border-radius:4px;margin-bottom:10px;font-size:11px;display:none}
    .msg.ok{display:block;background:rgba(0,200,83,.12);border:1px solid rgba(0,200,83,.3);color:#00c853}
    .msg.err{display:block;background:rgba(244,67,54,.12);border:1px solid rgba(244,67,54,.3);color:#f44336}
    .steps{font-size:11px;color:var(--vscode-descriptionForeground);padding-left:14px;margin-top:6px}
    .steps li{margin-bottom:3px}
  </style>
</head>
<body>

  <!-- Status banner -->
  <div class="banner ${isConfigured ? "ok" : "warn"}">
    ${isConfigured
      ? `✅ Connected — ${esc(state.org)} / ${esc(state.project)}`
      : "⚠️ Not configured — fill in your credentials below"}
  </div>

  <div id="msgBox" class="msg"></div>

  <!-- ── SECTION 1: Generate Code (primary action) ── -->
  <div class="generate-box">
    <div class="title">🚀 Generate Code from Work Item</div>
    <div class="form-group">
      <label for="workItemId">Work Item ID</label>
      <input id="workItemId" type="text" placeholder="e.g. 12345" ${!isConfigured ? "disabled" : ""}/>
    </div>
    <div class="btn-row">
      <button id="generateBtn" ${!isConfigured ? "disabled" : ""}>⚡ Generate Code</button>
      <button id="browseBtn" class="sec" ${!isConfigured ? "disabled" : ""}>📋 Browse Work Items</button>
    </div>
    <p id="connectHint" style="font-size:11px;color:var(--vscode-descriptionForeground);margin-top:8px;display:${!isConfigured ? "block" : "none"}">Connect your credentials below to enable code generation.</p>
  </div>

  <div class="divider"></div>

  <!-- ── SECTION 2: Configuration ── -->
  <div class="section">
    <div class="section-title">🔑 Azure DevOps Credentials</div>

    <div class="form-group">
      <label for="org">Organization</label>
      <input id="org" type="text" placeholder="e.g. mycompany" value="${esc(state.org)}"/>
    </div>
    <div class="form-group">
      <label for="project">Project</label>
      <input id="project" type="text" placeholder="e.g. MyProject" value="${esc(state.project)}"/>
    </div>
    <div class="form-group">
      <label for="pat">Personal Access Token</label>
      <input id="pat" type="password" placeholder="${state.pat ? "••••••••  (leave blank to keep existing)" : "Paste your PAT here"}"/>
      <div class="hint">Stored securely in VS Code Secret Storage</div>
    </div>
    <details id="patGuide" style="margin-top:6px;display:${!isConfigured ? "block" : "none"}">
      <summary style="font-size:11px;cursor:pointer;color:var(--vscode-descriptionForeground)">How to get a PAT?</summary>
      <ul class="steps">
        <li>Go to dev.azure.com → Your Profile → Personal access tokens</li>
        <li>Click "New Token", name it "ADO Copilot"</li>
        <li>Grant "Work Items (Read)" scope at minimum</li>
        <li>Copy and paste the token above</li>
      </ul>
    </details>

    <div class="form-group" style="margin-top:10px">
      <label for="repoCtx">Repository Context <span style="font-weight:400">(optional)</span></label>
      <input id="repoCtx" type="text" placeholder="e.g. Customer Portal Angular App" value="${esc(state.repoContext)}"/>
      <div class="hint">Helps AI understand what this repo does</div>
    </div>

    <div class="btn-row">
      <button id="connectBtn" ${isConfigured ? "disabled" : ""}>🔌 Connect</button>
      <button id="disconnectBtn" class="danger" ${!isConfigured ? "disabled" : ""}>⏏ Disconnect</button>
      <button id="testBtn" class="sec">🔗 Test</button>
      <button id="resetBtn" class="sec">↺ Reset</button>
    </div>
  </div>

  <div class="divider"></div>

  <!-- ── SECTION 3: Options ── -->
  <div class="section">
    <div class="section-title">⚙️ Options</div>
    <div class="checkbox-row">
      <input id="multi" type="checkbox" ${state.useMulti ? "checked" : ""}/>
      <label for="multi">Enable Multi-Stage Generation</label>
    </div>
    <div class="hint" style="margin-top:4px">Analysis → Planning → Implementation → Verification</div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    const msgBox = document.getElementById('msgBox');

    function showMsg(text, type) {
      msgBox.textContent = text;
      msgBox.className = 'msg ' + (type === 'error' ? 'err' : 'ok');
      setTimeout(() => { msgBox.className = 'msg'; }, 4000);
    }

    // Generate with explicit ID
    document.getElementById('generateBtn').addEventListener('click', () => {
      const id = document.getElementById('workItemId').value.trim();
      if (!id) { showMsg('❌ Please enter a Work Item ID', 'error'); return; }
      vscode.postMessage({ command: 'generate', payload: { workItemId: id } });
    });

    // Browse work items
    document.getElementById('browseBtn').addEventListener('click', () => {
      vscode.postMessage({ command: 'openPicker' });
    });

    // Also allow Enter key in workItemId input
    document.getElementById('workItemId').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') document.getElementById('generateBtn').click();
    });

    // Connection state — server-rendered initial values, kept in sync on connect/disconnect
    let isConnected = ${isConfigured};
    // Tracks whether a valid PAT is currently stored in VS Code secrets.
    // Must stay in sync with isConnected so canConnect never accepts a blank PAT
    // after the user has disconnected (the server-rendered ${isConfigured} is stale then).
    let patStoredInSecrets = ${isConfigured};
    let _operating = false;
    let _opTimeout = null;

    function setButtons(operating) {
      _operating = operating;
      if (_opTimeout) { clearTimeout(_opTimeout); _opTimeout = null; }
      if (operating) {
        // Safety net: re-enable buttons if no extension response arrives within 10 s
        _opTimeout = setTimeout(() => { _operating = false; setButtons(false); showMsg('⚠️ Operation timed out', 'error'); }, 10000);
      }
      const org = document.getElementById('org').value.trim();
      const project = document.getElementById('project').value.trim();
      const pat = document.getElementById('pat').value.trim();
      // Allow blank PAT only when a stored PAT already exists (update flow); after
      // disconnect patStoredInSecrets is false so a fresh PAT is always required.
      const canConnect = !isConnected && org && project && (pat || patStoredInSecrets);
      const connectBtn = document.getElementById('connectBtn');
      const disconnectBtn = document.getElementById('disconnectBtn');
      const testBtn = document.getElementById('testBtn');
      const resetBtn = document.getElementById('resetBtn');
      connectBtn.disabled = operating || isConnected || !canConnect;
      connectBtn.textContent = (operating && !isConnected) ? '⏳ Connecting…' : '🔌 Connect';
      disconnectBtn.disabled = operating || !isConnected;
      disconnectBtn.textContent = (operating && isConnected) ? '⏳ Disconnecting…' : '⏏ Disconnect';
      testBtn.disabled = operating;
      resetBtn.disabled = operating;
    }

    // Re-evaluate Connect button state as credential inputs change
    ['org', 'project', 'pat'].forEach(function(id) {
      document.getElementById(id).addEventListener('input', function() { setButtons(false); });
    });

    // Connect — establish ADO board connection using existing save logic
    document.getElementById('connectBtn').addEventListener('click', () => {
      const org = document.getElementById('org').value.trim();
      const project = document.getElementById('project').value.trim();
      const pat = document.getElementById('pat').value.trim();
      const repoContext = document.getElementById('repoCtx').value.trim();
      if (!org || !project) { showMsg('❌ Organization and Project are required', 'error'); return; }
      if (!pat && !patStoredInSecrets) { showMsg('❌ PAT is required', 'error'); return; }
      setButtons(true);
      vscode.postMessage({ command: 'save', payload: { org, project, pat, repoContext } });
    });

    // Disconnect — VS Code WebViews do not support window.confirm(), so confirmation
    // is delegated to the extension host via showWarningMessage. The 'disconnect'
    // command triggers the modal there; the result comes back as 'cleared' or
    // 'disconnectCancelled'.
    document.getElementById('disconnectBtn').addEventListener('click', () => {
      setButtons(true);
      vscode.postMessage({ command: 'disconnect' });
    });

    // Test connection.
    // When connected, the PAT field is empty (only a placeholder is shown) but
    // a PAT is already stored in VS Code secrets. Sending an empty pat is fine —
    // the extension host will substitute the stored PAT automatically.
    document.getElementById('testBtn').addEventListener('click', () => {
      const org = document.getElementById('org').value.trim();
      const project = document.getElementById('project').value.trim();
      const pat = document.getElementById('pat').value.trim();
      // Require explicit PAT only when none is stored yet
      if (!org || !project || (!pat && !patStoredInSecrets)) {
        showMsg('❌ Fill in Organization, Project, and PAT first', 'error');
        return;
      }
      showMsg('🔄 Testing connection…', 'ok');
      vscode.postMessage({ command: 'test', payload: { org, project, pat } });
    });

    // Reset — asks the extension host to re-render the webview from the current
    // secrets state, discarding any unsaved field edits. Uses the same reliable
    // HTML-push pattern as save/disconnect instead of location.reload().
    document.getElementById('resetBtn').addEventListener('click', () => {
      vscode.postMessage({ command: 'reset' });
    });

    // Multi-stage toggle
    document.getElementById('multi').addEventListener('change', (e) => {
      vscode.postMessage({ command: 'toggleMulti', payload: e.target.checked });
    });

    // ── Helpers for DOM updates (used by message handlers below) ────────────
    function setGenerateSection(enabled) {
      ['workItemId', 'generateBtn', 'browseBtn'].forEach(function(id) {
        var el = document.getElementById(id);
        if (el) el.disabled = !enabled;
      });
      var hint = document.getElementById('connectHint');
      if (hint) hint.style.display = enabled ? 'none' : 'block';
    }

    function setPatPlaceholder(hasPat) {
      var patEl = document.getElementById('pat');
      if (patEl) patEl.placeholder = hasPat ? '••••••••  (leave blank to keep existing)' : 'Paste your PAT here';
    }

    function updateBanner(connected, org, project) {
      var banner = document.querySelector('.banner');
      if (!banner) return;
      if (connected) {
        banner.className = 'banner ok';
        banner.textContent = '✅ Connected — ' + org + ' / ' + project;
      } else {
        banner.className = 'banner warn';
        banner.textContent = '⚠️ Not configured — fill in your credentials below';
      }
    }

    // Messages from extension host ──────────────────────────────────────────
    window.addEventListener('message', (event) => {
      const msg = event.data;

      if (msg.type === 'connected') {
        // Credentials saved — transition UI to connected state
        isConnected = true;
        patStoredInSecrets = true;
        updateBanner(true, msg.payload.org, msg.payload.project);
        setGenerateSection(true);
        setPatPlaceholder(true);
        var guide = document.getElementById('patGuide');
        if (guide) guide.style.display = 'none';
        setButtons(false);
        showMsg('✅ Connected successfully!', 'ok');

      } else if (msg.type === 'disconnected') {
        // Credentials cleared — transition UI to disconnected state
        isConnected = false;
        patStoredInSecrets = false;
        updateBanner(false, '', '');
        setGenerateSection(false);
        setPatPlaceholder(false);
        var guide = document.getElementById('patGuide');
        if (guide) guide.style.display = 'block';
        // Wipe all credential fields so previous values cannot be reused
        ['org', 'project', 'pat', 'repoCtx'].forEach(function(id) {
          var el = document.getElementById(id);
          if (el) el.value = '';
        });
        setButtons(false);
        showMsg('✅ Disconnected successfully', 'ok');

      } else if (msg.type === 'stateReset') {
        // Reset — restore fields to last stored values
        document.getElementById('org').value = msg.payload.org;
        document.getElementById('project').value = msg.payload.project;
        document.getElementById('pat').value = ''; // never expose raw PAT
        document.getElementById('repoCtx').value = msg.payload.repoContext;
        isConnected = msg.payload.isConnected;
        patStoredInSecrets = msg.payload.isConnected;
        setPatPlaceholder(msg.payload.isConnected);
        setButtons(false);
        showMsg('↺ Form reset to saved values', 'ok');

      } else if (msg.type === 'disconnectCancelled') {
        // User dismissed the VS Code confirmation dialog — restore button states
        setButtons(false);

      } else if (msg.type === 'testSuccess') {
        showMsg('✅ Connection successful!', 'ok');
      } else if (msg.type === 'testFailed') {
        showMsg('❌ Connection failed — check credentials', 'error');
      }
    });

    // Initialise button states from current field values on page load
    setButtons(false);
  </script>
</body>
</html>`;
  }
}

// Generate code from chat interface
async function generateCodeFromChat(
  workItemId: string,
  org: string,
  project: string,
  pat: string,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken,
): Promise<void> {
  try {
    // Fetch work item
    const workItem = await getWorkItem(org, project, pat, workItemId);

    const workItemType = workItem.fields["System.WorkItemType"] || "User Story";
    const title = workItem.fields["System.Title"] || "";
    const description = cleanHtml(workItem.fields["System.Description"] || "");
    const ac = cleanHtml(
      workItem.fields["Microsoft.VSTS.Common.AcceptanceCriteria"] || "",
    );
    const priority = workItem.fields["Microsoft.VSTS.Common.Priority"] || "";
    const severity = workItem.fields["Microsoft.VSTS.Common.Severity"] || "";
    const reproSteps = cleanHtml(
      workItem.fields["Microsoft.VSTS.TCM.ReproSteps"] || "",
    );
    const rootCause = cleanHtml(
      workItem.fields["Microsoft.VSTS.Common.RootCause"] || "",
    );
    const resolution = cleanHtml(
      workItem.fields["Microsoft.VSTS.Common.Resolution"] || "",
    );

    stream.markdown(`✅ **Found:** ${workItemType} - ${title}\n\n`);
    stream.progress("Analyzing workspace...");

    // Analyze workspace with work item description
    const contextSummary = await contextAnalyzer.analyzeWorkspace(description);

    stream.markdown(
      `🔍 **Tech Stack Detected:** ${contextSummary.techStack.primary}${contextSummary.techStack.version ? " " + contextSummary.techStack.version : ""}${contextSummary.techStack.framework ? " (" + contextSummary.techStack.framework + ")" : ""}\n\n`,
    );
    stream.progress("Fetching test cases...");

    // Fetch test cases and attachments
    const testCaseIds = extractTestCaseIds(workItem);
    const testCases = await getTestCases(org, project, pat, testCaseIds);
    const attachments = extractAttachments(workItem);

    stream.progress("Selecting strategy...");

    // Build work item data for strategy selection
    const workItemData: WorkItemData = {
      id: workItemId,
      workItemType,
      title,
      description,
      ac,
      priority,
      severity,
      reproSteps,
      rootCause,
      resolution,
      discussion: "",
      testCases,
      attachments,
    };

    // Select strategy with both workItem and context
    const strategyRec = strategySelector.select(workItemData, contextSummary);

    stream.markdown(`🎯 **Recommended Strategy:** ${strategyRec.strategy}\n`);
    stream.markdown(
      `⭐ **Confidence:** ${Math.round(strategyRec.confidence * 100)}%\n`,
    );
    stream.markdown(`⏱️ **Estimated Time:** ${strategyRec.estimatedTime}\n`);
    stream.markdown(
      `💰 **Estimated Tokens:** ~${strategyRec.estimatedTokens}\n\n`,
    );

    if (strategyRec.reasoning && strategyRec.reasoning.length > 0) {
      stream.markdown(`**Why ${strategyRec.strategy}?**\n`);
      strategyRec.reasoning.forEach((r) => stream.markdown(`- ${r}\n`));
      stream.markdown("\n");
    }

    // Get workspace context
    const workspaceContext = await getWorkspaceContext();

    // Build prompt
    const prompt = buildPrompt({
      ...workItemData,
      workspaceContext,
      selectedStrategy: strategyRec.strategy,
      techStack: contextSummary.techStack,
    });

    stream.progress("Opening Copilot chat...");
    stream.markdown(
      "🚀 **Opening GitHub Copilot chat with your prompt...**\n\n",
    );

    // Open Copilot chat with prompt
    await openCopilotChatWithPrompt(prompt);

    stream.markdown(
      "✅ **Prompt sent successfully!** GitHub Copilot is now generating your code.\n",
    );
  } catch (error) {
    throw error;
  }
}

// Core generate flow — shared by the command, the settings panel, and the chat participant
async function runGenerateFlow(
  workItemId: string,
  credentials: { org: string; project: string; pat: string },
): Promise<void> {
  // Pre-warm the Copilot chat panel immediately, before any async work.
  // The ADO fetch + workspace analysis + user reading the preview modal gives
  // the panel 10+ seconds to initialize, guaranteeing it is ready when
  // openCopilotChatWithPrompt eventually fires.
  if (!chatPanelInitialized) {
    vscode.commands.executeCommand("workbench.action.chat.open").then(undefined, () => {});
  }

  vscode.window.showInformationMessage(`🔄 Fetching ADO Work Item ${workItemId}...`);

  const workItem = await getWorkItem(credentials.org, credentials.project, credentials.pat, workItemId);

  const workItemType = workItem.fields["System.WorkItemType"] || "User Story";
  const title = workItem.fields["System.Title"] || "";
  const description = cleanHtml(workItem.fields["System.Description"] || "");
  const ac = cleanHtml(workItem.fields["Microsoft.VSTS.Common.AcceptanceCriteria"] || "");
  const priority = workItem.fields["Microsoft.VSTS.Common.Priority"] || "";
  const severity = workItem.fields["Microsoft.VSTS.Common.Severity"] || "";
  const reproSteps = cleanHtml(workItem.fields["Microsoft.VSTS.TCM.ReproSteps"] || "");
  const rootCause = cleanHtml(workItem.fields["Microsoft.VSTS.Common.RootCause"] || "");
  const resolution = cleanHtml(workItem.fields["Microsoft.VSTS.Common.Resolution"] || "");
  const discussion = cleanHtml(workItem.fields["System.History"] || "");

  const testCaseIds = extractTestCaseIds(workItem);
  const testCases = await getTestCases(credentials.org, credentials.project, credentials.pat, testCaseIds);
  const attachments = extractAttachments(workItem);
  const workspaceContext = await getWorkspaceContext();

  outputChannel.appendLine("\n🔍 Analyzing workspace and determining optimal strategy...");

  const workItemData: WorkItemData = {
    id: workItemId, workItemType, title, description, ac, priority, severity,
    reproSteps, rootCause, resolution, discussion,
    testCases: testCases.map((tc: any) => ({ id: tc.id, title: tc.title, steps: undefined })),
    attachments,
  };

  let contextSummary: any;
  let strategyRec: any;
  try {
    contextSummary = await contextAnalyzer.analyzeWorkspace(description);
    strategyRec = strategySelector.select(workItemData, contextSummary);
    outputChannel.appendLine(`✓ Strategy: ${strategyRec.strategy} (${Math.round(strategyRec.confidence * 100)}% confidence)`);
  } catch {
    strategyRec = { strategy: "BALANCED" as Strategy, confidence: 0.7, reasoning: ["Default strategy"], estimatedTime: "3-5 minutes", estimatedTokens: 4000 };
  }

  const techStackSummary = contextSummary
    ? `${contextSummary.techStack.primary}${contextSummary.techStack.version ? " " + contextSummary.techStack.version : ""}${contextSummary.techStack.framework ? " (" + contextSummary.techStack.framework + ")" : ""}`
    : undefined;

  const previewResult = await showIntelligentPreview({
    id: workItemId, workItemType, title, description,
    testCasesCount: testCases.length, attachmentsCount: attachments.length,
    workspaceContext, strategy: strategyRec,
    relevantFiles: contextSummary?.relevantFiles.map((f: any) => f.path) || [],
    techStackInfo: techStackSummary,
  });

  if (!previewResult.continue) {
    vscode.window.showInformationMessage("❌ Cancelled by user");
    return;
  }

  const selectedStrategy = previewResult.strategyOverride || strategyRec.strategy;
  const useMultiStage = vscode.workspace.getConfiguration("adoCopilot").get<boolean>("useMultiStageGeneration", false);

  if (useMultiStage) {
    outputChannel.appendLine("🚀 MULTI-STAGE MODE ENABLED");
    vscode.window.showInformationMessage("🚀 Starting multi-stage code generation...");
    // Pass the shared openCopilotChatWithPrompt so the orchestrator uses the same
    // chatPanelInitialized flag — avoids the 200ms cold-start race in its own copy.
    const orchestrator = new CodeGenerationOrchestrator(openCopilotChatWithPrompt);
    try {
      await orchestrator.start(workItemData);
    } finally {
      orchestrator.dispose();
    }
    return;
  }

  outputChannel.appendLine(`📝 ${selectedStrategy} STRATEGY MODE`);
  vscode.window.showInformationMessage(`✅ Using ${selectedStrategy} strategy...`);

  const prompt = buildPrompt({
    id: workItemId, workItemType, title, description, ac, priority, severity,
    reproSteps, rootCause, resolution, discussion, testCases, attachments,
    workspaceContext, selectedStrategy, techStack: contextSummary?.techStack,
  });

  vscode.window.showInformationMessage("✅ Opening Copilot with safety instructions...");
  try {
    await openCopilotChatWithPrompt(prompt);
    outputChannel.appendLine("✅ Successfully opened GitHub Copilot chat");
  } catch (chatError: any) {
    vscode.window.showErrorMessage(`❌ Failed to open GitHub Copilot chat: ${chatError.message}`);
  }
}

export async function activate(context: vscode.ExtensionContext) {
  console.log("🔥 ADO Copilot Extension Activated");
  outputChannel.appendLine("🔥 ADO Copilot Extension Activated");

  // Create credential manager early so closures below can reference it
  const credentialManager = new CredentialManager(context);

  const disposable = vscode.commands.registerCommand(
    "adoCopilot.generateCode",
    async () => {
      try {
        let credentials = await credentialManager.getCredentials();
        if (!credentials) {
          const choice = await vscode.window.showInformationMessage(
            "🔐 ADO credentials not configured. Set them up now?",
            "Yes, Configure", "Cancel",
          );
          if (choice !== "Yes, Configure") return;
          credentials = await credentialManager.promptForCredentials();
          if (!credentials) return;
          await updateStatusBar();
        }

        const picker = new WorkItemPicker({
          org: credentials.org, project: credentials.project,
          pat: credentials.pat, context,
        });
        const workItemId = await picker.show();
        if (!workItemId) return;

        await runGenerateFlow(workItemId, credentials);
      } catch (error: any) {
        outputChannel.appendLine(`❌ Error: ${error.message}`);
        vscode.window.showErrorMessage(`❌ Error: ${error.message}`);
      }
    },
  );

  // Status bar item — shown in the bottom bar next to GitHub Copilot / Go Live
  const statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    99,
  );
  statusBarItem.command = "adoCopilot.openSettings";
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  async function updateStatusBar(): Promise<void> {
    const creds = await credentialManager.getCredentials();
    if (creds) {
      statusBarItem.text = "$(azure) ADO Copilot";
      statusBarItem.tooltip = `ADO Copilot — ${creds.org}/${creds.project} (click to open settings)`;
      statusBarItem.backgroundColor = undefined;
    } else {
      statusBarItem.text = "$(warning) ADO Setup";
      statusBarItem.tooltip =
        "ADO Copilot — credentials not configured (click to set up)";
      statusBarItem.backgroundColor = new vscode.ThemeColor(
        "statusBarItem.warningBackground",
      );
    }
  }

  await updateStatusBar();

  // Register configure command
  const configureCommand = vscode.commands.registerCommand(
    "adoCopilot.configure",
    async () => {
      const credentials = await credentialManager.promptForCredentials();
      if (credentials) {
        vscode.window.showInformationMessage(
          `✅ ADO credentials configured for ${credentials.org}/${credentials.project}`,
        );
        await updateStatusBar();
      }
    },
  );

  // Register clear credentials command
  const clearCommand = vscode.commands.registerCommand(
    "adoCopilot.clearCredentials",
    async () => {
      await credentialManager.clearCredentials();
      vscode.window.showInformationMessage("✅ ADO credentials cleared");
      await updateStatusBar();
    },
  );

  // Register chat participant
  const chatParticipant = vscode.chat.createChatParticipant(
    "adocopilot.assistant",
    async (request, context, stream, token) => {
      await handleChatRequest(
        request,
        context,
        stream,
        token,
        credentialManager,
      );
    },
  );

  chatParticipant.iconPath = vscode.Uri.file(
    context.asAbsolutePath("resources/activity-icon.svg"),
  );

  // Register settings webview provider and open-settings command
  const settingsProvider = new SettingsViewProvider(
    context,
    credentialManager,
    async (workItemId?: string) => {
      try {
        const creds = await credentialManager.getCredentials();
        if (!creds) {
          vscode.window.showErrorMessage("❌ Please save your credentials first.");
          return;
        }
        let resolvedId = workItemId;
        if (!resolvedId) {
          const picker = new WorkItemPicker({
            org: creds.org, project: creds.project, pat: creds.pat, context,
          });
          resolvedId = await picker.show();
        }
        if (!resolvedId) return;
        await runGenerateFlow(resolvedId, creds);
      } catch (err: any) {
        vscode.window.showErrorMessage(`❌ ${err.message}`);
      }
    },
    updateStatusBar,
  );
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      SettingsViewProvider.viewType,
      settingsProvider,
    ),
  );

  const openSettingsCommand = vscode.commands.registerCommand(
    "adoCopilot.openSettings",
    async () => {
      // Reveal the activity bar container
      try {
        await vscode.commands.executeCommand(
          "workbench.view.extension.adoCopilot",
        );
      } catch (err) {
        // Fallback: try to focus the view directly
        await vscode.commands.executeCommand(
          "workbench.action.openView",
          "adoCopilot.settingsView",
        );
      }
    },
  );
  context.subscriptions.push(openSettingsCommand);

  context.subscriptions.push(disposable);
  context.subscriptions.push(configureCommand);
  context.subscriptions.push(clearCommand);
  context.subscriptions.push(chatParticipant);
  context.subscriptions.push(outputChannel);

  // Cleanup on deactivation
  context.subscriptions.push({
    dispose: () => contextAnalyzer.dispose(),
  });
}

// 🔗 Fetch Work Item
async function getWorkItem(
  org: string,
  project: string,
  pat: string,
  id: string,
) {
  const url = `https://dev.azure.com/${org}/${project}/_apis/wit/workitems/${id}?api-version=7.0&$expand=relations`;

  const response = await fetch(url, {
    headers: {
      Authorization: "Basic " + Buffer.from(`:${pat}`).toString("base64"),
    },
  });

  if (!response.ok) {
    throw new Error("Failed to fetch work item");
  }

  return await response.json();
}

// 🔗 Extract Test Case IDs
function extractTestCaseIds(workItem: any): string[] {
  const relations = workItem.relations || [];

  return relations
    .filter((rel: any) => rel.rel.includes("TestedBy"))
    .map((rel: any) => rel.url.split("/").pop());
}

// 🔗 Extract Attachments
function extractAttachments(workItem: any): any[] {
  const relations = workItem.relations || [];
  return relations
    .filter((rel: any) => rel.rel === "AttachedFile")
    .map((rel: any) => ({
      name: rel.attributes?.name || "Attachment",
      url: rel.url,
    }));
}

// � Get Workspace Context
async function getWorkspaceContext(): Promise<string> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    return "⚠️ No workspace opened";
  }

  const rootPath = workspaceFolders[0].uri.fsPath;
  const workspaceName = workspaceFolders[0].name;

  // Get optional repository context from settings
  const config = vscode.workspace.getConfiguration("adoCopilot");
  const repoContext = config.get<string>("repositoryContext");

  // Try to detect project type dynamically
  const packageJsonUri = vscode.Uri.joinPath(
    workspaceFolders[0].uri,
    "package.json",
  );

  let projectInfo = `Workspace: ${workspaceName}\nPath: ${rootPath}\n`;

  if (repoContext && repoContext.trim() !== "") {
    projectInfo += `Repository Context: ${repoContext}\n`;
  }

  try {
    const packageJsonExists = await vscode.workspace.fs
      .stat(packageJsonUri)
      .then(
        () => true,
        () => false,
      );

    if (packageJsonExists) {
      const packageJsonContent =
        await vscode.workspace.fs.readFile(packageJsonUri);
      const packageJson = JSON.parse(packageJsonContent.toString());
      const deps = {
        ...packageJson.dependencies,
        ...packageJson.devDependencies,
      };

      // Detect framework dynamically
      if (deps["@angular/core"]) {
        projectInfo += "✅ Angular project detected\n";
        projectInfo += `Angular Version: ${deps["@angular/core"]}\n`;
      } else if (deps["react"]) {
        projectInfo += "✅ React project detected\n";
        projectInfo += `React Version: ${deps["react"]}\n`;
        if (deps["next"]) projectInfo += "Framework: Next.js\n";
        else if (deps["gatsby"]) projectInfo += "Framework: Gatsby\n";
        else if (deps["@remix-run/react"]) projectInfo += "Framework: Remix\n";
      } else if (deps["vue"]) {
        projectInfo += "✅ Vue project detected\n";
        projectInfo += `Vue Version: ${deps["vue"]}\n`;
        if (deps["nuxt"]) projectInfo += "Framework: Nuxt\n";
      } else if (deps["express"] || deps["fastify"] || deps["@nestjs/core"]) {
        projectInfo += "✅ Node.js backend detected\n";
        if (deps["@nestjs/core"]) projectInfo += "Framework: NestJS\n";
        else if (deps["express"]) projectInfo += "Framework: Express\n";
      } else {
        projectInfo += "⚠️ JavaScript/TypeScript project\n";
      }

      // Detect testing framework
      if (deps["jest"]) projectInfo += "Testing: Jest\n";
      else if (deps["vitest"]) projectInfo += "Testing: Vitest\n";
      else if (deps["jasmine-core"]) projectInfo += "Testing: Jasmine/Karma\n";

      // Detect state management
      if (deps["@ngrx/store"]) projectInfo += "State: NgRx\n";
      else if (deps["redux"]) projectInfo += "State: Redux\n";
      else if (deps["mobx"]) projectInfo += "State: MobX\n";
      else if (deps["zustand"]) projectInfo += "State: Zustand\n";
    } else {
      projectInfo += "❌ WARNING: package.json not found\n";
    }
  } catch (error) {
    projectInfo += "⚠️ Could not detect project type\n";
  }

  return projectInfo;
}

// ⭐ NEW: Show Intelligent Preview with Strategy Recommendation
async function showIntelligentPreview(data: {
  id: string;
  workItemType: string;
  title: string;
  description: string;
  testCasesCount: number;
  attachmentsCount: number;
  workspaceContext: string;
  strategy: StrategyRecommendation;
  relevantFiles: string[];
  techStackInfo?: string; // NEW: Tech stack summary
}): Promise<{ continue: boolean; strategyOverride?: Strategy }> {
  const confidenceStars = "★".repeat(Math.round(data.strategy.confidence * 5));
  const confidencePercent = Math.round(data.strategy.confidence * 100);

  const strategyEmoji = {
    RAPID: "⚡",
    BALANCED: "⚖️",
    THOROUGH: "🔍",
  }[data.strategy.strategy];

  const preview = `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 WORK ITEM PREVIEW
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🆔 ID: ${data.id}
📌 Type: ${data.workItemType}
📝 Title: ${data.title}

${data.description ? `📖 Description Preview:\n${data.description.substring(0, 150)}${data.description.length > 150 ? "..." : ""}\n\n` : ""}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎯 RECOMMENDED STRATEGY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

${strategyEmoji} Strategy: ${data.strategy.strategy}
⭐ Confidence: ${confidenceStars} ${confidencePercent}%
⏱️ Est. Time: ${data.strategy.estimatedTime}
💰 Est. Tokens: ~${data.strategy.estimatedTokens} (~$${(data.strategy.estimatedTokens * 0.00002).toFixed(3)})

📋 Why ${data.strategy.strategy}?
${data.strategy.reasoning.map((r) => `   • ${r}`).join("\n")}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📂 WORKSPACE ANALYSIS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

${data.workspaceContext}
${data.techStackInfo ? `\n🔧 Detected Stack: ${data.techStackInfo}\n` : ""}
${
  data.relevantFiles.length > 0
    ? `
🎯 Relevant Files Found:
${data.relevantFiles
  .slice(0, 5)
  .map((f) => `   ✓ ${f}`)
  .join("\n")}
${data.relevantFiles.length > 5 ? `   ... and ${data.relevantFiles.length - 5} more` : ""}
`
    : "⚠️  No relevant files found - will create new files"
}

📊 Test Cases: ${data.testCasesCount}
📎 Attachments: ${data.attachmentsCount}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚙️ GENERATION OPTIONS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

You can change the strategy if needed:

⚡ RAPID (1-2 min) - Single prompt, auto-validate
⚖️ BALANCED (3-5 min) - Plan + implement, 1 approval
🔍 THOROUGH (5-10 min) - Full cycle, 2 approvals

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    `.trim();

  // Show modal with strategy options
  const result = await vscode.window.showInformationMessage(
    preview,
    { modal: true },
    {
      title: `✅ Continue with ${data.strategy.strategy}`,
      isCloseAffordance: false,
    } as vscode.MessageItem,
    {
      title: "⚡ Use RAPID instead",
      isCloseAffordance: false,
    } as vscode.MessageItem,
    {
      title: "⚖️ Use BALANCED instead",
      isCloseAffordance: false,
    } as vscode.MessageItem,
    {
      title: "🔍 Use THOROUGH instead",
      isCloseAffordance: false,
    } as vscode.MessageItem,
    {
      title: "Cancel",
      isCloseAffordance: true,
    } as vscode.MessageItem,
  );

  if (!result || result.title === "Cancel") {
    return { continue: false };
  }

  // Parse user choice
  let strategyOverride: Strategy | undefined;
  if (result.title.includes("RAPID")) strategyOverride = "RAPID";
  else if (result.title.includes("BALANCED")) strategyOverride = "BALANCED";
  else if (result.title.includes("THOROUGH")) strategyOverride = "THOROUGH";

  return {
    continue: true,
    strategyOverride,
  };
}

// 📋 Show Work Item Preview and Get Confirmation
async function showWorkItemPreview(data: any): Promise<boolean> {
  const preview = `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 WORK ITEM PREVIEW
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🆔 ID: ${data.id}
📌 Type: ${data.workItemType}
📝 Title: ${data.title}

${data.description ? `📖 Description Preview:\n${data.description.substring(0, 200)}${data.description.length > 200 ? "..." : ""}\n\n` : ""}
📊 Test Cases: ${data.testCasesCount}
📎 Attachments: ${data.attachmentsCount}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔍 CURRENT WORKSPACE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

${data.workspaceContext}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚠️  SAFETY NOTICE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

The AI will:
✓ Analyze your workspace FIRST
✓ Ask clarifying questions if needed
✓ NOT modify files without your approval
✓ Search for existing patterns before suggesting code

⚠️  Ensure this work item is relevant to your current workspace!

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    `;

  const continueAction: vscode.MessageItem = { title: "✅ Continue" };
  const cancelAction: vscode.MessageItem = {
    title: "Cancel",
    isCloseAffordance: true,
  };

  const result = await vscode.window.showInformationMessage(
    preview,
    { modal: true },
    continueAction,
    cancelAction,
  );

  return result === continueAction;
}

// �🔗 Fetch Test Cases
async function getTestCases(
  org: string,
  project: string,
  pat: string,
  ids: string[],
) {
  if (ids.length === 0) return [];

  const idsParam = ids.join(",");

  const url = `https://dev.azure.com/${org}/${project}/_apis/wit/workitems?ids=${idsParam}&api-version=7.0`;

  const response = await fetch(url, {
    headers: {
      Authorization: "Basic " + Buffer.from(`:${pat}`).toString("base64"),
    },
  });

  if (!response.ok) {
    return [];
  }

  const data = await response.json();

  return data.value.map((tc: any) => ({
    id: tc.id,
    title: tc.fields["System.Title"],
  }));
}

// 🧠 Build AI Prompt - Universal for All Work Item Types (Framework-Aware)
function buildPrompt(data: any): string {
  const workItemType = data.workItemType || "User Story";

  // Categorize work item types
  const isBugOrDefect = ["Bug", "Defect"].includes(workItemType);
  const isEpic = workItemType === "Epic";
  const isTask = workItemType === "Task";
  const isStory = [
    "User Story",
    "Enabler Story",
    "Product Backlog Item",
    "Dual Maintenance Work Item",
  ].includes(workItemType);

  // Format sections
  const testCasesText = formatTestCases(data.testCases);
  const reproStepsText = data.reproSteps
    ? `\n🔁 REPRODUCTION STEPS:\n${data.reproSteps}\n`
    : "";
  const rootCauseText = data.rootCause
    ? `\n⚠️ ROOT CAUSE:\n${data.rootCause}\n`
    : "";
  const resolutionText = data.resolution
    ? `\n✅ PROPOSED RESOLUTION:\n${data.resolution}\n`
    : "";
  const discussionText = data.discussion
    ? `\n💬 DISCUSSION:\n${data.discussion}\n`
    : "";
  const attachmentsText = formatAttachments(data.attachments);

  // Detect framework and generate framework-specific mission
  let frameworkMission = "";
  let frameworkName = "JavaScript/TypeScript";
  if (data.techStack) {
    frameworkMission = FrameworkPromptBuilder.buildFrameworkMission(
      data.techStack,
      workItemType,
    );
    frameworkName = data.techStack.primary || frameworkName;
  }

  return `
You are a senior ${frameworkName} developer working on an enterprise application. Analyze the work item below and provide a complete solution.

${isBugOrDefect ? "🐛" : isEpic ? "🏔️" : isTask ? "📋" : "✨"} ${workItemType.toUpperCase()}: #${data.id}

📌 Title: ${data.title}
${data.priority ? `📌 Priority: ${data.priority}` : ""}
${data.severity ? `📌 Severity: ${data.severity}` : ""}

═══════════════════════════════════════════

📖 DESCRIPTION:
${data.description || "No description provided"}
${reproStepsText}
═══════════════════════════════════════════

✅ ACCEPTANCE CRITERIA:
${data.ac || "No acceptance criteria provided"}
${rootCauseText}${resolutionText}${discussionText}
═══════════════════════════════════════════

🧪 TEST CASES:
${testCasesText}

═══════════════════════════════════════════

📎 ATTACHMENTS/SCREENSHOTS:
${attachmentsText}

═══════════════════════════════════════════

� CURRENT WORKSPACE CONTEXT:
${data.workspaceContext || "Workspace information not available"}

⚠️  VERIFY: Does this work item relate to the workspace above?

═══════════════════════════════════════════

🛡️ SAFETY PROTOCOL - MANDATORY:

⛔ **CRITICAL: READ-ONLY ANALYSIS FIRST**
   1. You MUST start by analyzing @workspace
   2. You MUST verify if this work item is relevant to this codebase
   3. You MUST ask the user to confirm if you're unsure about relevance
   4. You MUST NOT suggest file modifications without understanding the codebase
   5. You MUST NOT hallucinate code that doesn't fit the existing patterns

⛔ **BEFORE ANY CODE GENERATION:**
   - Search @workspace for related files and patterns
   - Verify the tech stack matches (Angular, not React/Vue/other)
   - Check if similar features already exist
   - Ask: "Is this work item for THIS repository?"
   - If unsure or no matches found, ASK questions instead of guessing

⛔ **PROHIBITED ACTIONS:**
   - ❌ DO NOT modify files without explicitly finding them in @workspace
   - ❌ DO NOT create new features without verifying folder structure
   - ❌ DO NOT assume file paths - always search first
   - ❌ DO NOT generate code if the work item seems unrelated
   - ❌ DO NOT proceed if you cannot find relevant existing code

✅ **REQUIRED APPROACH:**
   - ✓ Start with: "Let me search @workspace to understand the codebase..."
   - ✓ Show what you found (or didn't find) in the workspace
   - ✓ Ask: "I found [X]. Is this the right area to work on?"
   - ✓ Wait for user confirmation before suggesting changes
   - ✓ Reference specific files you found in @workspace

═══════════════════════════════════════════

${frameworkMission}

⚠️ CRITICAL RULES - FOLLOW STRICTLY:

✓ **Code Consistency:**
  - Search @workspace first to match existing patterns
  - Use the same naming conventions (camelCase for variables, PascalCase for classes)
  - Follow existing folder structure (feature-based or type-based)
  - Match import alias patterns (@app/, @shared/, @core/)

✓ **Angular Best Practices:**
  - Use OnPush change detection strategy where possible
  - Implement proper unsubscribe patterns (takeUntil, async pipe)
  - Use standalone components if the project uses them
  - Follow reactive programming with RxJS
  - Avoid memory leaks
  - Use Angular lifecycle hooks appropriately

✓ **Component Structure:**
  - Smart (container) vs Dumb (presentational) components
  - Single Responsibility Principle
  - Input/Output decorators for component communication
  - ViewChild/ContentChild when needed

✓ **Forms:**
  - Use Reactive Forms with FormBuilder
  - Add proper validators (built-in and custom)
  - Handle form errors elegantly
  - Show validation messages clearly

✓ **Error Handling:**
  - Use HttpInterceptor for global error handling
  - Show user-friendly error messages
  - Log errors appropriately
  - Handle HTTP errors with catchError operator

✓ **Performance:**
  - Lazy load feature modules
  - Use trackBy in *ngFor
  - Avoid function calls in templates
  - Optimize change detection

✓ **Accessibility:**
  - Add ARIA labels
  - Support keyboard navigation
  - Use semantic HTML
  - Ensure screen reader compatibility

✓ **Responsive Design:**
  - Mobile-first approach
  - Use CSS Grid/Flexbox
  - Match existing responsive patterns

═══════════════════════════════════════════

📦 EXPECTED DELIVERABLES:

${
  isBugOrDefect
    ? `
**1. Fixed Code:**
   - Show the corrected file(s) with clear changes
   - Highlight what was wrong and what's fixed
   
**2. Impact Analysis:**
   - List other files that might be affected
   - Note any breaking changes

**3. Updated Tests:**
   - Modified test specs
   - New test cases for the bug

**4. Explanation:**
   - What caused the bug
   - How the fix resolves it
   - Prevention strategy
`
    : isEpic
      ? `
**1. Architecture Diagram:**
   - Component hierarchy (use Mermaid if possible)
   - Module structure
   - Data flow

**2. Implementation Plan:**
   - Feature breakdown
   - File structure
   - Development phases

**3. Key Files:**
   - Main interfaces/models
   - Service signatures
   - Routing structure

**4. Dependencies:**
   - npm packages needed
   - Internal dependencies
`
      : isTask
        ? `
**1. Changed Files:**
   - List all files modified
   - Show code changes with explanations

**2. Testing:**
   - Updated or new test cases
   - Verification steps

**3. Documentation:**
   - Any updated comments or docs
   - Integration notes if needed
`
        : `
**1. Component Files:**
   \`\`\`typescript
   // component-name.component.ts
   // component-name.component.html
   // component-name.component.scss
   // component-name.component.spec.ts
   \`\`\`

**2. Service Files:**
   \`\`\`typescript
   // feature.service.ts
   // feature.service.spec.ts
   \`\`\`

**3. Models/Interfaces:**
   \`\`\`typescript
   // feature.model.ts or feature.interface.ts
   \`\`\`

**4. Module Updates:**
   - Module declarations and imports
   - Routing configuration
   - Provider registration

**5. Unit Tests:**
   - Component test suite (describe/it blocks)
   - Service test suite
   - All acceptance criteria covered

**6. Integration Instructions:**
   - How to integrate into existing app
   - Required imports
   - Configuration changes needed
`
}

═══════════════════════════════════════════

🔍 MANDATORY WORKFLOW - FOLLOW STRICTLY:

**PHASE 1: WORKSPACE ANALYSIS (REQUIRED)**
1. Search @workspace for package.json, angular.json
2. Verify this is an Angular project
3. Search for files related to the work item
4. Report what you found (or didn't find)

**PHASE 2: RELEVANCE CHECK (REQUIRED)**
5. Ask user: "I found [X files/patterns]. Is this work item for this repository?"
6. Wait for confirmation before proceeding
7. If no relevant files found, ask: "This seems unrelated to the workspace. Should I proceed?"

**PHASE 3: IMPLEMENTATION (ONLY AFTER CONFIRMATION)**
8. Design solution based on existing patterns
9. Ask clarifying questions if needed
10. Provide code following workspace conventions
11. Include tests and integration steps

═══════════════════════════════════════════

🚨 HALLUCINATION PREVENTION CHECKLIST:

□ Did you search @workspace first?
□ Did you find relevant files?
□ Does the work item match the workspace type (Angular)?
□ Did you ask the user to confirm relevance?
□ Are you following existing patterns (not inventing new ones)?
□ Are file paths from actual workspace search (not assumed)?

═══════════════════════════════════════════

💡 BEST PRACTICES:
- ✅ Be conservative: When in doubt, ASK
- ✅ Show your search results before suggesting code
- ✅ Reference actual files from @workspace
- ✅ Say "I couldn't find X" instead of guessing
- ✅ Suggest doing more research if context is unclear
- ❌ Never modify files you haven't found in @workspace
- ❌ Never assume folder structure without verification

═══════════════════════════════════════════

🎬 START YOUR ANALYSIS:

**Step 1:** Search @workspace and report your findings
**Step 2:** Verify work item relevance with the user
**Step 3:** Proceed only after confirmation

BEGIN NOW 👇
`;
}

// 🔧 Helper: Format Test Cases
function formatTestCases(testCases: any[]): string {
  if (!testCases || testCases.length === 0) {
    return "No test cases linked.";
  }
  return testCases
    .map(
      (tc: any, idx: number) =>
        `  ${idx + 1}. [TC-${tc.id}] ${tc.title}${tc.steps ? "\n     Steps: " + tc.steps : ""}`,
    )
    .join("\n");
}

// 🔧 Helper: Format Attachments
function formatAttachments(attachments: any[]): string {
  if (!attachments || attachments.length === 0) {
    return "No attachments or screenshots available.";
  }
  return attachments
    .map(
      (att: any, idx: number) =>
        `  ${idx + 1}. 📎 ${att.name}${att.url ? ` - ${att.url}` : ""}`,
    )
    .join("\n");
}

// 🧹 Clean HTML from ADO fields
function cleanHtml(html: string): string {
  return html.replace(/<[^>]*>/g, "").trim();
}

export function deactivate() {}

async function openCopilotChatWithPrompt(prompt: string): Promise<void> {
  try {
    outputChannel.appendLine("🔄 Opening GitHub Copilot chat...");

    // Open chat panel first so it starts initializing.
    await vscode.commands.executeCommand("workbench.action.chat.open");

    // First open in a session requires a longer wait — the panel's input
    // component is not ready to accept a query until it fully renders.
    const initDelay = chatPanelInitialized ? 300 : 1500;
    outputChannel.appendLine(`   Waiting ${initDelay}ms for chat panel...`);
    await delay(initDelay);
    chatPanelInitialized = true;

    outputChannel.appendLine("🔄 Sending prompt to chat...");

    // Send prompt with isPartialQuery:false so VS Code auto-submits it.
    // Retry up to 3 times with back-off in case the panel is still loading.
    let lastError: unknown;
    const retryDelays = [0, 500, 1000];

    for (let i = 0; i < retryDelays.length; i++) {
      if (retryDelays[i] > 0) {
        outputChannel.appendLine(
          `   Retry ${i}/${retryDelays.length - 1} after ${retryDelays[i]}ms...`,
        );
        await delay(retryDelays[i]);
      }
      try {
        outputChannel.appendLine(
          `   Attempt ${i + 1}/${retryDelays.length}...`,
        );
        await vscode.commands.executeCommand("workbench.action.chat.open", {
          query: prompt,
          isPartialQuery: false,
        });
        await delay(150);
        outputChannel.appendLine("   ✓ Success!");
        return;
      } catch (error) {
        lastError = error;
        outputChannel.appendLine(`   ✗ Attempt ${i + 1} failed: ${error}`);
      }
    }

    // Last-resort fallback: pass prompt as a plain string argument.
    outputChannel.appendLine(
      "   Fallback: sending prompt as plain argument...",
    );
    try {
      await vscode.commands.executeCommand(
        "workbench.action.chat.open",
        prompt,
      );
      await delay(150);
      await trySubmitChatMessage();
      outputChannel.appendLine("   ✓ Fallback succeeded!");
      return;
    } catch (fallbackError) {
      lastError = fallbackError;
    }

    throw new Error(
      `Unable to open Copilot chat with prompt. Make sure GitHub Copilot extension is installed and active. Last error: ${String(lastError)}`,
    );
  } catch (error) {
    outputChannel.appendLine(`❌ Error in openCopilotChatWithPrompt: ${error}`);
    throw error;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function trySubmitChatMessage(): Promise<void> {
  const submitCommands = [
    "workbench.action.chat.submit",
    "workbench.action.chat.send",
  ];

  for (const command of submitCommands) {
    try {
      outputChannel.appendLine(`   Trying submit command: ${command}`);
      await vscode.commands.executeCommand(command);
      outputChannel.appendLine(`   ✓ Submit command succeeded: ${command}`);
      return;
    } catch (error) {
      outputChannel.appendLine(
        `   ✗ Submit command failed: ${command} - ${error}`,
      );
      // Ignore missing command IDs and keep trying fallbacks.
    }
  }

  outputChannel.appendLine(
    "   ⚠️ No submit command worked, chat may need manual submission",
  );
}
