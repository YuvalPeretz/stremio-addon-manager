/**
 * Rollback Command
 * Rollback addon to previous version
 */

import ora from 'ora';
import chalk from 'chalk';
import {
  logger,
  ConfigManager,
  SSHManager,
  AddonRegistryManager,
  UpdateManager,
  type UpdateProgress,
  UpdateStep,
  UpdateStepStatus,
} from '@stremio-addon-manager/core';
import { resolveAddonId, getAddonMetadata } from '../utils/addon-resolver.js';

interface RollbackOptions {
  addon?: string;
  backupId?: string;
  listBackups?: boolean;
}

/**
 * Format step name for display
 */
function formatStepName(step: UpdateStep): string {
  const stepNames: Record<UpdateStep, string> = {
    [UpdateStep.VALIDATE]: 'Validating',
    [UpdateStep.CREATE_BACKUP]: 'Creating backup',
    [UpdateStep.STOP_SERVICE]: 'Stopping service',
    [UpdateStep.UPDATE_FILES]: 'Restoring files',
    [UpdateStep.INSTALL_DEPENDENCIES]: 'Installing dependencies',
    [UpdateStep.UPDATE_CONFIG]: 'Updating configuration',
    [UpdateStep.RESTART_SERVICE]: 'Restarting service',
    [UpdateStep.VERIFY]: 'Verifying rollback',
    [UpdateStep.UPDATE_REGISTRY]: 'Updating registry',
    [UpdateStep.CLEANUP]: 'Cleaning up',
    [UpdateStep.COMPLETE]: 'Complete',
  };
  return stepNames[step] || step;
}

/**
 * Rollback progress callback
 */
function createProgressCallback(spinner: ReturnType<typeof ora>) {
  return (progress: UpdateProgress) => {
    const stepName = formatStepName(progress.step);
    
    if (progress.status === UpdateStepStatus.IN_PROGRESS) {
      spinner.text = `${stepName}...`;
    } else if (progress.status === UpdateStepStatus.COMPLETED) {
      spinner.text = `${stepName} ✓`;
    } else if (progress.status === UpdateStepStatus.FAILED) {
      spinner.fail(chalk.red(`${stepName} failed: ${progress.error?.message}`));
    } else if (progress.status === UpdateStepStatus.SKIPPED) {
      spinner.text = `${stepName} (skipped)`;
    }
  };
}

/**
 * List backups for an addon
 */
async function listBackupsForAddon(addonId: string): Promise<void> {
  const addon = await getAddonMetadata(addonId);
  if (!addon) {
    console.log(chalk.red(`\n❌ Addon '${addonId}' not found.\n`));
    return;
  }

  const registryManager = new AddonRegistryManager();
  await registryManager.initialize();
  const addonMetadata = await registryManager.getAddon(addonId);

  if (!addonMetadata || !addonMetadata.backups || addonMetadata.backups.length === 0) {
    console.log(chalk.yellow(`\n⚠️  No backups found for addon '${addon.name}'.\n`));
    return;
  }

  console.log(chalk.cyan(`\nAvailable backups for '${addon.name}':\n`));

  addonMetadata.backups.forEach((backup, index) => {
    const date = new Date(backup.timestamp).toLocaleString();
    const sizeMB = (backup.size / 1024 / 1024).toFixed(2);
    const typeIcon = backup.type === 'pre-update' ? '🔄' : backup.type === 'manual' ? '📦' : '⏰';
    
    console.log(chalk.white(`${index + 1}. ${backup.id}`));
    console.log(chalk.gray(`   ${typeIcon} ${backup.type} | Version: ${backup.version}`));
    console.log(chalk.gray(`   📅 ${date} | 💾 ${sizeMB} MB`));
    console.log();
  });

  console.log(chalk.cyan(`💡 To rollback to a specific backup:`));
  console.log(chalk.cyan(`   stremio-addon-manager rollback --addon ${addonId} --backup-id <id>\n`));
}

/**
 * Rollback command handler
 */
export async function rollbackCommand(options: RollbackOptions): Promise<void> {
  try {
    const resolvedAddonId = await resolveAddonId(options.addon);
    if (!resolvedAddonId) {
      console.log(chalk.yellow('\n⚠️  No addon specified or found.\n'));
      console.log(chalk.cyan('Usage: stremio-addon-manager rollback --addon <id>\n'));
      process.exit(1);
    }

    // List backups mode
    if (options.listBackups) {
      await listBackupsForAddon(resolvedAddonId);
      return;
    }

    const addon = await getAddonMetadata(resolvedAddonId);
    if (!addon) {
      console.log(chalk.red(`\n❌ Addon '${resolvedAddonId}' not found.\n`));
      process.exit(1);
    }

    const configManager = new ConfigManager(resolvedAddonId);
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

    console.log(chalk.cyan(`\n🔙 Rolling back addon '${addon.name}'...\n`));

    if (options.backupId) {
      console.log(chalk.gray(`Using backup: ${options.backupId}\n`));
    } else {
      console.log(chalk.gray('Using most recent backup or .old directory\n'));
    }

    const spinner = ora('Starting rollback...').start();

    const result = await updateManager.rollbackUpdate(resolvedAddonId, {
      backupId: options.backupId,
      useFastRollback: true,
      restartService: true,
      progressCallback: createProgressCallback(spinner),
    });

    if (result.success) {
      const method = result.method === 'fast' ? 'fast rollback (.old directory)' : 'backup restoration';
      spinner.succeed(
        chalk.green(
          `Addon '${addon.name}' rolled back successfully! (${result.currentVersion} → ${result.rolledBackToVersion})`
        )
      );
      console.log(chalk.gray(`Method: ${method}`));
      if (result.backupId) {
        console.log(chalk.gray(`Backup: ${result.backupId}`));
      }
      console.log();
    } else {
      spinner.fail(chalk.red(`Rollback failed: ${result.error}`));
      console.log();
      return;
    }

    if (ssh) {
      await ssh.disconnect();
    }
  } catch (error) {
    logger.error('Failed to rollback addon', error);
    console.log(chalk.red(`\n❌ ${(error as Error).message}\n`));
    process.exit(1);
  }
}

