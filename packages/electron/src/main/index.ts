/**
 * Electron Main Process
 * Handles window management, IPC, and system-level operations
 */

import { app, BrowserWindow, ipcMain, protocol } from "electron";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

// ESM equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Electron Forge Vite plugin provides these environment variables
// If not using Forge, these will be undefined and we'll use fallbacks
declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string | undefined;
import {
  logger,
  ConfigManager,
  InstallationManager,
  ServiceManager,
  SSHManager,
  OSDetector,
  ServerDetector,
  ServerConnection,
  ConnectionProfileManager,
} from "@stremio-addon-manager/core";

let mainWindow: BrowserWindow | null = null;

/**
 * Create the main application window
 */
function createWindow() {
  // CRITICAL FIX: Use app.getAppPath() for absolute path resolution
  const isDev = process.env.NODE_ENV === "development";

  // Get the correct preload path
  // Electron Forge Vite plugin automatically provides the correct preload path
  // For manual setup, we need to find it ourselves
  let preloadPath: string;

  // Check if Electron Forge is providing the preload path via environment
  // (This would be set by Electron Forge's Vite plugin)
  if (typeof process.env.VITE_PRELOAD === "string") {
    preloadPath = path.resolve(__dirname, process.env.VITE_PRELOAD);
    console.log("Using Electron Forge preload path:", preloadPath);
  } else if (isDev) {
    // Manual setup: Try multiple possible locations
    // Note: preload must be .cjs because package.json has "type": "module"
    const possiblePaths = [
      path.join(__dirname, "preload.cjs"), // Same directory as index.js (dist/src/main/)
      path.join(__dirname, "preload.js"), // Fallback to .js if .cjs doesn't exist
      path.join(__dirname, "..", "main", "preload.cjs"), // If __dirname is dist/src/
      path.join(__dirname, "..", "main", "preload.js"), // Fallback
      path.join(process.cwd(), "dist", "src", "main", "preload.cjs"), // From TypeScript build
      path.join(process.cwd(), "dist", "src", "main", "preload.js"), // Fallback
      path.join(process.cwd(), "packages", "electron", "dist", "src", "main", "preload.cjs"), // Full path
      path.join(process.cwd(), "packages", "electron", "dist", "src", "main", "preload.js"), // Fallback
    ];

    // Find the first existing path
    preloadPath = path.join(__dirname, "preload.cjs"); // Default fallback (.cjs for CommonJS)
    for (const possiblePath of possiblePaths) {
      if (fs.existsSync(possiblePath)) {
        preloadPath = possiblePath;
        break;
      }
    }
  } else {
    // In production, use app.getAppPath()
    // Try .cjs first (CommonJS), then fallback to .js
    const prodPathCjs = path.join(app.getAppPath(), "dist", "src", "main", "preload.cjs");
    const prodPathJs = path.join(app.getAppPath(), "dist", "src", "main", "preload.js");
    preloadPath = fs.existsSync(prodPathCjs) ? prodPathCjs : prodPathJs;
  }

  // DEBUG: Log paths
  console.log("=== ELECTRON DEBUG ===");
  console.log("__dirname:", __dirname);
  console.log("app.getAppPath():", app.getAppPath());
  console.log("Preload path:", preloadPath);
  console.log("Preload exists:", fs.existsSync(preloadPath));
  console.log("NODE_ENV:", process.env.NODE_ENV);
  console.log("===================");

  // If preload doesn't exist at expected path, try alternative locations
  if (!fs.existsSync(preloadPath)) {
    console.warn("⚠️ Preload not found at expected path, trying alternatives...");
    const alternatives = [
      path.join(__dirname, "preload.cjs"), // Same directory (.cjs for CommonJS)
      path.join(__dirname, "preload.js"), // Fallback
      path.join(app.getAppPath(), "dist", "src", "main", "preload.cjs"), // Production path
      path.join(app.getAppPath(), "dist", "src", "main", "preload.js"), // Fallback
      path.join(process.cwd(), "dist", "src", "main", "preload.cjs"), // From cwd
      path.join(process.cwd(), "dist", "src", "main", "preload.js"), // Fallback
      path.join(process.cwd(), "packages", "electron", "dist", "src", "main", "preload.cjs"), // Full path from monorepo root
      path.join(process.cwd(), "packages", "electron", "dist", "src", "main", "preload.js"), // Fallback
    ];

    for (const altPath of alternatives) {
      if (fs.existsSync(altPath)) {
        console.log("✅ Found preload at:", altPath);
        preloadPath = altPath;
        break;
      }
    }
  }

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false, // Must be false for security
      contextIsolation: true, // Must be true for security
      sandbox: false, // Disable sandbox to allow preload to work
      webSecurity: isDev ? false : true, // CRITICAL: Must be false for remote URLs in dev
      allowRunningInsecureContent: isDev ? true : false, // Allow insecure content in dev
    },
    title: "Stremio Addon Manager",
    backgroundColor: "#1f1f1f",
  });

  // DEBUG: Listen for preload errors
  mainWindow.webContents.on("preload-error", (_, preloadPath, error) => {
    console.error("❌ PRELOAD ERROR:", preloadPath, error);
  });

  mainWindow.webContents.on("did-fail-load", (_, errorCode, errorDescription) => {
    console.error("❌ PAGE LOAD FAILED:", errorCode, errorDescription);
  });

  mainWindow.webContents.on("did-finish-load", () => {
    console.log("✅ Page loaded successfully");

    // Wait a bit for preload to finish, then check
    setTimeout(() => {
      // DEBUG: Check if window.electron is available after load
      mainWindow?.webContents
        .executeJavaScript(
          `
        console.log("=== RENDERER CHECK (from main process) ===");
        console.log("window.electron:", typeof window.electron !== "undefined" ? "✅ EXISTS" : "❌ UNDEFINED");
        console.log("window.__ELECTRON_TEST__:", typeof window.__ELECTRON_TEST__ !== "undefined" ? "✅ EXISTS" : "❌ UNDEFINED");
        if (window.electron) {
          console.log("window.electron keys:", Object.keys(window.electron));
        } else {
          console.error("❌ window.electron is UNDEFINED - preload script may not have loaded correctly");
        }
        return typeof window.electron !== "undefined";
      `
        )
        .then((result) => {
          console.log("Main process check result - window.electron exists:", result);
          if (!result) {
            console.error("❌ CRITICAL: window.electron is not available in renderer!");
            console.error("This means the preload script did not expose the API correctly.");
            console.error("Check the terminal for preload script logs above.");
          }
        })
        .catch((err) => console.error("Failed to execute debug script:", err));
    }, 1000); // Wait 1 second for preload to finish
  });

  // Load the React app
  // CRITICAL: contextBridge.exposeInMainWorld does NOT work with remote URLs (http://localhost:3000)
  // even with webSecurity: false. This is a known Electron limitation.
  // Solutions:
  // 1. Use vite-plugin-electron's dev server (provides proper integration)
  // 2. Use Electron Forge's dev command (provides MAIN_WINDOW_VITE_DEV_SERVER_URL which works)
  // 3. Load from built local file (works but loses hot reloading)
  if (process.env.NODE_ENV === "development") {
    // Check if Electron Forge is providing the dev server URL
    if (typeof MAIN_WINDOW_VITE_DEV_SERVER_URL !== "undefined") {
      console.log("✅ Using Electron Forge dev server (preload will work):", MAIN_WINDOW_VITE_DEV_SERVER_URL);
      mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
    } else {
      // Use vite-plugin-electron's dev server URL
      // vite-plugin-electron provides VITE_DEV_SERVER_URL environment variable
      const viteDevServerUrl = process.env.VITE_DEV_SERVER_URL || "http://localhost:3000";

      // For vite-plugin-electron, we need to use a custom protocol or load from file
      // The safest approach is to build the renderer and load from file in dev mode
      const rendererPath = path.join(__dirname, "../renderer/index.html");
      if (fs.existsSync(rendererPath)) {
        console.log("✅ Loading from built file (preload will work):", rendererPath);
        console.log("   Note: Run 'npm run build:renderer' after code changes");
        mainWindow.loadFile(rendererPath);
      } else {
        // Last resort: Try using the dev server
        // NOTE: contextBridge will NOT work with http:// URLs
        // The preload script will load but window.electron will be undefined
        console.error("❌ Built renderer not found!");
        console.error("   Run 'npm run build:renderer' first for preload to work");
        console.error("   Loading from dev server (preload will NOT work):", viteDevServerUrl);
        console.error("   window.electron will be undefined when loading from http:// URLs");
        mainWindow.loadURL(viteDevServerUrl);
      }
    }
    mainWindow.webContents.openDevTools();
  } else {
    // Production: Load from built file
    mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  logger.info("Main window created");
}

/**
 * Register custom protocol for dev server
 * This allows contextBridge to work with localhost URLs
 */
function registerCustomProtocol() {
  if (process.env.NODE_ENV === "development") {
    protocol.registerHttpProtocol("app", (request, callback) => {
      // Convert app:// URLs to http://localhost:3000
      const url = request.url.replace("app://", "http://localhost:3000/");
      callback({ url });
    });
    console.log("✅ Custom protocol 'app://' registered for dev server");
  }
}

/**
 * App lifecycle events
 */
app.on("ready", () => {
  registerCustomProtocol();
  createWindow();
  setupIPC();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (mainWindow === null) {
    createWindow();
  }
});

/**
 * Setup IPC handlers for communication with renderer process
 */
function setupIPC() {
  // OS Detection
  ipcMain.handle("os:detect", async () => {
    try {
      const systemInfo = OSDetector.detect();
      return { success: true, data: systemInfo };
    } catch (error) {
      logger.error("OS detection failed", error);
      return { success: false, error: (error as Error).message };
    }
  });

  // Config Management
  ipcMain.handle("config:load", async () => {
    try {
      const configManager = new ConfigManager();
      const config = await configManager.load();
      return { success: true, data: config };
    } catch (error) {
      logger.error("Config load failed", error);
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle("config:save", async (_event, config) => {
    try {
      const configManager = new ConfigManager();
      await configManager.save(config);
      return { success: true };
    } catch (error) {
      logger.error("Config save failed", error);
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle("config:get", async (_event, key: string) => {
    try {
      const configManager = new ConfigManager();
      await configManager.load();
      const value = configManager.getNestedValue(key);
      return { success: true, data: value };
    } catch (error) {
      logger.error("Config get failed", error);
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle("config:set", async (_event, key: string, value: unknown) => {
    try {
      const configManager = new ConfigManager();
      await configManager.load();
      configManager.setNestedValue(key, value);
      await configManager.save();
      return { success: true };
    } catch (error) {
      logger.error("Config set failed", error);
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle("config:exists", async () => {
    try {
      const configManager = new ConfigManager();
      const exists = await configManager.exists();
      return { success: true, data: exists };
    } catch (error) {
      logger.error("Config exists check failed", error);
      return { success: false, error: (error as Error).message };
    }
  });

  // Installation
  ipcMain.handle("install:start", async (_event, options) => {
    try {
      const installManager = new InstallationManager({
        ...options,
        progressCallback: (progress) => {
          mainWindow?.webContents.send("install:progress", progress);
        },
      });

      const result = await installManager.install();
      return { success: true, data: result };
    } catch (error) {
      logger.error("Installation failed", error);
      return { success: false, error: (error as Error).message };
    }
  });

  // Service Management
  ipcMain.handle("service:status", async (_event, ssh) => {
    try {
      const sshConnection = ssh ? new SSHManager(ssh) : undefined;
      if (sshConnection) {
        await sshConnection.connect();
      }

      const serviceManager = new ServiceManager("stremio-addon", sshConnection);
      const status = await serviceManager.status();

      if (sshConnection) {
        await sshConnection.disconnect();
      }

      return { success: true, data: status };
    } catch (error) {
      logger.error("Service status failed", error);
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle("service:start", async (_event, ssh) => {
    try {
      const sshConnection = ssh ? new SSHManager(ssh) : undefined;
      if (sshConnection) {
        await sshConnection.connect();
      }

      const serviceManager = new ServiceManager("stremio-addon", sshConnection);
      await serviceManager.start();

      if (sshConnection) {
        await sshConnection.disconnect();
      }

      return { success: true };
    } catch (error) {
      logger.error("Service start failed", error);
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle("service:stop", async (_event, ssh) => {
    try {
      const sshConnection = ssh ? new SSHManager(ssh) : undefined;
      if (sshConnection) {
        await sshConnection.connect();
      }

      const serviceManager = new ServiceManager("stremio-addon", sshConnection);
      await serviceManager.stop();

      if (sshConnection) {
        await sshConnection.disconnect();
      }

      return { success: true };
    } catch (error) {
      logger.error("Service stop failed", error);
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle("service:restart", async (_event, ssh) => {
    try {
      const sshConnection = ssh ? new SSHManager(ssh) : undefined;
      if (sshConnection) {
        await sshConnection.connect();
      }

      const serviceManager = new ServiceManager("stremio-addon", sshConnection);
      await serviceManager.restart();

      if (sshConnection) {
        await sshConnection.disconnect();
      }

      return { success: true };
    } catch (error) {
      logger.error("Service restart failed", error);
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle("service:logs", async (_event, lines: number, ssh) => {
    try {
      const sshConnection = ssh ? new SSHManager(ssh) : undefined;
      if (sshConnection) {
        await sshConnection.connect();
      }

      const serviceManager = new ServiceManager("stremio-addon", sshConnection);
      const logs = await serviceManager.logs(lines);

      if (sshConnection) {
        await sshConnection.disconnect();
      }

      return { success: true, data: logs };
    } catch (error) {
      logger.error("Service logs failed", error);
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle("service:getLogs", async (_event, lines: number = 100, ssh) => {
    try {
      const sshConnection = ssh ? new SSHManager(ssh) : undefined;
      if (sshConnection) {
        await sshConnection.connect();
      }

      const serviceManager = new ServiceManager("stremio-addon", sshConnection);
      const logs = await serviceManager.logs(lines);

      if (sshConnection) {
        await sshConnection.disconnect();
      }

      return { success: true, data: logs };
    } catch (error) {
      logger.error("Get logs failed", error);
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle("service:clearLogs", async (_event, ssh) => {
    try {
      const sshConnection = ssh ? new SSHManager(ssh) : undefined;
      if (sshConnection) {
        await sshConnection.connect();
      }

      // Clear logs by truncating the log file
      const systemInfo = sshConnection ? await OSDetector.detectRemote(sshConnection as any) : OSDetector.detect();
      const logPath = systemInfo.os === "linux" ? "/var/log/stremio-addon.log" : "./stremio-addon.log";

      if (sshConnection) {
        await sshConnection.execCommand(`echo "" > ${logPath}`);
        await sshConnection.disconnect();
      } else {
        const fs = await import("fs/promises");
        await fs.writeFile(logPath, "");
      }

      return { success: true };
    } catch (error) {
      logger.error("Clear logs failed", error);
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle("service:enableAutoStart", async (_event, ssh) => {
    try {
      const sshConnection = ssh ? new SSHManager(ssh) : undefined;
      if (sshConnection) {
        await sshConnection.connect();
      }

      const serviceManager = new ServiceManager("stremio-addon", sshConnection);
      await serviceManager.enable();

      if (sshConnection) {
        await sshConnection.disconnect();
      }

      return { success: true };
    } catch (error) {
      logger.error("Enable auto-start failed", error);
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle("service:disableAutoStart", async (_event, ssh) => {
    try {
      const sshConnection = ssh ? new SSHManager(ssh) : undefined;
      if (sshConnection) {
        await sshConnection.connect();
      }

      const serviceManager = new ServiceManager("stremio-addon", sshConnection);
      await serviceManager.disable();

      if (sshConnection) {
        await sshConnection.disconnect();
      }

      return { success: true };
    } catch (error) {
      logger.error("Disable auto-start failed", error);
      return { success: false, error: (error as Error).message };
    }
  });

  // SSH Testing
  ipcMain.handle("ssh:test", async (_event, sshConfig) => {
    try {
      const ssh = new SSHManager(sshConfig);
      const result = await ssh.testConnection();
      return { success: true, data: result };
    } catch (error) {
      logger.error("SSH test failed", error);
      return { success: false, error: (error as Error).message };
    }
  });

  // Server Detection
  ipcMain.handle("server:detect", async (_event, url: string) => {
    try {
      const result = await ServerDetector.detectServer(url);
      return result;
    } catch (error) {
      logger.error("Server detection failed", error);
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle("server:detectLocal", async () => {
    try {
      const servers = await ServerDetector.detectLocalServers();
      return { success: true, data: servers };
    } catch (error) {
      logger.error("Local server detection failed", error);
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle("server:getManifest", async (_event, url: string) => {
    try {
      const manifest = await ServerDetector.getManifest(url);
      return { success: true, data: manifest };
    } catch (error) {
      logger.error("Get manifest failed", error);
      return { success: false, error: (error as Error).message };
    }
  });

  // Server Connection
  ipcMain.handle("server:connect", async (_event, config) => {
    try {
      const connection = new ServerConnection(config);
      const result = await connection.connect();
      return result;
    } catch (error) {
      logger.error("Server connection failed", error);
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle("server:testConnection", async (_event, config) => {
    try {
      const connection = new ServerConnection(config);
      const result = await connection.testConnection();
      return result;
    } catch (error) {
      logger.error("Connection test failed", error);
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle("server:getHealth", async (_event, config) => {
    try {
      const connection = new ServerConnection(config);
      const result = await connection.getHealth();
      return result;
    } catch (error) {
      logger.error("Health check failed", error);
      return { success: false, error: (error as Error).message };
    }
  });

  // Connection Profiles
  ipcMain.handle("profile:save", async (_event, profile) => {
    try {
      const profileManager = new ConnectionProfileManager();
      const result = await profileManager.saveProfile(profile);
      return result;
    } catch (error) {
      logger.error("Save profile failed", error);
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle("profile:load", async () => {
    try {
      const profileManager = new ConnectionProfileManager();
      const profiles = await profileManager.loadProfiles();
      return { success: true, data: profiles };
    } catch (error) {
      logger.error("Load profiles failed", error);
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle("profile:get", async (_event, id: string) => {
    try {
      const profileManager = new ConnectionProfileManager();
      const profile = await profileManager.getProfile(id);
      return { success: true, data: profile };
    } catch (error) {
      logger.error("Get profile failed", error);
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle("profile:delete", async (_event, id: string) => {
    try {
      const profileManager = new ConnectionProfileManager();
      const result = await profileManager.deleteProfile(id);
      return result;
    } catch (error) {
      logger.error("Delete profile failed", error);
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle("profile:update", async (_event, id: string, updates) => {
    try {
      const profileManager = new ConnectionProfileManager();
      const result = await profileManager.updateProfile(id, updates);
      return result;
    } catch (error) {
      logger.error("Update profile failed", error);
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle("profile:getRecent", async (_event, limit?: number) => {
    try {
      const profileManager = new ConnectionProfileManager();
      const profiles = await profileManager.getRecentProfiles(limit);
      return { success: true, data: profiles };
    } catch (error) {
      logger.error("Get recent profiles failed", error);
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle("profile:test", async (_event, id: string) => {
    try {
      const profileManager = new ConnectionProfileManager();
      const result = await profileManager.testProfile(id);
      return result;
    } catch (error) {
      logger.error("Test profile failed", error);
      return { success: false, error: (error as Error).message };
    }
  });

  logger.info("IPC handlers registered");
}

// Handle uncaught exceptions
process.on("uncaughtException", (error) => {
  logger.error("Uncaught exception", error);
});

process.on("unhandledRejection", (error) => {
  logger.error("Unhandled rejection", error);
});
