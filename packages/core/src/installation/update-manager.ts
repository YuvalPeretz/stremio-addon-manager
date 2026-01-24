/**
 * Update Manager
 * Manages addon updates, rollbacks, and version control
 */

import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { logger } from '../utils/logger.js';
import { AddonRegistryManager } from '../config/registry-manager.js';
import { ServiceManager } from '../service/manager.js';
import { ServiceStatus } from '../service/types.js';
import type { SSHConnection } from '../ssh/types.js';
import type {
  UpdateOptions,
  UpdateResult,
  UpdateInfo,
  PreUpdateCheck,
  UpdateProgress,
  RollbackOptions,
  RollbackResult,
  BackupOptions,
  BackupEntry,
  VersionComparison,
} from './update-types.js';
import { UpdateStep, UpdateStepStatus } from './update-types.js';

/**
 * Update Manager class
 */
export class UpdateManager {
  private registryManager: AddonRegistryManager;
  private ssh?: SSHConnection;
  private startTime: number = 0;
  private steps: UpdateProgress[] = [];

  constructor(ssh?: SSHConnection) {
    this.registryManager = new AddonRegistryManager();
    this.ssh = ssh;
  }

  /**
   * Initialize the update manager
   */
  public async initialize(): Promise<void> {
    await this.registryManager.initialize();
  }

  /**
   * Get current installed version of an addon
   */
  public async getCurrentVersion(addonId: string): Promise<string> {
    logger.info('Getting current version', { addonId });

    const registry = this.registryManager.getRegistry();
    await registry.load();

    const addon = registry.get(addonId);
    if (!addon) {
      throw new Error(`Addon not found: ${addonId}`);
    }

    // If version is stored in registry, return it
    if (addon.version) {
      return addon.version;
    }

    // Otherwise, try to read from package.json in addon directory
    try {
      const packageJsonPath = path.join(addon.configPath, '../addon-server/package.json');
      const version = await this.readVersionFromPackageJson(packageJsonPath);
      
      // Update registry with the version
      addon.version = version;
      await registry.save();
      
      return version;
    } catch (error) {
      logger.warn('Could not read version from package.json', { 
        addonId, 
        error: (error as Error).message 
      });
      return '0.0.0'; // Unknown version
    }
  }

  /**
   * Get latest available version (from bundled package)
   */
  public getLatestVersion(): string {
    try {
      // Read version from bundled addon-server package.json
      // This assumes we're running from CLI or Electron which bundles the addon-server
      const packageJsonPath = this.getBundledPackageJsonPath();
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
      return packageJson.version || '1.0.0';
    } catch (error) {
      logger.error('Could not read latest version', { error: (error as Error).message });
      return '1.0.0';
    }
  }

  /**
   * Get available versions
   * For now, only returns the latest version
   * In the future, this could return multiple versions from a version registry
   */
  public getAvailableVersions(): string[] {
    const latest = this.getLatestVersion();
    return [latest];
  }

  /**
   * Check if updates are available for an addon
   */
  public async checkForUpdates(addonId: string): Promise<UpdateInfo> {
    logger.info('Checking for updates', { addonId });

    const currentVersion = await this.getCurrentVersion(addonId);
    const latestVersion = this.getLatestVersion();
    const availableVersions = this.getAvailableVersions();

    const comparison = this.compareVersions(currentVersion, latestVersion);
    const updateAvailable = comparison.isNewer;

    return {
      addonId,
      currentVersion,
      latestVersion,
      availableVersions,
      updateAvailable,
      changes: updateAvailable ? await this.getChangelog(currentVersion, latestVersion) : [],
    };
  }

  /**
   * Validate pre-conditions before update
   */
  public async validateUpdatePreconditions(addonId: string): Promise<PreUpdateCheck> {
    logger.info('Validating update preconditions', { addonId });

    const registry = this.registryManager.getRegistry();
    await registry.load();

    const addon = registry.get(addonId);
    const addonExists = !!addon;

    if (!addonExists) {
      return {
        addonExists: false,
        serviceRunning: false,
        sufficientDiskSpace: false,
        availableDiskSpaceMB: 0,
        requiredDiskSpaceMB: 100,
        sshConnected: false,
        canBackup: false,
        conflicts: ['Addon not found in registry'],
        warnings: [],
      };
    }

    // Check if service is running
    const serviceManager = new ServiceManager(addon.serviceName, this.ssh);
    const serviceInfo = await serviceManager.status();
    const serviceRunning = serviceInfo.status === ServiceStatus.ACTIVE;

    // Check SSH connection for remote
    const sshConnected = this.ssh ? true : true; // Local is always "connected"

    // Check disk space
    const diskSpace = await this.checkDiskSpace();
    const sufficientDiskSpace = diskSpace.availableMB >= diskSpace.requiredMB;

    // Check if we can backup
    const canBackup = true; // Assume we can always backup for now

    const conflicts: string[] = [];
    const warnings: string[] = [];

    if (!serviceRunning) {
      warnings.push('Service is not currently running');
    }

    if (!sufficientDiskSpace) {
      conflicts.push(`Insufficient disk space. Available: ${diskSpace.availableMB}MB, Required: ${diskSpace.requiredMB}MB`);
    }

    return {
      addonExists,
      serviceRunning,
      sufficientDiskSpace,
      availableDiskSpaceMB: diskSpace.availableMB,
      requiredDiskSpaceMB: diskSpace.requiredMB,
      sshConnected,
      canBackup,
      conflicts,
      warnings,
    };
  }

  /**
   * Update an addon to a specific version (or latest)
   */
  public async updateAddon(addonId: string, options: UpdateOptions = {}): Promise<UpdateResult> {
    this.startTime = Date.now();
    this.steps = [];

    logger.info('Starting addon update', { addonId, options });

    try {
      // Set defaults
      const opts: Required<UpdateOptions> = {
        targetVersion: options.targetVersion || this.getLatestVersion(),
        skipBackup: options.skipBackup || false,
        restartService: options.restartService !== false, // Default true
        forceUpdate: options.forceUpdate || false,
        dryRun: options.dryRun || false,
        keepOldFiles: options.keepOldFiles || false,
        progressCallback: options.progressCallback || (() => {}),
      };

      // Step 1: Validate preconditions
      await this.executeStep(UpdateStep.VALIDATE, async () => {
        const check = await this.validateUpdatePreconditions(addonId);
        
        if (!check.addonExists) {
          throw new Error('Addon not found in registry');
        }

        if (check.conflicts.length > 0) {
          throw new Error(`Update validation failed: ${check.conflicts.join(', ')}`);
        }

        if (check.warnings.length > 0) {
          logger.warn('Update validation warnings', { warnings: check.warnings });
        }
      }, opts.progressCallback);

      // Get current version
      const previousVersion = await this.getCurrentVersion(addonId);
      const newVersion = opts.targetVersion;

      // Check if update is needed
      const comparison = this.compareVersions(previousVersion, newVersion);
      if (comparison.isSame && !opts.forceUpdate) {
        logger.info('Already on target version', { addonId, version: newVersion });
        
        return {
          success: true,
          addonId,
          previousVersion,
          newVersion,
          duration: Date.now() - this.startTime,
          changes: ['No update needed - already on target version'],
          warnings: ['Already on target version'],
          steps: this.steps,
        };
      }

      if (opts.dryRun) {
        logger.info('Dry run - skipping actual update', { addonId });
        
        return {
          success: true,
          addonId,
          previousVersion,
          newVersion,
          duration: Date.now() - this.startTime,
          changes: ['DRY RUN - No changes made'],
          steps: this.steps,
        };
      }

      // Get addon config
      const registry = this.registryManager.getRegistry();
      await registry.load();
      const addon = registry.get(addonId);
      if (!addon) {
        throw new Error('Addon not found');
      }

      let backupId: string | undefined;

      // Step 2: Create backup (unless skipped)
      if (!opts.skipBackup) {
        backupId = await this.executeStep(UpdateStep.CREATE_BACKUP, async () => {
          return await this.createBackup({
            addonId,
            type: 'pre-update',
            compression: 'gzip',
            includeNodeModules: false,
          });
        }, opts.progressCallback);
      } else {
        this.skipStep(UpdateStep.CREATE_BACKUP, 'Backup skipped by user', opts.progressCallback);
      }

      // Step 3: Stop service
      await this.executeStep(UpdateStep.STOP_SERVICE, async () => {
        const serviceManager = new ServiceManager(addon.serviceName, this.ssh);
        await serviceManager.stop();
      }, opts.progressCallback);

      // Step 4: Update files
      await this.executeStep(UpdateStep.UPDATE_FILES, async () => {
        await this.updateAddonFiles(addon, opts.keepOldFiles);
      }, opts.progressCallback);

      // Step 5: Install dependencies (if needed)
      await this.executeStep(UpdateStep.INSTALL_DEPENDENCIES, async () => {
        await this.installDependenciesIfNeeded(addon);
      }, opts.progressCallback);

      // Step 6: Update configuration
      await this.executeStep(UpdateStep.UPDATE_CONFIG, async () => {
        // Update service file if needed
        // For now, this is a placeholder
      }, opts.progressCallback);

      // Step 7: Restart service
      if (opts.restartService) {
        await this.executeStep(UpdateStep.RESTART_SERVICE, async () => {
          const serviceManager = new ServiceManager(addon.serviceName, this.ssh);
          await serviceManager.start();
        }, opts.progressCallback);
      } else {
        this.skipStep(UpdateStep.RESTART_SERVICE, 'Service restart skipped', opts.progressCallback);
      }

      // Step 8: Verify installation
      await this.executeStep(UpdateStep.VERIFY, async () => {
        await this.verifyUpdate(addon);
      }, opts.progressCallback);

      // Step 9: Update registry
      await this.executeStep(UpdateStep.UPDATE_REGISTRY, async () => {
        addon.version = newVersion;
        addon.lastUpdated = new Date().toISOString();
        
        // Add to update history
        if (!addon.updateHistory) {
          addon.updateHistory = [];
        }
        
        addon.updateHistory.push({
          timestamp: new Date(),
          fromVersion: previousVersion,
          toVersion: newVersion,
          success: true,
          duration: Date.now() - this.startTime,
          backupId,
          initiatedBy: 'user',
        });

        await registry.save();
      }, opts.progressCallback);

      // Step 10: Cleanup
      await this.executeStep(UpdateStep.CLEANUP, async () => {
        // Cleanup old files if not keeping them
        if (!opts.keepOldFiles) {
          await this.cleanupOldFiles(addon);
        }
      }, opts.progressCallback);

      // Complete
      this.updateProgress(
        UpdateStep.COMPLETE,
        UpdateStepStatus.COMPLETED,
        'Update completed successfully',
        100,
        opts.progressCallback
      );

      const duration = Date.now() - this.startTime;
      logger.info('Update completed successfully', { addonId, duration, previousVersion, newVersion });

      return {
        success: true,
        addonId,
        previousVersion,
        newVersion,
        duration,
        backupId,
        changes: [`Updated from ${previousVersion} to ${newVersion}`],
        steps: this.steps,
      };
    } catch (error) {
      const duration = Date.now() - this.startTime;
      const errorMessage = (error as Error).message;

      logger.error('Update failed', { addonId, error: errorMessage, duration });

      // Attempt automatic rollback on failure
      if (this.steps.some(s => s.step === UpdateStep.UPDATE_FILES && s.status === UpdateStepStatus.COMPLETED)) {
        logger.info('Attempting automatic rollback due to update failure', { addonId });
        try {
          await this.rollbackUpdate(addonId, { 
            useFastRollback: true,
            progressCallback: options.progressCallback,
          });
          logger.info('Automatic rollback successful', { addonId });
        } catch (rollbackError) {
          logger.error('Automatic rollback failed', { 
            addonId, 
            error: (rollbackError as Error).message 
          });
        }
      }

      return {
        success: false,
        addonId,
        previousVersion: await this.getCurrentVersion(addonId).catch(() => '0.0.0'),
        newVersion: options.targetVersion || this.getLatestVersion(),
        duration,
        error: errorMessage,
        changes: [],
        steps: this.steps,
      };
    }
  }

  /**
   * Update multiple addons
   */
  public async updateMultipleAddons(
    addonIds: string[],
    options: UpdateOptions = {}
  ): Promise<UpdateResult[]> {
    logger.info('Updating multiple addons', { count: addonIds.length });

    const results: UpdateResult[] = [];

    for (const addonId of addonIds) {
      try {
        const result = await this.updateAddon(addonId, options);
        results.push(result);
      } catch (error) {
        logger.error('Failed to update addon', { addonId, error: (error as Error).message });
        results.push({
          success: false,
          addonId,
          previousVersion: '0.0.0',
          newVersion: options.targetVersion || this.getLatestVersion(),
          duration: 0,
          error: (error as Error).message,
          changes: [],
          steps: [],
        });
      }
    }

    return results;
  }

  /**
   * Rollback an addon to a previous version
   */
  public async rollbackUpdate(addonId: string, options: RollbackOptions = {}): Promise<RollbackResult> {
    this.startTime = Date.now();
    this.steps = [];

    logger.info('Starting rollback', { addonId, options });

    const opts = {
      backupId: options.backupId,
      useFastRollback: options.useFastRollback !== false, // Default true
      restartService: options.restartService !== false, // Default true
      progressCallback: options.progressCallback || (() => {}),
    };

    try {
      // Get addon info
      const registry = this.registryManager.getRegistry();
      await registry.load();
      const addon = registry.get(addonId);
      
      if (!addon) {
        throw new Error('Addon not found in registry');
      }

      const currentVersion = addon.version || '0.0.0';
      let rolledBackToVersion = '0.0.0';
      let method: 'fast' | 'backup' = 'backup';

      // Try fast rollback first (using .old directory)
      if (opts.useFastRollback) {
        try {
          await this.executeStep(UpdateStep.STOP_SERVICE, async () => {
            const serviceManager = new ServiceManager(addon.serviceName, this.ssh);
            await serviceManager.stop();
          }, opts.progressCallback);

          const hasOldDir = await this.checkOldDirectoryExists(addon);
          
          if (hasOldDir) {
            logger.info('Using fast rollback (.old directory)', { addonId });
            method = 'fast';

            await this.executeStep(UpdateStep.UPDATE_FILES, async () => {
              await this.restoreFromOldDirectory(addon);
            }, opts.progressCallback);

            rolledBackToVersion = await this.readVersionFromAddonDirectory(addon);
          } else {
            throw new Error('No .old directory found, will use backup rollback');
          }
        } catch (error) {
          logger.warn('Fast rollback not available', { error: (error as Error).message });
          method = 'backup';
        }
      }

      // If fast rollback didn't work, use backup
      if (method === 'backup') {
        logger.info('Using backup rollback', { addonId, backupId: opts.backupId });

        // Find backup to restore
        const backupToRestore = opts.backupId 
          ? addon.backups?.find(b => b.id === opts.backupId)
          : addon.backups?.[0]; // Most recent backup

        if (!backupToRestore) {
          throw new Error('No backup available for rollback');
        }

          await this.executeStep(UpdateStep.STOP_SERVICE, async () => {
            const serviceManager = new ServiceManager(addon.serviceName, this.ssh);
            await serviceManager.stop();
          }, opts.progressCallback);

        await this.executeStep(UpdateStep.UPDATE_FILES, async () => {
          await this.restoreFromBackup(addon, backupToRestore);
        }, opts.progressCallback);

        rolledBackToVersion = backupToRestore.version;
      }

      // Restart service
      if (opts.restartService) {
        await this.executeStep(UpdateStep.RESTART_SERVICE, async () => {
          const serviceManager = new ServiceManager(addon.serviceName, this.ssh);
          await serviceManager.start();
        }, opts.progressCallback);
      }

      // Update registry
      await this.executeStep(UpdateStep.UPDATE_REGISTRY, async () => {
        addon.version = rolledBackToVersion;
        addon.lastUpdated = new Date().toISOString();
        
        if (!addon.updateHistory) {
          addon.updateHistory = [];
        }
        
        addon.updateHistory.push({
          timestamp: new Date(),
          fromVersion: currentVersion,
          toVersion: rolledBackToVersion,
          success: true,
          duration: Date.now() - this.startTime,
          rollbackId: opts.backupId || undefined,
          initiatedBy: 'user',
        });

        await registry.save();
      }, opts.progressCallback);

      const duration = Date.now() - this.startTime;
      logger.info('Rollback completed successfully', { addonId, duration, method });

      return {
        success: true,
        addonId,
        currentVersion,
        rolledBackToVersion,
        duration,
        method,
        backupId: opts.backupId,
        steps: this.steps,
      };
    } catch (error) {
      const duration = Date.now() - this.startTime;
      logger.error('Rollback failed', { addonId, error: (error as Error).message });

      return {
        success: false,
        addonId,
        currentVersion: await this.getCurrentVersion(addonId).catch(() => '0.0.0'),
        rolledBackToVersion: '0.0.0',
        duration,
        method: 'backup',
        error: (error as Error).message,
        steps: this.steps,
      };
    }
  }

  // ==================== Private Helper Methods ====================

  /**
   * Execute an update step with progress tracking
   */
  private async executeStep<T>(
    step: UpdateStep,
    action: () => Promise<T>,
    progressCallback?: (progress: UpdateProgress) => void
  ): Promise<T> {
    this.updateProgress(step, UpdateStepStatus.IN_PROGRESS, `${step}...`, 0, progressCallback);

    try {
      const result = await action();
      this.updateProgress(step, UpdateStepStatus.COMPLETED, `${step} completed`, 0, progressCallback);
      return result;
    } catch (error) {
      this.updateProgress(
        step,
        UpdateStepStatus.FAILED,
        `${step} failed: ${(error as Error).message}`,
        0,
        progressCallback,
        error as Error
      );
      throw error;
    }
  }

  /**
   * Skip a step
   */
  private skipStep(
    step: UpdateStep,
    reason: string,
    progressCallback?: (progress: UpdateProgress) => void
  ): void {
    this.updateProgress(step, UpdateStepStatus.SKIPPED, reason, 0, progressCallback);
  }

  /**
   * Update progress
   */
  private updateProgress(
    step: UpdateStep,
    status: UpdateStepStatus,
    message: string,
    progress: number,
    progressCallback?: (progress: UpdateProgress) => void,
    error?: Error
  ): void {
    const progressUpdate: UpdateProgress = {
      step,
      status,
      message,
      progress,
      timestamp: new Date(),
      error,
    };

    this.steps.push(progressUpdate);

    if (progressCallback) {
      progressCallback(progressUpdate);
    }

    logger.info('Update progress', { step, status, message });
  }

  /**
   * Compare two semantic versions
   */
  private compareVersions(current: string, target: string): VersionComparison {
    const parseCurrent = this.parseVersion(current);
    const parseTarget = this.parseVersion(target);

    const isNewer = 
      parseTarget.major > parseCurrent.major ||
      (parseTarget.major === parseCurrent.major && parseTarget.minor > parseCurrent.minor) ||
      (parseTarget.major === parseCurrent.major && parseTarget.minor === parseCurrent.minor && parseTarget.patch > parseCurrent.patch);

    const isSame = 
      parseTarget.major === parseCurrent.major &&
      parseTarget.minor === parseCurrent.minor &&
      parseTarget.patch === parseCurrent.patch;

    const isOlder = !isNewer && !isSame;

    let difference: 'major' | 'minor' | 'patch' | 'none' = 'none';
    if (!isSame) {
      if (parseTarget.major !== parseCurrent.major) {
        difference = 'major';
      } else if (parseTarget.minor !== parseCurrent.minor) {
        difference = 'minor';
      } else if (parseTarget.patch !== parseCurrent.patch) {
        difference = 'patch';
      }
    }

    return {
      current,
      target,
      isNewer,
      isSame,
      isOlder,
      difference,
    };
  }

  /**
   * Parse semantic version
   */
  private parseVersion(version: string): { major: number; minor: number; patch: number } {
    const parts = version.replace(/^v/, '').split('.');
    return {
      major: parseInt(parts[0] || '0', 10),
      minor: parseInt(parts[1] || '0', 10),
      patch: parseInt(parts[2] || '0', 10),
    };
  }

  /**
   * Read version from package.json
   */
  private async readVersionFromPackageJson(packageJsonPath: string): Promise<string> {
    try {
      if (this.ssh) {
        // Remote: read via SSH
        const result = await this.ssh.execCommand(`cat ${packageJsonPath}`);
        if (result.code !== 0) {
          throw new Error(result.stderr || 'Failed to read package.json');
        }
        const packageJson = JSON.parse(result.stdout);
        return packageJson.version || '0.0.0';
      } else {
        // Local: read from filesystem
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
        return packageJson.version || '0.0.0';
      }
    } catch (error) {
      throw new Error(`Failed to read version: ${(error as Error).message}`);
    }
  }

  /**
   * Get bundled package.json path
   */
  private getBundledPackageJsonPath(): string {
    // This will be different for CLI vs Electron
    // For now, assume we're in a development environment
    return path.resolve(__dirname, '../../../addon-server/package.json');
  }

  /**
   * Get changelog between versions
   */
  private async getChangelog(fromVersion: string, toVersion: string): Promise<string[]> {
    // TODO: Parse CHANGELOG.md for changes between versions
    // For now, return a placeholder
    return [`Updated from ${fromVersion} to ${toVersion}`];
  }

  /**
   * Check disk space
   */
  private async checkDiskSpace(): Promise<{ availableMB: number; requiredMB: number }> {
    // TODO: Implement actual disk space check
    // For now, return dummy values
    return {
      availableMB: 1000,
      requiredMB: 100,
    };
  }

  /**
   * Create backup
   */
  private async createBackup(options: BackupOptions): Promise<string> {
    // TODO: Implement actual backup creation
    // For now, return a placeholder backup ID
    const backupId = `backup-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    logger.info('Creating backup', { backupId, options });
    return backupId;
  }

  /**
   * Update addon files
   */
  private async updateAddonFiles(addon: any, keepOldFiles: boolean): Promise<void> {
    logger.info('Updating addon files', { addonId: addon.id, keepOldFiles });

    // Get the addon directory (parent of config path)
    const addonDir = path.dirname(addon.configPath);
    const addonServerDir = path.join(addonDir, 'addon-server');

    // Get bundled package path
    const bundledPackagePath = this.getBundledPackageJsonPath();
    const bundledDir = path.dirname(bundledPackagePath); // This is the bundled addon-server directory

    logger.info('Addon paths', { addonDir, addonServerDir, bundledDir });

    if (this.ssh) {
      // Remote update via SSH
      await this.updateRemoteAddonFiles(addonDir, bundledDir, keepOldFiles);
    } else {
      // Local update
      await this.updateLocalAddonFiles(addonDir, bundledDir, keepOldFiles);
    }

    logger.info('Addon files updated successfully');
  }

  /**
   * Update addon files locally
   */
  private async updateLocalAddonFiles(addonDir: string, bundledDir: string, keepOldFiles: boolean): Promise<void> {
    const addonServerDir = path.join(addonDir, 'addon-server');

    // Backup old files if requested
    if (keepOldFiles) {
      const oldDir = path.join(addonDir, 'addon-server.old');
      if (fs.existsSync(addonServerDir)) {
        logger.info('Moving old files to .old directory');
        if (fs.existsSync(oldDir)) {
          fs.rmSync(oldDir, { recursive: true, force: true });
        }
        fs.renameSync(addonServerDir, oldDir);
      }
    }

    // Copy new files
    logger.info('Copying new addon files', { from: bundledDir, to: addonServerDir });
    
    // Create addon-server directory
    if (!fs.existsSync(addonServerDir)) {
      fs.mkdirSync(addonServerDir, { recursive: true });
    }

    // Copy all files from bundled directory to addon directory
    this.copyDirectorySync(bundledDir, addonServerDir);

    logger.info('Local addon files updated');
  }

  /**
   * Update addon files on remote server via SSH
   */
  private async updateRemoteAddonFiles(addonDir: string, bundledDir: string, keepOldFiles: boolean): Promise<void> {
    if (!this.ssh) {
      throw new Error('SSH connection required for remote update');
    }

    const addonServerDir = `${addonDir}/addon-server`;
    const addonServerOldDir = `${addonDir}/addon-server.old`;

    // Backup old files if requested
    if (keepOldFiles) {
      logger.info('Backing up old files on remote server');
      const checkResult = await this.ssh.execCommand(`test -d ${addonServerDir} && echo "exists" || echo "not exists"`);
      if (checkResult.stdout.trim() === 'exists') {
        // Remove old backup if exists
        await this.ssh.execCommand(`rm -rf ${addonServerOldDir}`);
        // Move current to .old
        await this.ssh.execCommand(`mv ${addonServerDir} ${addonServerOldDir}`);
      }
    } else {
      // Just remove the old directory
      await this.ssh.execCommand(`rm -rf ${addonServerDir}`);
    }

    // Create addon-server directory
    await this.ssh.execCommand(`mkdir -p ${addonServerDir}`);

    // Create a tarball of the bundled directory
    const tempTarPath = path.join(os.tmpdir(), `addon-update-${Date.now()}.tar.gz`);
    logger.info('Creating tarball of bundled files', { tarPath: tempTarPath });
    
    execSync(`tar -czf ${tempTarPath} -C ${path.dirname(bundledDir)} ${path.basename(bundledDir)}`);

    // Upload tarball to remote server
    const remoteTarPath = `/tmp/addon-update-${Date.now()}.tar.gz`;
    logger.info('Uploading tarball to remote server', { remotePath: remoteTarPath });
    
    await this.ssh.transferFile(tempTarPath, remoteTarPath);

    // Extract tarball on remote server
    logger.info('Extracting tarball on remote server');
    const extractResult = await this.ssh.execCommand(
      `tar -xzf ${remoteTarPath} -C ${addonDir} && mv ${addonDir}/${path.basename(bundledDir)} ${addonServerDir}`
    );

    if (extractResult.code !== 0) {
      throw new Error(`Failed to extract files on remote server: ${extractResult.stderr}`);
    }

    // Cleanup temp files
    fs.unlinkSync(tempTarPath);
    await this.ssh.execCommand(`rm -f ${remoteTarPath}`);

    logger.info('Remote addon files updated');
  }

  /**
   * Copy directory recursively (synchronous)
   */
  private copyDirectorySync(src: string, dest: string): void {
    // Create destination directory
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true });
    }

    // Read all items in source directory
    const items = fs.readdirSync(src);

    for (const item of items) {
      const srcPath = path.join(src, item);
      const destPath = path.join(dest, item);
      const stat = fs.statSync(srcPath);

      if (stat.isDirectory()) {
        // Recursively copy subdirectory
        this.copyDirectorySync(srcPath, destPath);
      } else {
        // Copy file
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }

  /**
   * Install dependencies if needed
   */
  private async installDependenciesIfNeeded(addon: any): Promise<void> {
    logger.info('Installing dependencies', { addonId: addon.id });

    const addonDir = path.dirname(addon.configPath);
    const addonServerDir = path.join(addonDir, 'addon-server');

    if (this.ssh) {
      // Remote: install via SSH
      logger.info('Installing dependencies on remote server');
      const result = await this.ssh.execCommand(`cd ${addonServerDir} && npm install --production`);

      if (result.code !== 0) {
        logger.error('Failed to install dependencies on remote server', { stderr: result.stderr });
        throw new Error(`Failed to install dependencies: ${result.stderr}`);
      }

      logger.info('Dependencies installed on remote server');
    } else {
      // Local: install using child_process
      logger.info('Installing dependencies locally');
      
      try {
        execSync('npm install --production', {
          cwd: addonServerDir,
          stdio: 'pipe',
        });
        logger.info('Dependencies installed locally');
      } catch (error) {
        logger.error('Failed to install dependencies locally', { error });
        throw new Error(`Failed to install dependencies: ${(error as Error).message}`);
      }
    }
  }

  /**
   * Verify update
   */
  private async verifyUpdate(addon: any): Promise<void> {
    logger.info('Verifying update', { addonId: addon.id });

    const addonDir = path.dirname(addon.configPath);
    const packageJsonPath = path.join(addonDir, 'addon-server', 'package.json');

    try {
      if (this.ssh) {
        // Remote: verify via SSH
        const result = await this.ssh.execCommand(`cat ${packageJsonPath}`);
        if (result.code !== 0) {
          throw new Error('package.json not found after update');
        }

        const packageJson = JSON.parse(result.stdout);
        logger.info('Update verified - package.json exists', { version: packageJson.version });
      } else {
        // Local: verify locally
        if (!fs.existsSync(packageJsonPath)) {
          throw new Error('package.json not found after update');
        }

        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
        logger.info('Update verified - package.json exists', { version: packageJson.version });
      }
    } catch (error) {
      logger.error('Update verification failed', { error });
      throw new Error(`Update verification failed: ${(error as Error).message}`);
    }
  }

  /**
   * Cleanup old files
   */
  private async cleanupOldFiles(addon: any): Promise<void> {
    logger.info('Cleaning up old files', { addonId: addon.id });

    const addonDir = path.dirname(addon.configPath);
    const oldDir = path.join(addonDir, 'addon-server.old');

    if (this.ssh) {
      // Remote: cleanup via SSH
      const checkResult = await this.ssh.execCommand(`test -d ${oldDir} && echo "exists" || echo "not exists"`);
      if (checkResult.stdout.trim() === 'exists') {
        logger.info('Removing old files on remote server');
        await this.ssh.execCommand(`rm -rf ${oldDir}`);
      }
    } else {
      // Local: cleanup locally
      if (fs.existsSync(oldDir)) {
        logger.info('Removing old files locally');
        fs.rmSync(oldDir, { recursive: true, force: true });
      }
    }

    logger.info('Old files cleaned up');
  }

  /**
   * Check if .old directory exists
   */
  private async checkOldDirectoryExists(_addon: any): Promise<boolean> {
    // TODO: Implement check for .old directory
    return false;
  }

  /**
   * Restore from .old directory
   */
  private async restoreFromOldDirectory(_addon: any): Promise<void> {
    // TODO: Implement restoration from .old directory
    logger.info('Restoring from .old directory');
  }

  /**
   * Read version from addon directory
   */
  private async readVersionFromAddonDirectory(_addon: any): Promise<string> {
    // TODO: Implement version reading
    return '0.0.0';
  }

  /**
   * Restore from backup
   */
  private async restoreFromBackup(_addon: any, backup: BackupEntry): Promise<void> {
    // TODO: Implement restoration from backup
    logger.info('Restoring from backup', { backupId: backup.id });
  }
}

