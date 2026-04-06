
const { contextBridge, ipcRenderer } = require('electron');

const deploymentConfig = ipcRenderer.sendSync('deployment:get-config-sync');

const api = {
  openCustomerDisplay: () => ipcRenderer.invoke('customer-display:open'),
  closeCustomerDisplay: () => ipcRenderer.invoke('customer-display:close'),
  updateCustomerDisplay: (payload) => {
    ipcRenderer.send('customer-display:update', payload || null);
  },
  getCustomerDisplayState: () => ipcRenderer.invoke('customer-display:get-state'),
  onCustomerDisplayUpdate: (handler) => {
    if (typeof handler !== 'function') return () => {};
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on('customer-display:data', listener);
    return () => ipcRenderer.removeListener('customer-display:data', listener);
  },
  openPromotionsDisplay: () => ipcRenderer.invoke('promotions-display:open'),
  closePromotionsDisplay: () => ipcRenderer.invoke('promotions-display:close'),
  updatePromotionsDisplay: (payload) => {
    ipcRenderer.send('promotions-display:update', payload || null);
  },
  getPromotionsDisplayState: () => ipcRenderer.invoke('promotions-display:get-state'),
  onPromotionsDisplayUpdate: (handler) => {
    if (typeof handler !== 'function') return () => {};
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on('promotions-display:data', listener);
    return () => ipcRenderer.removeListener('promotions-display:data', listener);
  },
  listPrinters: () => ipcRenderer.invoke('print:list-printers'),
  printToPrinter: (printerName, htmlContent, paperSize) =>
    ipcRenderer.invoke('print:to-printer', { printerName, htmlContent, paperSize }),
  getDeploymentConfig: () => ipcRenderer.invoke('deployment:get-config'),
  saveDeploymentConfig: (config) => ipcRenderer.invoke('deployment:save-config', config),
  restartApp: () => ipcRenderer.invoke('app:restart'),
  deploymentConfig,
};

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('electronAPI', api);
} else {
  window.electronAPI = api;
}
