const { app, BrowserWindow, Menu, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');

const normalizeDeploymentMode = (value) => {
  const raw = String(value || '').trim().toLowerCase();
  return raw === 'local_network' ? 'local_network' : 'standalone';
};

const normalizeDeviceRole = (value, mode) => {
  const raw = String(value || '').trim().toLowerCase();
  if (mode === 'standalone') return 'standalone';
  return raw === 'terminal' ? 'terminal' : 'host';
};

const normalizeApiBaseUrl = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return null;
  let normalized = raw.replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(normalized)) normalized = `http://${normalized}`;
  normalized = normalized.replace(/\/api$/i, '');
  return `${normalized}/api`;
};

const normalizeBoolean = (value, fallback) => {
  if (typeof value === 'boolean') return value;
  const raw = String(value ?? '').trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(raw)) return true;
  if (['0', 'false', 'no', 'off'].includes(raw)) return false;
  return fallback;
};

const getDeploymentConfigPath = () => path.join(app.getPath('userData'), 'deployment-config.json');

const normalizeDeploymentConfig = (input = {}) => {
  const mode = normalizeDeploymentMode(input.mode);
  const role = normalizeDeviceRole(input.role, mode);
  const canOwnBackend = mode === 'standalone' || role === 'host';
  return {
    mode,
    role,
    apiBaseUrl: normalizeApiBaseUrl(input.apiBaseUrl),
    canOwnBackend,
    canOwnDatabase: canOwnBackend,
    allowLocalUsbPrinting: normalizeBoolean(input.allowLocalUsbPrinting, canOwnBackend),
  };
};

const readPersistedDeploymentConfig = () => {
  try {
    const filePath = getDeploymentConfigPath();
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf8');
    if (!raw.trim()) return null;
    return JSON.parse(raw);
  } catch (error) {
    console.warn('[deployment] Failed to read persisted deployment config:', error?.message || error);
    return null;
  }
};

const writePersistedDeploymentConfig = (input) => {
  const normalized = normalizeDeploymentConfig(input);
  const filePath = getDeploymentConfigPath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(normalized, null, 2), 'utf8');
  return normalized;
};

const getDeploymentConfig = () => {
  const envConfig = {
    mode: process.env.SHAMEL_DEPLOYMENT_MODE || process.env.APP_DEPLOYMENT_MODE,
    role: process.env.SHAMEL_DEVICE_ROLE || process.env.APP_DEVICE_ROLE,
    apiBaseUrl: process.env.SHAMEL_API_URL || process.env.SHAMEL_SERVER_URL || process.env.APP_SERVER_URL,
    allowLocalUsbPrinting: process.env.SHAMEL_ALLOW_LOCAL_USB_PRINTING,
  };
  const savedConfig = readPersistedDeploymentConfig();
  return normalizeDeploymentConfig({
    ...envConfig,
    ...(savedConfig || {}),
  });
};

function resolveElectronPaths() {
  const normalized = __dirname.replace(/\\/g, '/');
  if (/\/electron$/i.test(normalized)) {
    return { electronDir: __dirname, appRoot: path.join(__dirname, '..') };
  }
  return { electronDir: path.join(__dirname, 'electron'), appRoot: __dirname };
}
const { electronDir, appRoot } = resolveElectronPaths();

let mainWindow;
let customerDisplayWindow = null;
let lastCustomerDisplayState = null;
let promotionsDisplayWindow = null;
let lastPromotionsDisplayState = null;
let serverProcess;
let serverLogPath;
let serverErrPath;
let devReloadRetries = 0;

const writeServerLog = (filePath, data) => {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.appendFileSync(filePath, data);
  } catch {}
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const waitForServerReady = async (maxAttempts = 20, intervalMs = 1000) => {
  const deployment = getDeploymentConfig();
  const url = deployment.canOwnBackend
    ? 'http://127.0.0.1:3111/api/system/status'
    : `${deployment.apiBaseUrl || 'http://127.0.0.1:3111/api'}/system/status`;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetch(url, { cache: 'no-store' });
      if (response.ok) {
        const body = await response.json().catch(() => null);
        console.log(`✅ Backend readiness check passed (attempt ${attempt}):`, body);
        return true;
      }
      console.warn(`⚠️ Backend readiness check got non-200 (${response.status}) on attempt ${attempt}`);
    } catch (error) {
      console.warn(`⚠️ Backend not ready yet (attempt ${attempt}/${maxAttempts}):`, error?.message || error);
    }
    await sleep(intervalMs);
  }
  console.error('❌ Backend did not become ready within timeout.');
  return false;
};

const resolveServerPath = () => {
  const unpackedPath = path.join(process.resourcesPath, 'app.asar.unpacked', 'dist-server', 'server.cjs');
  if (fs.existsSync(unpackedPath)) return unpackedPath;

  const asarPath = path.join(app.getAppPath(), 'dist-server', 'server.cjs');
  if (fs.existsSync(asarPath)) return asarPath;

  const legacyPath = path.join(process.resourcesPath, 'dist-server', 'server.cjs');
  if (fs.existsSync(legacyPath)) return legacyPath;

  return null;
};

const startServer = async () => {
  if (!app.isPackaged) return true;
  const deployment = getDeploymentConfig();
  if (!deployment.canOwnBackend) {
    console.log(`[electron] Skipping bundled backend startup for ${deployment.mode}/${deployment.role}`);
    return true;
  }
  try {
    const serverPath = resolveServerPath();
    if (!serverPath) {
      console.error('Server bundle not found in packaged app.');
      return;
    }

    let dataDir;
    let logsDir;
    let dbPath;
    
    const userDataDir = path.join(app.getPath('userData'), 'data');
    const userLogsDir = path.join(app.getPath('userData'), 'logs');
    
    const fallbackDataDir = path.join(os.homedir(), 'ShamelERP', 'data');
    const fallbackLogsDir = path.join(os.homedir(), 'ShamelERP', 'logs');
    
    let selectedDataDir = null;
    let selectedLogsDir = null;
    
    try {
      fs.mkdirSync(userDataDir, { recursive: true });
      fs.accessSync(userDataDir, fs.constants.W_OK);
      selectedDataDir = userDataDir;
      selectedLogsDir = userLogsDir;
      console.log(`✅ Using userData directory: ${selectedDataDir}`);
    } catch (userDataError) {
      console.warn(`⚠️  userData directory not writable: ${userDataError.message}`);
      
      try {
        fs.mkdirSync(fallbackDataDir, { recursive: true });
        fs.accessSync(fallbackDataDir, fs.constants.W_OK);
        selectedDataDir = fallbackDataDir;
        selectedLogsDir = fallbackLogsDir;
        console.log(`✅ Using fallback directory: ${selectedDataDir}`);
      } catch (appDirError) {
        console.error('❌ Neither userData nor fallback directory is writable');
        console.error('userData error:', userDataError.message);
        console.error('appDir error:', appDirError.message);
        return;
      }
    }
    
    dataDir = selectedDataDir;
    logsDir = selectedLogsDir;
    dbPath = path.join(dataDir, 'shamel.db');
    
    // Ensure directories exist
    try {
      fs.mkdirSync(dataDir, { recursive: true });
      fs.mkdirSync(logsDir, { recursive: true });
      console.log(`✅ Created data directory: ${dataDir}`);
      console.log(`✅ Created logs directory: ${logsDir}`);
    } catch (mkdirError) {
      console.error('Failed to create directories:', mkdirError);
      return;
    }
    
    // Check if database exists, if not try to copy from template
    if (!fs.existsSync(dbPath)) {
      console.log('📁 Database not found, attempting to create from template...');
      
      // Try to copy from data-template first (if exists from extraResources)
      const templatePath = path.join(process.resourcesPath, 'data-template', 'shamel.db');
      if (fs.existsSync(templatePath)) {
        try {
          fs.copyFileSync(templatePath, dbPath);
          console.log(`✅ Copied database template from: ${templatePath}`);
        } catch (copyError) {
          console.warn(`⚠️  Failed to copy template database: ${copyError.message}`);
        }
      } else {
        console.log('ℹ️  No template database found, will create new one');
      }
    } else {
      console.log(`✅ Database already exists at: ${dbPath}`);
    }
    
    // Final write permissions check
    try {
      fs.accessSync(dataDir, fs.constants.W_OK);
      if (fs.existsSync(dbPath)) {
        fs.accessSync(dbPath, fs.constants.R_OK | fs.constants.W_OK);
      }
      console.log(`✅ Database access confirmed: ${dbPath}`);
    } catch (accessError) {
      console.error('❌ Database access failed:', accessError);
      return;
    }

    serverLogPath = path.join(selectedLogsDir, 'server.log');
    serverErrPath = path.join(selectedLogsDir, 'server-error.log');

    const unpackedNodeModules = path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules');
    const asarNodeModules = path.join(process.resourcesPath, 'app.asar', 'node_modules');
    const nodePath = [unpackedNodeModules, asarNodeModules, process.env.NODE_PATH]
      .filter(Boolean)
      .join(path.delimiter);

    console.log(`🚀 Starting server with DB_PATH: ${dbPath}`);
    console.log(`📁 Server path: ${serverPath}`);
    console.log(`📦 Node modules path: ${nodePath}`);
    console.log(`📁 Data directory: ${dataDir}`);
    console.log(`📁 Logs directory: ${logsDir}`);

    serverProcess = spawn(process.execPath, [serverPath], {
      env: {
        ...process.env,
        DB_PATH: dbPath,
        DB_PATH_FROM_ELECTRON: dbPath, // New variable for better handling
        NODE_PATH: nodePath,
        ELECTRON_RUN_AS_NODE: '1',
        ELECTRON_IS_PACKAGED: '1',
        SHAMEL_DEPLOYMENT_MODE: deployment.mode,
        SHAMEL_DEVICE_ROLE: deployment.role,
        ...(deployment.apiBaseUrl ? { SHAMEL_API_URL: deployment.apiBaseUrl } : {})
      },
      cwd: path.dirname(serverPath),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });

    serverProcess.stdout.on('data', (data) => {
      const logData = data.toString();
      console.log('Server output:', logData);
      writeServerLog(serverLogPath, logData);
    });
    
    serverProcess.stderr.on('data', (data) => {
      const errorData = data.toString();
      console.error('Server error:', errorData);
      writeServerLog(serverErrPath, errorData);
    });
    
    serverProcess.on('exit', (code) => {
      const exitMsg = `Server exited with code ${code}\n`;
      console.log(exitMsg);
      writeServerLog(serverErrPath, exitMsg);
    });
    
    serverProcess.on('error', (error) => {
      console.error('Failed to start server process:', error);
      writeServerLog(serverErrPath, `Failed to start server: ${error.message}\n`);
    });
    
    console.log('✅ Server process started successfully');

    // Wait for server to be reachable on local API surface before proceeding
    const ready = await waitForServerReady(20, 1000);
    if (!ready) {
      console.error('❌ Packaged backend startup failure: local API unreachable after retries.');
      writeServerLog(serverErrPath, 'Backend readiness timeout after setup server process launch.\n');
      return false;
    }

    console.log('✅ Packaged backend ready and accepting requests.');
    return true;

  } catch (e) {
    console.error('Failed to start bundled server', e);
    writeServerLog(serverErrPath, `Critical error starting server: ${e.message}\n`);
    return false;
  }
};

const createWindow = () => {
  const isDev = !app.isPackaged;

  mainWindow = new BrowserWindow({
    width: 1366,
    height: 900,
    show: false, 
    title: "العالمية للمحاسبة",
    backgroundColor: '#f3f4f6',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(electronDir, 'preload.cjs'),
      webSecurity: false 
    },
  });

  mainWindow.setMenuBarVisibility(true);
  mainWindow.setAutoHideMenuBar(false);

  const template = [
    {
      label: 'الملف',
      submenu: [{ role: 'quit', label: 'خروج من النظام' }]
    },
    {
      label: 'عرض',
      submenu: [
        { role: 'reload', label: 'إعادة تحميل الواجهة' },
        { role: 'toggleDevTools', label: 'أدوات المطور' },
        { type: 'separator' },
        { role: 'resetZoom', label: 'الزوم الافتراضي' },
        { role: 'zoomin', label: 'تكبير' },
        { role: 'zoomout', label: 'تصغير' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'ملء الشاشة' }
      ]
    },
    {
      label: 'مساعدة',
      submenu: [
        { label: 'عن النظام', click: () => { console.log('العالمية للمحاسبة'); } }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);

  if (isDev) {
    mainWindow.loadURL('http://127.0.0.1:5173');
  } else {
    const indexPath = path.join(appRoot, 'dist', 'index.html');
    mainWindow.loadFile(indexPath).catch(err => {
        console.error("Critical: Failed to load index.html", err);
    });
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
  });

  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.error(`Page failed to load: ${errorDescription} (${errorCode})`);
    const isDev = !app.isPackaged;
    if (isDev) {
      const transientNetworkError =
        errorCode === -21 || // ERR_NETWORK_CHANGED
        errorCode === -102 || // ERR_CONNECTION_REFUSED
        errorCode === -105 || // ERR_NAME_NOT_RESOLVED
        String(errorDescription || '').toUpperCase().includes('ERR_NETWORK_CHANGED');

      if (transientNetworkError && devReloadRetries < 8) {
        devReloadRetries += 1;
        const delay = Math.min(500 + (devReloadRetries * 300), 3000);
        console.warn(`Dev load transient failure. Retrying (${devReloadRetries}) in ${delay}ms...`);
        setTimeout(() => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.loadURL('http://127.0.0.1:5173');
          }
        }, delay);
      }
      return;
    }

    mainWindow.webContents.executeJavaScript(`
      document.body.innerHTML = \`
        <div style="background:#fff; color:#333; padding:50px; font-family:sans-serif; text-align:center; height:100vh; display:flex; flex-direction:column; align-items:center; justify-content:center;">
          <h1 style="color:#e11d48;">خطأ في تشغيل واجهة النظام</h1>
          <p>فشل تحميل ملفات الواجهة (Error: ${errorCode})</p>
          <div style="background:#fef2f2; padding:15px; border-radius:10px; border:1px solid #fee2e2; margin:20px 0; font-size:14px; color:#b91c1c;">
             تأكد من تنفيذ أمر <code>npm run build</code> قبل تغليف التطبيق.
          </div>
          <button onclick="window.location.reload()" style="padding:10px 30px; background:#0f766e; color:white; border:none; border-radius:8px; cursor:pointer; font-weight:bold; font-size:16px;">إعادة المحاولة</button>
        </div>
      \`;
    `);
  });

  mainWindow.webContents.on('did-finish-load', () => {
    devReloadRetries = 0;
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    if (customerDisplayWindow && !customerDisplayWindow.isDestroyed()) {
      try { customerDisplayWindow.close(); } catch {}
    }
    customerDisplayWindow = null;
    if (promotionsDisplayWindow && !promotionsDisplayWindow.isDestroyed()) {
      try { promotionsDisplayWindow.close(); } catch {}
    }
    promotionsDisplayWindow = null;
  });
};

const loadCustomerDisplayWindow = (win) => {
  const isDev = !app.isPackaged;
  if (isDev) {
    win.loadURL('http://127.0.0.1:5173/#/customer-display');
    return;
  }
  const indexPath = path.join(appRoot, 'dist', 'index.html');
  win.loadFile(indexPath, { hash: '/customer-display' }).catch((err) => {
    console.error('Failed to load customer display window:', err);
  });
};

const createCustomerDisplayWindow = () => {
  if (customerDisplayWindow && !customerDisplayWindow.isDestroyed()) {
    if (customerDisplayWindow.isMinimized()) customerDisplayWindow.restore();
    customerDisplayWindow.show();
    customerDisplayWindow.focus();
    return { window: customerDisplayWindow, alreadyOpen: true };
  }

  customerDisplayWindow = new BrowserWindow({
    width: 1280,
    height: 780,
    minWidth: 900,
    minHeight: 560,
    show: false,
    title: 'شاشة الزبون',
    backgroundColor: '#0b1220',
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(electronDir, 'preload.cjs'),
      webSecurity: false,
    },
  });

  customerDisplayWindow.setMenuBarVisibility(false);
  customerDisplayWindow.removeMenu();
  loadCustomerDisplayWindow(customerDisplayWindow);

  customerDisplayWindow.once('ready-to-show', () => {
    if (!customerDisplayWindow || customerDisplayWindow.isDestroyed()) return;
    customerDisplayWindow.show();
    customerDisplayWindow.focus();
  });

  customerDisplayWindow.webContents.on('did-finish-load', () => {
    if (!lastCustomerDisplayState || !customerDisplayWindow || customerDisplayWindow.isDestroyed()) return;
    customerDisplayWindow.webContents.send('customer-display:data', lastCustomerDisplayState);
  });

  customerDisplayWindow.on('closed', () => {
    customerDisplayWindow = null;
  });

  return { window: customerDisplayWindow, alreadyOpen: false };
};

const loadPromotionsDisplayWindow = (win) => {
  const isDev = !app.isPackaged;
  if (isDev) {
    win.loadURL('http://127.0.0.1:5173/#/promotions-display');
    return;
  }
  const indexPath = path.join(appRoot, 'dist', 'index.html');
  win.loadFile(indexPath, { hash: '/promotions-display' }).catch((err) => {
    console.error('Failed to load promotions display window:', err);
  });
};

const createPromotionsDisplayWindow = () => {
  if (promotionsDisplayWindow && !promotionsDisplayWindow.isDestroyed()) {
    if (promotionsDisplayWindow.isMinimized()) promotionsDisplayWindow.restore();
    promotionsDisplayWindow.show();
    promotionsDisplayWindow.focus();
    return { window: promotionsDisplayWindow, alreadyOpen: true };
  }

  promotionsDisplayWindow = new BrowserWindow({
    width: 1600,
    height: 900,
    minWidth: 1200,
    minHeight: 700,
    show: false,
    title: 'شاشة العروض',
    backgroundColor: '#091018',
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(electronDir, 'preload.cjs'),
      webSecurity: false,
    },
  });

  promotionsDisplayWindow.setMenuBarVisibility(false);
  promotionsDisplayWindow.removeMenu();
  loadPromotionsDisplayWindow(promotionsDisplayWindow);

  promotionsDisplayWindow.once('ready-to-show', () => {
    if (!promotionsDisplayWindow || promotionsDisplayWindow.isDestroyed()) return;
    promotionsDisplayWindow.show();
    promotionsDisplayWindow.focus();
  });

  promotionsDisplayWindow.webContents.on('did-finish-load', () => {
    if (!lastPromotionsDisplayState || !promotionsDisplayWindow || promotionsDisplayWindow.isDestroyed()) return;
    promotionsDisplayWindow.webContents.send('promotions-display:data', lastPromotionsDisplayState);
  });

  promotionsDisplayWindow.on('closed', () => {
    promotionsDisplayWindow = null;
  });

  return { window: promotionsDisplayWindow, alreadyOpen: false };
};

ipcMain.handle('customer-display:open', () => {
  const result = createCustomerDisplayWindow();
  return { success: true, alreadyOpen: result.alreadyOpen };
});

ipcMain.handle('customer-display:close', () => {
  if (customerDisplayWindow && !customerDisplayWindow.isDestroyed()) {
    customerDisplayWindow.close();
  }
  customerDisplayWindow = null;
  return { success: true };
});

ipcMain.handle('customer-display:get-state', () => lastCustomerDisplayState || null);

ipcMain.on('customer-display:update', (_event, payload) => {
  if (!payload || typeof payload !== 'object') return;
  lastCustomerDisplayState = payload;
  if (!customerDisplayWindow || customerDisplayWindow.isDestroyed()) return;
  customerDisplayWindow.webContents.send('customer-display:data', payload);
});

ipcMain.handle('promotions-display:open', () => {
  const result = createPromotionsDisplayWindow();
  return { success: true, alreadyOpen: result.alreadyOpen };
});

ipcMain.handle('promotions-display:close', () => {
  if (promotionsDisplayWindow && !promotionsDisplayWindow.isDestroyed()) {
    promotionsDisplayWindow.close();
  }
  promotionsDisplayWindow = null;
  return { success: true };
});

ipcMain.handle('promotions-display:get-state', () => lastPromotionsDisplayState || null);

ipcMain.on('promotions-display:update', (_event, payload) => {
  if (!payload || typeof payload !== 'object') return;
  lastPromotionsDisplayState = payload;
  if (!promotionsDisplayWindow || promotionsDisplayWindow.isDestroyed()) return;
  promotionsDisplayWindow.webContents.send('promotions-display:data', payload);
});

// ---------- الطباعة: قائمة الطابعات + طباعة صامتة إلى طابعة محددة ----------
ipcMain.handle('print:list-printers', async () => {
  if (!getDeploymentConfig().allowLocalUsbPrinting) return [];
  const wc = mainWindow?.webContents;
  if (!wc) return [];
  try {
    const list = await wc.getPrintersAsync();
    return (list || []).map((p) => p.name);
  } catch (e) {
    console.warn('getPrintersAsync failed', e);
    return [];
  }
});

ipcMain.handle('print:to-printer', async (_event, { printerName, htmlContent, paperSize }) => {
  if (!getDeploymentConfig().allowLocalUsbPrinting) return false;
  if (!printerName || typeof htmlContent !== 'string') return false;

  // Write HTML to a temp file so Electron loads it via file:// (avoids data: URL encoding limits)
  const tmpDir = os.tmpdir();
  const tmpFile = path.join(tmpDir, `shamel-print-${Date.now()}.html`);
  try {
    fs.writeFileSync(tmpFile, htmlContent, 'utf8');
  } catch (writeErr) {
    console.warn('Failed to write temp print file', writeErr);
    return false;
  }

  return new Promise((resolve) => {
    const printWin = new BrowserWindow({
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        /* Ensure Arabic shaping uses a font with Arabic glyphs when rasterizing for thermal */
        defaultFontFamily: {
          standard: 'Segoe UI',
          serif: 'Segoe UI',
          sansSerif: 'Segoe UI',
          monospace: 'Consolas',
        },
      },
    });

    const cleanup = (result) => {
      try { if (printWin && !printWin.isDestroyed()) printWin.close(); } catch {}
      try { fs.unlinkSync(tmpFile); } catch {}
      resolve(!!result);
    };

    printWin.webContents.once('did-fail-load', (_e, code) => {
      console.warn('Print window load failed', code);
      cleanup(false);
    });

    printWin.webContents.once('did-finish-load', () => {
      // Give the page a moment to fully render before sending to printer
      setTimeout(() => {
        if (printWin.isDestroyed()) return cleanup(false);
        const pageSizeByPaper = (() => {
          const normalized = String(paperSize || '').toLowerCase();
          if (normalized === '58mm') return { width: 58000, height: 200000 };
          if (normalized === '80mm') return { width: 80000, height: 200000 };
          if (normalized === '85mm') return { width: 85000, height: 200000 };
          if (normalized === 'a5') return 'A5';
          if (normalized === 'a4') return 'A4';
          return undefined;
        })();

        const printOptions = {
          silent: true,
          deviceName: printerName,
          printBackground: true,
          margins: { marginType: 'none' },
          ...(pageSizeByPaper ? { pageSize: pageSizeByPaper } : {}),
        };
        printWin.webContents.print(
          printOptions,
          (success) => cleanup(success)
        );
      }, 400);
    });

    printWin.loadFile(tmpFile).catch((err) => {
      console.warn('Print loadFile failed', err);
      cleanup(false);
    });
  });
});

ipcMain.handle('deployment:get-config', () => getDeploymentConfig());
ipcMain.on('deployment:get-config-sync', (event) => {
  event.returnValue = getDeploymentConfig();
});
ipcMain.handle('deployment:save-config', (_event, config) => writePersistedDeploymentConfig(config || {}));
ipcMain.handle('app:restart', () => {
  setImmediate(() => {
    app.relaunch();
    app.exit(0);
  });
  return true;
});

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    const serverReady = await startServer();
    if (!serverReady) {
      console.error('❌ Continuing startup with packaged UI but backend failed to stand up.');
      // Still create window to show clean error from frontend/gate; this avoids blank app.
      // Frontend has own backend readiness gate and will report to user.
    }
    createWindow();
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (customerDisplayWindow && !customerDisplayWindow.isDestroyed()) {
    try { customerDisplayWindow.close(); } catch {}
  }
  if (promotionsDisplayWindow && !promotionsDisplayWindow.isDestroyed()) {
    try { promotionsDisplayWindow.close(); } catch {}
  }
  if (serverProcess) {
    try { serverProcess.kill(); } catch {}
  }
});
