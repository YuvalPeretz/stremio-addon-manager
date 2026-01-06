/**
 * Config Command
 * Manage addon configuration
 */

import chalk from 'chalk';
import inquirer from 'inquirer';
import { logger, ConfigManager } from '@stremio-addon-manager/core';

interface ConfigOptions {
  show?: boolean;
  edit?: boolean;
  set?: string;
  get?: string;
  reset?: boolean;
}

/**
 * Config command handler
 */
export async function configCommand(options: ConfigOptions): Promise<void> {
  try {
    const configManager = new ConfigManager();

    // Show configuration
    if (options.show) {
      const config = await configManager.load();
      console.log(chalk.bold.cyan('\n⚙️  Current Configuration\n'));
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

