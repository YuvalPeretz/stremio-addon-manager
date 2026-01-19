#!/usr/bin/env node

/**
 * Fix registry ID mismatch
 * Updates the registry entry to use the correct addonId from config
 */

import { AddonRegistryManager, ConfigManager } from '@stremio-addon-manager/core';
import fs from 'fs';

async function fixRegistry() {
  try {
    const registryManager = new AddonRegistryManager();
    await registryManager.initialize();

    // Get all addons
    const addons = await registryManager.listAddons();
    console.log(`Found ${addons.length} addons in registry\n`);

    for (const addon of addons) {
      console.log(`Checking addon: ${addon.id}`);
      console.log(`  Config path: ${addon.configPath}`);

      // Load config to get the actual addonId
      const configPath = addon.configPath;
      if (fs.existsSync(configPath)) {
        const configManager = new ConfigManager(undefined, configPath);
        const config = await configManager.load();
        
        console.log(`  Config addonId: ${config.addonId}`);
        console.log(`  Registry addonId: ${addon.id}`);

        if (config.addonId && config.addonId !== addon.id) {
          console.log(`  ⚠️  Mismatch detected! Fixing...`);
          
          // Delete old entry
          await registryManager.deleteAddon(addon.id);
          console.log(`  ✓ Deleted old registry entry: ${addon.id}`);

          // Create new entry with correct ID
          const newAddon = await registryManager.createAddon(
            config.addon.name,
            config.addon.port || 7000,
            config.addon.domain,
            configPath
          );
          console.log(`  ✓ Created new registry entry: ${newAddon.id}`);
        } else {
          console.log(`  ✓ IDs match`);
        }
      } else {
        console.log(`  ⚠️  Config file not found: ${configPath}`);
      }
      console.log('');
    }

    // List final state
    const finalAddons = await registryManager.listAddons();
    console.log(`\n📊 Final registry state:`);
    for (const addon of finalAddons) {
      console.log(`   - ${addon.id}: ${addon.name} (${addon.domain}:${addon.port})`);
    }

    console.log('\n✅ Registry fix complete!\n');
  } catch (error) {
    console.error('❌ Error:', error instanceof Error ? error.message : String(error));
    console.error(error);
    process.exit(1);
  }
}

fixRegistry();
