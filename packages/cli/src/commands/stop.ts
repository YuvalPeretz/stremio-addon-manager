/**
 * Stop Command
 * Stop the addon service(s)
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

interface StopOptions {
  addon?: string;
  all?: boolean;
  remote?: boolean;
}

/**
 * Stop a single addon
 */
async function stopSingleAddon(addonId: string, ssh?: SSHManager): Promise<boolean> {
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
    await serviceManager.stop();

    if (!ssh && sshConnection) {
      await sshConnection.disconnect();
    }

    return true;
  } catch (error) {
    logger.error(`Failed to stop addon ${addonId}`, error);
    return false;
  }
}

/**
 * Stop command handler
 */
export async function stopCommand(options: StopOptions): Promise<void> {
  try {
    if (options.all) {
      const registryManager = new AddonRegistryManager();
      await registryManager.initialize();
      const allAddons = await registryManager.listAddons();

      if (allAddons.length === 0) {
        console.log(chalk.yellow('\n⚠️  No addons found.\n'));
        return;
      }

      const spinner = ora(`Stopping ${allAddons.length} addon(s)...`).start();
      let successCount = 0;

      for (const addon of allAddons) {
        const success = await stopSingleAddon(addon.id);
        if (success) {
          successCount++;
        }
      }

      if (successCount === allAddons.length) {
        spinner.succeed(chalk.green(`All ${allAddons.length} addon(s) stopped successfully!`));
      } else {
        spinner.warn(
          chalk.yellow(`Stopped ${successCount} of ${allAddons.length} addon(s). Some failed.`)
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

    const spinner = ora(`Stopping addon '${addon.name}'...`).start();

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
    await serviceManager.stop();

    spinner.succeed(chalk.green(`Addon '${addon.name}' stopped successfully!`));

    if (ssh) {
      await ssh.disconnect();
    }
  } catch (error) {
    logger.error('Failed to stop service', error);
    console.log(chalk.red(`\n❌ ${(error as Error).message}\n`));
    process.exit(1);
  }
}

