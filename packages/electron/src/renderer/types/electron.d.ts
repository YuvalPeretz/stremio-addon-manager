/**
 * Global type declarations for Electron API
 */

interface ElectronAPI {
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
  };
  ssh: {
    test: (sshConfig: unknown) => Promise<{ success: boolean; data?: boolean; error?: string }>;
  };
}

declare global {
  interface Window {
    electron: ElectronAPI;
  }
}

export {};

