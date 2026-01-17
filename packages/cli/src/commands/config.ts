/**
 * Config Command
 * Manage addon configuration
 */

import chalk from 'chalk';
import inquirer from 'inquirer';
import {
  logger,
  ConfigManager,
  AddonRegistryManager,
  generateServiceName,
} from '@stremio-addon-manager/core';
import { resolveAddonId, listAddons, getAddonMetadata, getConfigManagerForAddon } from '../utils/addon-resolver.js';

interface ConfigOptions {
  addon?: string;
  show?: boolean;
  edit?: boolean;
  set?: string;
  get?: string;
  reset?: boolean;
  listAddons?: boolean;
  createAddon?: string;
  deleteAddon?: string;
  switchAddon?: string;
}

/**
 * Config command handler
 */
export async function configCommand(options: ConfigOptions): Promise<void> {
  try {
    // Handle addon management subcommands
    if (options.listAddons) {
      await listAddons();
      return;
    }

    if (options.createAddon) {
      const registryManager = new AddonRegistryManager();
      await registryManager.initialize();

      // Check if name is available
      if (!(await registryManager.isNameAvailable(options.createAddon))) {
        console.log(chalk.red(`\n❌ Addon name '${options.createAddon}' is already in use.\n`));
        process.exit(1);
      }

      // Prompt for port and domain
      const { port, domain } = await inquirer.prompt([
        {
          type: 'number',
          name: 'port',
          message: 'Enter port number:',
          default: 7000,
          validate: async (value) => {
            if (!(await registryManager.isPortAvailable(value))) {
              return `Port ${value} is already in use`;
            }
            return true;
          },
        },
        {
          type: 'input',
          name: 'domain',
          message: 'Enter domain:',
          validate: async (value) => {
            if (!value) {
              return 'Domain is required';
            }
            if (!(await registryManager.isDomainAvailable(value))) {
              return `Domain '${value}' is already in use`;
            }
            return true;
          },
        },
      ]);

      // Generate addon ID
      const addonId = options.createAddon
        .toLowerCase()
        .trim()
        .replace(/[^\w\s-]/g, '')
        .replace(/[\s_-]+/g, '-')
        .replace(/^-+|-+$/g, '');

      // Ensure unique ID
      let finalAddonId = addonId;
      let counter = 1;
      const registry = registryManager.getRegistry();
      await registry.load();
      while (registry.exists(finalAddonId)) {
        finalAddonId = `${addonId}-${counter}`;
        counter++;
      }

      // Create config
      const configManager = getConfigManagerForAddon(finalAddonId);
      const config = configManager.reset();
      config.addonId = finalAddonId;
      config.serviceName = generateServiceName(finalAddonId);
      config.addon.name = options.createAddon;
      config.addon.port = port;
      config.addon.domain = domain;
      await configManager.save();

      // Register in registry
      await registryManager.createAddon(options.createAddon, port, domain, configManager.getConfigPath());

      console.log(chalk.green(`\n✅ Addon '${options.createAddon}' created with ID '${finalAddonId}'\n`));
      return;
    }

    if (options.deleteAddon) {
      const { confirm } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'confirm',
          message: `Are you sure you want to delete addon '${options.deleteAddon}'? This will remove the addon from the registry but not uninstall it.`,
          default: false,
        },
      ]);

      if (!confirm) {
        console.log(chalk.yellow('\n⚠️  Deletion cancelled\n'));
        return;
      }

      const registryManager = new AddonRegistryManager();
      await registryManager.initialize();
      const deleted = await registryManager.deleteAddon(options.deleteAddon);

      if (deleted) {
        console.log(chalk.green(`\n✅ Addon '${options.deleteAddon}' deleted from registry\n`));
      } else {
        console.log(chalk.red(`\n❌ Addon '${options.deleteAddon}' not found\n`));
        process.exit(1);
      }
      return;
    }

    if (options.switchAddon) {
      const registryManager = new AddonRegistryManager();
      await registryManager.initialize();
      await registryManager.setDefaultAddon(options.switchAddon);

      const addon = await getAddonMetadata(options.switchAddon);
      if (addon) {
        console.log(chalk.green(`\n✅ Default addon set to '${addon.name}' (${options.switchAddon})\n`));
      } else {
        console.log(chalk.green(`\n✅ Default addon set to '${options.switchAddon}'\n`));
      }
      return;
    }

    // Resolve addon ID for other operations
    const resolvedAddonId = await resolveAddonId(options.addon);
    const configManager = resolvedAddonId
      ? getConfigManagerForAddon(resolvedAddonId)
      : new ConfigManager();

    // Show configuration
    if (options.show) {
      const config = await configManager.load();
      const addonInfo = resolvedAddonId ? await getAddonMetadata(resolvedAddonId) : null;
      console.log(chalk.bold.cyan(`\n⚙️  Configuration${addonInfo ? `: ${addonInfo.name}` : ''}\n`));
      console.log(JSON.stringify(config, null, 2));
      console.log();
      return;
    }

    // Get a specific value
    if (options.get) {
      await configManager.load();
      const value = configManager.getNestedValue(options.get);
      console.log(chalk.cyan(`\n${options.get}:`), value, '\n');
      return;
    }

    // Set a specific value
    if (options.set) {
      const [key, ...valueParts] = options.set.split('=');
      const value = valueParts.join('=');

      if (!key || !value) {
        console.log(chalk.red('\n❌ Invalid format. Use: --set key=value\n'));
        process.exit(1);
      }

      await configManager.load();
      configManager.setNestedValue(key, value);
      await configManager.save();

      console.log(chalk.green(`\n✅ Configuration updated: ${key} = ${value}\n`));
      return;
    }

    // Reset configuration
    if (options.reset) {
      const { confirm } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'confirm',
          message: 'Are you sure you want to reset configuration to defaults?',
          default: false,
        },
      ]);

      if (confirm) {
        configManager.reset();
        if (resolvedAddonId) {
          const config = configManager.get();
          config.addonId = resolvedAddonId;
          config.serviceName = generateServiceName(resolvedAddonId);
        }
        await configManager.save();
        console.log(chalk.green('\n✅ Configuration reset to defaults\n'));
      } else {
        console.log(chalk.yellow('\n⚠️  Reset cancelled\n'));
      }
      return;
    }

    // Edit interactively
    if (options.edit) {
      console.log(chalk.yellow('\n⚠️  Interactive edit not yet implemented\n'));
      return;
    }

    // No options provided
    console.log(chalk.yellow('\n⚠️  No action specified. Use --help for options.\n'));
  } catch (error) {
    logger.error('Config command failed', error);
    console.log(chalk.red(`\n❌ ${(error as Error).message}\n`));
    process.exit(1);
  }
}

