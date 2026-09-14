const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('omr', {
  importBar: () => ipcRenderer.invoke('omr:import'),
  pasteAiImage: () => ipcRenderer.invoke('ai:paste-image'),
});
