/**
 * Switch Command
 * Set the default addon
 */

import chalk from 'chalk';
import { logger, AddonRegistryManager } from '@stremio-addon-manager/core';
import { getAddonMetadata } from '../utils/addon-resolver.js';

/**
 * Switch command handler
 */
export async function switchCommand(addonId: string): Promise<void> {
  try {
    if (!addonId) {
      console.log(chalk.red('\n❌ Addon ID is required.\n'));
      console.log(chalk.yellow('Usage: stremio-addon-manager switch <addonId>\n'));
      process.exit(1);
    }

    const addon = await getAddonMetadata(addonId);
    if (!addon) {
      console.log(chalk.red(`\n❌ Addon '${addonId}' not found.\n`));
      process.exit(1);
    }

    const registryManager = new AddonRegistryManager();
    await registryManager.initialize();
    await registryManager.setDefaultAddon(addonId);

    console.log(chalk.green(`\n✅ Default addon set to '${addon.name}' (${addonId})\n`));
  } catch (error) {
    logger.error('Failed to switch addon', error);
    console.log(chalk.red(`\n❌ Failed to switch addon: ${(error as Error).message}\n`));
    process.exit(1);
  }
}
