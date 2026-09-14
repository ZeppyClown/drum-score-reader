const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('omr', {
  importBar: () => ipcRenderer.invoke('omr:import'),
  pasteAiImage: () => ipcRenderer.invoke('ai:paste-image'),
});
// Score files: the renderer sends documents; main chooses paths and touches the disk.
const COMMANDS = new Set(['new', 'open', 'open-recent', 'save', 'save-as', 'save-and-close', 'undo', 'redo']);
contextBridge.exposeInMainWorld('scoreFiles', {
  save: (doc, options) => ipcRenderer.invoke('score:save', doc, options),
  open: options => ipcRenderer.invoke('score:open', options),
  newScore: () => ipcRenderer.invoke('score:new'),
  autosave: (doc, dirty) => ipcRenderer.invoke('score:autosave', doc, dirty),
  confirmDiscard: (title, scoreId) => ipcRenderer.invoke('score:confirm-discard', title, scoreId),
  recover: () => ipcRenderer.invoke('score:recover'),
  setStatus: status => ipcRenderer.invoke('score:status', status),
  onCommand: callback => ipcRenderer.on('app:command', (_event, name, arg) => {
    if (COMMANDS.has(name)) callback(name, arg);
  }),
});
