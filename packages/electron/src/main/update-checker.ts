/**
 * Background Update Checker
 * Periodically checks for available updates
 */

import { BrowserWindow } from 'electron';
import {
  AddonRegistryManager,
  UpdateManager,
  logger,
} from '@stremio-addon-manager/core';

export interface UpdateCheckResult {
  addonId: string;
  addonName: string;
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
}

export class UpdateChecker {
  private checkInterval: NodeJS.Timeout | null = null;
  private intervalMs: number;
  private mainWindow: BrowserWindow | null = null;
  private isChecking: boolean = false;

  constructor(intervalMs: number = 24 * 60 * 60 * 1000) { // Default: 24 hours
    this.intervalMs = intervalMs;
  }

  /**
   * Set the main window for sending notifications
   */
  setMainWindow(window: BrowserWindow): void {
    this.mainWindow = window;
  }

  /**
   * Start automatic update checking
   */
  start(): void {
    if (this.checkInterval) {
      logger.info('Update checker already running');
      return;
    }

    logger.info('Starting background update checker', { 
      intervalMs: this.intervalMs,
      intervalHours: this.intervalMs / (60 * 60 * 1000),
    });

    // Check immediately on start
    this.checkForUpdates().catch(error => {
      logger.error('Initial update check failed', error);
    });

    // Then check periodically
    this.checkInterval = setInterval(() => {
      this.checkForUpdates().catch(error => {
        logger.error('Periodic update check failed', error);
      });
    }, this.intervalMs);
  }

  /**
   * Stop automatic update checking
   */
  stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
      logger.info('Stopped background update checker');
    }
  }

  /**
   * Set check interval (in milliseconds)
   */
  setInterval(intervalMs: number): void {
    this.intervalMs = intervalMs;
    
    // Restart if already running
    if (this.checkInterval) {
      this.stop();
      this.start();
    }
  }

  /**
   * Check for updates for all addons
   */
  async checkForUpdates(): Promise<UpdateCheckResult[]> {
    if (this.isChecking) {
      logger.debug('Update check already in progress, skipping');
      return [];
    }

    this.isChecking = true;

    try {
      logger.info('Checking for updates...');

      const registryManager = new AddonRegistryManager();
      await registryManager.initialize();
      const allAddons = await registryManager.listAddons();

      if (allAddons.length === 0) {
        logger.debug('No addons to check for updates');
        return [];
      }

      const updateManager = new UpdateManager();
      await updateManager.initialize();

      const results: UpdateCheckResult[] = [];
      let updatesAvailable = 0;

      for (const addon of allAddons) {
        try {
          const updateInfo = await updateManager.checkForUpdates(addon.id);
          
          const result: UpdateCheckResult = {
            addonId: addon.id,
            addonName: addon.name,
            currentVersion: updateInfo.currentVersion,
            latestVersion: updateInfo.latestVersion,
            updateAvailable: updateInfo.updateAvailable,
          };

          results.push(result);

          if (updateInfo.updateAvailable) {
            updatesAvailable++;
            logger.info('Update available', {
              addonId: addon.id,
              currentVersion: updateInfo.currentVersion,
              latestVersion: updateInfo.latestVersion,
            });
          }
        } catch (error) {
          logger.error('Failed to check update for addon', { 
            addonId: addon.id,
            error: (error as Error).message,
          });
        }
      }

      // Notify main window if updates are available
      if (updatesAvailable > 0 && this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send('updates-available', {
          count: updatesAvailable,
          updates: results.filter(r => r.updateAvailable),
        });

        logger.info('Notified UI of available updates', { count: updatesAvailable });
      }

      return results;
    } catch (error) {
      logger.error('Failed to check for updates', error);
      return [];
    } finally {
      this.isChecking = false;
    }
  }

  /**
   * Force an immediate update check
   */
  async checkNow(): Promise<UpdateCheckResult[]> {
    return await this.checkForUpdates();
  }
}

// Singleton instance
let updateCheckerInstance: UpdateChecker | null = null;

/**
 * Get or create the update checker instance
 */
export function getUpdateChecker(): UpdateChecker {
  if (!updateCheckerInstance) {
    updateCheckerInstance = new UpdateChecker();
  }
  return updateCheckerInstance;
}

/**
 * Initialize update checker with settings
 */
export function initializeUpdateChecker(
  mainWindow: BrowserWindow,
  options: {
    enabled?: boolean;
    intervalMs?: number;
  } = {}
): UpdateChecker {
  const checker = getUpdateChecker();
  checker.setMainWindow(mainWindow);

  if (options.intervalMs) {
    checker.setInterval(options.intervalMs);
  }

  if (options.enabled !== false) { // Default to enabled
    checker.start();
  }

  return checker;
}

