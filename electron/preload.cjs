const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('to3mato', {
  account: {
    status: () => ipcRenderer.invoke('account:status'),
    requestCode: (email) => ipcRenderer.invoke('account:requestCode', email),
    verify: (email, code) => ipcRenderer.invoke('account:verify', email, code),
    enable: () => ipcRenderer.invoke('account:enable'),
    mediaAdopted: () => ipcRenderer.invoke('account:mediaAdopted'),
    disable: () => ipcRenderer.invoke('account:disable'),
    logout: () => ipcRenderer.invoke('account:logout'),
    remove: () => ipcRenderer.invoke('account:remove'),
    syncNow: () => ipcRenderer.invoke('account:now'),
    resolve: (id, action) => ipcRenderer.invoke('account:resolve', id, action),
    subscribe: (callback) => {
      let active = true,
        received = false;
      const listener = (_event, value) => {
        received = true;
        if (active) callback(value);
      };
      ipcRenderer.on('account:status', listener);
      ipcRenderer
        .invoke('account:status')
        .then((value) => {
          if (active && !received) callback(value);
        })
        .catch(() => {});
      return () => {
        active = false;
        ipcRenderer.removeListener('account:status', listener);
      };
    },
  },
  sync: {
    extra: (entity, id, fields, deleted = false, owner) =>
      ipcRenderer.invoke('sync:extra', entity, id, fields, deleted, owner),
    putAsset: (id, mime, bytes, owner) =>
      ipcRenderer.invoke('sync:asset-put', id, mime, bytes, owner),
    readAsset: (id, owner) => ipcRenderer.invoke('sync:asset-read', id, owner),
    projectImages: () => ipcRenderer.invoke('sync:project-images'),
  },
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
  ritualDates: () => ipcRenderer.invoke('ritual:dates'),
  finishRitual: (kind, date) => ipcRenderer.invoke('ritual:finish', kind, date),
  onRitual: (callback) => {
    const listener = (_event, kind) => {
      if (kind === 'plan' || kind === 'review') callback(kind);
    };
    ipcRenderer.on('ritual:open', listener);
    return () => ipcRenderer.removeListener('ritual:open', listener);
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
