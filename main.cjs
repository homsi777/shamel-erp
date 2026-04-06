"use strict";

// electron/main.cjs
var { app, BrowserWindow, Menu, ipcMain } = require("electron");
var path = require("path");
var fs = require("fs");
var os = require("os");
var { spawn } = require("child_process");
var normalizeDeploymentMode = (value) => {
  const raw = String(value || "").trim().toLowerCase();
  return raw === "local_network" ? "local_network" : "standalone";
};
var normalizeDeviceRole = (value, mode) => {
  const raw = String(value || "").trim().toLowerCase();
  if (mode === "standalone")
    return "standalone";
  return raw === "terminal" ? "terminal" : "host";
};
var normalizeApiBaseUrl = (value) => {
  const raw = String(value || "").trim();
  if (!raw)
    return null;
  let normalized = raw.replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(normalized))
    normalized = `http://${normalized}`;
  normalized = normalized.replace(/\/api$/i, "");
  return `${normalized}/api`;
};
var normalizeBoolean = (value, fallback) => {
  if (typeof value === "boolean")
    return value;
  const raw = String(value ?? "").trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(raw))
    return true;
  if (["0", "false", "no", "off"].includes(raw))
    return false;
  return fallback;
};
var getDeploymentConfigPath = () => path.join(app.getPath("userData"), "deployment-config.json");
var normalizeDeploymentConfig = (input = {}) => {
  const mode = normalizeDeploymentMode(input.mode);
  const role = normalizeDeviceRole(input.role, mode);
  const canOwnBackend = mode === "standalone" || role === "host";
  return {
    mode,
    role,
    apiBaseUrl: normalizeApiBaseUrl(input.apiBaseUrl),
    canOwnBackend,
    canOwnDatabase: canOwnBackend,
    allowLocalUsbPrinting: normalizeBoolean(input.allowLocalUsbPrinting, canOwnBackend)
  };
};
var readPersistedDeploymentConfig = () => {
  try {
    const filePath = getDeploymentConfigPath();
    if (!fs.existsSync(filePath))
      return null;
    const raw = fs.readFileSync(filePath, "utf8");
    if (!raw.trim())
      return null;
    return JSON.parse(raw);
  } catch (error) {
    console.warn("[deployment] Failed to read persisted deployment config:", error?.message || error);
    return null;
  }
};
var writePersistedDeploymentConfig = (input) => {
  const normalized = normalizeDeploymentConfig(input);
  const filePath = getDeploymentConfigPath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(normalized, null, 2), "utf8");
  return normalized;
};
var getDeploymentConfig = () => {
  const envConfig = {
    mode: process.env.SHAMEL_DEPLOYMENT_MODE || process.env.APP_DEPLOYMENT_MODE,
    role: process.env.SHAMEL_DEVICE_ROLE || process.env.APP_DEVICE_ROLE,
    apiBaseUrl: process.env.SHAMEL_API_URL || process.env.SHAMEL_SERVER_URL || process.env.APP_SERVER_URL,
    allowLocalUsbPrinting: process.env.SHAMEL_ALLOW_LOCAL_USB_PRINTING
  };
  const savedConfig = readPersistedDeploymentConfig();
  return normalizeDeploymentConfig({
    ...envConfig,
    ...savedConfig || {}
  });
};
function resolveElectronPaths() {
  const normalized = __dirname.replace(/\\/g, "/");
  if (/\/electron$/i.test(normalized)) {
    return { electronDir: __dirname, appRoot: path.join(__dirname, "..") };
  }
  return { electronDir: path.join(__dirname, "electron"), appRoot: __dirname };
}
var { electronDir, appRoot } = resolveElectronPaths();
var mainWindow;
var customerDisplayWindow = null;
var lastCustomerDisplayState = null;
var promotionsDisplayWindow = null;
var lastPromotionsDisplayState = null;
var serverProcess;
var serverLogPath;
var serverErrPath;
var devReloadRetries = 0;
var writeServerLog = (filePath, data) => {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.appendFileSync(filePath, data);
  } catch {
  }
};
var sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
var waitForServerReady = async (maxAttempts = 20, intervalMs = 1e3) => {
  const deployment = getDeploymentConfig();
  const url = deployment.canOwnBackend ? "http://127.0.0.1:3111/api/system/status" : `${deployment.apiBaseUrl || "http://127.0.0.1:3111/api"}/system/status`;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (response.ok) {
        const body = await response.json().catch(() => null);
        console.log(`\u2705 Backend readiness check passed (attempt ${attempt}):`, body);
        return true;
      }
      console.warn(`\u26A0\uFE0F Backend readiness check got non-200 (${response.status}) on attempt ${attempt}`);
    } catch (error) {
      console.warn(`\u26A0\uFE0F Backend not ready yet (attempt ${attempt}/${maxAttempts}):`, error?.message || error);
    }
    await sleep(intervalMs);
  }
  console.error("\u274C Backend did not become ready within timeout.");
  return false;
};
var resolveServerPath = () => {
  const unpackedPath = path.join(process.resourcesPath, "app.asar.unpacked", "dist-server", "server.cjs");
  if (fs.existsSync(unpackedPath))
    return unpackedPath;
  const asarPath = path.join(app.getAppPath(), "dist-server", "server.cjs");
  if (fs.existsSync(asarPath))
    return asarPath;
  const legacyPath = path.join(process.resourcesPath, "dist-server", "server.cjs");
  if (fs.existsSync(legacyPath))
    return legacyPath;
  return null;
};
var startServer = async () => {
  if (!app.isPackaged)
    return true;
  const deployment = getDeploymentConfig();
  if (!deployment.canOwnBackend) {
    console.log(`[electron] Skipping bundled backend startup for ${deployment.mode}/${deployment.role}`);
    return true;
  }
  try {
    const serverPath = resolveServerPath();
    if (!serverPath) {
      console.error("Server bundle not found in packaged app.");
      return;
    }
    let dataDir;
    let logsDir;
    let dbPath;
    const userDataDir = path.join(app.getPath("userData"), "data");
    const userLogsDir = path.join(app.getPath("userData"), "logs");
    const fallbackDataDir = path.join(os.homedir(), "ShamelERP", "data");
    const fallbackLogsDir = path.join(os.homedir(), "ShamelERP", "logs");
    let selectedDataDir = null;
    let selectedLogsDir = null;
    try {
      fs.mkdirSync(userDataDir, { recursive: true });
      fs.accessSync(userDataDir, fs.constants.W_OK);
      selectedDataDir = userDataDir;
      selectedLogsDir = userLogsDir;
      console.log(`\u2705 Using userData directory: ${selectedDataDir}`);
    } catch (userDataError) {
      console.warn(`\u26A0\uFE0F  userData directory not writable: ${userDataError.message}`);
      try {
        fs.mkdirSync(fallbackDataDir, { recursive: true });
        fs.accessSync(fallbackDataDir, fs.constants.W_OK);
        selectedDataDir = fallbackDataDir;
        selectedLogsDir = fallbackLogsDir;
        console.log(`\u2705 Using fallback directory: ${selectedDataDir}`);
      } catch (appDirError) {
        console.error("\u274C Neither userData nor fallback directory is writable");
        console.error("userData error:", userDataError.message);
        console.error("appDir error:", appDirError.message);
        return;
      }
    }
    dataDir = selectedDataDir;
    logsDir = selectedLogsDir;
    dbPath = path.join(dataDir, "shamel.db");
    try {
      fs.mkdirSync(dataDir, { recursive: true });
      fs.mkdirSync(logsDir, { recursive: true });
      console.log(`\u2705 Created data directory: ${dataDir}`);
      console.log(`\u2705 Created logs directory: ${logsDir}`);
    } catch (mkdirError) {
      console.error("Failed to create directories:", mkdirError);
      return;
    }
    if (!fs.existsSync(dbPath)) {
      console.log("\u{1F4C1} Database not found, attempting to create from template...");
      const templatePath = path.join(process.resourcesPath, "data-template", "shamel.db");
      if (fs.existsSync(templatePath)) {
        try {
          fs.copyFileSync(templatePath, dbPath);
          console.log(`\u2705 Copied database template from: ${templatePath}`);
        } catch (copyError) {
          console.warn(`\u26A0\uFE0F  Failed to copy template database: ${copyError.message}`);
        }
      } else {
        console.log("\u2139\uFE0F  No template database found, will create new one");
      }
    } else {
      console.log(`\u2705 Database already exists at: ${dbPath}`);
    }
    try {
      fs.accessSync(dataDir, fs.constants.W_OK);
      if (fs.existsSync(dbPath)) {
        fs.accessSync(dbPath, fs.constants.R_OK | fs.constants.W_OK);
      }
      console.log(`\u2705 Database access confirmed: ${dbPath}`);
    } catch (accessError) {
      console.error("\u274C Database access failed:", accessError);
      return;
    }
    serverLogPath = path.join(selectedLogsDir, "server.log");
    serverErrPath = path.join(selectedLogsDir, "server-error.log");
    const unpackedNodeModules = path.join(process.resourcesPath, "app.asar.unpacked", "node_modules");
    const asarNodeModules = path.join(process.resourcesPath, "app.asar", "node_modules");
    const nodePath = [unpackedNodeModules, asarNodeModules, process.env.NODE_PATH].filter(Boolean).join(path.delimiter);
    console.log(`\u{1F680} Starting server with DB_PATH: ${dbPath}`);
    console.log(`\u{1F4C1} Server path: ${serverPath}`);
    console.log(`\u{1F4E6} Node modules path: ${nodePath}`);
    console.log(`\u{1F4C1} Data directory: ${dataDir}`);
    console.log(`\u{1F4C1} Logs directory: ${logsDir}`);
    serverProcess = spawn(process.execPath, [serverPath], {
      env: {
        ...process.env,
        DB_PATH: dbPath,
        DB_PATH_FROM_ELECTRON: dbPath,
        // New variable for better handling
        NODE_PATH: nodePath,
        ELECTRON_RUN_AS_NODE: "1",
        ELECTRON_IS_PACKAGED: "1",
        SHAMEL_DEPLOYMENT_MODE: deployment.mode,
        SHAMEL_DEVICE_ROLE: deployment.role,
        ...deployment.apiBaseUrl ? { SHAMEL_API_URL: deployment.apiBaseUrl } : {}
      },
      cwd: path.dirname(serverPath),
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });
    serverProcess.stdout.on("data", (data) => {
      const logData = data.toString();
      console.log("Server output:", logData);
      writeServerLog(serverLogPath, logData);
    });
    serverProcess.stderr.on("data", (data) => {
      const errorData = data.toString();
      console.error("Server error:", errorData);
      writeServerLog(serverErrPath, errorData);
    });
    serverProcess.on("exit", (code) => {
      const exitMsg = `Server exited with code ${code}
`;
      console.log(exitMsg);
      writeServerLog(serverErrPath, exitMsg);
    });
    serverProcess.on("error", (error) => {
      console.error("Failed to start server process:", error);
      writeServerLog(serverErrPath, `Failed to start server: ${error.message}
`);
    });
    console.log("\u2705 Server process started successfully");
    const ready = await waitForServerReady(20, 1e3);
    if (!ready) {
      console.error("\u274C Packaged backend startup failure: local API unreachable after retries.");
      writeServerLog(serverErrPath, "Backend readiness timeout after setup server process launch.\n");
      return false;
    }
    console.log("\u2705 Packaged backend ready and accepting requests.");
    return true;
  } catch (e) {
    console.error("Failed to start bundled server", e);
    writeServerLog(serverErrPath, `Critical error starting server: ${e.message}
`);
    return false;
  }
};
var createWindow = () => {
  const isDev = !app.isPackaged;
  mainWindow = new BrowserWindow({
    width: 1366,
    height: 900,
    show: false,
    title: "\u0627\u0644\u0639\u0627\u0644\u0645\u064A\u0629 \u0644\u0644\u0645\u062D\u0627\u0633\u0628\u0629",
    backgroundColor: "#f3f4f6",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(electronDir, "preload.cjs"),
      webSecurity: false
    }
  });
  mainWindow.setMenuBarVisibility(true);
  mainWindow.setAutoHideMenuBar(false);
  const template = [
    {
      label: "\u0627\u0644\u0645\u0644\u0641",
      submenu: [{ role: "quit", label: "\u062E\u0631\u0648\u062C \u0645\u0646 \u0627\u0644\u0646\u0638\u0627\u0645" }]
    },
    {
      label: "\u0639\u0631\u0636",
      submenu: [
        { role: "reload", label: "\u0625\u0639\u0627\u062F\u0629 \u062A\u062D\u0645\u064A\u0644 \u0627\u0644\u0648\u0627\u062C\u0647\u0629" },
        { role: "toggleDevTools", label: "\u0623\u062F\u0648\u0627\u062A \u0627\u0644\u0645\u0637\u0648\u0631" },
        { type: "separator" },
        { role: "resetZoom", label: "\u0627\u0644\u0632\u0648\u0645 \u0627\u0644\u0627\u0641\u062A\u0631\u0627\u0636\u064A" },
        { role: "zoomin", label: "\u062A\u0643\u0628\u064A\u0631" },
        { role: "zoomout", label: "\u062A\u0635\u063A\u064A\u0631" },
        { type: "separator" },
        { role: "togglefullscreen", label: "\u0645\u0644\u0621 \u0627\u0644\u0634\u0627\u0634\u0629" }
      ]
    },
    {
      label: "\u0645\u0633\u0627\u0639\u062F\u0629",
      submenu: [
        { label: "\u0639\u0646 \u0627\u0644\u0646\u0638\u0627\u0645", click: () => {
          console.log("\u0627\u0644\u0639\u0627\u0644\u0645\u064A\u0629 \u0644\u0644\u0645\u062D\u0627\u0633\u0628\u0629");
        } }
      ]
    }
  ];
  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
  if (isDev) {
    mainWindow.loadURL("http://127.0.0.1:5173");
  } else {
    const indexPath = path.join(appRoot, "dist", "index.html");
    mainWindow.loadFile(indexPath).catch((err) => {
      console.error("Critical: Failed to load index.html", err);
    });
  }
  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
    mainWindow.focus();
  });
  mainWindow.webContents.on("did-fail-load", (event, errorCode, errorDescription) => {
    console.error(`Page failed to load: ${errorDescription} (${errorCode})`);
    const isDev2 = !app.isPackaged;
    if (isDev2) {
      const transientNetworkError = errorCode === -21 || // ERR_NETWORK_CHANGED
      errorCode === -102 || // ERR_CONNECTION_REFUSED
      errorCode === -105 || // ERR_NAME_NOT_RESOLVED
      String(errorDescription || "").toUpperCase().includes("ERR_NETWORK_CHANGED");
      if (transientNetworkError && devReloadRetries < 8) {
        devReloadRetries += 1;
        const delay = Math.min(500 + devReloadRetries * 300, 3e3);
        console.warn(`Dev load transient failure. Retrying (${devReloadRetries}) in ${delay}ms...`);
        setTimeout(() => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.loadURL("http://127.0.0.1:5173");
          }
        }, delay);
      }
      return;
    }
    mainWindow.webContents.executeJavaScript(`
      document.body.innerHTML = \`
        <div style="background:#fff; color:#333; padding:50px; font-family:sans-serif; text-align:center; height:100vh; display:flex; flex-direction:column; align-items:center; justify-content:center;">
          <h1 style="color:#e11d48;">\u062E\u0637\u0623 \u0641\u064A \u062A\u0634\u063A\u064A\u0644 \u0648\u0627\u062C\u0647\u0629 \u0627\u0644\u0646\u0638\u0627\u0645</h1>
          <p>\u0641\u0634\u0644 \u062A\u062D\u0645\u064A\u0644 \u0645\u0644\u0641\u0627\u062A \u0627\u0644\u0648\u0627\u062C\u0647\u0629 (Error: ${errorCode})</p>
          <div style="background:#fef2f2; padding:15px; border-radius:10px; border:1px solid #fee2e2; margin:20px 0; font-size:14px; color:#b91c1c;">
             \u062A\u0623\u0643\u062F \u0645\u0646 \u062A\u0646\u0641\u064A\u0630 \u0623\u0645\u0631 <code>npm run build</code> \u0642\u0628\u0644 \u062A\u063A\u0644\u064A\u0641 \u0627\u0644\u062A\u0637\u0628\u064A\u0642.
          </div>
          <button onclick="window.location.reload()" style="padding:10px 30px; background:#0f766e; color:white; border:none; border-radius:8px; cursor:pointer; font-weight:bold; font-size:16px;">\u0625\u0639\u0627\u062F\u0629 \u0627\u0644\u0645\u062D\u0627\u0648\u0644\u0629</button>
        </div>
      \`;
    `);
  });
  mainWindow.webContents.on("did-finish-load", () => {
    devReloadRetries = 0;
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
    if (customerDisplayWindow && !customerDisplayWindow.isDestroyed()) {
      try {
        customerDisplayWindow.close();
      } catch {
      }
    }
    customerDisplayWindow = null;
    if (promotionsDisplayWindow && !promotionsDisplayWindow.isDestroyed()) {
      try {
        promotionsDisplayWindow.close();
      } catch {
      }
    }
    promotionsDisplayWindow = null;
  });
};
var loadCustomerDisplayWindow = (win) => {
  const isDev = !app.isPackaged;
  if (isDev) {
    win.loadURL("http://127.0.0.1:5173/#/customer-display");
    return;
  }
  const indexPath = path.join(appRoot, "dist", "index.html");
  win.loadFile(indexPath, { hash: "/customer-display" }).catch((err) => {
    console.error("Failed to load customer display window:", err);
  });
};
var createCustomerDisplayWindow = () => {
  if (customerDisplayWindow && !customerDisplayWindow.isDestroyed()) {
    if (customerDisplayWindow.isMinimized())
      customerDisplayWindow.restore();
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
    title: "\u0634\u0627\u0634\u0629 \u0627\u0644\u0632\u0628\u0648\u0646",
    backgroundColor: "#0b1220",
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(electronDir, "preload.cjs"),
      webSecurity: false
    }
  });
  customerDisplayWindow.setMenuBarVisibility(false);
  customerDisplayWindow.removeMenu();
  loadCustomerDisplayWindow(customerDisplayWindow);
  customerDisplayWindow.once("ready-to-show", () => {
    if (!customerDisplayWindow || customerDisplayWindow.isDestroyed())
      return;
    customerDisplayWindow.show();
    customerDisplayWindow.focus();
  });
  customerDisplayWindow.webContents.on("did-finish-load", () => {
    if (!lastCustomerDisplayState || !customerDisplayWindow || customerDisplayWindow.isDestroyed())
      return;
    customerDisplayWindow.webContents.send("customer-display:data", lastCustomerDisplayState);
  });
  customerDisplayWindow.on("closed", () => {
    customerDisplayWindow = null;
  });
  return { window: customerDisplayWindow, alreadyOpen: false };
};
var loadPromotionsDisplayWindow = (win) => {
  const isDev = !app.isPackaged;
  if (isDev) {
    win.loadURL("http://127.0.0.1:5173/#/promotions-display");
    return;
  }
  const indexPath = path.join(appRoot, "dist", "index.html");
  win.loadFile(indexPath, { hash: "/promotions-display" }).catch((err) => {
    console.error("Failed to load promotions display window:", err);
  });
};
var createPromotionsDisplayWindow = () => {
  if (promotionsDisplayWindow && !promotionsDisplayWindow.isDestroyed()) {
    if (promotionsDisplayWindow.isMinimized())
      promotionsDisplayWindow.restore();
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
    title: "\u0634\u0627\u0634\u0629 \u0627\u0644\u0639\u0631\u0648\u0636",
    backgroundColor: "#091018",
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(electronDir, "preload.cjs"),
      webSecurity: false
    }
  });
  promotionsDisplayWindow.setMenuBarVisibility(false);
  promotionsDisplayWindow.removeMenu();
  loadPromotionsDisplayWindow(promotionsDisplayWindow);
  promotionsDisplayWindow.once("ready-to-show", () => {
    if (!promotionsDisplayWindow || promotionsDisplayWindow.isDestroyed())
      return;
    promotionsDisplayWindow.show();
    promotionsDisplayWindow.focus();
  });
  promotionsDisplayWindow.webContents.on("did-finish-load", () => {
    if (!lastPromotionsDisplayState || !promotionsDisplayWindow || promotionsDisplayWindow.isDestroyed())
      return;
    promotionsDisplayWindow.webContents.send("promotions-display:data", lastPromotionsDisplayState);
  });
  promotionsDisplayWindow.on("closed", () => {
    promotionsDisplayWindow = null;
  });
  return { window: promotionsDisplayWindow, alreadyOpen: false };
};
ipcMain.handle("customer-display:open", () => {
  const result = createCustomerDisplayWindow();
  return { success: true, alreadyOpen: result.alreadyOpen };
});
ipcMain.handle("customer-display:close", () => {
  if (customerDisplayWindow && !customerDisplayWindow.isDestroyed()) {
    customerDisplayWindow.close();
  }
  customerDisplayWindow = null;
  return { success: true };
});
ipcMain.handle("customer-display:get-state", () => lastCustomerDisplayState || null);
ipcMain.on("customer-display:update", (_event, payload) => {
  if (!payload || typeof payload !== "object")
    return;
  lastCustomerDisplayState = payload;
  if (!customerDisplayWindow || customerDisplayWindow.isDestroyed())
    return;
  customerDisplayWindow.webContents.send("customer-display:data", payload);
});
ipcMain.handle("promotions-display:open", () => {
  const result = createPromotionsDisplayWindow();
  return { success: true, alreadyOpen: result.alreadyOpen };
});
ipcMain.handle("promotions-display:close", () => {
  if (promotionsDisplayWindow && !promotionsDisplayWindow.isDestroyed()) {
    promotionsDisplayWindow.close();
  }
  promotionsDisplayWindow = null;
  return { success: true };
});
ipcMain.handle("promotions-display:get-state", () => lastPromotionsDisplayState || null);
ipcMain.on("promotions-display:update", (_event, payload) => {
  if (!payload || typeof payload !== "object")
    return;
  lastPromotionsDisplayState = payload;
  if (!promotionsDisplayWindow || promotionsDisplayWindow.isDestroyed())
    return;
  promotionsDisplayWindow.webContents.send("promotions-display:data", payload);
});
ipcMain.handle("print:list-printers", async () => {
  if (!getDeploymentConfig().allowLocalUsbPrinting)
    return [];
  const wc = mainWindow?.webContents;
  if (!wc)
    return [];
  try {
    const list = await wc.getPrintersAsync();
    return (list || []).map((p) => p.name);
  } catch (e) {
    console.warn("getPrintersAsync failed", e);
    return [];
  }
});
ipcMain.handle("print:to-printer", async (_event, { printerName, htmlContent, paperSize }) => {
  if (!getDeploymentConfig().allowLocalUsbPrinting)
    return false;
  if (!printerName || typeof htmlContent !== "string")
    return false;
  const tmpDir = os.tmpdir();
  const tmpFile = path.join(tmpDir, `shamel-print-${Date.now()}.html`);
  try {
    fs.writeFileSync(tmpFile, htmlContent, "utf8");
  } catch (writeErr) {
    console.warn("Failed to write temp print file", writeErr);
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
          standard: "Segoe UI",
          serif: "Segoe UI",
          sansSerif: "Segoe UI",
          monospace: "Consolas"
        }
      }
    });
    const cleanup = (result) => {
      try {
        if (printWin && !printWin.isDestroyed())
          printWin.close();
      } catch {
      }
      try {
        fs.unlinkSync(tmpFile);
      } catch {
      }
      resolve(!!result);
    };
    printWin.webContents.once("did-fail-load", (_e, code) => {
      console.warn("Print window load failed", code);
      cleanup(false);
    });
    printWin.webContents.once("did-finish-load", () => {
      setTimeout(() => {
        if (printWin.isDestroyed())
          return cleanup(false);
        const pageSizeByPaper = (() => {
          const normalized = String(paperSize || "").toLowerCase();
          if (normalized === "58mm")
            return { width: 58e3, height: 2e5 };
          if (normalized === "80mm")
            return { width: 8e4, height: 2e5 };
          if (normalized === "85mm")
            return { width: 85e3, height: 2e5 };
          if (normalized === "a5")
            return "A5";
          if (normalized === "a4")
            return "A4";
          return void 0;
        })();
        const printOptions = {
          silent: true,
          deviceName: printerName,
          printBackground: true,
          margins: { marginType: "none" },
          ...pageSizeByPaper ? { pageSize: pageSizeByPaper } : {}
        };
        printWin.webContents.print(
          printOptions,
          (success) => cleanup(success)
        );
      }, 400);
    });
    printWin.loadFile(tmpFile).catch((err) => {
      console.warn("Print loadFile failed", err);
      cleanup(false);
    });
  });
});
ipcMain.handle("deployment:get-config", () => getDeploymentConfig());
ipcMain.on("deployment:get-config-sync", (event) => {
  event.returnValue = getDeploymentConfig();
});
ipcMain.handle("deployment:save-config", (_event, config) => writePersistedDeploymentConfig(config || {}));
ipcMain.handle("app:restart", () => {
  setImmediate(() => {
    app.relaunch();
    app.exit(0);
  });
  return true;
});
var gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized())
        mainWindow.restore();
      mainWindow.focus();
    }
  });
  app.whenReady().then(async () => {
    const serverReady = await startServer();
    if (!serverReady) {
      console.error("\u274C Continuing startup with packaged UI but backend failed to stand up.");
    }
    createWindow();
  });
}
app.on("window-all-closed", () => {
  if (process.platform !== "darwin")
    app.quit();
});
app.on("before-quit", () => {
  if (customerDisplayWindow && !customerDisplayWindow.isDestroyed()) {
    try {
      customerDisplayWindow.close();
    } catch {
    }
  }
  if (promotionsDisplayWindow && !promotionsDisplayWindow.isDestroyed()) {
    try {
      promotionsDisplayWindow.close();
    } catch {
    }
  }
  if (serverProcess) {
    try {
      serverProcess.kill();
    } catch {
    }
  }
});
