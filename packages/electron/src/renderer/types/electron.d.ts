/**
 * Global type declarations for Electron API
 */

export interface ElectronAPI {
  os: {
    detect: () => Promise<{ success: boolean; data?: unknown; error?: string }>;
  };
  config: {
    load: (addonId?: string) => Promise<{ success: boolean; data?: unknown; error?: string }>;
    save: (
      config: unknown,
      addonId?: string,
      options?: { syncServiceFile?: boolean; restartService?: boolean }
    ) => Promise<{
      success: boolean;
      serviceFileSynced?: boolean;
      serviceFileChanges?: string[];
      error?: string;
    }>;
    get: (key: string, addonId?: string) => Promise<{ success: boolean; data?: unknown; error?: string }>;
    set: (key: string, value: unknown, addonId?: string) => Promise<{ success: boolean; error?: string }>;
    exists: (addonId?: string) => Promise<{ success: boolean; data?: boolean; error?: string }>;
  };
  migration: {
    check: () => Promise<{ success: boolean; data?: boolean; error?: string }>;
    migrate: () => Promise<{ success: boolean; data?: string; error?: string }>;
  };
  addon: {
    list: () => Promise<{ success: boolean; data?: unknown[]; error?: string }>;
    get: (addonId: string) => Promise<{ success: boolean; data?: unknown; error?: string }>;
    getDefault: () => Promise<{ success: boolean; data?: unknown; error?: string }>;
    setDefault: (addonId: string) => Promise<{ success: boolean; error?: string }>;
    create: (name: string, port: number, domain: string) => Promise<{ success: boolean; data?: unknown; error?: string }>;
    delete: (addonId: string) => Promise<{ success: boolean; error?: string }>;
  };
  install: {
    start: (options: unknown) => Promise<{ success: boolean; data?: unknown; error?: string }>;
    onProgress: (callback: (progress: unknown) => void) => void;
    removeProgressListener: () => void;
  };
  service: {
    status: (ssh?: unknown, addonId?: string) => Promise<{ success: boolean; data?: unknown; error?: string }>;
    start: (ssh?: unknown, addonId?: string) => Promise<{ success: boolean; error?: string }>;
    stop: (ssh?: unknown, addonId?: string) => Promise<{ success: boolean; error?: string }>;
    restart: (ssh?: unknown, addonId?: string) => Promise<{ success: boolean; error?: string }>;
    logs: (lines: number, ssh?: unknown, addonId?: string) => Promise<{ success: boolean; data?: string; error?: string }>;
    getLogs: (lines?: number, ssh?: unknown, addonId?: string) => Promise<{ success: boolean; data?: string; error?: string }>;
    clearLogs: (ssh?: unknown, addonId?: string) => Promise<{ success: boolean; error?: string }>;
    enableAutoStart: (ssh?: unknown, addonId?: string) => Promise<{ success: boolean; error?: string }>;
    disableAutoStart: (ssh?: unknown, addonId?: string) => Promise<{ success: boolean; error?: string }>;
  };
  env: {
    list: (ssh?: unknown, addonId?: string) => Promise<{ success: boolean; data?: Record<string, string>; error?: string }>;
    get: (key: string, ssh?: unknown, addonId?: string) => Promise<{ success: boolean; data?: { key: string; value: string }; error?: string }>;
    set: (key: string, value: string, ssh?: unknown, addonId?: string) => Promise<{ success: boolean; error?: string }>;
    unset: (key: string, ssh?: unknown, addonId?: string) => Promise<{ success: boolean; error?: string }>;
    reset: (ssh?: unknown, addonId?: string) => Promise<{ success: boolean; error?: string }>;
    sync: (ssh?: unknown, addonId?: string, restartService?: boolean) => Promise<{ success: boolean; data?: { updated: boolean; changes?: string[] }; error?: string }>;
    generate: (key: string, ssh?: unknown, addonId?: string) => Promise<{ success: boolean; data?: { key: string; value: string }; error?: string }>;
    getMetadata: () => Promise<{ success: boolean; data?: { metadata: Record<string, unknown>; defaults: Record<string, string> }; error?: string }>;
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
