/**
 * Global type declarations for Electron API
 */

export interface ElectronAPI {
  os: {
    detect: () => Promise<{ success: boolean; data?: unknown; error?: string }>;
  };
  config: {
    load: () => Promise<{ success: boolean; data?: unknown; error?: string }>;
    save: (config: unknown) => Promise<{ success: boolean; error?: string }>;
    get: (key: string) => Promise<{ success: boolean; data?: unknown; error?: string }>;
    set: (key: string, value: unknown) => Promise<{ success: boolean; error?: string }>;
    exists: () => Promise<{ success: boolean; data?: boolean; error?: string }>;
  };
  install: {
    start: (options: unknown) => Promise<{ success: boolean; data?: unknown; error?: string }>;
    onProgress: (callback: (progress: unknown) => void) => void;
    removeProgressListener: () => void;
  };
  service: {
    status: (ssh?: unknown) => Promise<{ success: boolean; data?: unknown; error?: string }>;
    start: (ssh?: unknown) => Promise<{ success: boolean; error?: string }>;
    stop: (ssh?: unknown) => Promise<{ success: boolean; error?: string }>;
    restart: (ssh?: unknown) => Promise<{ success: boolean; error?: string }>;
    logs: (lines: number, ssh?: unknown) => Promise<{ success: boolean; data?: string; error?: string }>;
    getLogs: (lines?: number, ssh?: unknown) => Promise<{ success: boolean; data?: string; error?: string }>;
    clearLogs: (ssh?: unknown) => Promise<{ success: boolean; error?: string }>;
    enableAutoStart: (ssh?: unknown) => Promise<{ success: boolean; error?: string }>;
    disableAutoStart: (ssh?: unknown) => Promise<{ success: boolean; error?: string }>;
  };
  ssh: {
    test: (sshConfig: unknown) => Promise<{ success: boolean; data?: boolean; error?: string }>;
  };
  server: {
    detect: (url: string) => Promise<{ success: boolean; data?: unknown; error?: string }>;
    detectLocal: () => Promise<{ success: boolean; data?: unknown[]; error?: string }>;
    getManifest: (url: string) => Promise<{ success: boolean; data?: unknown; error?: string }>;
    connect: (config: unknown) => Promise<{ success: boolean; data?: unknown; error?: string }>;
    testConnection: (config: unknown) => Promise<{ success: boolean; data?: boolean; error?: string }>;
    getHealth: (config: unknown) => Promise<{ success: boolean; data?: unknown; error?: string }>;
  };
  profile: {
    save: (profile: unknown) => Promise<{ success: boolean; data?: unknown; error?: string }>;
    load: () => Promise<{ success: boolean; data?: unknown[]; error?: string }>;
    get: (id: string) => Promise<{ success: boolean; data?: unknown; error?: string }>;
    delete: (id: string) => Promise<{ success: boolean; error?: string }>;
    update: (id: string, updates: unknown) => Promise<{ success: boolean; data?: unknown; error?: string }>;
    getRecent: (limit?: number) => Promise<{ success: boolean; data?: unknown[]; error?: string }>;
    test: (id: string) => Promise<{ success: boolean; data?: boolean; error?: string }>;
  };
}

declare global {
  interface Window {
    electron: ElectronAPI;
  }
}

export {};
