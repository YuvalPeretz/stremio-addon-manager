/**
 * Update IPC Handlers
 * Handles IPC communication for update operations
 */

import { ipcMain, BrowserWindow } from 'electron';
import {
  ConfigManager,
  SSHManager,
  UpdateManager,
  AddonRegistryManager,
  logger,
  type UpdateOptions,
  type RollbackOptions,
} from '@stremio-addon-manager/core';
import { getUpdateChecker } from './update-checker.js';

/**
 * Register all update-related IPC handlers
 */
export function registerUpdateHandlers(): void {
  /**
   * Check for updates for a specific addon or all addons
   */
  ipcMain.handle('update:check', async (_event, addonId?: string) => {
    try {
      if (addonId) {
        // Check specific addon
        const configManager = new ConfigManager(addonId);
        const config = await configManager.load();

        let ssh: SSHManager | undefined;
        if (config.installation.type === 'remote' && config.installation.target) {
          ssh = new SSHManager({
            host: config.installation.target.host || '',
            port: config.installation.target.port || 22,
            username: config.installation.target.username || '',
            password: config.installation.target.password,
            privateKeyPath: config.installation.target.privateKeyPath,
          });
          await ssh.connect();
        }

        const updateManager = new UpdateManager(ssh);
        await updateManager.initialize();
        const updateInfo = await updateManager.checkForUpdates(addonId);

        if (ssh) {
          await ssh.disconnect();
        }

        return { success: true, data: updateInfo };
      } else {
        // Check all addons
        const updateChecker = getUpdateChecker();
        const results = await updateChecker.checkNow();
        return { success: true, data: results };
      }
    } catch (error) {
      logger.error('Failed to check for updates', error);
      return { success: false, error: (error as Error).message };
    }
  });

  /**
   * Update a specific addon
   */
  ipcMain.handle('update:addon', async (event, addonId: string, options: UpdateOptions = {}) => {
    try {
      logger.info('Starting addon update via IPC', { addonId, options });

      const configManager = new ConfigManager(addonId);
      const config = await configManager.load();

      let ssh: SSHManager | undefined;
      if (config.installation.type === 'remote' && config.installation.target) {
        ssh = new SSHManager({
          host: config.installation.target.host || '',
          port: config.installation.target.port || 22,
          username: config.installation.target.username || '',
          password: config.installation.target.password,
          privateKeyPath: config.installation.target.privateKeyPath,
        });
        await ssh.connect();
      }

      const updateManager = new UpdateManager(ssh);
      await updateManager.initialize();

      // Set up progress callback to send to renderer
      const progressCallback = (progress: any) => {
        const window = BrowserWindow.getAllWindows()[0];
        if (window && !window.isDestroyed()) {
          window.webContents.send('update:progress', { addonId, progress });
        }
      };

      const result = await updateManager.updateAddon(addonId, {
        ...options,
        progressCallback,
      });

      if (ssh) {
        await ssh.disconnect();
      }

      logger.info('Addon update completed via IPC', { 
        addonId, 
        success: result.success,
        previousVersion: result.previousVersion,
        newVersion: result.newVersion,
      });

      return { success: true, data: result };
    } catch (error) {
      logger.error('Failed to update addon via IPC', error);
      return { success: false, error: (error as Error).message };
    }
  });

  /**
   * Update multiple addons
   */
  ipcMain.handle('update:multiple', async (event, addonIds: string[], options: UpdateOptions = {}) => {
    try {
      logger.info('Starting multiple addon updates via IPC', { addonIds, options });

      const results = [];

      for (const addonId of addonIds) {
        try {
          const configManager = new ConfigManager(addonId);
          const config = await configManager.load();

          let ssh: SSHManager | undefined;
          if (config.installation.type === 'remote' && config.installation.target) {
            ssh = new SSHManager({
              host: config.installation.target.host || '',
              port: config.installation.target.port || 22,
              username: config.installation.target.username || '',
              password: config.installation.target.password,
              privateKeyPath: config.installation.target.privateKeyPath,
            });
            await ssh.connect();
          }

          const updateManager = new UpdateManager(ssh);
          await updateManager.initialize();

          // Set up progress callback
          const progressCallback = (progress: any) => {
            const window = BrowserWindow.getAllWindows()[0];
            if (window && !window.isDestroyed()) {
              window.webContents.send('update:progress', { addonId, progress });
            }
          };

          const result = await updateManager.updateAddon(addonId, {
            ...options,
            progressCallback,
          });

          if (ssh) {
            await ssh.disconnect();
          }

          results.push(result);
        } catch (error) {
          logger.error('Failed to update addon in batch', { addonId, error: (error as Error).message });
          results.push({
            success: false,
            addonId,
            previousVersion: '0.0.0',
            newVersion: '0.0.0',
            duration: 0,
            error: (error as Error).message,
            changes: [],
            steps: [],
          });
        }
      }

      logger.info('Multiple addon updates completed via IPC', { 
        total: addonIds.length,
        successful: results.filter(r => r.success).length,
      });

      return { success: true, data: results };
    } catch (error) {
      logger.error('Failed to update multiple addons via IPC', error);
      return { success: false, error: (error as Error).message };
    }
  });

  /**
   * Rollback an addon
   */
  ipcMain.handle('update:rollback', async (event, addonId: string, options: RollbackOptions = {}) => {
    try {
      logger.info('Starting addon rollback via IPC', { addonId, options });

      const configManager = new ConfigManager(addonId);
      const config = await configManager.load();

      let ssh: SSHManager | undefined;
      if (config.installation.type === 'remote' && config.installation.target) {
        ssh = new SSHManager({
          host: config.installation.target.host || '',
          port: config.installation.target.port || 22,
          username: config.installation.target.username || '',
          password: config.installation.target.password,
          privateKeyPath: config.installation.target.privateKeyPath,
        });
        await ssh.connect();
      }

      const updateManager = new UpdateManager(ssh);
      await updateManager.initialize();

      // Set up progress callback
      const progressCallback = (progress: any) => {
        const window = BrowserWindow.getAllWindows()[0];
        if (window && !window.isDestroyed()) {
          window.webContents.send('update:progress', { addonId, progress });
        }
      };

      const result = await updateManager.rollbackUpdate(addonId, {
        ...options,
        progressCallback,
      });

      if (ssh) {
        await ssh.disconnect();
      }

      logger.info('Addon rollback completed via IPC', { 
        addonId, 
        success: result.success,
        method: result.method,
      });

      return { success: true, data: result };
    } catch (error) {
      logger.error('Failed to rollback addon via IPC', error);
      return { success: false, error: (error as Error).message };
    }
  });

  /**
   * List backups for an addon
   */
  ipcMain.handle('update:list-backups', async (_event, addonId: string) => {
    try {
      const registryManager = new AddonRegistryManager();
      await registryManager.initialize();
      const addon = await registryManager.getAddon(addonId);

      if (!addon) {
        return { success: false, error: 'Addon not found' };
      }

      const backups = addon.backups || [];

      return { success: true, data: backups };
    } catch (error) {
      logger.error('Failed to list backups via IPC', error);
      return { success: false, error: (error as Error).message };
    }
  });

  /**
   * Get update history for an addon
   */
  ipcMain.handle('update:history', async (_event, addonId: string) => {
    try {
      const registryManager = new AddonRegistryManager();
      await registryManager.initialize();
      const addon = await registryManager.getAddon(addonId);

      if (!addon) {
        return { success: false, error: 'Addon not found' };
      }

      const history = addon.updateHistory || [];

      return { success: true, data: history };
    } catch (error) {
      logger.error('Failed to get update history via IPC', error);
      return { success: false, error: (error as Error).message };
    }
  });

  /**
   * Get update checker status
   */
  ipcMain.handle('update:checker-status', async () => {
    try {
      const checker = getUpdateChecker();
      // Return basic status (we don't expose internal state)
      return { 
        success: true, 
        data: { 
          enabled: true, // Checker is always available once initialized
        } 
      };
    } catch (error) {
      logger.error('Failed to get update checker status via IPC', error);
      return { success: false, error: (error as Error).message };
    }
  });

  /**
   * Trigger manual update check
   */
  ipcMain.handle('update:check-now', async () => {
    try {
      const checker = getUpdateChecker();
      const results = await checker.checkNow();
      return { success: true, data: results };
    } catch (error) {
      logger.error('Failed to trigger manual update check via IPC', error);
      return { success: false, error: (error as Error).message };
    }
  });

  logger.info('Update IPC handlers registered');
}

