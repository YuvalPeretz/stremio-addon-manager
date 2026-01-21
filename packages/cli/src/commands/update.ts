/**
 * Update Command
 * Update addon to latest version
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

interface UpdateOptions {
  addon?: string;
  all?: boolean;
  version?: string;
  skipBackup?: boolean;
  force?: boolean;
  dryRun?: boolean;
  keepOld?: boolean;
}

/**
 * Format step name for display
 */
function formatStepName(step: UpdateStep): string {
  const stepNames: Record<UpdateStep, string> = {
    [UpdateStep.VALIDATE]: 'Validating',
    [UpdateStep.CREATE_BACKUP]: 'Creating backup',
    [UpdateStep.STOP_SERVICE]: 'Stopping service',
    [UpdateStep.UPDATE_FILES]: 'Updating files',
    [UpdateStep.INSTALL_DEPENDENCIES]: 'Installing dependencies',
    [UpdateStep.UPDATE_CONFIG]: 'Updating configuration',
    [UpdateStep.RESTART_SERVICE]: 'Restarting service',
    [UpdateStep.VERIFY]: 'Verifying update',
    [UpdateStep.UPDATE_REGISTRY]: 'Updating registry',
    [UpdateStep.CLEANUP]: 'Cleaning up',
    [UpdateStep.COMPLETE]: 'Complete',
  };
  return stepNames[step] || step;
}

/**
 * Update progress callback
 */
function createProgressCallback(spinner: ReturnType<typeof ora>) {
  return (progress: UpdateProgress) => {
    const stepName = formatStepName(progress.step);
    
    if (progress.status === UpdateStepStatus.IN_PROGRESS) {
      spinner.text = `${stepName}...`;
    } else if (progress.status === UpdateStepStatus.COMPLETED) {
      // Keep spinner running, just update text
      spinner.text = `${stepName} ✓`;
    } else if (progress.status === UpdateStepStatus.FAILED) {
      spinner.fail(chalk.red(`${stepName} failed: ${progress.error?.message}`));
    } else if (progress.status === UpdateStepStatus.SKIPPED) {
      spinner.text = `${stepName} (skipped)`;
    }
  };
}

/**
 * Update a single addon
 */
async function updateSingleAddon(addonId: string, options: UpdateOptions): Promise<boolean> {
  try {
    const addon = await getAddonMetadata(addonId);
    if (!addon) {
      return false;
    }

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

    // Check for updates first
    console.log(chalk.cyan(`\nChecking for updates for '${addon.name}'...`));
    const updateInfo = await updateManager.checkForUpdates(addonId);

    if (!updateInfo.updateAvailable && !options.force) {
      console.log(chalk.green(`✓ Already on latest version (${updateInfo.currentVersion})\n`));
      if (ssh) {
        await ssh.disconnect();
      }
      return true;
    }

    console.log(chalk.cyan(`Current version: ${updateInfo.currentVersion}`));
    console.log(chalk.cyan(`Latest version:  ${updateInfo.latestVersion}\n`));

    if (options.dryRun) {
      console.log(chalk.yellow('🔍 DRY RUN - No changes will be made\n'));
    }

    const spinner = ora('Starting update...').start();

    const result = await updateManager.updateAddon(addonId, {
      targetVersion: options.version,
      skipBackup: options.skipBackup,
      forceUpdate: options.force,
      dryRun: options.dryRun,
      keepOldFiles: options.keepOld,
      progressCallback: createProgressCallback(spinner),
    });

    if (result.success) {
      spinner.succeed(
        chalk.green(
          `Addon '${addon.name}' updated successfully! (${result.previousVersion} → ${result.newVersion})`
        )
      );
      
      if (result.backupId) {
        console.log(chalk.gray(`Backup created: ${result.backupId}`));
      }
      
      if (result.warnings && result.warnings.length > 0) {
        console.log(chalk.yellow('\n⚠️  Warnings:'));
        result.warnings.forEach((warning: string) => console.log(chalk.yellow(`   - ${warning}`)));
      }
      
      console.log(); // Empty line
    } else {
      spinner.fail(chalk.red(`Update failed: ${result.error}`));
      console.log(chalk.yellow('\n💡 The addon has been automatically rolled back to the previous version.\n'));
      return false;
    }

    if (ssh) {
      await ssh.disconnect();
    }

    return true;
  } catch (error) {
    logger.error(`Failed to update addon ${addonId}`, error);
    return false;
  }
}

/**
 * Update command handler
 */
export async function updateCommand(options: UpdateOptions): Promise<void> {
  try {
    // Check for updates mode
    if (!options.addon && !options.all) {
      // Show available updates for all addons
      const registryManager = new AddonRegistryManager();
      await registryManager.initialize();
      const allAddons = await registryManager.listAddons();

      if (allAddons.length === 0) {
        console.log(chalk.yellow('\n⚠️  No addons found.\n'));
        return;
      }

      console.log(chalk.cyan('\n🔍 Checking for updates...\n'));

      const updateManager = new UpdateManager();
      await updateManager.initialize();

      let updatesAvailable = 0;
      const updateInfos: Array<{ addonId: string; name: string; info: any }> = [];

      for (const addon of allAddons) {
        try {
          const info = await updateManager.checkForUpdates(addon.id);
          updateInfos.push({ addonId: addon.id, name: addon.name, info });
          if (info.updateAvailable) {
            updatesAvailable++;
          }
        } catch (error) {
          logger.error(`Failed to check updates for ${addon.id}`, error);
        }
      }

      // Display results
      console.log(chalk.bold('Available Updates:\n'));
      
      for (const { name, info } of updateInfos) {
        if (info.updateAvailable) {
          console.log(chalk.green(`✓ ${name}`));
          console.log(chalk.gray(`  Current: ${info.currentVersion} → Latest: ${info.latestVersion}`));
        } else {
          console.log(chalk.gray(`  ${name} - Up to date (${info.currentVersion})`));
        }
      }

      console.log();
      
      if (updatesAvailable > 0) {
        console.log(chalk.cyan(`💡 ${updatesAvailable} update(s) available.`));
        console.log(chalk.cyan(`   Run 'stremio-addon-manager update --all' to update all addons`));
        console.log(chalk.cyan(`   or 'stremio-addon-manager update --addon <id>' for specific addon\n`));
      } else {
        console.log(chalk.green('✓ All addons are up to date!\n'));
      }
      
      return;
    }

    // Update all addons
    if (options.all) {
      const registryManager = new AddonRegistryManager();
      await registryManager.initialize();
      const allAddons = await registryManager.listAddons();

      if (allAddons.length === 0) {
        console.log(chalk.yellow('\n⚠️  No addons found.\n'));
        return;
      }

      console.log(chalk.cyan(`\n🔄 Updating ${allAddons.length} addon(s)...\n`));
      
      let successCount = 0;
      for (const addon of allAddons) {
        const success = await updateSingleAddon(addon.id, options);
        if (success) {
          successCount++;
        }
      }

      console.log();
      if (successCount === allAddons.length) {
        console.log(chalk.green(`✓ All ${allAddons.length} addon(s) updated successfully!\n`));
      } else {
        console.log(
          chalk.yellow(`⚠️  Updated ${successCount} of ${allAddons.length} addon(s). Some failed.\n`)
        );
      }
      return;
    }

    // Update specific addon
    const resolvedAddonId = await resolveAddonId(options.addon);
    if (!resolvedAddonId) {
      console.log(chalk.yellow('\n⚠️  No addon specified or found.\n'));
      process.exit(1);
    }

    const addon = await getAddonMetadata(resolvedAddonId);
    if (!addon) {
      console.log(chalk.red(`\n❌ Addon '${resolvedAddonId}' not found.\n`));
      process.exit(1);
    }

    await updateSingleAddon(resolvedAddonId, options);
  } catch (error) {
    logger.error('Failed to update addon', error);
    console.log(chalk.red(`\n❌ ${(error as Error).message}\n`));
    process.exit(1);
  }
}

