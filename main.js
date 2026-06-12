// ============================================================================

// SPOIL EDITOR - ENTERPRISE MAIN RUNTIME CORE ENGINE (main.js)

// ============================================================================

const { app, BrowserWindow, Menu, ipcMain, dialog, shell,desktopCapturer } = require('electron');
const path = require('path');
const fs = require('fs'); // For Sync operations
const fsPromises = require('fs').promises; // For Async operations
const os = require('os');

const { spawn } = require('child_process');
const Tools = require('./tools');

// ⚡ Cache folder creation (Sync is okay here because it's startup)
const spoilCacheDir = path.join(os.homedir(), '.spoil-editor', 'cache');
if (!fs.existsSync(spoilCacheDir)) {
  fs.mkdirSync(spoilCacheDir, { recursive: true });
}
let store = { get: () => ({}), set: () => {} };
(async () => {
    try {
        const Store = (await import('electron-store')).default;
        store = new Store({ name: 'spoil-config' });
    } catch (err) {
        console.warn("Electron store failed to load, using memory fallback.");
    }
})();



// ⚡ SYSTEM ACCELERATION CONFIGURATIONS & HARDWARE SAFE SWITCHES

app.commandLine.appendSwitch('disk-cache-dir', spoilCacheDir);

app.commandLine.appendSwitch('disable-gpu');

app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');

app.commandLine.appendSwitch('disable-software-rasterizer');

app.commandLine.appendSwitch('no-sandbox');

app.commandLine.appendSwitch('disable-gpu-sandbox');



let mainWindow = null;



function createWindow() {

  mainWindow = new BrowserWindow({

    width: 1480,

    height: 920,

    title: 'SPOIL Editor',

    backgroundColor: '#181818',

    webPreferences: {
    nodeIntegration: false,    // ✅ BACK TO TRUE
    contextIsolation: true,  // ✅ BACK TO FALSE
    enableRemoteModule: false,
    sandbox: false,           // ✅ BACK TO FALSE
    preload: path.join(__dirname, 'preload.js')
  }

  });



  mainWindow.loadFile('index.html');
  mainWindow.webContents.openDevTools(); // 👈 ADD THIS LINE

  mainWindow.setMenu(Menu.buildFromTemplate(buildMenuTemplate()));



  mainWindow.on('closed', () => {

    mainWindow = null;

    if (activeChildProcess) {

      try { activeChildProcess.kill(); } catch (e) {}

    }

  });

}



function buildMenuTemplate() {

  return [

    {

      label: 'File',

      submenu: [

        { label: 'New File', accelerator: 'CmdOrCtrl+N', click: () => triggerRendererAction('menu-new-file') },

        { label: 'Open File...', accelerator: 'CmdOrCtrl+O', click: async () => {

          const result = await dialog.showOpenDialog(mainWindow, { properties: ['openFile'] });

          if (!result.canceled && result.filePaths.length > 0) {

            triggerRendererAction('menu-open-file-path', result.filePaths[0]);

          }

        } },

        { label: 'Open Folder...', accelerator: 'CmdOrCtrl+Shift+O', click: async () => {

          const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });

          if (!result.canceled && result.filePaths.length > 0) {

            triggerRendererAction('menu-open-workspace-folder', result.filePaths[0]);

          }

        } },

        { type: 'separator' },

        { label: 'Save', accelerator: 'CmdOrCtrl+S', click: () => triggerRendererAction('menu-trigger-save') },

        { label: 'Save As...', accelerator: 'CmdOrCtrl+Shift+S', click: () => triggerRendererAction('menu-save-as') },

        { type: 'separator' },

        { label: 'Quit', accelerator: 'CmdOrCtrl+Q', role: 'quit' }

      ]

    },

    {

      label: 'Edit',

      submenu: [

        { label: 'Undo', role: 'undo' },

        { label: 'Redo', role: 'redo' },

        { type: 'separator' },

        { label: 'Cut', role: 'cut' },

        { label: 'Copy', role: 'copy' },

        { label: 'Paste', role: 'paste' },

        { type: 'separator' },

        { label: 'Find', accelerator: 'CmdOrCtrl+F', click: () => triggerRendererAction('menu-find') },

        { label: 'Replace', accelerator: 'CmdOrCtrl+H', click: () => triggerRendererAction('menu-replace') },

        { type: 'separator' },

        { label: 'Select All', role: 'selectAll' }

      ]

    },

    {

      label: 'Selection',

      submenu: [

        { label: 'Expand Selection', accelerator: 'Shift+Alt+Right', click: () => triggerRendererAction('menu-selection-expand') },

        { label: 'Shrink Selection', accelerator: 'Shift+Alt+Left', click: () => triggerRendererAction('menu-selection-shrink') }

      ]

    },

    {

      label: 'View',

      submenu: [

        { label: 'Command Palette...', accelerator: 'CmdOrCtrl+Shift+P', click: () => triggerRendererAction('menu-toggle-palette') },

        { label: 'Open AI Composer', accelerator: 'CmdOrCtrl+L', click: () => triggerRendererAction('menu-focus-composer') },

        { type: 'separator' },

        { label: 'Toggle Full Screen', role: 'togglefullscreen' },

        { label: 'Toggle Developer Tools', accelerator: 'F12', role: 'toggleDevTools' },

        { label: 'Zoom In', role: 'zoomIn' },

        { label: 'Zoom Out', role: 'zoomOut' },

        { label: 'Reset Zoom', role: 'resetZoom' }

      ]

    },

    {

      label: 'Run',

      submenu: [

        { label: 'Run Active File', accelerator: 'F5', click: () => triggerRendererAction('menu-run-execute') },

        { label: 'Run and Debug', accelerator: 'F6', click: () => triggerRendererAction('menu-run-debug') }

      ]

    },

    {

      label: 'Terminal',

      submenu: [

        { label: 'New Terminal', accelerator: 'CmdOrCtrl+Shift+`', click: () => triggerRendererAction('menu-terminal-new') },

        { label: 'Split Terminal', accelerator: 'CmdOrCtrl+Shift+5', click: () => triggerRendererAction('menu-terminal-split') },

        { label: 'Clear Terminal', click: () => triggerRendererAction('menu-terminal-clear') }

      ]

    },

    {

      label: 'Help',

      submenu: [

        { label: 'Open Documentation', click: async () => shell.openExternal('https://github.com') },

        { label: 'Playground', click: () => triggerRendererAction('menu-help-playground') },

        { label: 'About SPOIL Editor', click: () => dialog.showMessageBox(mainWindow, {

          type: 'info',

          title: 'SPOIL Editor',

          message: 'Hybrid Next-Gen IDE Pipeline',

          detail: 'Integrated VS Code Layout + Cursor Autonomous Factory Tracking Loop Engine.'

        }) }

      ]

    }

  ];

}



function triggerRendererAction(actionName, payload = null) {

  if (mainWindow && mainWindow.webContents) {
    mainWindow.webContents.send('menu-action', actionName, payload);

  }

}



// ⚡ REFACTORED: Safe Directory Tree Reader with Strict Infinite Loop Guards

function getDirectoryTree(folderPath) {

  try {

    const baseName = path.basename(folderPath);

    // Heavy folders ని ఇన్స్టెంట్ గా స్కిప్ చేసి మెమరీ లాగ్స్ ని ఆపేస్తుంది!

    if (baseName === 'node_modules' || baseName === '.git' || baseName === 'cache' || baseName === '.spoil-editor') {

      return [];

    }



    const entries = fs.readdirSync(folderPath, { withFileTypes: true })

      .map((entry) => ({

        name: entry.name,

        path: path.join(folderPath, entry.name),

        isDirectory: entry.isDirectory()

      }))

      .sort((a, b) => {

        if (a.isDirectory !== b.isDirectory) {

          return Number(b.isDirectory) - Number(a.isDirectory);

        }

        return a.name.localeCompare(b.name);

      });



    const tree = [];

    for (const entry of entries) {

      if (!entry.isDirectory) {

        tree.push(entry);

      } else {

        tree.push({

          ...entry,

          children: getDirectoryTree(entry.path) // Recursion remains perfectly guarded here

        });

      }

    }

    return tree;

  } catch (e) {

    return [];

  }

}



function safeResolveHome() {

  const desktopPath = path.join(os.homedir(), 'Desktop');

  return fs.existsSync(desktopPath) ? desktopPath : os.homedir();

}



// --- ⚡ NATIVE CONTROL DRIVERS IPC HOOKS INTERFACES ---
ipcMain.handle('capture-screen', async () => {
    const sources = await desktopCapturer.getSources({ 
        types: ['screen'], 
        thumbnailSize: { width: 1280, height: 720 } 
    });
    
    // Check if a source actually exists
    if (sources.length > 0) {
        return sources[0].thumbnail.toDataURL();
    } else {
        throw new Error("No screen source found for capture.");
    }
});
// ⚡ UNIVERSAL AGENT FILE SYSTEM BRIDGE
ipcMain.handle('agent-fs', async (event, action, payload) => {
    try {
        if (action === 'homedir') return { success: true, data: os.homedir() };
        if (action === 'exists') return { success: true, data: fs.existsSync(payload.path) };
        if (action === 'mkdir') { fs.mkdirSync(payload.path, { recursive: true }); return { success: true }; }
        if (action === 'rm') { fs.rmSync(payload.path, { recursive: true, force: true }); return { success: true }; }
        if (action === 'rename') { fs.renameSync(payload.src, payload.dest); return { success: true }; }
        if (action === 'cp') { fs.cpSync(payload.src, payload.dest, { recursive: true }); return { success: true }; }
        if (action === 'readdir') { return { success: true, data: fs.readdirSync(payload.path) }; }
        return { success: false, error: 'Unknown action' };
    } catch (err) {
        return { success: false, error: err.message };
    }
});
ipcMain.handle('run-tool', async (event, data) => {
    return await Tools.executeExternalTool(data.name, data.args);
});
ipcMain.handle('get-os-home-path', async () => ({ success: true, homePath: os.homedir() }));

// --- STATE PERSISTENCE IPC HANDLERS ---
ipcMain.handle('save-project-state', async (event, data) => {
    store.set(data);
    return { success: true };
});

ipcMain.handle('load-project-state', async () => {
    return store.store; // Motham state ni return chesthundi
});

ipcMain.handle('select-folder', async () => {

  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'], createDirectory: true });

  if (result.canceled || result.filePaths.length === 0) return null;

  return { folderPath: result.filePaths[0] };

});
ipcMain.handle('create-file', async (event, { baseDirectory, fileName }) => {
    const fs = require('fs');
    const path = require('path');
    
    try {
        const finalPath = path.join(baseDirectory, fileName);
        // Folder lekapothe create chesthundi
        fs.mkdirSync(path.dirname(finalPath), { recursive: true });
        // File create chesthundi
        fs.writeFileSync(finalPath, '', 'utf8');
        
        return { success: true, filePath: finalPath };
    } catch (err) {
        return { success: false, error: err.message };
    }
});
// --- STATE PERSISTENCE IPC HANDLERS ---
// Merge chesi unified ga manage cheyandi
// KEEP ONLY THIS BLOCK and delete the 'save-project-state' duplicates:
ipcMain.handle('save-state', async (event, data) => {
    try {
        store.set(data);
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

// ADD THESE TWO NEW HANDLERS:
ipcMain.handle('save-api-key', async (event, key) => {
    store.set('secureApiKey', key);
    return { success: true };
});

ipcMain.handle('load-api-key', async () => {
    return store.get('secureApiKey', '');
});

ipcMain.handle('load-state', async () => {
    return store.store; 
});



// --- 2. ASYNC DIRECTORY READER (No Lag!) ---
// main.js lo eeh function ni update cheyi
ipcMain.handle('agent-read-directory', async (event, folderPath) => {
    const fsPromises = require('fs').promises;
    async function buildTreeAsync(currentPath, depth = 0) {
        if (depth > 4) return []; // ⚡ FIX: Depth pencham, ippudu lopaliki unna folders kuda kanipisthai!
        try {
            const items = await fsPromises.readdir(currentPath, { withFileTypes: true });
            const tree = [];
            for (const item of items) {
                if (['node_modules', '.git', '.next', 'cache', '.spoil-editor'].includes(item.name)) continue;
                const fullPath = path.join(currentPath, item.name);
                if (item.isDirectory()) {
                    tree.push({ name: item.name, path: fullPath, isDirectory: true, children: await buildTreeAsync(fullPath, depth + 1) });
                } else {
                    tree.push({ name: item.name, path: fullPath, isDirectory: false });
                }
            }
            return tree;
        } catch (e) { return []; }
    }
    const treeData = await buildTreeAsync(folderPath);
    return { success: true, tree: treeData };
});



ipcMain.handle('read-file', async (event, filePath) => {
    try { 
        return await fsPromises.readFile(filePath, 'utf8'); 
    } catch (error) { 
        return `Error: ${error.message}`; 
    }
});



// Fix: Use fsPromises here
ipcMain.handle('save-file', async (event, { filePath, content }) => {
  try {
    await fsPromises.mkdir(path.dirname(filePath), { recursive: true });
    await fsPromises.writeFile(filePath, content || '', 'utf8');
    return { success: true };
  } catch (error) { 
    return { success: false, error: error.message }; 
  }
});



ipcMain.handle('save-file-as', async (event, { filePath, content }) => {

  try {

    const defaultPath = filePath || path.join(safeResolveHome(), 'untitled.txt');

    const result = await dialog.showSaveDialog(mainWindow, { defaultPath });

    if (result.canceled) return { success: false, canceled: true };

   

    fs.mkdirSync(path.dirname(result.filePath), { recursive: true });

    fs.writeFileSync(result.filePath, content || '', 'utf8');

    return { success: true, filePath: result.filePath };

  } catch (error) { return { success: false, error: error.message }; }

});



let activeChildProcess = null;



ipcMain.handle('execute-command', async (event, { command, cwd }) => {

  return new Promise((resolve) => {

    if (activeChildProcess) {

      try { activeChildProcess.kill(); } catch (e) {}

    }



    activeChildProcess = spawn(command, { shell: true, cwd: cwd || process.cwd(), env: process.env });

    let stdout = ''; let stderr = '';



    activeChildProcess.stdout.on('data', (chunk) => { stdout += chunk.toString(); });

    activeChildProcess.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

   

    activeChildProcess.on('close', (code) => {

      activeChildProcess = null;

      resolve({ success: code === 0, code, stdout, stderr });

    });

    activeChildProcess.on('error', (error) => {

      activeChildProcess = null;

      resolve({ success: false, code: -1, stdout, stderr: error.message });

    });

  });

});



ipcMain.handle('stop-active-command', async () => {

  if (activeChildProcess) {

    try {

      if (process.platform === 'win32') {

        spawn("taskkill", ["/pid", activeChildProcess.pid, '/f', '/t']);

      } else {

        activeChildProcess.kill('SIGINT');

      }

      activeChildProcess = null;

      return { success: true };

    } catch (error) {

      return { success: false, error: error.message };

    }

  }

  return { success: false, error: 'No active process running' };

});
ipcMain.handle('deploy-template', async (event, { folderName, workspaceRoot }) => {
    try {
        const root = workspaceRoot ? path.join(workspaceRoot, folderName) : path.join(os.homedir(), 'Desktop', folderName);
        
        ['src'].forEach(d => fs.mkdirSync(path.join(root, d), { recursive: true }));

        const files = {
            'package.json': JSON.stringify({
                "name": folderName, "private": true, "version": "0.0.0", "type": "module",
                "scripts": { "dev": "vite", "build": "vite build" },
                "dependencies": { "react": "^18.2.0", "react-dom": "^18.2.0", "lucide-react": "latest" },
                "devDependencies": { "tailwindcss": "latest", "vite": "latest" }
            }, null, 2),
            'index.html': `<!doctype html>\n<html lang="en">\n<head>\n  <meta charset="UTF-8" />\n  <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n  <title>${folderName}</title>\n</head>\n<body>\n  <div id="root"></div>\n  <script type="module" src="/src/main.jsx"></script>\n</body>\n</html>`,
            'src/index.css': '@tailwind base;\n@tailwind components;\n@tailwind utilities;',
            'src/main.jsx': `import React from 'react';\nimport ReactDOM from 'react-dom/client';\nimport App from './App.jsx';\nimport './index.css';\n\nReactDOM.createRoot(document.getElementById('root')).render(\n  <React.StrictMode>\n    <App />\n  </React.StrictMode>,\n);`
        };

        Object.entries(files).forEach(([file, content]) => {
            fs.writeFileSync(path.join(root, file), content);
        });

        return { success: true, rootPath: root };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

ipcMain.handle('clone-template', async (event, { templateName, destinationName, currentWorkspacePath }) => {
    try {
        const templateRoot = path.join(os.homedir(), 'Desktop', 'templates');
        const sourcePath = path.join(templateRoot, templateName);
        const destinationPath = path.join(currentWorkspacePath, destinationName);

        if (!fs.existsSync(sourcePath)) {
            return { success: false, error: `Template folder '${templateName}' not found.` };
        }

        fs.cpSync(sourcePath, destinationPath, { recursive: true });
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
});



app.whenReady().then(() => {

  createWindow();
  const { globalShortcut } = require('electron');

app.whenReady().then(() => {
    // ... nee patha createWindow code ...

    // ⚡ F12 leda Ctrl+Shift+I kottinappudu Console toggle avvadaniki:
    globalShortcut.register('CommandOrControl+Shift+I', () => {
        const win = BrowserWindow.getFocusedWindow();
        if (win) win.webContents.toggleDevTools();
    });

    globalShortcut.register('F12', () => {
        const win = BrowserWindow.getFocusedWindow();
        if (win) win.webContents.toggleDevTools();
    });
});

// App close ayinappudu shortcuts unregister cheyadaniki (Memory leak rakunda)
app.on('will-quit', () => {
    globalShortcut.unregisterAll();
});

  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

});



app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });