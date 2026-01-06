/**
 * Electron Main Process
 * Handles window management, IPC, and system-level operations
 */

import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import {
  logger,
  ConfigManager,
  InstallationManager,
  ServiceManager,
  SSHManager,
  OSDetector,
} from '@stremio-addon-manager/core';

let mainWindow: BrowserWindow | null = null;

/**
 * Create the main application window
 */
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
    title: 'Stremio Addon Manager',
    backgroundColor: '#1f1f1f',
  });

  // Load the React app
  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:3000');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  logger.info('Main window created');
}

/**
 * App lifecycle events
 */
app.on('ready', () => {
  createWindow();
  setupIPC();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});

/**
 * Setup IPC handlers for communication with renderer process
 */
function setupIPC() {
  // OS Detection
  ipcMain.handle('os:detect', async () => {
    try {
      const systemInfo = OSDetector.detect();
      return { success: true, data: systemInfo };
    } catch (error) {
      logger.error('OS detection failed', error);
      return { success: false, error: (error as Error).message };
    }
  });

  // Config Management
  ipcMain.handle('config:load', async () => {
    try {
      const configManager = new ConfigManager();
      const config = await configManager.load();
      return { success: true, data: config };
    } catch (error) {
      logger.error('Config load failed', error);
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('config:save', async (_event, config) => {
    try {
      const configManager = new ConfigManager();
      await configManager.save(config);
      return { success: true };
    } catch (error) {
      logger.error('Config save failed', error);
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('config:get', async (_event, key: string) => {
    try {
      const configManager = new ConfigManager();
      await configManager.load();
      const value = configManager.getNestedValue(key);
      return { success: true, data: value };
    } catch (error) {
      logger.error('Config get failed', error);
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('config:set', async (_event, key: string, value: unknown) => {
    try {
      const configManager = new ConfigManager();
      await configManager.load();
      configManager.setNestedValue(key, value);
      await configManager.save();
      return { success: true };
    } catch (error) {
      logger.error('Config set failed', error);
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('config:exists', async () => {
    try {
      const configManager = new ConfigManager();
      const exists = await configManager.exists();
      return { success: true, data: exists };
    } catch (error) {
      logger.error('Config exists check failed', error);
      return { success: false, error: (error as Error).message };
    }
  });

  // Installation
  ipcMain.handle('install:start', async (_event, options) => {
    try {
      const installManager = new InstallationManager({
        ...options,
        progressCallback: (progress) => {
          mainWindow?.webContents.send('install:progress', progress);
        },
      });

      const result = await installManager.install();
      return { success: true, data: result };
    } catch (error) {
      logger.error('Installation failed', error);
      return { success: false, error: (error as Error).message };
    }
  });

  // Service Management
  ipcMain.handle('service:status', async (_event, ssh) => {
    try {
      const sshConnection = ssh ? new SSHManager(ssh) : undefined;
      if (sshConnection) {
        await sshConnection.connect();
      }

      const serviceManager = new ServiceManager('stremio-addon', sshConnection);
      const status = await serviceManager.status();

      if (sshConnection) {
        await sshConnection.disconnect();
      }

      return { success: true, data: status };
    } catch (error) {
      logger.error('Service status failed', error);
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('service:start', async (_event, ssh) => {
    try {
      const sshConnection = ssh ? new SSHManager(ssh) : undefined;
      if (sshConnection) {
        await sshConnection.connect();
      }

      const serviceManager = new ServiceManager('stremio-addon', sshConnection);
      await serviceManager.start();

      if (sshConnection) {
        await sshConnection.disconnect();
      }

      return { success: true };
    } catch (error) {
      logger.error('Service start failed', error);
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('service:stop', async (_event, ssh) => {
    try {
      const sshConnection = ssh ? new SSHManager(ssh) : undefined;
      if (sshConnection) {
        await sshConnection.connect();
      }

      const serviceManager = new ServiceManager('stremio-addon', sshConnection);
      await serviceManager.stop();

      if (sshConnection) {
        await sshConnection.disconnect();
      }

      return { success: true };
    } catch (error) {
      logger.error('Service stop failed', error);
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('service:restart', async (_event, ssh) => {
    try {
      const sshConnection = ssh ? new SSHManager(ssh) : undefined;
      if (sshConnection) {
        await sshConnection.connect();
      }

      const serviceManager = new ServiceManager('stremio-addon', sshConnection);
      await serviceManager.restart();

      if (sshConnection) {
        await sshConnection.disconnect();
      }

      return { success: true };
    } catch (error) {
      logger.error('Service restart failed', error);
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('service:logs', async (_event, lines: number, ssh) => {
    try {
      const sshConnection = ssh ? new SSHManager(ssh) : undefined;
      if (sshConnection) {
        await sshConnection.connect();
      }

      const serviceManager = new ServiceManager('stremio-addon', sshConnection);
      const logs = await serviceManager.logs(lines);

      if (sshConnection) {
        await sshConnection.disconnect();
      }

      return { success: true, data: logs };
    } catch (error) {
      logger.error('Service logs failed', error);
      return { success: false, error: (error as Error).message };
    }
  });

  // SSH Testing
  ipcMain.handle('ssh:test', async (_event, sshConfig) => {
    try {
      const ssh = new SSHManager(sshConfig);
      const result = await ssh.testConnection();
      return { success: true, data: result };
    } catch (error) {
      logger.error('SSH test failed', error);
      return { success: false, error: (error as Error).message };
    }
  });

  logger.info('IPC handlers registered');
}

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception', error);
});

process.on('unhandledRejection', (error) => {
  logger.error('Unhandled rejection', error);
});

