/**
 * Restart Command
 * Restart the addon service(s)
 */

import ora from 'ora';
import chalk from 'chalk';
import {
  logger,
  ConfigManager,
  ServiceManager,
  SSHManager,
  AddonRegistryManager,
  getServiceNameFromAddonId,
} from '@stremio-addon-manager/core';
import { resolveAddonId, getAddonMetadata } from '../utils/addon-resolver.js';

interface RestartOptions {
  addon?: string;
  all?: boolean;
  remote?: boolean;
}

/**
 * Restart a single addon
 */
async function restartSingleAddon(addonId: string, ssh?: SSHManager): Promise<boolean> {
  try {
    const addon = await getAddonMetadata(addonId);
    if (!addon) {
      return false;
    }

    const configManager = new ConfigManager(addonId);
    const config = await configManager.load();

    let sshConnection = ssh;
    if (!sshConnection && config.installation.type === 'remote' && config.installation.target) {
      sshConnection = new SSHManager({
        host: config.installation.target.host || '',
        port: config.installation.target.port || 22,
        username: config.installation.target.username || '',
        password: config.installation.target.password,
        privateKeyPath: config.installation.target.privateKeyPath,
      });
      await sshConnection.connect();
    }

    const serviceName = config.serviceName || getServiceNameFromAddonId(addonId);
    const serviceManager = new ServiceManager(serviceName, sshConnection);
    await serviceManager.restart();

    if (!ssh && sshConnection) {
      await sshConnection.disconnect();
    }

    return true;
  } catch (error) {
    logger.error(`Failed to restart addon ${addonId}`, error);
    return false;
  }
}

/**
 * Restart command handler
 */
export async function restartCommand(options: RestartOptions): Promise<void> {
  try {
    if (options.all) {
      const registryManager = new AddonRegistryManager();
      await registryManager.initialize();
      const allAddons = await registryManager.listAddons();

      if (allAddons.length === 0) {
        console.log(chalk.yellow('\n⚠️  No addons found.\n'));
        return;
      }

      const spinner = ora(`Restarting ${allAddons.length} addon(s)...`).start();
      let successCount = 0;

      for (const addon of allAddons) {
        const success = await restartSingleAddon(addon.id);
        if (success) {
          successCount++;
        }
      }

      if (successCount === allAddons.length) {
        spinner.succeed(chalk.green(`All ${allAddons.length} addon(s) restarted successfully!`));
      } else {
        spinner.warn(
          chalk.yellow(`Restarted ${successCount} of ${allAddons.length} addon(s). Some failed.`)
        );
      }
      return;
    }

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

    const spinner = ora(`Restarting addon '${addon.name}'...`).start();

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

    const serviceName = config.serviceName || getServiceNameFromAddonId(resolvedAddonId);
    const serviceManager = new ServiceManager(serviceName, ssh);
    await serviceManager.restart();

    spinner.succeed(chalk.green(`Addon '${addon.name}' restarted successfully!`));

    if (ssh) {
      await ssh.disconnect();
    }
  } catch (error) {
    logger.error('Failed to restart service', error);
    console.log(chalk.red(`\n❌ ${(error as Error).message}\n`));
    process.exit(1);
  }
}

