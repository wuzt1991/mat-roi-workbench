'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const api = {
  checkForUpdates: () => ipcRenderer.invoke('updates:check'),
  downloadUpdate: () => ipcRenderer.invoke('updates:download'),
  quitAndInstall: () => ipcRenderer.invoke('updates:quit-and-install'),
  onUpdateStatus: listener => {
    if (typeof listener !== 'function') return () => {};
    const wrapped = (_event, status) => listener(status);
    ipcRenderer.on('updates:status', wrapped);
    return () => ipcRenderer.removeListener('updates:status', wrapped);
  }
};

contextBridge.exposeInMainWorld('matUpdates', Object.freeze(api));
