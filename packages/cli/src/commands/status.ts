/**
 * Status Command
 * Check the status of the addon service(s)
 */

import chalk from 'chalk';
import {
  logger,
  ConfigManager,
  ServiceManager,
  SSHManager,
  ServiceStatus,
  AddonRegistryManager,
  getServiceNameFromAddonId,
} from '@stremio-addon-manager/core';
import { resolveAddonId, getAddonMetadata } from '../utils/addon-resolver.js';

interface StatusOptions {
  addon?: string;
  remote?: boolean;
}

/**
 * Get status for a single addon
 */
async function getAddonStatus(
  addonId: string,
  ssh?: SSHManager
): Promise<{ addonId: string; name: string; status: any; config: any } | null> {
  try {
    const addon = await getAddonMetadata(addonId);
    if (!addon) {
      return null;
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
    const serviceInfo = await serviceManager.status();

    // Disconnect if we created the connection
    if (!ssh && sshConnection) {
      await sshConnection.disconnect();
    }

    return {
      addonId,
      name: addon.name,
      status: serviceInfo,
      config,
    };
  } catch (error) {
    logger.error(`Failed to get status for addon ${addonId}`, error);
    return null;
  }
}

/**
 * Status command handler
 */
export async function statusCommand(options: StatusOptions): Promise<void> {
  try {
    const resolvedAddonId = await resolveAddonId(options.addon);

    // If no addon resolved, show all addons
    if (!resolvedAddonId) {
      const registryManager = new AddonRegistryManager();
      await registryManager.initialize();
      const allAddons = await registryManager.listAddons();

      if (allAddons.length === 0) {
        console.log(chalk.yellow('\n⚠️  No addons found.\n'));
        return;
      }

      console.log(chalk.bold.cyan('\n📊 Addon Service Status (All Addons)\n'));
      console.log(chalk.gray('─'.repeat(100)));

      // Table header
      console.log(
        `${chalk.bold('Name')}${' '.repeat(20)}${chalk.bold('ID')}${' '.repeat(25)}${chalk.bold('Status')}${' '.repeat(8)}${chalk.bold('Port')}${' '.repeat(6)}${chalk.bold('Domain')}`
      );
      console.log(chalk.gray('─'.repeat(100)));

      // Get status for each addon
      for (const addon of allAddons) {
        const statusData = await getAddonStatus(addon.id);
        if (!statusData) {
          const namePadding = ' '.repeat(Math.max(1, 25 - addon.name.length));
          const idPadding = ' '.repeat(Math.max(1, 30 - addon.id.length));
          console.log(
            `${addon.name}${namePadding}${chalk.cyan(addon.id)}${idPadding}${chalk.red('ERROR')}${' '.repeat(10)}${chalk.yellow(addon.port.toString())}${' '.repeat(6)}${chalk.blue(addon.domain)}`
          );
          continue;
        }

        const statusColor =
          statusData.status.status === ServiceStatus.ACTIVE
            ? chalk.green
            : statusData.status.status === ServiceStatus.FAILED
            ? chalk.red
            : chalk.yellow;

        const namePadding = ' '.repeat(Math.max(1, 25 - statusData.name.length));
        const idPadding = ' '.repeat(Math.max(1, 30 - statusData.addonId.length));
        const statusPadding = ' '.repeat(Math.max(1, 13 - statusData.status.status.length));
        const portPadding = ' '.repeat(Math.max(1, 10 - addon.port.toString().length));

        console.log(
          `${statusData.name}${namePadding}${chalk.cyan(statusData.addonId)}${idPadding}${statusColor(statusData.status.status)}${statusPadding}${chalk.yellow(addon.port.toString())}${portPadding}${chalk.blue(addon.domain)}`
        );
      }

      console.log(chalk.gray('─'.repeat(100)));
      console.log();
      return;
    }

    // Single addon status
    const addon = await getAddonMetadata(resolvedAddonId);
    if (!addon) {
      console.log(chalk.red(`\n❌ Addon '${resolvedAddonId}' not found.\n`));
      process.exit(1);
    }

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

    // Create service manager
    const serviceName = config.serviceName || getServiceNameFromAddonId(resolvedAddonId);
    const serviceManager = new ServiceManager(serviceName, ssh);
    const serviceInfo = await serviceManager.status();

    // Display status
    console.log(chalk.bold.cyan(`\n📊 Addon Service Status: ${addon.name}\n`));
    console.log(chalk.gray('─'.repeat(50)));
    console.log(`Addon ID:  ${chalk.cyan(resolvedAddonId)}`);
    console.log(`Name:      ${chalk.cyan(addon.name)}`);

    const statusColor =
      serviceInfo.status === ServiceStatus.ACTIVE
        ? chalk.green
        : serviceInfo.status === ServiceStatus.FAILED
        ? chalk.red
        : chalk.yellow;

    console.log(`Status:    ${statusColor(serviceInfo.status)}`);
    console.log(`Enabled:   ${serviceInfo.enabled ? chalk.green('Yes') : chalk.red('No')}`);

    if (serviceInfo.uptime) {
      console.log(`Uptime:    ${chalk.cyan(serviceInfo.uptime)}`);
    }
    if (serviceInfo.memory) {
      console.log(`Memory:    ${chalk.cyan(serviceInfo.memory)}`);
    }
    if (serviceInfo.cpu) {
      console.log(`CPU:       ${chalk.cyan(serviceInfo.cpu)}`);
    }
    if (serviceInfo.pid) {
      console.log(`PID:       ${chalk.cyan(serviceInfo.pid)}`);
    }

    console.log(chalk.gray('─'.repeat(50)));
    const protocol = config.features.ssl ? 'https' : 'http';
    console.log(`\nAddon URL: ${chalk.blue.underline(`${protocol}://${config.addon.domain}`)}\n`);

    // Cleanup
    if (ssh) {
      await ssh.disconnect();
    }
  } catch (error) {
    logger.error('Failed to get status', error);
    console.log(chalk.red(`\n❌ Failed to get status: ${(error as Error).message}\n`));
    process.exit(1);
  }
}

