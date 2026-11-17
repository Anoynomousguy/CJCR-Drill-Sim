const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  isDesktop: true,
  platform: () => ipcRenderer.invoke('app:platform'),
  savePlan: (payload) => ipcRenderer.invoke('plan:save', payload),
  openPlan: () => ipcRenderer.invoke('plan:open'),
  onMenu: (callback) => {
    const listener = (_event, command) => callback(command);
    ipcRenderer.on('menu-command', listener);
    return () => ipcRenderer.removeListener('menu-command', listener);
  },
});
