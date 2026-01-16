/**
 * Electron Preload Script
 * Exposes safe IPC methods to the renderer process
 */

import { contextBridge, ipcRenderer } from "electron";

// === CRITICAL DEBUG LOGGING ===
// These logs appear in the MAIN PROCESS console (terminal), NOT in DevTools!
console.log("🚀 PRELOAD SCRIPT STARTING");
console.log("contextBridge available:", typeof contextBridge !== "undefined");
console.log("ipcRenderer available:", typeof ipcRenderer !== "undefined");

/**
 * Exposed API for renderer process
 */
const api = {
  // OS Detection
  os: {
    detect: () => ipcRenderer.invoke("os:detect"),
  },

  // Configuration
  config: {
    load: () => ipcRenderer.invoke("config:load"),
    save: (config: unknown) => ipcRenderer.invoke("config:save", config),
    get: (key: string) => ipcRenderer.invoke("config:get", key),
    set: (key: string, value: unknown) => ipcRenderer.invoke("config:set", key, value),
    exists: () => ipcRenderer.invoke("config:exists"),
  },

  // Installation
  install: {
    start: (options: unknown) => ipcRenderer.invoke("install:start", options),
    onProgress: (callback: (progress: unknown) => void) => {
      ipcRenderer.on("install:progress", (_event, progress) => callback(progress));
    },
    removeProgressListener: () => {
      ipcRenderer.removeAllListeners("install:progress");
    },
  },

  // Service Management
  service: {
    status: (ssh?: unknown) => ipcRenderer.invoke("service:status", ssh),
    start: (ssh?: unknown) => ipcRenderer.invoke("service:start", ssh),
    stop: (ssh?: unknown) => ipcRenderer.invoke("service:stop", ssh),
    restart: (ssh?: unknown) => ipcRenderer.invoke("service:restart", ssh),
    logs: (lines: number, ssh?: unknown) => ipcRenderer.invoke("service:logs", lines, ssh),
    getLogs: (lines?: number, ssh?: unknown) => ipcRenderer.invoke("service:getLogs", lines, ssh),
    clearLogs: (ssh?: unknown) => ipcRenderer.invoke("service:clearLogs", ssh),
    enableAutoStart: (ssh?: unknown) => ipcRenderer.invoke("service:enableAutoStart", ssh),
    disableAutoStart: (ssh?: unknown) => ipcRenderer.invoke("service:disableAutoStart", ssh),
  },

  // SSH
  ssh: {
    test: (sshConfig: unknown) => ipcRenderer.invoke("ssh:test", sshConfig),
  },

  // Server Detection
  server: {
    detect: (url: string) => ipcRenderer.invoke("server:detect", url),
    detectLocal: () => ipcRenderer.invoke("server:detectLocal"),
    getManifest: (url: string) => ipcRenderer.invoke("server:getManifest", url),
    connect: (config: unknown) => ipcRenderer.invoke("server:connect", config),
    testConnection: (config: unknown) => ipcRenderer.invoke("server:testConnection", config),
    getHealth: (config: unknown) => ipcRenderer.invoke("server:getHealth", config),
  },

  // Connection Profiles
  profile: {
    save: (profile: unknown) => ipcRenderer.invoke("profile:save", profile),
    load: () => ipcRenderer.invoke("profile:load"),
    get: (id: string) => ipcRenderer.invoke("profile:get", id),
    delete: (id: string) => ipcRenderer.invoke("profile:delete", id),
    update: (id: string, updates: unknown) => ipcRenderer.invoke("profile:update", id, updates),
    getRecent: (limit?: number) => ipcRenderer.invoke("profile:getRecent", limit),
    test: (id: string) => ipcRenderer.invoke("profile:test", id),
  },
};

// Expose API to renderer process with comprehensive error handling
try {
  console.log("Attempting to expose electron API...");
  contextBridge.exposeInMainWorld("electron", api);
  console.log("✅ Successfully exposed 'electron' to window");
  console.log("Exposed API keys:", Object.keys(api));

  // Also expose a test function to verify it works
  contextBridge.exposeInMainWorld("__ELECTRON_TEST__", {
    test: () => "Preload script is working!",
    timestamp: Date.now(),
  });
  console.log("✅ Test API also exposed");
} catch (error) {
  console.error("❌ CRITICAL ERROR: Failed to expose electron API");
  console.error("Error type:", error instanceof Error ? error.constructor.name : typeof error);
  console.error("Error message:", error instanceof Error ? error.message : String(error));
  console.error("Error stack:", error instanceof Error ? error.stack : "No stack trace");

  // Try to expose error info as fallback
  try {
    contextBridge.exposeInMainWorld("electronError", {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    console.log("✅ Exposed error info as fallback");
  } catch (e) {
    console.error("❌ Could not even expose error:", e);
  }
}

console.log("🏁 PRELOAD SCRIPT FINISHED");
console.log("window.electron should now be available in renderer");

// TypeScript type declarations
export type ElectronAPI = typeof api;
