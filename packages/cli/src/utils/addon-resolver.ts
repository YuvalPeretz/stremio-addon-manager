/**
 * Addon Resolver Utility
 * Handles addon ID resolution, selection, and listing
 */

import inquirer from 'inquirer';
import chalk from 'chalk';
import {
  AddonRegistryManager,
  ConfigManager,
  getServiceNameFromAddonId,
  legacyConfigExists,
  migrateLegacyConfig,
  type AddonMetadata,
} from '@stremio-addon-manager/core';

/**
 * Check and handle migration if needed
 */
export async function checkAndMigrateIfNeeded(): Promise<{ migrated: boolean; addonId?: string }> {
  if (await legacyConfigExists()) {
    console.log(chalk.yellow('\n⚠️  Legacy configuration detected.'));
    console.log(chalk.cyan('Migrating to multi-addon system...\n'));

    const result = await migrateLegacyConfig();
    if (result.success && result.addonId) {
      console.log(chalk.green(`✅ Migration completed successfully!`));
      console.log(chalk.cyan(`   Addon ID: ${result.addonId}`));
      console.log(chalk.cyan(`   Your addon has been migrated to the new multi-addon system.\n`));
      return { migrated: true, addonId: result.addonId };
    } else {
      console.log(chalk.red(`❌ Migration failed: ${result.error || 'Unknown error'}\n`));
      return { migrated: false };
    }
  }
  return { migrated: false };
}

/**
 * Resolve addon ID from options or prompt user
 * @param addonId Optional addon ID from command line
 * @param allowAll Whether to allow 'all' as a special value
 * @returns Addon ID or 'all' if allowed, or undefined if cancelled
 */
export async function resolveAddonId(
  addonId?: string,
  allowAll: boolean = false
): Promise<string | 'all' | undefined> {
  // Check for migration first
  await checkAndMigrateIfNeeded();

  const registryManager = new AddonRegistryManager();
  await registryManager.initialize();

  const allAddons = await registryManager.listAddons();

  // If 'all' is requested and allowed
  if (addonId === 'all' && allowAll) {
    if (allAddons.length === 0) {
      console.log(chalk.yellow('\n⚠️  No addons found.\n'));
      return undefined;
    }
    return 'all';
  }

  // If specific addon ID provided
  if (addonId) {
    const addon = await registryManager.getAddon(addonId);
    if (!addon) {
      console.log(chalk.red(`\n❌ Addon '${addonId}' not found.\n`));
      console.log(chalk.yellow('Available addons:'));
      if (allAddons.length === 0) {
        console.log(chalk.gray('  (none)'));
      } else {
        allAddons.forEach((a) => {
          console.log(chalk.cyan(`  - ${a.id} (${a.name})`));
        });
      }
      console.log();
      return undefined;
    }
    return addonId;
  }

  // No addon specified - try to find default or prompt
  if (allAddons.length === 0) {
    // No addons in registry - check for legacy config
    const legacyManager = new ConfigManager();
    const legacyExists = await legacyManager.exists();
    if (legacyExists) {
      // Legacy config exists - return undefined to use legacy mode
      return undefined;
    }
    console.log(chalk.yellow('\n⚠️  No addons found. Use --addon <id> or install a new addon.\n'));
    return undefined;
  }

  // Get default addon
  const defaultAddon = await registryManager.getDefaultAddon();
  if (defaultAddon) {
    return defaultAddon.id;
  }

  // No default set - if only one addon, use it
  if (allAddons.length === 1) {
    return allAddons[0].id;
  }

  // Multiple addons - prompt user
  const { selectedAddon } = await inquirer.prompt([
    {
      type: 'list',
      name: 'selectedAddon',
      message: 'Select an addon:',
      choices: allAddons.map((addon) => ({
        name: `${addon.name} (${addon.id}) - Port: ${addon.port}, Domain: ${addon.domain}`,
        value: addon.id,
      })),
    },
  ]);

  return selectedAddon;
}

/**
 * Get addon metadata by ID
 */
export async function getAddonMetadata(addonId: string): Promise<AddonMetadata | undefined> {
  const registryManager = new AddonRegistryManager();
  await registryManager.initialize();
  return await registryManager.getAddon(addonId);
}

/**
 * List all addons in a formatted table
 */
export async function listAddons(): Promise<void> {
  const registryManager = new AddonRegistryManager();
  await registryManager.initialize();

  const allAddons = await registryManager.listAddons();
  const defaultAddon = await registryManager.getDefaultAddon();

  if (allAddons.length === 0) {
    console.log(chalk.yellow('\n⚠️  No addons found.\n'));
    return;
  }

  console.log(chalk.bold.cyan('\n📦 Installed Addons\n'));
  console.log(chalk.gray('─'.repeat(100)));

  // Table header
  console.log(
    `${chalk.bold('Name')}${' '.repeat(20)}${chalk.bold('ID')}${' '.repeat(25)}${chalk.bold('Status')}${' '.repeat(8)}${chalk.bold('Port')}${' '.repeat(6)}${chalk.bold('Domain')}`
  );
  console.log(chalk.gray('─'.repeat(100)));

  // Table rows
  for (const addon of allAddons) {
    const isDefault = defaultAddon?.id === addon.id;
    const name = isDefault ? `${addon.name} ${chalk.gray('(default)')}` : addon.name;
    const namePadding = ' '.repeat(Math.max(1, 25 - name.length));
    const idPadding = ' '.repeat(Math.max(1, 30 - addon.id.length));
    const statusPadding = ' '.repeat(Math.max(1, 13 - addon.port.toString().length));
    const portPadding = ' '.repeat(Math.max(1, 10 - addon.port.toString().length));

    console.log(
      `${name}${namePadding}${chalk.cyan(addon.id)}${idPadding}${chalk.gray('N/A')}${statusPadding}${chalk.yellow(addon.port.toString())}${portPadding}${chalk.blue(addon.domain)}`
    );
  }

  console.log(chalk.gray('─'.repeat(100)));
  console.log();
}

/**
 * Get service name for an addon ID
 */
export function getServiceNameForAddon(addonId: string): string {
  return getServiceNameFromAddonId(addonId);
}

/**
 * Get config manager for a specific addon
 */
export function getConfigManagerForAddon(addonId: string): ConfigManager {
  return new ConfigManager(addonId);
}
