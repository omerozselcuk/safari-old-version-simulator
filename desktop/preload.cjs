const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('safariSimulator', {
  getState: () => ipcRenderer.invoke('get-state'),
  launchBrowser: request => ipcRenderer.invoke('launch-browser', request),
  closeBrowser: () => ipcRenderer.invoke('close-browser'),
  onStatus: callback => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on('browser-status', listener);
    return () => ipcRenderer.removeListener('browser-status', listener);
  },
});
