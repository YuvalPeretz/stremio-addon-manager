#!/usr/bin/env node

/**
 * Manual addon registration script
 * Registers an addon from its config file into the registry
 * Usage: node manual-register-addon.js <addon-id>
 */

import { AddonRegistryManager, ConfigManager } from '@stremio-addon-manager/core';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const addonId = process.argv[2];

if (!addonId) {
  console.error('Usage: node manual-register-addon.js <addon-id>');
  console.error('\nAvailable addon IDs:');
  const { ConfigManager } = await import('@stremio-addon-manager/core');
  const configPaths = await ConfigManager.listAddonConfigs();
  for (const configPath of configPaths) {
    const parts = configPath.split(/[/\\]/);
    const id = parts[parts.length - 2];
    console.error(`  - ${id}`);
  }
  process.exit(1);
}

try {
  console.log(`\n📋 Registering addon: ${addonId}\n`);

  // Load config
  const configManager = new ConfigManager(addonId);
  const config = await configManager.load();
  
  console.log('Config loaded:', {
    addonId: config.addonId,
    name: config.addon?.name,
    domain: config.addon?.domain,
    port: config.addon?.port,
    serviceName: config.serviceName,
  });

  if (!config.addonId) {
    console.error('❌ Error: Config missing addonId');
    process.exit(1);
  }

  if (!config.addon?.name) {
    console.error('❌ Error: Config missing addon.name');
    process.exit(1);
  }

  // Register addon
  const registryManager = new AddonRegistryManager();
  await registryManager.initialize();

  // Check if already exists
  const existing = await registryManager.getAddon(addonId);
  if (existing) {
    console.log('⚠️  Addon already exists in registry');
    console.log('   Updating...');
    await registryManager.updateAddon(addonId, {
      name: config.addon.name,
      port: config.addon.port,
      domain: config.addon.domain,
    });
    console.log('✅ Addon updated in registry');
  } else {
    const configPath = ConfigManager.getConfigPathForAddon(addonId);
    const addon = await registryManager.createAddon(
      config.addon.name,
      config.addon.port || 7000,
      config.addon.domain,
      configPath
    );
    console.log('✅ Addon registered successfully:', addon);
  }

  // List all addons
  const allAddons = await registryManager.listAddons();
  console.log(`\n📊 Total addons in registry: ${allAddons.length}`);
  for (const addon of allAddons) {
    console.log(`   - ${addon.id}: ${addon.name} (${addon.domain}:${addon.port})`);
  }

  console.log('\n✅ Registration complete!\n');
} catch (error) {
  console.error('❌ Error:', error instanceof Error ? error.message : String(error));
  console.error(error);
  process.exit(1);
}
