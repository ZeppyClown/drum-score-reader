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
// Ask DrumHub: questions and snapshots go to main, which owns the key and the model call.
contextBridge.exposeInMainWorld('agent', {
  status: () => ipcRenderer.invoke('agent:status'),
  ask: request => ipcRenderer.invoke('agent:ask', request),
  cancel: () => ipcRenderer.invoke('agent:cancel'),
  setCloud: enabled => ipcRenderer.invoke('agent:set-cloud', Boolean(enabled)),
});
// Page and PDF import: main opens the file, crops boxes and runs recognition.
contextBridge.exposeInMainWorld('pages', {
  open: () => ipcRenderer.invoke('page:open'),
  transcribe: (jobId, boxes, recognizer) => ipcRenderer.invoke('page:transcribe', jobId, boxes, recognizer),
  retry: (jobId, boxId) => ipcRenderer.invoke('page:retry', jobId, boxId),
  cancel: jobId => ipcRenderer.invoke('page:cancel', jobId),
  recoverable: () => ipcRenderer.invoke('page:recoverable'),
  load: jobId => ipcRenderer.invoke('page:load', jobId),
  discard: jobId => ipcRenderer.invoke('page:discard', jobId),
  onProgress: callback => ipcRenderer.on('page:progress', (_event, update) => callback(update)),
});
