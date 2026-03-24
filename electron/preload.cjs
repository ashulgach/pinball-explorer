const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  pickFile: () => ipcRenderer.invoke('pick-file'),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
});
