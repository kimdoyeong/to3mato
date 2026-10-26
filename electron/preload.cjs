const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('to3mato', {
  version: () => ipcRenderer.invoke('app:version'),
  update: {
    check: () => ipcRenderer.invoke('update:check'),
    install: () => ipcRenderer.invoke('update:install'),
    subscribe: (callback) => {
      let active = true;
      let received = false;
      const listener = (_event, status) => {
        received = true;
        if (active) callback(status);
      };
      ipcRenderer.on('update:status', listener);
      // Opening settings after download or reloading must restore the current status.
      ipcRenderer
        .invoke('update:status')
        .then((status) => {
          if (active && !received) callback(status);
        })
        .catch(() => {});
      return () => {
        active = false;
        ipcRenderer.removeListener('update:status', listener);
      };
    },
  },
  subscribeVisibility: (callback) => {
    let active = true,
      received = false;
    const listener = (_event, visible) => {
      received = true;
      if (active) callback(visible);
    };
    ipcRenderer.on('window:visibility', listener);
    ipcRenderer
      .invoke('window:visible')
      .then((visible) => {
        if (active && !received) callback(visible);
      })
      .catch(() => {});
    return () => {
      active = false;
      ipcRenderer.removeListener('window:visibility', listener);
    };
  },
  showMain: () => ipcRenderer.invoke('window:show'),
  load: () => ipcRenderer.invoke('state:load'),
  dispatch: (command) => ipcRenderer.invoke('state:command', command),
  subscribe: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('state:changed', listener);
    return () => ipcRenderer.removeListener('state:changed', listener);
  },
  onError: (callback) => {
    const listener = (_event, message) => callback(message);
    ipcRenderer.on('state:error', listener);
    return () => ipcRenderer.removeListener('state:error', listener);
  },
  exportData: () => ipcRenderer.invoke('data:export'),
  exportVideo: (bytes, filename) =>
    ipcRenderer.invoke('video:export', bytes, filename),
  importData: () => ipcRenderer.invoke('data:import'),
  pickProjectImage: () => ipcRenderer.invoke('image:pick'),
  readProjectImage: (file) => ipcRenderer.invoke('image:read', file),
});
