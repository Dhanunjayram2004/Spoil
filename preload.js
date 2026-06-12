// preload.js

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    createFile: (data) => ipcRenderer.invoke('create-file', data),    saveFile: (data) => ipcRenderer.invoke('save-file', data),
    saveFileAs: (data) => ipcRenderer.invoke('save-file-as', data),
    runTool: (data) => ipcRenderer.invoke('run-tool', data),
    readFile: (filePath) => ipcRenderer.invoke('read-file', filePath),
    agentFs: (action, payload) => ipcRenderer.invoke('agent-fs', action, payload),
    
    deployTemplate: (folderName, workspaceRoot) => ipcRenderer.invoke('deploy-template', { folderName, workspaceRoot }),
    cloneTemplate: (templateName, destinationName, currentWorkspacePath) => ipcRenderer.invoke('clone-template', { templateName, destinationName, currentWorkspacePath }),
    // 2. Directory/Workspace Operations
    selectFolder: () => ipcRenderer.invoke('select-folder'),
    readDirectory: (folderPath) => ipcRenderer.invoke('agent-read-directory', folderPath),
    
    // 3. State Management
    saveState: (data) => ipcRenderer.invoke('save-state', data),
    loadState: () => ipcRenderer.invoke('load-state'),
    
    // 4. Execution & Tools
    executeCommand: (cmdData) => ipcRenderer.invoke('execute-command', cmdData),
    stopCommand: () => ipcRenderer.invoke('stop-active-command'),
    captureScreen: () => ipcRenderer.invoke('capture-screen'),
    
    // 5. System Info
    getOSHomePath: () => ipcRenderer.invoke('get-os-home-path'),
    // Add these inside the electronAPI object:
    saveApiKey: (key) => ipcRenderer.invoke('save-api-key', key),
    loadApiKey: () => ipcRenderer.invoke('load-api-key'),

    // 6. Listener for menu actions (Renderer lo already logic unte idi optional)
// This should be in your preload.js
onMenuAction: (callback) => ipcRenderer.on('menu-action', (event, ...args) => callback(...args))});