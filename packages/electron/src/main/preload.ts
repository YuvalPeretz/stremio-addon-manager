/**
 * Electron Preload Script
 * Exposes safe IPC methods to the renderer process
 */

import { contextBridge, ipcRenderer } from 'electron';

/**
 * Exposed API for renderer process
 */
const api = {
  // OS Detection
  os: {
    detect: () => ipcRenderer.invoke('os:detect'),
  },

  // Configuration
  config: {
    load: () => ipcRenderer.invoke('config:load'),
    save: (config: unknown) => ipcRenderer.invoke('config:save', config),
    get: (key: string) => ipcRenderer.invoke('config:get', key),
    set: (key: string, value: unknown) => ipcRenderer.invoke('config:set', key, value),
    exists: () => ipcRenderer.invoke('config:exists'),
  },

  // Installation
  install: {
    start: (options: unknown) => ipcRenderer.invoke('install:start', options),
    onProgress: (callback: (progress: unknown) => void) => {
      ipcRenderer.on('install:progress', (_event, progress) => callback(progress));
    },
    removeProgressListener: () => {
      ipcRenderer.removeAllListeners('install:progress');
    },
  },

  // Service Management
  service: {
    status: (ssh?: unknown) => ipcRenderer.invoke('service:status', ssh),
    start: (ssh?: unknown) => ipcRenderer.invoke('service:start', ssh),
    stop: (ssh?: unknown) => ipcRenderer.invoke('service:stop', ssh),
    restart: (ssh?: unknown) => ipcRenderer.invoke('service:restart', ssh),
    logs: (lines: number, ssh?: unknown) => ipcRenderer.invoke('service:logs', lines, ssh),
  },

  // SSH
  ssh: {
    test: (sshConfig: unknown) => ipcRenderer.invoke('ssh:test', sshConfig),
  },
};

// Expose API to renderer process
contextBridge.exposeInMainWorld('electron', api);

// TypeScript type declarations
export type ElectronAPI = typeof api;

