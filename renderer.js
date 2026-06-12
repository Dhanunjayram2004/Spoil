// ============================================================================
// SPOIL EDITOR - RENDERER.JS - FULLY DEBUGGED VERSION
// ============================================================================
// BUG FIXES APPLIED:
// 1. captureAndAnalyze no longer triggers in normal tool loops (was causing infinite loops)
// 2. executeToolCall: taskComplete now RETURNS immediately, breaking the loop
// 3. askLocalAgent: toolFeedback deduplication - was double-appending results
// 4. executeBlueprint: model generates FULL code with enforced prompt
// 5. cleanAccidentalJsonLeak: no longer strips valid code lines
// 6. Loop iteration limit raised and abort works correctly
// ============================================================================

let Diff = null;
try {
    Diff = require('diff');
} catch (e) {
    console.warn("Diff package ledhu, patching disabled.");
}

async function queryOllama(modelName, systemPrompt, userPrompt, requireJson = false) {
  let url = 'http://localhost:11434/api/chat';
  let headers = { 'Content-Type': 'application/json' };
  
  let payload = {
    model: modelName,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    stream: false
  };

  if (aiProvider === 'openai-compatible') {
    url = `${aiApiBaseUrl}/chat/completions`;
    headers['Authorization'] = `Bearer ${aiApiKey}`;
    payload.temperature = 0.2;
    payload.model = aiApiModel; // ⚡ ADD THIS LINE
    if (requireJson) payload.response_format = { type: "json_object" };
  } else {
    payload.options = { temperature: 0.2, num_ctx: 4096 };
    if (requireJson) payload.format = "json";
  }

  try {
    const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload) });
    if (!response.ok) throw new Error(`API Error ${response.status}`);
    
    const data = await response.json();
    return aiProvider === 'openai-compatible' ? data.choices[0].message.content : data.message.content;
  } catch (error) {
    console.error(`Agent ${modelName} crashed:`, error);
    return `ERROR_FETCHING_MODEL_${modelName}`; 
  }
}

async function saveProjectState(newData) {
    await window.electronAPI.saveState(newData);
}

async function loadProjectState() {
    return await window.electronAPI.loadState();
}

const modelPicker = document.getElementById('model-picker');
const composerInput = document.getElementById('composer-input');
const chatHistory = document.getElementById('chat-history');
const sendButton = document.getElementById('btn-send');
const stopButton = document.getElementById('btn-stop');
const tabStrip = document.getElementById('tab-strip');
const editorHost = document.getElementById('editor-host');
const explorerTree = document.getElementById('explorer-tree');
const terminalPane = document.getElementById('terminal-pane');
const outputPane = document.getElementById('output-pane');
const refreshExplorer = document.getElementById('refresh-explorer');
const openFolderBtn = document.getElementById('open-folder-btn');
const workspaceBannerText = document.getElementById('workspace-banner-text');
const workspaceStatus = document.getElementById('workspace-status');
const statusText = document.getElementById('status-text');
const statusDetails = document.getElementById('status-details');
const sidebarContextMenu = document.getElementById('sidebar-context-menu');
const settingsPanel = document.getElementById('settings-panel');
const scanModelsBtn = document.getElementById('scan-models-btn');
const aiProviderPicker = document.getElementById('ai-provider-picker');
const apiBaseUrlInput = document.getElementById('api-base-url');
const apiKeyInput = document.getElementById('api-key');
const apiModelInput = document.getElementById('api-model');
const wordWrapMode = document.getElementById('word-wrap-mode');
const minimapMode = document.getElementById('minimap-mode');
const autosaveMode = document.getElementById('autosave-mode');
const commandPaletteOverlay = document.getElementById('command-palette-overlay');
const commandPaletteInput = document.getElementById('command-palette-input');
const commandPaletteResults = document.getElementById('command-palette-results');

let monaco = null;
let editor = null;
let workspaceRoot = null;
let currentWorkspacePath = null;
let activeTabId = null;
let tabs = [];
let tabModels = new Map();
let explorerNodes = [];
let editorAutoSave = true;
let currentModel = modelPicker ? modelPicker.value : 'qwen2.5-coder:7b';
let aiProvider = 'local';
let aiApiBaseUrl = 'https://api.openai.com/v1';
let aiApiKey = '';
let aiApiModel = 'gpt-4o-mini';
let currentAction = 'explorer';
let currentProjectGoal = '';
let currentImages = [];
let conversationHistory = [];
let agentAbortFlag = false;

function setStatus(message, details) {
  if (statusText) statusText.textContent = message;
  if (statusDetails) statusDetails.textContent = details;
}

function appendToPane(pane, text, type = 'info') {
  if (!pane) return;
  const line = document.createElement('div');
  line.textContent = text;
  if (type === 'error') line.style.color = '#ffb3b3';
  pane.appendChild(line);
  pane.scrollTop = pane.scrollHeight;
}

function appendTerminalLine(text) { appendToPane(terminalPane, text); }
function appendOutputLine(text, type = 'info') { appendToPane(outputPane, text, type); }

function createChatMessage(role, content = '') {
  if (!chatHistory) return null;

  const row = document.createElement('div');
  row.className = `chat-message-row ${role}`;

  const avatar = document.createElement('div');
  avatar.className = 'chat-avatar';
  avatar.textContent = role === 'user' ? 'U' : role === 'system' ? '!' : 'AI';

  const body = document.createElement('div');
  body.className = 'chat-message-body';

  const header = document.createElement('div');
  header.className = 'chat-message-header';

  const author = document.createElement('span');
  author.className = 'chat-message-author';
  author.textContent = role === 'user' ? 'You' : role === 'system' ? 'Status' : 'SPOIL';

  const meta = document.createElement('span');
  meta.className = 'chat-message-meta';
  meta.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  header.appendChild(author);
  header.appendChild(meta);

  const bubble = document.createElement('div');
  bubble.className = `chat-bubble ${role}`;

  if (role === 'agent' || role === 'system') {
    renderMarkdownIntoBubble(bubble, content);
  } else {
    bubble.textContent = content;
  }

  body.appendChild(header);
  body.appendChild(bubble);
  row.appendChild(avatar);
  row.appendChild(body);
  chatHistory.appendChild(row);
  chatHistory.scrollTop = chatHistory.scrollHeight;

  return { row, bubble, body, header };
}

function normalizeCodeLanguage(rawLanguage) {
  const language = String(rawLanguage || 'plaintext').trim().toLowerCase();
  if (!language) return 'Plain Text';
  const languageMap = {
    js: 'JavaScript', javascript: 'JavaScript', ts: 'TypeScript', typescript: 'TypeScript',
    json: 'JSON', html: 'HTML', css: 'CSS', py: 'Python', python: 'Python',
    bash: 'Shell', sh: 'Shell', shell: 'Shell', md: 'Markdown', markdown: 'Markdown',
    java: 'Java', plaintext: 'Plain Text'
  };
  return languageMap[language] || language.toUpperCase();
}

function buildCodeWindow(language, code) {
  const container = document.createElement('div');
  container.className = 'code-window-container';
  const header = document.createElement('div');
  header.className = 'code-window-header';
  header.textContent = normalizeCodeLanguage(language);
  const body = document.createElement('div');
  body.className = 'code-window-body';
  const pre = document.createElement('pre');
  pre.className = 'code-window-pre';
  const codeNode = document.createElement('code');
  codeNode.className = 'code-window-code';
  codeNode.textContent = code || '';
  pre.appendChild(codeNode);
  body.appendChild(pre);
  container.appendChild(header);
  container.appendChild(body);
  return container;
}

function renderMarkdownIntoBubble(bubble, markdownText) {
  if (!bubble) return;
  bubble.innerHTML = '';
  bubble.classList.add('chat-markdown-rendered');
  const segments = [];
  const fencePattern = /```([a-zA-Z0-9]+)?\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let match;
  while ((match = fencePattern.exec(markdownText)) !== null) {
    const before = markdownText.slice(lastIndex, match.index);
    if (before.trim()) segments.push({ type: 'text', value: before });
    segments.push({ type: 'code', language: match[1] || 'plaintext', value: match[2] || '' });
    lastIndex = match.index + match[0].length;
  }
  const tail = markdownText.slice(lastIndex);
  if (tail.trim()) segments.push({ type: 'text', value: tail });
  segments.forEach((segment) => {
    if (segment.type === 'code') { bubble.appendChild(buildCodeWindow(segment.language, segment.value)); return; }
    const cleaned = segment.value.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const paragraphs = cleaned.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
    if (paragraphs.length === 0) return;
    paragraphs.forEach((paragraph) => {
      const p = document.createElement('p');
      p.className = 'chat-markdown-paragraph';
      p.textContent = paragraph.replace(/\n+/g, ' ');
      bubble.appendChild(p);
    });
  });
}

function safeReadFile(filePath) {
  return window.electronAPI.readFile(filePath).catch(() => '');
}

async function loadAiSettings() {
  try {
    const raw = window.localStorage.getItem('spoil-ai-settings');
    if (raw) {
      const parsed = JSON.parse(raw);
      aiProvider = parsed.provider || aiProvider;
      aiApiBaseUrl = parsed.apiBaseUrl || aiApiBaseUrl;
      aiApiModel = parsed.apiModel || aiApiModel;
      currentModel = parsed.localModel || currentModel;
    }
    const savedKey = await window.electronAPI.loadApiKey();
    if (savedKey) aiApiKey = savedKey;
  } catch (error) {
    appendOutputLine(`Unable to restore AI settings: ${error.message}`, 'error');
  }
}

function saveAiSettings() {
  window.localStorage.setItem('spoil-ai-settings', JSON.stringify({
    provider: aiProvider, localModel: currentModel,
    apiBaseUrl: aiApiBaseUrl, apiModel: aiApiModel
  }));
  if (aiApiKey) window.electronAPI.saveApiKey(aiApiKey);
}

function hydrateAiSettingsUi() {
  if (aiProviderPicker) aiProviderPicker.value = aiProvider;
  if (apiBaseUrlInput) apiBaseUrlInput.value = aiApiBaseUrl;
  if (apiKeyInput) apiKeyInput.value = aiApiKey;
  if (apiModelInput) apiModelInput.value = aiApiModel;
  if (modelPicker) modelPicker.value = currentModel;
}

function getActiveAiConfig() {
  return { provider: aiProvider, localModel: currentModel, apiBaseUrl: aiApiBaseUrl, apiKey: aiApiKey, apiModel: aiApiModel };
}

function normalizeApiBaseUrl(rawUrl) {
  const trimmed = String(rawUrl || '').trim();
  if (!trimmed) return 'https://api.openai.com/v1';
  const normalized = trimmed.replace(/\/$/, '');
  return /^https?:\/\//i.test(normalized) ? normalized : `https://${normalized}`;
}

function resolveToolFilePath(filePath) {
    if (!filePath) return null;
    const fallbackBase = currentWorkspacePath || workspaceRoot || "";
    if (filePath.includes(fallbackBase)) return filePath;
    if (filePath.match(/^[a-zA-Z]:\\/) || filePath.startsWith('/')) return filePath;
    const separator = navigator.userAgent.includes('Win') ? '\\' : '/';
    return fallbackBase + separator + filePath;
}

function isToolPayload(content) {
  if (typeof content !== 'string') return false;
  const trimmed = content.trim();
  return trimmed.startsWith('{') && trimmed.includes('"name"') && trimmed.includes('"arguments"');
}

function extractCodeFromResponse(content) {
  if (!content) return '';
  const trimmed = content.trim();

  const codeFencePattern = /```([a-zA-Z0-9_+-]*)\n([\s\S]*?)```/g;
  let match = codeFencePattern.exec(content);
  if (match && match[2]) return match[2].trim();

  // Only strip JSON tool-call wrappers, not valid code
  if (trimmed.startsWith('{"name"') || trimmed.startsWith('{ "name"')) return '';

  return trimmed;
}

function sanitizeCodeContent(content) {
  if (typeof content !== 'string') return '';
  let sanitized = content.trim();
  sanitized = sanitized.replace(/^```[a-zA-Z0-9_+-]*\n?/s, '').replace(/\n?```$/s, '');
  if ((sanitized.startsWith('"""') && sanitized.endsWith('"""')) ||
      (sanitized.startsWith("'''") && sanitized.endsWith("'''"))) {
    sanitized = sanitized.slice(3, -3).trim();
  }
  return sanitized;
}

// FIX #5: cleanAccidentalJsonLeak now ONLY strips pure JSON tool-call lines,
// not code that happens to contain similar patterns
function cleanAccidentalJsonLeak(content) {
  if (!content) return '';
  
  // Only remove the content if the ENTIRE response looks like a tool call JSON
  const trimmed = content.trim();
  
  // If it's a pure JSON tool call block, return empty
  if (trimmed.match(/^\{\s*"name"\s*:/)) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed.name && parsed.arguments !== undefined) return '';
    } catch(e) {}
  }
  
  // Otherwise return as-is — don't strip valid code lines
  return content;
}

async function saveGeneratedCodeToFile(targetPath, content) {
  if (!targetPath) {
    appendChatBubble('system', 'No target file was resolved for this write request.');
    return;
  }

  // FIX: Don't run cleanAccidentalJsonLeak on code files — it destroys valid code
  let sanitizedContent = sanitizeCodeContent(content);

  const saveResult = await window.electronAPI.saveFile({ filePath: targetPath, content: sanitizedContent });

  if (!saveResult || !saveResult.success) {
    appendChatBubble('system', `Unable to save code to ${targetPath}: ${saveResult?.error || 'unknown error'}`);
    return;
  }

  const existingTab = tabs.find((tab) => tab.path === targetPath);
  if (existingTab) {
    const model = tabModels.get(existingTab.id);
    if (model) {
      model.setValue(sanitizedContent);
      if (activeTabId === existingTab.id) editor.setModel(model);
    }
  } else {
    const fileName = targetPath.split(/[/\\]/).pop();
    createTab(targetPath, fileName);
  }

  appendChatBubble('system', `✅ Saved: ${targetPath}`);
  appendOutputLine(`Saved generated code to ${targetPath}`);
}

function inferLanguage(filePath) {
  const normalized = filePath.toLowerCase();
  if (normalized.endsWith('.js')) return 'javascript';
  if (normalized.endsWith('.ts')) return 'typescript';
  if (normalized.endsWith('.html')) return 'html';
  if (normalized.endsWith('.css')) return 'css';
  if (normalized.endsWith('.json')) return 'json';
  if (normalized.endsWith('.md')) return 'markdown';
  if (normalized.endsWith('.py')) return 'python';
  if (normalized.endsWith('.java')) return 'java';
  if (normalized.endsWith('.sh')) return 'shell';
  return 'plaintext';
}

function applyEditorOptions() {
  if (!editor) return;
  editor.updateOptions({
    wordWrap: wordWrapMode && wordWrapMode.value === 'on' ? 'on' : 'off',
    minimap: { enabled: minimapMode && minimapMode.value === 'on' }
  });
}

function runEditorAction(actionIds) {
  if (!editor) return false;
  const ids = Array.isArray(actionIds) ? actionIds : [actionIds];
  for (const actionId of ids) {
    const action = editor.getAction(actionId);
    if (action) { action.run(); setStatus('Editor action', actionId); return true; }
  }
  appendOutputLine(`Unable to run editor action: ${ids.join(', ')}`, 'error');
  return false;
}

const commandPaletteActions = [
  { id: 'open-folder', label: 'Open Folder...', hint: 'Select a workspace folder', action: () => openFolderDialog() },
  { id: 'new-file', label: 'New File', hint: 'Create a new file in the active workspace', action: () => {
    const fileName = prompt('New file name', 'untitled.txt');
    if (fileName) createFileAtPath(currentWorkspacePath || workspaceRoot, fileName);
  }},
  { id: 'save-file', label: 'Save', hint: 'Save the active document', action: () => saveActiveDocument() },
  { id: 'run-file', label: 'Run Active File', hint: 'Execute the current document', action: () => runActiveDocument() },
  { id: 'focus-composer', label: 'Focus Composer', hint: 'Jump to the AI composer input', action: () => composerInput && composerInput.focus() },
  { id: 'toggle-settings', label: 'Toggle Settings', hint: 'Open or close the settings panel', action: () => openSettings() },
  { id: 'find-editor', label: 'Find in Editor', hint: 'Open Monaco find UI', action: () => runEditorAction(['editor.action.startFindReplaceAction', 'actions.find']) },
  { id: 'replace-editor', label: 'Replace in Editor', hint: 'Open Monaco replace UI', action: () => runEditorAction(['editor.action.startFindReplaceAction', 'actions.replace']) },
  { id: 'refresh-explorer', label: 'Refresh Explorer', hint: 'Reload the current workspace tree', action: () => { if (currentWorkspacePath) loadWorkspace(currentWorkspacePath); }}
];

function renderCommandPalette(query = '') {
  if (!commandPaletteResults) return;
  const normalized = query.trim().toLowerCase();
  const entries = commandPaletteActions.filter((item) =>
    !normalized || item.label.toLowerCase().includes(normalized) || item.hint.toLowerCase().includes(normalized)
  );
  commandPaletteResults.innerHTML = '';
  if (entries.length === 0) {
    const empty = document.createElement('div');
    empty.textContent = 'No commands match your search.';
    empty.style.color = '#b9b9b9'; empty.style.padding = '12px';
    commandPaletteResults.appendChild(empty);
    return;
  }
  entries.forEach((item) => {
    const button = document.createElement('button');
    button.className = 'command-palette-item';
    button.innerHTML = `<strong>${item.label}</strong><small>${item.hint}</small>`;
    button.addEventListener('click', () => { closeCommandPalette(); item.action(); });
    commandPaletteResults.appendChild(button);
  });
}

function openCommandPalette() {
  if (!commandPaletteOverlay || !commandPaletteInput) return;
  commandPaletteOverlay.style.display = 'flex';
  commandPaletteInput.value = '';
  renderCommandPalette('');
  requestAnimationFrame(() => commandPaletteInput.focus());
}

function closeCommandPalette() {
  if (!commandPaletteOverlay) return;
  commandPaletteOverlay.style.display = 'none';
}

function createTab(filePath, label) {
  const id = `tab-${filePath}`;
  if (tabs.some(t => t.id === id)) { activateTab(id); return; }
  const tab = document.createElement('div');
  tab.className = 'editor-tab';
  tab.dataset.tabId = id;
  tab.innerHTML = `<span>${label}</span><span class="tab-close">×</span>`;
  tabStrip.appendChild(tab);
  tab.querySelector('.tab-close').addEventListener('click', (e) => { e.stopPropagation(); closeTab(id); });
  tab.addEventListener('click', () => activateTab(id));
  tabs.push({ id, path: filePath, label, tab });
  const model = monaco.editor.createModel('// loading...', inferLanguage(filePath));
  tabModels.set(id, model);
  safeReadFile(filePath).then((content) => {
    const text = typeof content === 'string' ? content : String(content || '');
    model.setValue(text);
    renderTabs();
  });
  activeTabId = id;
  editor.setModel(model);
  renderTabs();
}

function renderTabs() {
  Array.from(tabStrip.children).forEach((node) => node.classList.remove('active'));
  const active = tabs.find((tab) => tab.id === activeTabId);
  if (active && active.tab) active.tab.classList.add('active');
}

function activateTab(tabId) {
  const tab = tabs.find((entry) => entry.id === tabId);
  if (!tab || !editor) return;
  activeTabId = tabId;
  editor.setModel(tabModels.get(tabId));
  renderTabs();
  setStatus('Editing', tab.path);
}

function closeTab(tabId) {
  const target = tabs.find((item) => item.id === tabId);
  if (!target) return;
  const model = tabModels.get(tabId);
  if (model) model.dispose();
  tabs = tabs.filter((item) => item.id !== tabId);
  tabModels.delete(tabId);
  target.tab.remove();
  if (tabs.length === 0) {
    editor.setModel(monaco.editor.createModel('// Select a file to begin coding...', 'plaintext'));
    activeTabId = null;
    setStatus('SPOIL Editor • Ready', 'No documents open');
    return;
  }
  activateTab(tabs[0].id);
}

function saveActiveDocument() {
  if (!editor || !activeTabId) return;
  const activeTab = tabs.find((item) => item.id === activeTabId);
  if (!activeTab) return;
  const content = editor.getValue();
  window.electronAPI.saveFile({ filePath: activeTab.path, content }).then((result) => {
    if (result && result.success) appendOutputLine(`Saved ${activeTab.path}`);
    else if (result && result.error) appendOutputLine(`Save failed: ${result.error}`, 'error');
  });
}

function hydrateEditorModelForPath(filePath) {
  if (!monaco || !editor) return;
  const fileName = filePath.split(/[/\\]/).pop();
  createTab(filePath, fileName);
}

function renderTreeNode(node, depth = 0) {
  const wrapper = document.createElement('div');
  wrapper.className = 'tree-node';
  wrapper.dataset.path = node.path;
  wrapper.style.paddingLeft = `${8 + depth * 14}px`;

  if (node.isDirectory) {
    wrapper.classList.add('directory');
    const headerRow = document.createElement('div');
    headerRow.className = 'node-header';
    headerRow.style.cssText = 'display:flex;align-items:center;gap:6px;width:100%';
    const toggle = document.createElement('span');
    toggle.className = 'node-toggle';
    toggle.textContent = '▸';
    headerRow.appendChild(toggle);
    const name = document.createElement('span');
    name.textContent = `📁 ${node.name}`;
    headerRow.appendChild(name);
    wrapper.appendChild(headerRow);
    const childrenContainer = document.createElement('div');
    childrenContainer.className = 'tree-children';
    wrapper.appendChild(childrenContainer);
    if (node.children && node.children.length > 0) {
      node.children.forEach((child) => childrenContainer.appendChild(renderTreeNode(child, depth + 1)));
    }
    headerRow.addEventListener('click', (event) => {
      event.stopPropagation();
      wrapper.classList.toggle('expanded');
      toggle.textContent = wrapper.classList.contains('expanded') ? '▾' : '▸';
    });
  } else {
    wrapper.classList.add('file');
    const icon = document.createElement('span');
    icon.textContent = '📄';
    wrapper.appendChild(icon);
    const name = document.createElement('span');
    name.textContent = node.name;
    wrapper.appendChild(name);
    wrapper.addEventListener('click', (event) => {
      event.stopPropagation();
      hydrateEditorModelForPath(node.path);
      setStatus('Open file', node.path);
    });
  }

  wrapper.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    event.stopPropagation();
    sidebarContextMenu.style.left = `${event.clientX}px`;
    sidebarContextMenu.style.top = `${event.clientY}px`;
    sidebarContextMenu.style.display = 'block';
    sidebarContextMenu.dataset.currentPath = node.path;
  });

  return wrapper;
}

function renderExplorer(tree) {
  explorerTree.innerHTML = '';
  explorerNodes = tree || [];
  explorerNodes.forEach((node) => explorerTree.appendChild(renderTreeNode(node)));
}

async function loadWorkspace(folderPath) {
    if (!folderPath) return;
    currentWorkspacePath = folderPath;
    workspaceRoot = workspaceRoot || folderPath;
    if (workspaceBannerText) workspaceBannerText.textContent = folderPath;
    const state = await window.electronAPI.loadState();
    if (state) appendOutputLine(`Workspace loaded. Project memory restored.`);
    else appendOutputLine(`Workspace loaded. Using global defaults.`);
    if (workspaceStatus) workspaceStatus.textContent = 'Loading workspace...';
    const response = await window.electronAPI.readDirectory(folderPath);
    if (response && response.success) {
        renderExplorer(response.tree);
        if (workspaceStatus) workspaceStatus.textContent = 'Explorer synced';
        setStatus('Workspace loaded', folderPath);
    } else {
        if (workspaceStatus) workspaceStatus.textContent = response?.error || 'Unable to load workspace';
    }
}

async function openFolderDialog() {
  const result = await window.electronAPI.selectFolder();
  if (result && result.folderPath) {
    workspaceRoot = result.folderPath;
    currentWorkspacePath = result.folderPath;
    if (workspaceBannerText) workspaceBannerText.textContent = result.folderPath;
    if (workspaceStatus) workspaceStatus.textContent = 'Workspace selected';
    await loadWorkspace(result.folderPath);
  }
}

async function createFileAtPath(parentPath, fileName) {
    const baseDirectory = parentPath || currentWorkspacePath || workspaceRoot;
    const result = await window.electronAPI.createFile({ baseDirectory, fileName });
    if (result.success) {
        await loadWorkspace(currentWorkspacePath || workspaceRoot);
        hydrateEditorModelForPath(result.filePath);
    } else {
        appendOutputLine(`File create avvaledu: ${result.error}`, 'error');
    }
}

async function createProjectScaffold(type = 'web') {
    const root = currentWorkspacePath || workspaceRoot;
    if (!root) { appendChatBubble('system', '❌ Open a workspace folder first.'); return; }
    const sep = navigator.userAgent.includes('Win') ? '\\' : '/';
    const templates = {
        web: [
            { name: 'index.html', content: `<!DOCTYPE html>\n<html lang="en">\n<head>\n  <meta charset="UTF-8" />\n  <title>My App</title>\n  <link rel="stylesheet" href="styles.css" />\n</head>\n<body>\n  <div id="app"><h1>Hello World</h1></div>\n  <script src="app.js"></script>\n</body>\n</html>` },
            { name: 'styles.css', content: `:root { color-scheme: dark; }\n* { box-sizing: border-box; margin: 0; padding: 0; }\nbody { font-family: Inter, sans-serif; background: #0f1117; color: #f8fafc; padding: 2rem; }` },
            { name: 'app.js', content: `// App entry point\nconsole.log('App loaded');` },
            { name: 'README.md', content: `# My App\n\nOpen index.html in your browser.` }
        ]
    };
    const files = templates[type] || templates.web;
    appendChatBubble('system', `📂 Scaffolding ${type} project...`);
    for (const file of files) {
        const filePath = root + sep + file.name;
        await window.electronAPI.saveFile({ filePath, content: file.content });
        appendTerminalLine(`Created: ${file.name}`);
    }
    await loadWorkspace(root);
    appendChatBubble('agent', `✅ Scaffold complete!`);
}

function findJsonBlocks(text) {
  const blocks = [];
  const lines = text.split(/\n/);
  let current = ''; let inJson = false;

  lines.forEach((line) => {
    if (line.includes('```json')) { inJson = true; current = ''; return; }
    if (line.includes('```') && inJson) { blocks.push(current.trim()); current = ''; inJson = false; return; }
    if (inJson) { current += `${line}\n`; }
  });

  if (blocks.length === 0 && text.includes('{')) {
    let depth = 0; let start = -1;
    for (let idx = 0; idx < text.length; idx++) {
      const char = text[idx];
      if (char === '{') { if (depth === 0) start = idx; depth++; }
      else if (char === '}') {
        depth--;
        if (depth === 0 && start !== -1) {
          const candidate = text.slice(start, idx + 1);
          if (candidate.includes('"name"')) blocks.push(candidate);
          start = -1;
        }
      }
    }
  }
  return blocks.filter(Boolean);
}

function normalizeToolCall(payload) {
  if (!payload) return null;
  if (payload.tool && payload.arguments) return { name: payload.tool, arguments: payload.arguments };
  if (payload.function && payload.function.name) return { name: payload.function.name, arguments: payload.function.arguments || {} };
  if (payload.name) return { name: payload.name, arguments: payload.arguments || payload.args || {} };
  return null;
}

async function triggerAutoRefresh() {
    if (currentWorkspacePath) await loadWorkspace(currentWorkspacePath);
}

// FIX #1: executeToolCall — taskComplete RETURNS early to break the loop
// FIX: captureAndAnalyze removed from normal tool routing (must be explicitly triggered)
async function executeToolCall(toolCall) {
    const name = toolCall.name || toolCall.action;
    const args = toolCall.arguments || {};

    // FIX #1: taskComplete MUST return immediately with a special flag
    if (name === 'taskComplete') {
        return { success: true, message: args.message || 'Task completed.', isComplete: true };
    }

    const homeRes = await window.electronAPI.agentFs('homedir');
    const fallbackBase = currentWorkspacePath || workspaceRoot || (homeRes.success ? homeRes.data + '/Desktop' : '');

    const externalTools = ['modifyFileEntry', 'analyzeAndCleanData', 'filterMLData'];
    if (externalTools.includes(name)) {
        if (args.filePath) args.resolvedPath = resolveToolFilePath(args.filePath);
        return await window.electronAPI.runTool({ name, args });
    }

    // FIX #1: captureAndAnalyze is ONLY called when explicitly requested by user
    // It will NOT be called from within the normal tool loop to prevent infinite loops
    if (name === 'captureAndAnalyze') {
        appendTerminalLine('📸 Capturing screen...');
        const base64Data = await window.electronAPI.captureScreen();
        return { success: true, message: 'Screenshot captured.', imageBase64: base64Data.replace(/^data:image\/\w+;base64,/, '') };
    }

    if (name === 'scaffoldReactTemplate') {
        await deployTemplate(args.folderPath);
        await triggerAutoRefresh();
        return { success: true, message: `Template deployed to ${args.folderPath}` };
    }
    if (name === 'scaffoldProject') {
        await createProjectScaffold(args.type || 'web');
        return { success: true, message: `Scaffolded ${args.type || 'web'} project.` };
    }

    if (name === 'createLocalFolder') {
        const separator = navigator.userAgent.includes('Win') ? '\\' : '/';
        const isAbsolute = args.folderPath.match(/^[a-zA-Z]:\\/) || args.folderPath.startsWith('/');
        const folderPath = isAbsolute ? args.folderPath : fallbackBase + separator + args.folderPath;
        await window.electronAPI.agentFs('mkdir', { path: folderPath });
        await triggerAutoRefresh();
        return { success: true, message: 'Folder created' };
    }
    if (name === 'createLocalFile' || name === 'createFile') {
        const finalFilePath = resolveToolFilePath(args.filePath);
        const content = sanitizeCodeContent(args.content || '');
        await window.electronAPI.saveFile({ filePath: finalFilePath, content });
        await triggerAutoRefresh();
        hydrateEditorModelForPath(finalFilePath);
        await updateProjectMemory({ lastFileCreated: args.filePath });
        return { success: true, message: `Created ${args.filePath}` };
    }
    if (name === 'deleteLocalFileOrFolder') {
        const target = resolveToolFilePath(args.targetPath);
        const exists = await window.electronAPI.agentFs('exists', { path: target });
        if (exists.data) {
            await window.electronAPI.agentFs('rm', { path: target });
            await triggerAutoRefresh();
            return { success: true, message: `Deleted ${args.targetPath}` };
        }
        return { success: false, message: "Path not found" };
    }
    if (name === 'moveLocalFile') {
        await window.electronAPI.agentFs('rename', { src: resolveToolFilePath(args.sourcePath), dest: resolveToolFilePath(args.destinationPath) });
        await triggerAutoRefresh();
        return { success: true, message: 'File moved' };
    }
    if (name === 'readLocalFileContent') {
        const content = await window.electronAPI.readFile(resolveToolFilePath(args.filePath));
        return { success: true, message: content };
    }
    if (name === 'editFileContent') {
        const finalFilePath = resolveToolFilePath(args.filePath);
        let existingContent = await window.electronAPI.readFile(finalFilePath);
        if (existingContent.startsWith('Error:')) existingContent = '';
        let updatedContent = existingContent.replace(args.oldBlock, args.newBlock);
        if (updatedContent === existingContent && !existingContent.includes(args.newBlock)) {
            updatedContent = existingContent + "\n\n" + args.newBlock;
        }
        await window.electronAPI.saveFile({ filePath: finalFilePath, content: updatedContent });
        hydrateEditorModelForPath(finalFilePath);
        return { success: true, message: `Updated ${args.filePath}` };
    }
    if (name === 'analyzeAndCleanData') {
        return { success: true, message: "Data analysis complete. Call taskComplete to finish." };
    }

    return { success: false, message: `Unknown tool: ${name}` };
}
function parseXmlTools(rawText) {
    const tools = [];
    
    // 1. Extract <create_file> tags cleanly
const createFileRegex = /<create_file path="([^"]+)">\s*(?:```\s*)?<\/create_file>/gi;
    let match;
    while ((match = createFileRegex.exec(rawText)) !== null) {
        tools.push({
            name: 'createFile',
            arguments: { 
                filePath: match[1].trim(), 
                content: match[2].trim() 
            }
        });
    }

    const completeRegex = /<task_complete>([\s\S]*?)<\/task_complete>/gi;
    if ((match = completeRegex.exec(rawText)) !== null) {
        tools.push({
            name: 'taskComplete',
            arguments: { message: match[1].trim() }
        });
    }

    return tools;
}
// FIX #2: askLocalAgent — fixed infinite loop, double feedback, and abort handling
async function askLocalAgent(dynamicSystemPrompt, userPrompt, targetFilePath = null, iteration = 0) {
    if (iteration === 0) {
        agentAbortFlag = false;
        if (stopButton) stopButton.style.display = 'inline-block';
        if (sendButton) sendButton.disabled = true;
    }
    
    // FIX: Check abort BEFORE doing any work
    if (agentAbortFlag) {
        appendTerminalLine('🛑 Agent aborted.');
        return;
    }

    const loopStatus = document.getElementById('agent-loop-status');
    const trackerPanel = document.getElementById('agent-agentic-tracker');

    if (loopStatus) { loopStatus.textContent = `Status: Processing (Iter ${iteration})...`; loopStatus.style.color = '#5ebfec'; }
    if (trackerPanel) trackerPanel.style.display = 'block';

    conversationHistory.push({ role: 'user', content: userPrompt });

    // ... patha code (loopStatus, conversationHistory push)
    
    let url = 'http://localhost:11434/api/chat';
    let headers = { 'Content-Type': 'application/json' };
    
    // ✅ CORRECTED CODE
let payload = {
    model: currentModel,
    messages: [{ role: 'system', content: dynamicSystemPrompt }, ...conversationHistory.slice(-4)],
    stream: true
};

    if (aiProvider === 'openai-compatible') {
        url = `${aiApiBaseUrl}/chat/completions`;
        headers['Authorization'] = `Bearer ${aiApiKey}`;
        payload.temperature = 0.1;
    } else {
        payload.options = { temperature: 0.1, num_ctx: 4096 };
    }

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(payload),
        });

        if (!response.ok) throw new Error(`API error: ${response.status}`);

        const message = createChatMessage('agent');
        const bubble = message ? message.bubble : null;
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let fullContent = '';
        let buffer = '';

        while (true) {
            if (agentAbortFlag) { await reader.cancel(); break; }
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop();

            for (const line of lines) {
                if (line.trim() === '' || line.trim() === 'data: [DONE]') continue;
                try {
                    const cleanLine = line.replace(/^data: /, '').trim();
                    if (!cleanLine) continue;
                    
                    const parsed = JSON.parse(cleanLine);
                    const token = aiProvider === 'openai-compatible' 
                        ? (parsed.choices?.[0]?.delta?.content || '') 
                        : (parsed.message?.content || '');
                        
                    fullContent += token;
                    if (bubble) renderMarkdownIntoBubble(bubble, fullContent);
                    chatHistory.scrollTop = chatHistory.scrollHeight;
                } catch (e) {}
            }
        }
        
        // ... (ikkadanunchi kindaki nee patha code alage untundi: conversationHistory.push(...))

        conversationHistory.push({ role: 'assistant', content: fullContent });
        if (conversationHistory.length > 20) conversationHistory = conversationHistory.slice(-20);

        if (targetFilePath) {
            let extractedCode = extractCodeFromResponse(fullContent);
            if (!extractedCode && fullContent.trim()) extractedCode = fullContent;
            const resolveDir = currentWorkspacePath || workspaceRoot || "";
            const separator = navigator.userAgent.includes('Win') ? '\\' : '/';
            const absolutePath = targetFilePath.includes(resolveDir)
                ? targetFilePath
                : resolveDir + separator + targetFilePath.split(/[/\\]/).pop();
            await saveGeneratedCodeToFile(absolutePath, extractedCode);
        } else {
            const parsedTools = parseXmlTools(fullContent);

            // FIX #2: Collect all tool results first, THEN decide whether to recurse
            let toolFeedback = '';
            let isTaskFinished = false;

            if (parsedTools.length > 0) {
                for (const toolCall of parsedTools) {
                    if (agentAbortFlag) break;

                    if (toolCall.arguments && toolCall.arguments.path) {
                        toolCall.arguments.folderPath = toolCall.arguments.path;
                    }

                    const result = await executeToolCall(toolCall);
                    
                   if (result.isComplete) {
    const activeFile = getActiveFilePath();
    let isNaturallySmall = false;
    let fileContent = "";

    if (activeFile) {
        fileContent = await window.electronAPI.readFile(activeFile);
        isNaturallySmall = activeFile.endsWith('__init__.py') || activeFile.endsWith('.env') || activeFile.endsWith('.gitignore');
    }

    // Reject completion if the file is suspiciously empty
    if (activeFile && !isNaturallySmall && fileContent.trim().length < 50) {
        appendTerminalLine('⚠️ Agent attempted to quit, but the file is practically empty. Forcing continuation.');
        toolFeedback += `[ERROR]: You called taskComplete, but ${activeFile} is empty. You MUST use editFileContent to write the full logic before finishing.\n`;
        // Do NOT set isTaskFinished = true, let the loop continue
    } else {
        isTaskFinished = true;
        appendTerminalLine(`✅ Task Complete: ${result.message}`);
        break;
    }
}

                    appendTerminalLine(`✅ Tool [${toolCall.name}] → ${result.message}`);
                    // FIX #2: Only add to toolFeedback ONCE (was being double-added before)
                    toolFeedback += `[${toolCall.name} result]: ${result.message}\n`;

                    await updateProjectMemory({ lastAction: toolCall.name, status: 'success' });
                }
            }

            // FIX #2: Only recurse if: task not done, tools ran, there's real feedback, and under limit
            if (!isTaskFinished && !agentAbortFlag && parsedTools.length > 0 && toolFeedback.trim() !== '') {
                if (iteration < 4) {  // Max 4 iterations (was 3, sometimes needs one more)
                    const updatedTree = await getProjectContext(currentWorkspacePath);
                    const feedbackPrompt = `Tool results:\n${toolFeedback}\nCurrent workspace:\n${updatedTree}\n\nIf the task is fully complete, output ONLY:\n\`\`\`json\n{ "name": "taskComplete", "arguments": { "message": "Done" } }\n\`\`\`\nOtherwise continue with the next required action.`;
                    await askLocalAgent(dynamicSystemPrompt, feedbackPrompt, targetFilePath, iteration + 1);
                } else {
                    appendTerminalLine('⚠️ Max iterations reached. Stopping agent.');
                    appendChatBubble('system', '⚠️ Agent reached the iteration limit. Task may be incomplete.');
                }
            }
        }

        await loadWorkspace(currentWorkspacePath || workspaceRoot);
        
        if (iteration === 0) {
            if (loopStatus) loopStatus.textContent = 'Status: Idle';
            if (trackerPanel) trackerPanel.style.display = 'none';
            if (stopButton) stopButton.style.display = 'none';
            if (sendButton) sendButton.disabled = false;
        }
    } catch (error) {
        console.error('Agent Loop Error:', error);
        appendChatBubble('system', `❌ Agent crashed: ${error.message}`);
        if (loopStatus) loopStatus.textContent = 'Status: Error';
        if (trackerPanel) trackerPanel.style.display = 'none';
        if (stopButton) stopButton.style.display = 'none';
        if (sendButton) sendButton.disabled = false;
    }
}

function appendChatBubble(role, text) {
  const message = createChatMessage(role, text);
  return message ? message.row : null;
}

function getActiveFilePath() {
  if (!activeTabId) return null;
  const activeTab = tabs.find((tab) => tab.id === activeTabId);
  return activeTab ? activeTab.path : null;
}

function normalizeRequestedFilePath(prompt, fallbackPath) {
  const normalizedPrompt = prompt.toLowerCase();
  const explicitMatch = normalizedPrompt.match(/\b([a-z0-9_./-]+\.(?:py|js|ts|html|css|json|md))\b/);
  const sep = navigator.userAgent.includes('Win') ? '\\' : '/';
  const fallbackName = fallbackPath ? fallbackPath.split(/[/\\]/).pop().toLowerCase() : '';
  if (explicitMatch) {
    const candidate = explicitMatch[1];
    const candidateName = candidate.split(/[/\\]/).pop().toLowerCase();
    if (fallbackName === candidateName) return fallbackPath;
    const isAbsolute = /^([a-zA-Z]:\\|\/)/.test(candidate);
    if (isAbsolute) return candidate;
    const base = currentWorkspacePath || workspaceRoot ||
      (fallbackPath ? fallbackPath.split(/[/\\]/).slice(0, -1).join(sep) : '');
    return base + sep + candidate.split(/[/\\]/).join(sep);
  }
  return fallbackPath;
}

function openSettings() {
  if (settingsPanel) settingsPanel.style.display = settingsPanel.style.display === 'none' ? 'block' : 'none';
}

async function scanModels() {
  try {
    const response = await fetch('http://localhost:11434/api/tags');
    const data = await response.json();
    const models = data.models || [];
    if (!modelPicker) return;
    const currentValue = modelPicker.value;
    modelPicker.innerHTML = '';
    models.forEach((item) => {
      const option = document.createElement('option');
      option.value = item.name; option.textContent = item.name;
      modelPicker.appendChild(option);
    });
    modelPicker.value = currentValue || models[0]?.name || 'qwen2.5-coder:7b';
    appendTerminalLine(`Synced ${models.length} local Ollama model(s).`);
  } catch (error) {
    appendOutputLine(`Unable to sync Ollama models: ${error.message}`, 'error');
  }
}

function runActiveDocument() {
  if (!activeTabId) return;
  const activeTab = tabs.find((tab) => tab.id === activeTabId);
  if (!activeTab) return;
  const filePath = activeTab.path;
  const isWin = navigator.userAgent.includes('Win');
  const separator = isWin ? '\\' : '/';
  const pathParts = filePath.split(separator);
  const fullName = pathParts.pop();
  const dir = pathParts.join(separator);
  const nameParts = fullName.split('.');
  const ext = nameParts.length > 1 ? '.' + nameParts.pop().toLowerCase() : '';
  const fileName = nameParts.join('.');
  let command = '';
  if (ext === '.js') command = `node "${filePath}"`;
  if (ext === '.py') command = `python "${filePath}"`;
  if (ext === '.cpp') {
      const exePath = dir + separator + fileName + (isWin ? '.exe' : '');
      command = `g++ "${filePath}" -o "${exePath}" && "${exePath}"`;
  }
  if (ext === '.java') command = `javac "${filePath}" && java -cp "${dir}" "${fileName}"`;
  if (!command) { appendOutputLine(`Compiler/Runtime not configured for: ${ext}`, 'error'); return; }
  if (terminalPane) { terminalPane.innerHTML = ''; appendTerminalLine(`> ${command}`); }
  window.electronAPI.executeCommand({ command, cwd: currentWorkspacePath }).then((result) => {
    if (result.stdout) appendTerminalLine(result.stdout);
    if (result.stderr) appendTerminalLine(result.stderr, 'error');
    if (!result.success) appendOutputLine(`Build/Run failed (Exit Code: ${result.code})`, 'error');
    else appendOutputLine(`Execution finished successfully.`);
  }).catch((err) => appendOutputLine(`Execution error: ${err.message}`, 'error'));
}

async function runVisionNode(imageBase64, userQuestion) {
    appendTerminalLine('👁️ Vision Node (Moondream) analyzing...');
    const payload = {
        model: 'moondream',
        messages: [{ role: 'user', content: userQuestion, images: [imageBase64] }],
        stream: false
    };
    try {
        const response = await fetch('http://localhost:11434/api/chat', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await response.json();
        return data.message.content;
    } catch (error) {
        console.error("Vision Error:", error);
        return "Failed to analyze image.";
    }
}

function classifyIntent(prompt) {
  const lowerPrompt = prompt.toLowerCase();
  
  // 1. BUILD MODE MUST GO FIRST (Catches big project prompts)
  const buildKeywords = ['build ', 'create a ', 'scaffold', 'develop a ', 'project', 'application task'];
  if (buildKeywords.some(kw => lowerPrompt.includes(kw))) {
    return 'build';
  }

  // 2. FIX / DATA MODE
  const dataKeywords = ['excel', 'xlsx', 'csv', 'audit code', 'refactor this', 'clean the data'];
  if (dataKeywords.some(kw => lowerPrompt.includes(kw))) {
    return 'fix';
  }
  
  return 'chat';
}

async function runDirectorNode(userRequest) {
  const sys = `You are a UI/UX Creative Director. Give a short design blueprint for the user's request. Include hex colors, layout style, animations. Under 80 words.`;
  return await queryOllama('gemma3:4b', sys, userRequest, false) || "Modern dark mode, Tailwind CSS.";
}

async function getModelForTask(taskType) {
    switch(taskType) {
        case 'design': return 'gemma3:4b';
        case 'architect': return 'qwen3:4b';
        case 'code': return 'qwen2.5-coder:7b';
        case 'edit': return 'qwen2.5-coder:1.5b';
        default: return currentModel;
    }
}

// FIX #3: runArchitectNode — returns structured file list properly
async function runArchitectNode(userRequest, blueprint) {
  const architectModel = await getModelForTask('architect');

  const sys = `You are a Software Architect. Analyze the request and output the best file structure.
Output ONLY valid JSON — no explanation, no markdown, no prose:
{
  "projectType": "description",
  "files": [
    { "path": "relative/path/file.ext", "purpose": "Exactly what logic this file must contain" }
  ]
}`;

  const prompt = `Request: ${userRequest}\n\nOutput ONLY the JSON object, nothing else.`;
  const response = await queryOllama(architectModel, sys, prompt, false);

  try {
    const startIndex = response.indexOf('{');
    const endIndex = response.lastIndexOf('}') + 1;
    if (startIndex !== -1 && endIndex !== -1) {
        return JSON.parse(response.slice(startIndex, endIndex));
    }
    return JSON.parse(response);
  } catch (e) {
    appendTerminalLine(`❌ Architect parse error. Raw: ${response.substring(0, 200)}`);
    return null;
  }
}

// FIX #4: executeBlueprint — generates COMPLETE code with strict anti-truncation prompt
async function executeBlueprint(blueprint) {
    const root = currentWorkspacePath || workspaceRoot;
    if (!root) { appendChatBubble('system', '❌ No workspace open.'); return; }

    appendChatBubble('system', `📋 Building ${blueprint.files.length} files for: ${blueprint.projectType}`);

    for (const fileObj of blueprint.files) {
        if (agentAbortFlag) break;

        appendTerminalLine(`⚙️ Coding: ${fileObj.path}...`);
        appendChatBubble('system', `⚙️ Writing: ${fileObj.path}`);

        // Create the file first
        const createResult = await window.electronAPI.createFile({ baseDirectory: root, fileName: fileObj.path });
        if (!createResult || !createResult.success) {
            appendTerminalLine(`❌ Cannot create file: ${fileObj.path} — ${createResult?.error}`);
            continue;
        }
        const absolutePath = createResult.filePath;
        const fileName = absolutePath.split(/[/\\]/).pop();
        createTab(absolutePath, fileName);
        await loadWorkspace(currentWorkspacePath);

        const tabId = `tab-${absolutePath}`;
        const model = tabModels.get(tabId);
        const coderModel = await getModelForTask('code');
        const ext = fileObj.path.includes('.') ? '.' + fileObj.path.split('.').pop().toLowerCase() : '';

        // FIX #4: Ultra-strict prompt that prevents truncation
        let systemPrompt;
        if (ext === '.json') {
            systemPrompt = `Output ONLY valid JSON for "${fileObj.path}". Purpose: ${fileObj.purpose}. No markdown, no code fences, no explanation. Raw JSON only.`;
        } else if (ext === '.md' || ext === '.txt') {
            systemPrompt = `Write documentation for "${fileObj.path}". Purpose: ${fileObj.purpose}. Output raw text only.`;
        } else {
systemPrompt = `You are a ${blueprint.projectType} expert. Write the COMPLETE, PRODUCTION-READY code for "${fileObj.path}".
PURPOSE: ${fileObj.purpose}


ABSOLUTE RULES — VIOLATIONS ARE NOT ACCEPTABLE:
1. Write EVERY SINGLE LINE OF CODE. No placeholders.
2. Output the code inside standard Markdown fences (e.g., \`\`\`python).
1. Write EVERY SINGLE LINE. The file must be 100% complete and runnable.
2. ZERO placeholders. Never write "# TODO", "# Add logic here", "pass", or "..." anywhere.
3. Every function must have a FULL implementation with real logic.
4. Every import must be used. Every class must have real methods with real code.
5. Output ONLY raw code. NO markdown. NO \`\`\` fences. NO explanations. Start with the first line of code immediately.
6. If you run out of context, FINISH the current function before stopping. Never leave a half-written function.`;
        }

        const payload = {
            model: coderModel,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: `Write the complete code for ${fileObj.path} now. Start immediately with the first line.` }
            ],
            stream: true,
            options: {
                temperature: 0.05,   // Very low temp for deterministic, complete output
                num_ctx: 4096,       // FIX #4: Higher context = longer, more complete output
                num_predict: 4096    // FIX #4: Allow up to 4096 tokens per file
            }
        };

        try {
            const response = await fetch('http://localhost:11434/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!response.ok) throw new Error(`Stream failed: ${response.status}`);

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let liveCode = '';

            while (true) {
                if (agentAbortFlag) { reader.cancel(); break; }
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value, { stream: true });
                for (const line of chunk.split('\n')) {
                    if (line.trim() === '') continue;
                    try {
                        const parsed = JSON.parse(line);
                        const token = parsed.message?.content || '';
                        // FIX #4: Only strip markdown fences, not code content
                        if (token === '```' || token.match(/^```[a-z]*$/)) continue;
                        liveCode += token;
                        if (model) { model.setValue(liveCode); editor.revealLine(model.getLineCount()); }
                    } catch (e) {}
                }
            }

            // ⚡ FIX: Bulletproof code extractor. Markdown unna lekapoina perfect ga code laaguthundi.
            let finalCode = liveCode.trim();
            const codeBlockRegex = /```[a-z0-9_+-]*\n([\s\S]*?)```/i;
            const match = liveCode.match(codeBlockRegex);
            if (match && match[1]) {
                finalCode = match[1].trim();
            } else {
                finalCode = finalCode.replace(/^```[a-zA-Z0-9]*\n?/, '').replace(/\n?```$/, '').trim();
            }

            await saveGeneratedCodeToFile(absolutePath, finalCode);
            appendTerminalLine(`✅ Completed: ${fileObj.path} (${finalCode.split('\n').length} lines)`);

        } catch (error) {
            appendTerminalLine(`❌ Stream error for ${fileObj.path}: ${error.message}`);
        }
    }

    await loadWorkspace(currentWorkspacePath || workspaceRoot);
    appendChatBubble('agent', `✅ Build complete! ${blueprint.files.length} files generated.\n\nCheck the explorer to open your files.`);
}

async function getProjectContext(workspacePath) {
    if (!workspacePath) return "No files.";
    try {
        const response = await window.electronAPI.readDirectory(workspacePath);
        if (!response || !response.success) return "Error reading files.";
        const files = [];
        function extractPaths(nodes, currentPath = '') {
            for (const node of nodes) {
                const itemPath = currentPath ? `${currentPath}/${node.name}` : node.name;
                if (node.isDirectory && node.children) extractPaths(node.children, itemPath);
                else files.push(itemPath);
            }
        }
        extractPaths(response.tree);
        return files.join('\n');
    } catch (e) { return "Error reading files."; }
}

function registerEventHooks() {
  if (sendButton) {
    sendButton.addEventListener('click', async () => {
    if (!composerInput) return;
    const userPrompt = composerInput.value.trim();
    if (!userPrompt) return;

    composerInput.value = '';
    currentModel = modelPicker ? modelPicker.value : 'qwen2.5-coder:7b';
    appendChatBubble('user', userPrompt);

    if (!currentWorkspacePath) {
        appendChatBubble('system', '❌ Please open a workspace folder first.');
        return;
    }

const MASTERMIND_PROMPT = `You are the SPOIL Mastermind AI agent with full control over the development environment.

TOOL CALL FORMAT — XML TAGS:
Do not use JSON. You MUST use the following custom XML tags to execute actions.

To create a new file or completely overwrite it, use this exact format:
<create_file path="folder/filename.ext">
\`\`\`language
// Complete, production-ready code goes here without placeholders
\`\`\`
</create_file>

To finish the task and announce you are done, use:
<task_complete>
Describe what you have successfully built here.
</task_complete>

PROTOCOL:
1. CHAIN OF THOUGHT: Before you output any XML tag, you MUST write exactly one sentence of plain text explaining what you are about to do and why.
2. NO PLACEHOLDERS: Always write the FULL, complete code inside the <create_file> or <edit_file> tags. No partial updates allowed.
3. COMPLETION: When the job is done, use the <task_complete> tag to announce completion. Do not use JSON.`;


    const userIntent = classifyIntent(userPrompt);

    if (userIntent === "chat") {
        appendChatBubble('system', '💬 Chat Mode...');
        await askLocalAgent("You are a helpful coding assistant.", userPrompt);
    } else if (userIntent === "fix") {
        appendChatBubble('system', '🧠 Mastermind activated...');
        const projectTree = await getProjectContext(currentWorkspacePath);
        const activeFile = getActiveFilePath() || "None";
        await askLocalAgent(
            MASTERMIND_PROMPT,
            `Workspace files:\n${projectTree}\n\nCurrently open: ${activeFile}\n\nUser request: ${userPrompt}`,
            null, 0
        );
    } else if (userIntent === "build") {
        appendChatBubble('system', '🏗️ Architect is designing the blueprint...');
        const blueprintJSON = await runArchitectNode(userPrompt, "");
        if (blueprintJSON && blueprintJSON.files && blueprintJSON.files.length > 0) {
            appendChatBubble('system', `📋 Blueprint ready: ${blueprintJSON.files.length} files to build.`);
            await executeBlueprint(blueprintJSON);
        } else {
            appendChatBubble('system', '❌ Architect failed. Try being more specific about what to build.');
            appendTerminalLine('Architect returned: ' + JSON.stringify(blueprintJSON));
        }
    }
  });
  }

  if (stopButton) {
    stopButton.addEventListener('click', () => {
      agentAbortFlag = true;
      appendChatBubble('system', '🛑 Agent stopped by user.');
      if (stopButton) stopButton.style.display = 'none';
      if (sendButton) sendButton.disabled = false;
      const loopStatus = document.getElementById('agent-loop-status');
      if (loopStatus) loopStatus.textContent = 'Status: Stopped';
    });
  }

  if (composerInput) {
    composerInput.addEventListener('keydown', async (event) => {
      if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); sendButton.click(); }
    });
  }

  document.querySelectorAll('.dock-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.dock-tab').forEach((node) => node.classList.remove('active'));
      document.querySelectorAll('.dock-pane').forEach((pane) => pane.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(tab.dataset.pane).classList.add('active');
    });
  });

  document.querySelectorAll('.activity-icon').forEach((icon) => {
    icon.addEventListener('click', () => {
      currentAction = icon.dataset.action;
      document.querySelectorAll('.activity-icon').forEach((node) => node.classList.remove('active'));
      icon.classList.add('active');
      if (currentAction === 'search') openCommandPalette();
      else if (currentAction === 'settings') openSettings();
      else if (currentAction === 'git') appendOutputLine('Source control ready.');
    });
  });

  if (commandPaletteOverlay) {
    commandPaletteOverlay.addEventListener('click', (event) => {
      if (event.target === commandPaletteOverlay) closeCommandPalette();
    });
  }

  if (commandPaletteInput) {
    commandPaletteInput.addEventListener('input', (event) => renderCommandPalette(event.target.value));
    commandPaletteInput.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') { event.preventDefault(); closeCommandPalette(); if (composerInput) composerInput.focus(); }
    });
  }

  if (refreshExplorer) refreshExplorer.addEventListener('click', () => { if (currentWorkspacePath) loadWorkspace(currentWorkspacePath); });
  if (openFolderBtn) openFolderBtn.addEventListener('click', openFolderDialog);

  if (sidebarContextMenu) {
    sidebarContextMenu.addEventListener('click', (event) => {
      const action = event.target.dataset.action;
      sidebarContextMenu.style.display = 'none';
      if (action === 'new-file') {
        const fileName = prompt('New file name', 'untitled.txt');
        if (fileName) createFileAtPath(currentWorkspacePath || workspaceRoot, fileName);
      }
      if (action === 'refresh') loadWorkspace(currentWorkspacePath || workspaceRoot);
    });
  }

  document.addEventListener('click', () => { if (sidebarContextMenu) sidebarContextMenu.style.display = 'none'; });

  if (scanModelsBtn) scanModelsBtn.addEventListener('click', scanModels);
  if (aiProviderPicker) aiProviderPicker.addEventListener('change', () => { aiProvider = aiProviderPicker.value || 'local'; saveAiSettings(); });
  if (apiBaseUrlInput) apiBaseUrlInput.addEventListener('change', () => { aiApiBaseUrl = normalizeApiBaseUrl(apiBaseUrlInput.value); saveAiSettings(); });
  if (apiKeyInput) apiKeyInput.addEventListener('change', () => { aiApiKey = apiKeyInput.value.trim(); saveAiSettings(); });
  if (apiModelInput) apiModelInput.addEventListener('change', () => { aiApiModel = apiModelInput.value.trim() || aiApiModel; saveAiSettings(); });
  if (modelPicker) modelPicker.addEventListener('change', () => { currentModel = modelPicker.value; saveAiSettings(); });
  if (wordWrapMode) wordWrapMode.addEventListener('change', applyEditorOptions);
  if (minimapMode) minimapMode.addEventListener('change', applyEditorOptions);
  if (autosaveMode) autosaveMode.addEventListener('change', () => { editorAutoSave = autosaveMode.value === 'on'; });

  window.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'l') { event.preventDefault(); if (composerInput) { composerInput.focus(); composerInput.select(); } }
    if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'p') { event.preventDefault(); openCommandPalette(); }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') { event.preventDefault(); runEditorAction(['editor.action.startFindReplaceAction', 'actions.find']); }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'h') { event.preventDefault(); runEditorAction(['editor.action.startFindReplaceAction', 'actions.replace']); }
    if (event.key === 'F5') { event.preventDefault(); runActiveDocument(); }
  });
}

async function bootstrap() {
  try {
    await loadAiSettings();
    hydrateAiSettingsUi();
    applyEditorOptions();
    registerEventHooks();
    window.MonacoEnvironment = {
      getWorkerUrl: function (workerId, label) {
        const basePath = window.location.href.replace(/\/index\.html.*$/, '');
        const workerCode = `
          self.MonacoEnvironment = { baseUrl: '${basePath}/node_modules/monaco-editor/min/' };
          importScripts('${basePath}/node_modules/monaco-editor/min/vs/base/worker/workerMain.js');
        `;
        const blob = new Blob([workerCode], { type: 'application/javascript' });
        return URL.createObjectURL(blob);
      }
    };

    window.require.config({ paths: { 'vs': './node_modules/monaco-editor/min/vs' } });
    window.require(['vs/editor/editor.main'], async function () {
      monaco = window.monaco;
      editor = monaco.editor.create(editorHost, {
        value: '// Select a file or workspace to begin coding...',
        language: 'javascript', theme: 'vs-dark', automaticLayout: true,
        minimap: { enabled: true }, wordWrap: 'on', fontSize: 14, tabSize: 2
      });
      editor.onDidChangeModelContent(() => { if (!editorAutoSave || !activeTabId) return; saveActiveDocument(); });
      appendOutputLine('Monaco Editor initialized.');

      const homeResponse = await window.electronAPI.getOSHomePath();
      if (homeResponse && homeResponse.success) {
        const separator = navigator.userAgent.includes('Win') ? '\\' : '/';
        const defaultWorkspace = homeResponse.homePath + separator + 'Desktop';
        workspaceRoot = defaultWorkspace;
        currentWorkspacePath = defaultWorkspace;
        if (workspaceBannerText) workspaceBannerText.textContent = defaultWorkspace;
        if (workspaceStatus) workspaceStatus.textContent = 'Using Desktop workspace';
        await loadWorkspace(defaultWorkspace);
        setStatus('SPOIL Editor • Ready', defaultWorkspace);
      }
      appendTerminalLine('SPOIL shell online. Ready for agent execution.');
    });
  } catch (error) {
    console.error("SPOIL CRASH LOG:", error);
    appendOutputLine(`Bootstrap failed: ${error.message}`, 'error');
  }
}

if (window.electronAPI && window.electronAPI.onMenuAction) {
  window.electronAPI.onMenuAction(async (actionName, payload) => {
    switch (actionName) {
      case 'menu-open-file-path': if (payload) hydrateEditorModelForPath(payload); break;
      case 'menu-open-workspace-folder':
        if (payload) { workspaceRoot = payload; currentWorkspacePath = payload; if (workspaceBannerText) workspaceBannerText.textContent = payload; await loadWorkspace(payload); }
        break;
      case 'menu-new-file':
        const fileName = prompt('New file name', 'untitled.txt');
        if (fileName) createFileAtPath(currentWorkspacePath || workspaceRoot, fileName);
        break;
      case 'menu-save': case 'menu-trigger-save': saveActiveDocument(); break;
      case 'menu-save-as':
        if (!activeTabId) return;
        const activeTab = tabs.find((tab) => tab.id === activeTabId);
        if (!activeTab) return;
        const result = await window.electronAPI.saveFileAs({ filePath: activeTab.path, content: editor.getValue() });
        if (result && result.success) {
          activeTab.path = result.filePath;
          activeTab.label = result.filePath.split(/[/\\]/).pop();
          activeTab.tab.querySelector('span').textContent = activeTab.label;
          setStatus('Saved As', result.filePath);
        }
        break;
      case 'menu-run-execute': case 'menu-run-debug': runActiveDocument(); break;
      case 'menu-focus-composer': if (composerInput) composerInput.focus(); break;
      case 'menu-toggle-palette': openCommandPalette(); break;
      case 'menu-find': runEditorAction(['editor.action.startFindReplaceAction', 'actions.find']); break;
      case 'menu-replace': runEditorAction(['editor.action.startFindReplaceAction', 'actions.replace']); break;
      case 'menu-terminal-new': appendTerminalLine('New terminal session.'); break;
      case 'menu-terminal-clear': if (terminalPane) terminalPane.innerHTML = ''; break;
      default: console.warn('Unknown menu action:', actionName);
    }
  });
}

async function deployTemplate(folderName) {
    const result = await window.electronAPI.deployTemplate(folderName, workspaceRoot);
    if (result.success) {
        currentWorkspacePath = result.rootPath;
        await loadWorkspace(result.rootPath);
    } else {
        appendOutputLine(`Template deployment failed: ${result.error}`, 'error');
    }
}

async function cloneTemplate(templateName, destinationName) {
    appendTerminalLine(`📂 Cloning ${templateName}...`);
    const result = await window.electronAPI.cloneTemplate(templateName, destinationName, currentWorkspacePath);
    if (result.success) {
        await loadWorkspace(currentWorkspacePath);
        appendTerminalLine(`✅ Clone complete.`);
        return true;
    } else {
        appendOutputLine(`❌ Clone failed: ${result.error}`, 'error');
        return false;
    }
}

async function updateProjectMemory(agentContext) {
    if (!currentWorkspacePath) return;
    const separator = navigator.userAgent.includes('Win') ? '\\' : '/';
    const memoryPath = currentWorkspacePath + separator + '.spoil.json';
    const memoryData = { lastUpdated: new Date().toISOString(), goal: currentProjectGoal, ...agentContext };
    await window.electronAPI.saveFile({ filePath: memoryPath, content: JSON.stringify(memoryData, null, 2) });
}

function applyPatchToCode(originalCode, diffContent) {
  if (!Diff) { console.warn("Patching skipped."); return originalCode; }
  try { return Diff.applyPatch(originalCode, diffContent); }
  catch (e) { console.error("Patching failed:", e); return originalCode; }
}

bootstrap().catch((error) => console.error("Bootstrap failed:", error));

// ============================================================================
// RESTORED FUNCTIONS (were in original but missing from fix)
// ============================================================================

async function generateAndWriteFiles(fileList, prompt, blueprint) {
    const root = currentWorkspacePath || workspaceRoot;
    const sep = navigator.userAgent.includes('Win') ? '\\' : '/';

    for (const file of fileList) {
        if (agentAbortFlag) break;
        appendTerminalLine(`Injecting code into ${file}...`);

        const systemPrompt = `You are a Senior React Engineer.
Write the FULL, COMPLETE production-ready code for ${file}.
RULES:
1. Write the entire file content. NO placeholders, NO comments like "// ...".
2. Use Tailwind CSS for all styling.
3. Output ONLY the raw code — no markdown fences, no explanation.
4. num_predict is high — use it. Write every single line.`;

        const promptText = `Project Request: ${prompt}\nBlueprint: ${blueprint}\nFile to build: ${file}\n\nWrite the complete code now.`;

        const rawResponse = await queryOllama(currentModel, systemPrompt, promptText, false);
        // Strip any accidental fences
        const code = rawResponse.replace(/^```[a-zA-Z0-9]*\n?/, '').replace(/\n?```$/, '').trim();

        const absolutePath = root + sep + file.split(/[/\\]/).join(sep);
        await window.electronAPI.saveFile({ filePath: absolutePath, content: code });
        hydrateEditorModelForPath(absolutePath);
        appendTerminalLine(`✅ Written: ${file} (${code.split('\n').length} lines)`);
    }
}

function askUserApproval(explanation, goal, onAllow, onSkip) {
  const card = document.createElement('div');
  card.className = 'chat-bubble system';
  card.style.cssText = 'background:#1e1e24;border:1px solid var(--border);padding:14px;border-radius:10px;display:flex;flex-direction:column;gap:10px;margin:10px 0;';

  card.innerHTML = `
    <div style="color:var(--accent-2);font-weight:bold;font-size:11px;text-transform:uppercase;">⚡ Agent Action Request</div>
    <div style="font-size:13px;color:#efefef;"><strong>Explanation:</strong> ${explanation}</div>
    <div style="font-size:12px;color:var(--muted-text);"><strong>Goal:</strong> ${goal}</div>
    <div style="display:flex;gap:10px;margin-top:6px;">
      <button id="btn-allow-agent" style="background:var(--accent);color:#fff;border:none;padding:6px 14px;border-radius:6px;font-weight:bold;cursor:pointer;">Allow</button>
      <button id="btn-skip-agent" style="background:transparent;color:var(--muted-text);border:1px solid var(--border);padding:6px 14px;border-radius:6px;cursor:pointer;">Skip</button>
    </div>
  `;

  chatHistory.appendChild(card);
  chatHistory.scrollTop = chatHistory.scrollHeight;

  card.querySelector('#btn-allow-agent').addEventListener('click', () => { card.remove(); onAllow(); });
  card.querySelector('#btn-skip-agent').addEventListener('click', () => {
    card.remove();
    appendChatBubble('system', 'Action skipped by user.');
    onSkip();
  });
}

function updateAgentChecklist(stepNum, totalSteps, text, status = 'pending') {
  const container = document.getElementById('agent-todo-list-container');
  if (!container) return;
  let stepId = `agent-step-${stepNum}`;
  let stepEl = document.getElementById(stepId);
  if (!stepEl) {
    stepEl = document.createElement('div');
    stepEl.id = stepId;
    stepEl.style.cssText = 'display:flex;justify-content:space-between;font-size:12px;padding:4px 0;';
    container.appendChild(stepEl);
  }
  let statusIcon = '⏳'; let textColor = '#9b9b9b';
  if (status === 'active')  { statusIcon = '⚡'; textColor = '#5ebfec'; }
  if (status === 'done')    { statusIcon = '✅'; textColor = '#4ade80'; }
  if (status === 'failed')  { statusIcon = '❌'; textColor = '#ff6b6b'; }
  stepEl.innerHTML = `<span style="color:${textColor}">${statusIcon} (${stepNum}/${totalSteps}) ${text}</span>`;
}

// FIX: runReviewerNode — skips non-code files, won't trigger captureAndAnalyze loop
async function runReviewerNode(filePath, code) {
  const skipExtensions = ['.json', '.xlsx', '.png', '.jpg', '.gif', '.ico', '.svg', '.lock'];
  const fileName = filePath.split(/[/\\]/).pop();
  if (skipExtensions.some(ext => fileName.endsWith(ext))) {
    appendTerminalLine(`⏭️ Skipping audit for: ${fileName}`);
    return;
  }

  const sys = `You are a Senior Code Reviewer. Audit this code for:
1. Performance bottlenecks.
2. Readability and clean code practices.
3. Modern patterns appropriate for this language.

If you find improvements, use 'editFileContent' to apply them.
If the code is already good, output ONLY:
\`\`\`json
{ "name": "taskComplete", "arguments": { "message": "Code is already optimized." } }
\`\`\`

DO NOT call captureAndAnalyze. DO NOT take screenshots. Only review the code provided.`;

  appendTerminalLine(`🔍 Auditing ${fileName}...`);
  await askLocalAgent(sys, `Audit this file: ${filePath}\n\nCode:\n\`\`\`\n${code}\n\`\`\``, null, 0);
}

async function generatePremiumBlueprint(userRequest) {
  const blueprintPrompt = `You are a world-class UI/UX Web Designer.
The user wants to build: "${userRequest}"

Give a "Premium Design Blueprint":
1. A modern color palette (Tailwind hex codes).
2. 4-5 sections with names (e.g., Hero, Bento Grid, Animated Footer).
3. Animations to use.
4. Typography choices.

Keep under 150 words. Be specific.`;

  const payload = {
    model: currentModel,
    messages: [{ role: 'user', content: blueprintPrompt }],
    stream: false,
    options: { temperature: 0.4 }
  };

  try {
    const response = await fetch('http://localhost:11434/api/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    return data.message.content;
  } catch (error) {
    return "Modern minimalist, dark mode, Tailwind CSS, smooth transitions.";
  }
}