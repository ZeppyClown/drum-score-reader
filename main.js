const { app, BrowserWindow } = require('electron');
const path = require('path');

function createWindow() {
  const win = new BrowserWindow({ width: 1000, height: 400 });
  win.loadFile('index.html');
  win.webContents.openDevTools();
}

app.whenReady().then(createWindow);
