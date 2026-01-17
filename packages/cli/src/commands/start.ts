/**
 * Start Command
 * Start the addon service(s)
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

interface StartOptions {
  addon?: string;
  all?: boolean;
  remote?: boolean;
}

/**
 * Start a single addon
 */
async function startSingleAddon(addonId: string, ssh?: SSHManager): Promise<boolean> {
  try {
    const addon = await getAddonMetadata(addonId);
    if (!addon) {
      console.log(chalk.red(`\n❌ Addon '${addonId}' not found.\n`));
      return false;
    }

    const configManager = new ConfigManager(addonId);
    const config = await configManager.load();

    // Setup SSH connection if needed
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
    await serviceManager.start();

    // Disconnect if we created the connection
    if (!ssh && sshConnection) {
      await sshConnection.disconnect();
    }

    return true;
  } catch (error) {
    logger.error(`Failed to start addon ${addonId}`, error);
    return false;
  }
}

/**
 * Start command handler
 */
export async function startCommand(options: StartOptions): Promise<void> {
  try {
    if (options.all) {
      // Start all addons
      const registryManager = new AddonRegistryManager();
      await registryManager.initialize();
      const allAddons = await registryManager.listAddons();

      if (allAddons.length === 0) {
        console.log(chalk.yellow('\n⚠️  No addons found.\n'));
        return;
      }

      const spinner = ora(`Starting ${allAddons.length} addon(s)...`).start();
      let successCount = 0;

      for (const addon of allAddons) {
        const success = await startSingleAddon(addon.id);
        if (success) {
          successCount++;
        }
      }

      if (successCount === allAddons.length) {
        spinner.succeed(chalk.green(`All ${allAddons.length} addon(s) started successfully!`));
      } else {
        spinner.warn(
          chalk.yellow(`Started ${successCount} of ${allAddons.length} addon(s). Some failed.`)
        );
      }
      return;
    }

    // Start single addon
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

    const spinner = ora(`Starting addon '${addon.name}'...`).start();

    const configManager = new ConfigManager(resolvedAddonId);
    const config = await configManager.load();

    // Setup SSH connection if needed
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

    // Start service
    const serviceName = config.serviceName || getServiceNameFromAddonId(resolvedAddonId);
    const serviceManager = new ServiceManager(serviceName, ssh);
    await serviceManager.start();

    spinner.succeed(chalk.green(`Addon '${addon.name}' started successfully!`));

    // Cleanup
    if (ssh) {
      await ssh.disconnect();
    }
  } catch (error) {
    logger.error('Failed to start service', error);
    console.log(chalk.red(`\n❌ ${(error as Error).message}\n`));
    process.exit(1);
  }
}

