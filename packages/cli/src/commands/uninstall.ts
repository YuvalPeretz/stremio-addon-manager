/**
 * Uninstall Command
 * Remove the addon and all files
 */

import chalk from 'chalk';
import inquirer from 'inquirer';
import ora from 'ora';
import {
  logger,
  ServiceManager,
  SSHManager,
  AddonRegistryManager,
  getServiceNameFromAddonId,
} from '@stremio-addon-manager/core';
import { resolveAddonId, getAddonMetadata, getConfigManagerForAddon } from '../utils/addon-resolver.js';

interface UninstallOptions {
  addon?: string;
  remote?: boolean;
  keepConfig?: boolean;
  keepBackups?: boolean;
}

/**
 * Uninstall command handler
 */
export async function uninstallCommand(options: UninstallOptions): Promise<void> {
  try {
    // Resolve addon ID (required for multi-addon)
    const resolvedAddonId = await resolveAddonId(options.addon);
    if (!resolvedAddonId) {
      console.log(chalk.red('\n❌ Addon ID is required. Use --addon <id> to specify which addon to uninstall.\n'));
      console.log(chalk.yellow('Use "stremio-addon-manager list" to see all installed addons.\n'));
      process.exit(1);
    }

    const addon = await getAddonMetadata(resolvedAddonId);
    if (!addon) {
      console.log(chalk.red(`\n❌ Addon '${resolvedAddonId}' not found.\n`));
      process.exit(1);
    }

    const configManager = getConfigManagerForAddon(resolvedAddonId);
    const config = await configManager.load();

    // Confirm uninstallation
    const { confirm } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirm',
        message: chalk.red(
          `Are you sure you want to uninstall addon '${addon.name}' (${resolvedAddonId})? This action cannot be undone.`
        ),
        default: false,
      },
    ]);

    if (!confirm) {
      console.log(chalk.yellow('\n⚠️  Uninstallation cancelled\n'));
      return;
    }

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

    // Stop service
    const stopSpinner = ora('Stopping service...').start();
    try {
      const serviceName = config.serviceName || getServiceNameFromAddonId(resolvedAddonId);
      const serviceManager = new ServiceManager(serviceName, ssh);
      await serviceManager.stop();
      await serviceManager.disable();
      stopSpinner.succeed(chalk.green('Service stopped and disabled'));
    } catch (error) {
      stopSpinner.warn(chalk.yellow('Service may not be running'));
    }

    // Remove files
    const removeSpinner = ora('Removing addon files...').start();
    try {
      if (ssh) {
        await ssh.execCommand(`rm -rf ${config.paths.addonDirectory}`);
        await ssh.execSudo(`rm -f ${config.paths.serviceFile}`);
        await ssh.execSudo(`rm -f ${config.paths.nginxConfig}`);
        await ssh.execSudo(`rm -f /etc/nginx/sites-enabled/${config.serviceName || getServiceNameFromAddonId(resolvedAddonId)}`);

        if (!options.keepBackups) {
          await ssh.execSudo(`rm -rf ${config.paths.backups}`);
        }
      } else {
        // Local uninstall commands would go here
        // TODO: Implement local file removal
      }
      removeSpinner.succeed(chalk.green('Addon files removed'));
    } catch (error) {
      removeSpinner.fail(chalk.red('Failed to remove some files'));
      logger.error('File removal error', error);
    }

    // Remove from registry
    const registryManager = new AddonRegistryManager();
    await registryManager.initialize();
    await registryManager.deleteAddon(resolvedAddonId);

    // Remove configuration
    if (!options.keepConfig) {
      await configManager.delete();
      console.log(chalk.green('✅ Configuration removed'));
    }

    console.log(chalk.green(`\n✅ Addon '${addon.name}' uninstalled successfully!\n`));

    if (ssh) {
      await ssh.disconnect();
    }
  } catch (error) {
    logger.error('Uninstallation failed', error);
    console.log(chalk.red(`\n❌ Uninstallation failed: ${(error as Error).message}\n`));
    process.exit(1);
  }
}

