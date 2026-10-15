/**
 * Update Manager
 * Manages addon updates, rollbacks, and version control
 */

import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { logger } from '../utils/logger.js';
import { AddonRegistryManager } from '../config/registry-manager.js';
import { normalizeAddonProduct, productPackageDir } from '../config/product.js';
import type { AddonProduct } from '../config/product.js';
import { ConfigManager } from '../config/manager.js';
import { ServiceManager } from '../service/manager.js';
import { ServiceFileManager } from '../service/file-manager.js';
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
  DiagnosticItem,
  DiagnosticsResult,
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
      // For remote addons, the package.json is in config.paths.addonDirectory on the Pi.
      // For local addons, it's in <localConfigDir>/addon-server/package.json.
      let packageJsonPath: string;
      if (this.ssh) {
        const remoteDeployDir = await this.getRemoteDeployDir(addon.configPath, addon.serviceName);
        packageJsonPath = `${remoteDeployDir}/package.json`;
      } else {
        const addonDir = path.dirname(addon.configPath);
        const packageDir = productPackageDir(normalizeAddonProduct(addon.product));
        packageJsonPath = path.join(addonDir, packageDir, 'package.json');
      }

      logger.debug('Reading version from package.json', {
        addonId,
        configPath: addon.configPath,
        packageJsonPath
      });

      const version = await this.readVersionFromPackageJson(packageJsonPath);
      
      // Update registry with the version
      addon.version = version;
      await registry.save();
      
      return version;
    } catch (error) {
      logger.warn('Could not read version from package.json', { 
        addonId, 
        configPath: addon.configPath,
        error: (error as Error).message 
      });
      return '0.0.0'; // Unknown version
    }
  }

  /**
   * Get latest available version (from bundled package)
   */
  public getLatestVersion(product?: AddonProduct): string {
    try {
      const packageJsonPath = this.getBundledPackageJsonPath(product);
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
  public getAvailableVersions(product?: AddonProduct): string[] {
    const latest = this.getLatestVersion(product);
    return [latest];
  }

  /**
   * Check if updates are available for an addon
   */
  public async checkForUpdates(addonId: string): Promise<UpdateInfo> {
    logger.info('Checking for updates', { addonId });

    const currentVersion = await this.getCurrentVersion(addonId);
    const registry = this.registryManager.getRegistry();
    await registry.load();
    const addon = registry.get(addonId);
    const latestVersion = this.getLatestVersion(addon?.product);
    const availableVersions = this.getAvailableVersions(addon?.product);

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

      // Step 6: Update configuration — patch service file with any missing env vars
      await this.executeStep(UpdateStep.UPDATE_CONFIG, async () => {
        try {
          const existing = await ServiceFileManager.readServiceFile(addon.serviceName, this.ssh);
          const presentKeys = new Set(existing.service.environment.map((e) => e.key));

          // Add non-sensitive defaults for new env vars if absent.
          // TORBOX_API_TOKEN is intentionally excluded — it's sensitive and the user must set it explicitly.
          const patchVars: Record<string, string> = {};
          if (!presentKeys.has('STREAM_PROVIDER_MODE')) {
            patchVars['STREAM_PROVIDER_MODE'] = 'parallel';
          }
          if (!presentKeys.has('STREAM_PROVIDER_ORDER')) {
            patchVars['STREAM_PROVIDER_ORDER'] = 'real-debrid';
          }
          // Classic installs are single-app admin units; server default is false (public dual-app).
          if (!presentKeys.has('ENABLE_MANAGEMENT_API')) {
            patchVars['ENABLE_MANAGEMENT_API'] = 'true';
          }

          if (Object.keys(patchVars).length > 0) {
            await ServiceFileManager.updateServiceFile(addon.serviceName, patchVars, this.ssh);
            logger.info('Patched service file with new env defaults', { addonId: addon.id, patchVars });
          }
        } catch (err) {
          // Non-fatal — existing addons without the new vars still work (defaults are applied at runtime)
          logger.warn('Could not patch service file env vars; addon will use runtime defaults', {
            addonId: addon.id,
            error: (err as Error).message,
          });
        }
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

      // Step 9: Run diagnostics — checks for misconfigurations and auto-fixes what it can.
      // Intentionally non-fatal: diagnostics errors are surfaced to the user but never abort the update.
      let diagnostics: DiagnosticsResult | undefined;
      this.updateProgress(UpdateStep.DIAGNOSE, UpdateStepStatus.IN_PROGRESS, 'Running configuration diagnostics...', 0, opts.progressCallback);
      try {
        diagnostics = await this.runDiagnostics(addon);
        const { errors, warnings } = diagnostics;
        const summary = `${diagnostics.checks.length} checks — ${errors} error(s), ${warnings} warning(s)`;
        this.updateProgress(UpdateStep.DIAGNOSE, UpdateStepStatus.COMPLETED, summary, 0, opts.progressCallback);
      } catch (diagErr) {
        logger.warn('Diagnostics step threw unexpectedly', { error: (diagErr as Error).message });
        this.updateProgress(UpdateStep.DIAGNOSE, UpdateStepStatus.FAILED, `Diagnostics could not run: ${(diagErr as Error).message}`, 0, opts.progressCallback);
      }

      // Step 10: Update registry
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
        diagnostics,
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

  // ==================== Diagnostics ====================

  /**
   * Run a comprehensive set of checks against the remote addon and return structured results.
   * Checks that can be auto-fixed are fixed in place (the check is still reported with autoFixed=true).
   * Checks are non-fatal: the update is not aborted on failure here.
   */
  private async runDiagnostics(addon: any): Promise<DiagnosticsResult> {
    const checks: DiagnosticItem[] = [];

    const ok = (check: string, message: string, autoFixed = false): void => {
      checks.push({ check, status: 'ok', message, autoFixed });
    };
    const warn = (check: string, message: string, autoFixed = false): void => {
      checks.push({ check, status: 'warning', message, autoFixed });
    };
    const error = (check: string, message: string, autoFixed = false): void => {
      checks.push({ check, status: 'error', message, autoFixed });
    };

    // ── 1. Resolve remote deploy dir ────────────────────────────────────────
    let remoteDeployDir: string;
    try {
      remoteDeployDir = await this.getRemoteDeployDir(addon.configPath, addon.serviceName);
      ok('deploy_dir', `Deployment directory resolved: ${remoteDeployDir}`);
    } catch (e) {
      error('deploy_dir', `Cannot determine deployment directory: ${(e as Error).message}`);
      return { checks, errors: checks.filter(c => c.status === 'error').length, warnings: checks.filter(c => c.status === 'warning').length };
    }

    // ── 2. Required files present ────────────────────────────────────────────
    if (this.ssh) {
      try {
        const serverJsResult = await this.ssh.execCommand(`test -f ${remoteDeployDir}/server.js && echo "ok" || echo "missing"`);
        if (serverJsResult.stdout.trim() === 'ok') {
          ok('server_js', `server.js found at ${remoteDeployDir}/server.js`);
        } else {
          error('server_js', `server.js missing from ${remoteDeployDir} — files may not have deployed correctly`);
        }
      } catch (e) {
        warn('server_js', `Could not check server.js: ${(e as Error).message}`);
      }

      try {
        const pkgResult = await this.ssh.execCommand(`test -f ${remoteDeployDir}/package.json && echo "ok" || echo "missing"`);
        if (pkgResult.stdout.trim() === 'ok') {
          ok('package_json', `package.json found at ${remoteDeployDir}/package.json`);
        } else {
          error('package_json', `package.json missing from ${remoteDeployDir}`);
        }
      } catch (e) {
        warn('package_json', `Could not check package.json: ${(e as Error).message}`);
      }

      try {
        const nmResult = await this.ssh.execCommand(`test -d ${remoteDeployDir}/node_modules && echo "ok" || echo "missing"`);
        if (nmResult.stdout.trim() === 'ok') {
          ok('node_modules', `node_modules directory present`);
        } else {
          warn('node_modules', `node_modules missing from ${remoteDeployDir} — dependencies may need to be installed`);
        }
      } catch (e) {
        warn('node_modules', `Could not check node_modules: ${(e as Error).message}`);
      }
    }

    // ── 3. Service file checks ───────────────────────────────────────────────
    let serviceFile: import('../service/file-manager.js').ServiceFileContent | null = null;
    try {
      serviceFile = await ServiceFileManager.readServiceFile(addon.serviceName, this.ssh);
      ok('service_file', `Service file readable for ${addon.serviceName}`);
    } catch (e) {
      error('service_file', `Cannot read service file for ${addon.serviceName}: ${(e as Error).message}`);
    }

    if (serviceFile) {
      // 3a. ExecStart points to the right place
      const expectedExecStart = `/usr/bin/node ${remoteDeployDir}/server.js`;
      const actualExecStart = serviceFile.service.execStart ?? '';
      if (actualExecStart.includes(`${remoteDeployDir}/server.js`)) {
        ok('exec_start', `ExecStart correctly points to ${remoteDeployDir}/server.js`);
      } else if (actualExecStart === '') {
        error('exec_start', `ExecStart is empty in service file — service will not start`);
      } else {
        warn('exec_start', `ExecStart is "${actualExecStart}" but expected it to reference "${expectedExecStart}"`);
      }

      // 3b. WorkingDirectory
      const workDir = serviceFile.service.workingDirectory ?? '';
      if (workDir === remoteDeployDir || workDir === '') {
        if (workDir !== '') ok('working_dir', `WorkingDirectory set to ${workDir}`);
      } else {
        warn('working_dir', `WorkingDirectory is "${workDir}" but deploy dir is "${remoteDeployDir}"`);
      }

      // 3c. Required env vars
      const envMap = new Map(serviceFile.service.environment.map(e => [e.key, e.value]));

      const rdToken = envMap.get('RD_API_TOKEN') ?? '';
      const torboxToken = envMap.get('TORBOX_API_TOKEN') ?? '';
      const hasRd = rdToken.length > 0 && rdToken !== 'YOUR_REAL_DEBRID_TOKEN_HERE';
      const hasTorbox = torboxToken.length > 0;

      if (!hasRd && !hasTorbox) {
        error('provider_token', 'Neither RD_API_TOKEN nor TORBOX_API_TOKEN is set — no stream provider is configured');
      } else {
        if (hasRd) ok('rd_token', 'RD_API_TOKEN is set');
        if (hasTorbox) ok('torbox_token', 'TORBOX_API_TOKEN is set');
      }

      const password = envMap.get('ADDON_PASSWORD') ?? '';
      if (!password || password === 'YOUR_ADDON_PASSWORD_HERE') {
        warn('addon_password', 'ADDON_PASSWORD is not set — addon will run without authentication');
      } else {
        ok('addon_password', 'ADDON_PASSWORD is set');
      }

      const port = envMap.get('PORT') ?? '';
      if (!port) {
        warn('port', 'PORT is not set in service file — will use default 7000');
      } else {
        ok('port', `PORT is set to ${port}`);
      }

      // 3d. Provider mode / order + management API (auto-fix if missing)
      const patchVars: Record<string, string> = {};
      if (!envMap.has('STREAM_PROVIDER_MODE')) {
        patchVars['STREAM_PROVIDER_MODE'] = 'parallel';
      }
      if (!envMap.has('STREAM_PROVIDER_ORDER')) {
        patchVars['STREAM_PROVIDER_ORDER'] = hasRd ? 'real-debrid' : hasTorbox ? 'torbox' : 'real-debrid';
      }
      if (!envMap.has('ENABLE_MANAGEMENT_API')) {
        patchVars['ENABLE_MANAGEMENT_API'] = 'true';
      }

      if (Object.keys(patchVars).length > 0) {
        try {
          await ServiceFileManager.updateServiceFile(addon.serviceName, patchVars, this.ssh);
          for (const [k, v] of Object.entries(patchVars)) {
            warn('provider_config', `${k} was missing — set to "${v}"`, true);
          }
        } catch (e) {
          warn('provider_config', `Some provider env vars are missing but could not be auto-fixed: ${(e as Error).message}`);
        }
      } else {
        ok('provider_config', `STREAM_PROVIDER_MODE=${envMap.get('STREAM_PROVIDER_MODE')}, STREAM_PROVIDER_ORDER=${envMap.get('STREAM_PROVIDER_ORDER')}, ENABLE_MANAGEMENT_API=${envMap.get('ENABLE_MANAGEMENT_API')}`);
      }

      // 3e. MAX_CONCURRENT_VIEWERS
      if (!envMap.has('MAX_CONCURRENT_VIEWERS')) {
        try {
          await ServiceFileManager.updateServiceFile(addon.serviceName, { MAX_CONCURRENT_VIEWERS: '10' }, this.ssh);
          warn('concurrent_viewers', 'MAX_CONCURRENT_VIEWERS was missing — set to 10', true);
        } catch {
          warn('concurrent_viewers', 'MAX_CONCURRENT_VIEWERS is not set in service file — will use default 10');
        }
      } else {
        ok('concurrent_viewers', `MAX_CONCURRENT_VIEWERS=${envMap.get('MAX_CONCURRENT_VIEWERS')}`);
      }
    }

    // ── 4. Service running check ─────────────────────────────────────────────
    try {
      const svcMgr = new ServiceManager(addon.serviceName, this.ssh);
      const status = await svcMgr.status();
      if (status.status === ServiceStatus.ACTIVE) {
        ok('service_running', `Service ${addon.serviceName} is active and running`);
      } else if (status.status === ServiceStatus.FAILED) {
        error('service_running', `Service ${addon.serviceName} is in FAILED state — check logs for crash details`);
      } else {
        warn('service_running', `Service ${addon.serviceName} status is "${status.status}" (expected active)`);
      }
    } catch (e) {
      warn('service_running', `Could not check service status: ${(e as Error).message}`);
    }

    // ── 5. nginx check (if remote) ───────────────────────────────────────────
    if (this.ssh) {
      try {
        const nginxResult = await this.ssh.execCommand('systemctl is-active nginx');
        const nginxStatus = nginxResult.stdout.trim();
        if (nginxStatus === 'active') {
          ok('nginx', 'nginx is running');
        } else {
          error('nginx', `nginx is not running (status: ${nginxStatus}) — HTTPS proxy will fail`);
        }
      } catch (e) {
        warn('nginx', `Could not check nginx status: ${(e as Error).message}`);
      }
    }

    // ── 6. DuckDNS + maintenance script check (auto-fix) ─────────────────────
    // Verifies that ~/duckdns/duck.sh exists, targets the correct domain, and
    // includes the service watchdog.  Auto-rewrites + fixes the crontab if any
    // of these are wrong — so running Update from the Electron app self-heals a
    // misconfigured or manually-created DuckDNS script.
    if (this.ssh) {
      try {
        const configManager = new ConfigManager(addon.id);
        const config = await configManager.load();

        if (config?.addon?.domain?.includes('duckdns.org') && config?.secrets?.duckdnsToken) {
          const expectedDomain = config.addon.domain.replace('.duckdns.org', '');
          const token = config.secrets.duckdnsToken;
          const svcName = addon.serviceName as string;
          const scriptPath = '~/duckdns/duck.sh';
          const duckLogPath = '~/duckdns/duck.log';
          const maintLogPath = '~/duckdns/maintenance.log';

          const readResult = await this.ssh.execCommand(`cat ${scriptPath} 2>/dev/null || echo "__MISSING__"`);
          const scriptContent = readResult.stdout.trim();

          const isMissing = scriptContent === '__MISSING__';
          const domainOk  = !isMissing && scriptContent.includes(expectedDomain);
          const watchdogOk = !isMissing && scriptContent.includes(svcName);

          if (isMissing || !domainOk || !watchdogOk) {
            try {
              const newScript = [
                '#!/bin/bash',
                '# Stremio Addon Maintenance Script — auto-generated, do not edit manually.',
                '# Managed by stremio-addon-manager. Runs every 5 minutes via cron.',
                '',
                '# ── 1. Update DuckDNS with current public IP ──────────────────────────',
                `curl -k "https://www.duckdns.org/update?domains=${expectedDomain}&token=${token}&ip=" -o ${duckLogPath} 2>&1`,
                '',
                '# ── 2. Rotate maintenance log if > 500 KB ─────────────────────────────',
                `if [ -f ${maintLogPath} ] && [ "$(wc -c < ${maintLogPath})" -gt 512000 ]; then`,
                `  tail -n 200 ${maintLogPath} > ${maintLogPath}.tmp && mv ${maintLogPath}.tmp ${maintLogPath}`,
                'fi',
                '',
                '# ── 3. Ensure addon service is running ────────────────────────────────',
                `if ! systemctl is-active --quiet ${svcName}; then`,
                `  echo "$(date '+%Y-%m-%d %H:%M:%S') [watchdog] ${svcName} not active — restarting" >> ${maintLogPath}`,
                `  sudo systemctl start ${svcName} >> ${maintLogPath} 2>&1`,
                'fi',
                '',
                '# ── 4. Ensure nginx is running ────────────────────────────────────────',
                'if ! systemctl is-active --quiet nginx; then',
                `  echo "$(date '+%Y-%m-%d %H:%M:%S') [watchdog] nginx not active — restarting" >> ${maintLogPath}`,
                `  sudo systemctl start nginx >> ${maintLogPath} 2>&1`,
                'fi',
              ].join('\n');

              await this.ssh.execCommand(`mkdir -p ~/duckdns`);
              await this.ssh.execCommand(`cat > ${scriptPath} << 'MAINT_EOF'\n${newScript}\nMAINT_EOF`);
              await this.ssh.execCommand(`chmod +x ${scriptPath}`);

              // Deduplicate crontab: remove all duck/duckdns entries, add exactly one.
              await this.ssh.execCommand(
                `(crontab -l 2>/dev/null | grep -Ev 'duck|duckdns'; echo "*/5 * * * * ${scriptPath} >/dev/null 2>&1") | crontab -`
              );

              const reason = isMissing
                ? 'script was missing'
                : !domainOk
                  ? `script targeted wrong domain (expected ${expectedDomain})`
                  : 'service watchdog was absent';

              warn(
                'duckdns_script',
                `DuckDNS/maintenance script rebuilt (${reason}) — now targeting ${expectedDomain}.duckdns.org with watchdog for ${svcName}`,
                true
              );
            } catch (fixErr) {
              const reason = isMissing ? 'missing' : !domainOk ? 'wrong domain' : 'missing watchdog';
              error('duckdns_script', `DuckDNS script is ${reason} and could not be auto-fixed: ${(fixErr as Error).message}`);
            }
          } else {
            ok('duckdns_script', `DuckDNS/maintenance script correctly configured for ${expectedDomain}.duckdns.org`);
          }
        }
      } catch (diagErr) {
        warn('duckdns_script', `Could not check DuckDNS/maintenance script: ${(diagErr as Error).message}`);
      }
    }

    const errors = checks.filter(c => c.status === 'error').length;
    const warnings = checks.filter(c => c.status === 'warning').length;

    logger.info('Diagnostics complete', { errors, warnings, totalChecks: checks.length });

    return { checks, errors, warnings };
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
  private getBundledPackageJsonPath(product?: AddonProduct): string {
    // Get current file's directory using ES modules approach
    const currentFileUrl = import.meta.url;
    const currentFilePath = fileURLToPath(currentFileUrl);
    const currentDir = path.dirname(currentFilePath);
    const packageDir = productPackageDir(normalizeAddonProduct(product));
    
    // Try multiple possible locations based on the environment
    const possiblePaths = [
      // === Electron Production (packaged app) ===
      ...(typeof process !== 'undefined' && process.versions && process.versions.electron ? [
        (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath &&
          path.join(
            (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath as string,
            packageDir,
            'package.json'
          ),
        path.resolve(currentDir, `../../../../resources/${packageDir}/package.json`),
        path.resolve(currentDir, `../../../resources/${packageDir}/package.json`),
      ].filter(Boolean) : []),
      
      path.resolve(currentDir, `../../../../../electron/resources/${packageDir}/package.json`),
      path.resolve(currentDir, `../../../../electron/resources/${packageDir}/package.json`),
      path.resolve(currentDir, `../../../resources/${packageDir}/package.json`),
      path.resolve(currentDir, `../../resources/${packageDir}/package.json`),
      path.resolve(currentDir, `../../../../${packageDir}/package.json`),
      path.resolve(currentDir, `../../../${packageDir}/package.json`),
    ];

    logger.debug('Searching for bundled addon-server package.json', {
      currentDir,
      isElectron: !!(process.versions && process.versions.electron),
      resourcesPath: (process as any).resourcesPath,
      searchingPaths: possiblePaths.length
    });

    // Find the first path that exists
    for (const packagePath of possiblePaths) {
      if (packagePath && fs.existsSync(packagePath)) {
        logger.info('Found bundled addon-server package.json', { path: packagePath });
        return packagePath;
      }
    }

    // If nothing found, throw error with helpful message
    logger.error('Could not find bundled addon-server package.json', { 
      searchedPaths: possiblePaths.filter(Boolean),
      currentDir,
      isElectron: !!(process.versions && process.versions.electron),
      resourcesPath: (process as any).resourcesPath,
    });
    throw new Error(
      'Bundled addon-server package.json not found. ' +
      'Make sure you run "npm run build" to bundle the packages before updating.'
    );
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
   * Load the full AddonManagerConfig from the addon's config.yaml path.
   * Used to retrieve the actual remote deployment directory (paths.addonDirectory).
   */
  private async loadAddonManagerConfig(configPath: string): Promise<import('../config/types.js').AddonManagerConfig> {
    const mgr = new ConfigManager(undefined, configPath);
    return mgr.load();
  }

  /**
   * Resolve the remote deployment directory for an addon.
   * When running via SSH this must come from config.paths.addonDirectory — NOT from
   * path.dirname(addon.configPath) which is the local Windows config directory.
   *
   * Falls back to the service-name convention (/opt/{serviceName}) when
   * paths.addonDirectory is absent from the config (e.g. older configs that
   * were saved before the paths section was added to the wizard).
   */
  private async getRemoteDeployDir(addonConfigPath: string, serviceName?: string): Promise<string> {
    try {
      const fullConfig = await this.loadAddonManagerConfig(addonConfigPath);
      const dir = fullConfig.paths?.addonDirectory?.trim();
      if (dir) {
        logger.info('Remote deploy dir resolved from config', { dir });
        return dir;
      }
    } catch (e) {
      logger.warn('Could not load addon config to resolve deploy dir', { error: (e as Error).message });
    }

    // Fall back: the install manager always places addons at /opt/{serviceName}
    if (serviceName) {
      const derived = `/opt/${serviceName}`;
      logger.warn('paths.addonDirectory not set in config — using convention-based fallback', { derived, serviceName });
      return derived;
    }

    throw new Error(
      `Cannot determine remote deployment directory: paths.addonDirectory is not set in ${addonConfigPath} and no serviceName provided`
    );
  }

  /**
   * Update addon files
   */
  private async updateAddonFiles(addon: any, keepOldFiles: boolean): Promise<void> {
    logger.info('Updating addon files', { addonId: addon.id, keepOldFiles });

    // Get bundled package path
    const bundledPackagePath = this.getBundledPackageJsonPath();
    const bundledDir = path.dirname(bundledPackagePath); // This is the bundled addon-server directory

    if (this.ssh) {
      // Remote update via SSH — use the actual Pi deployment path from the addon's config.yaml
      const remoteDeployDir = await this.getRemoteDeployDir(addon.configPath, addon.serviceName);
      logger.info('Addon paths (remote)', { remoteDeployDir, bundledDir });
      await this.updateRemoteAddonFiles(remoteDeployDir, bundledDir, keepOldFiles);
    } else {
      // Local update — local addon-server lives in a subdirectory next to config
      const addonDir = path.dirname(addon.configPath);
      logger.info('Addon paths (local)', { addonDir, bundledDir });
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
   * Update addon files on remote server via SSH.
   * remoteDeployDir is the actual deployment directory on the Pi (e.g. /opt/stremio-addon-my-private-addon).
   * Files are extracted directly into that directory — the service ExecStart points there.
   */
  private async updateRemoteAddonFiles(remoteDeployDir: string, bundledDir: string, keepOldFiles: boolean): Promise<void> {
    if (!this.ssh) {
      throw new Error('SSH connection required for remote update');
    }

    const remoteOldDir = `${remoteDeployDir}.old`;

    // Ensure the deploy directory exists on the remote
    await this.ssh.execCommand(`sudo mkdir -p ${remoteDeployDir}`);

    // Keep a copy of the old directory for rollback if requested
    if (keepOldFiles) {
      logger.info('Backing up old files on remote server', { from: remoteDeployDir, to: remoteOldDir });
      await this.ssh.execCommand(`sudo rm -rf ${remoteOldDir}`);
      await this.ssh.execCommand(`sudo cp -r ${remoteDeployDir} ${remoteOldDir}`);
    }

    // Create a tarball of the bundled directory
    const tempTarPath = path.join(os.tmpdir(), `addon-update-${Date.now()}.tar.gz`);
    logger.info('Creating tarball of bundled files', { tarPath: tempTarPath });

    execSync(`tar -czf "${tempTarPath}" -C "${path.dirname(bundledDir)}" "${path.basename(bundledDir)}"`);

    // Upload tarball to remote server
    const remoteTarPath = `/tmp/addon-update-${Date.now()}.tar.gz`;
    logger.info('Uploading tarball to remote server', { remotePath: remoteTarPath });

    await this.ssh.transferFile(tempTarPath, remoteTarPath);

    // Extract tarball directly into the deploy directory, stripping the top-level dir name.
    // This overwrites existing JS/JSON files in place without touching unrelated files
    // (e.g. local-library data, runtime state).
    logger.info('Extracting tarball on remote server', { into: remoteDeployDir });
    const extractResult = await this.ssh.execCommand(
      `sudo tar -xzf ${remoteTarPath} -C ${remoteDeployDir} --strip-components=1`
    );

    if (extractResult.code !== 0) {
      throw new Error(`Failed to extract files on remote server: ${extractResult.stderr}`);
    }

    // Fix ownership so the SSH user can run npm install and the service can read files
    const whoamiResult = await this.ssh.execCommand('whoami');
    const username = whoamiResult.stdout.trim() || 'root';
    await this.ssh.execCommand(`sudo chown -R ${username}:${username} ${remoteDeployDir}`);

    // Cleanup temp files
    fs.unlinkSync(tempTarPath);
    await this.ssh.execCommand(`rm -f ${remoteTarPath}`);

    logger.info('Remote addon files updated successfully', { remoteDeployDir });
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

    if (this.ssh) {
      // Remote: install via SSH using the actual Pi deployment path
      const remoteDeployDir = await this.getRemoteDeployDir(addon.configPath, addon.serviceName);
      logger.info('Installing dependencies on remote server', { remoteDeployDir });
      const result = await this.ssh.execCommand(`cd ${remoteDeployDir} && npm install --production`);

      if (result.code !== 0) {
        logger.error('Failed to install dependencies on remote server', { stderr: result.stderr });
        throw new Error(`Failed to install dependencies: ${result.stderr}`);
      }

      logger.info('Dependencies installed on remote server');
    } else {
      // Local: install using child_process next to config file
      const addonServerDir = path.join(path.dirname(addon.configPath), 'addon-server');
      logger.info('Installing dependencies locally', { addonServerDir });

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

    try {
      if (this.ssh) {
        // Remote: verify the server.js exists in the actual deployment directory
        const remoteDeployDir = await this.getRemoteDeployDir(addon.configPath, addon.serviceName);
        const remotePackageJsonPath = `${remoteDeployDir}/package.json`;
        const result = await this.ssh.execCommand(`cat ${remotePackageJsonPath}`);
        if (result.code !== 0) {
          throw new Error(`package.json not found after update at ${remotePackageJsonPath}`);
        }

        const packageJson = JSON.parse(result.stdout);
        logger.info('Update verified - package.json exists', { version: packageJson.version, remoteDeployDir });
      } else {
        // Local: verify locally
        const packageJsonPath = path.join(path.dirname(addon.configPath), 'addon-server', 'package.json');
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

    if (this.ssh) {
      // Remote: cleanup via SSH using the actual Pi deployment path
      const remoteDeployDir = await this.getRemoteDeployDir(addon.configPath, addon.serviceName);
      const remoteOldDir = `${remoteDeployDir}.old`;
      const checkResult = await this.ssh.execCommand(`test -d ${remoteOldDir} && echo "exists" || echo "not-exists"`);
      if (checkResult.stdout.trim() === 'exists') {
        logger.info('Removing old files on remote server', { remoteOldDir });
        await this.ssh.execCommand(`sudo rm -rf ${remoteOldDir}`);
      }
    } else {
      // Local: cleanup locally
      const oldDir = path.join(path.dirname(addon.configPath), 'addon-server.old');
      if (fs.existsSync(oldDir)) {
        logger.info('Removing old files locally', { oldDir });
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

