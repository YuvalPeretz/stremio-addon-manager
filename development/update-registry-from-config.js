#!/usr/bin/env node

/**
 * Update registry entry to match config file addonId
 */

import { AddonRegistryManager, ConfigManager } from '@stremio-addon-manager/core';
import fs from 'fs';
import yaml from 'js-yaml';

async function updateRegistry() {
  try {
    const registryManager = new AddonRegistryManager();
    await registryManager.initialize();

    const addons = await registryManager.listAddons();
    console.log(`Found ${addons.length} addons in registry\n`);

    for (const addon of addons) {
      console.log(`Processing: ${addon.id}`);
      
      // Read config file directly to get addonId
      const configPath = addon.configPath;
      if (!fs.existsSync(configPath)) {
        console.log(`  ⚠️  Config file not found: ${configPath}\n`);
        continue;
      }

      const configContent = fs.readFileSync(configPath, 'utf-8');
      const config = yaml.load(configContent);
      const configAddonId = config?.addonId;

      console.log(`  Registry ID: ${addon.id}`);
      console.log(`  Config addonId: ${configAddonId}`);

      if (!configAddonId) {
        console.log(`  ⚠️  Config missing addonId, skipping\n`);
        continue;
      }

      if (configAddonId === addon.id) {
        console.log(`  ✓ IDs already match\n`);
        continue;
      }

      console.log(`  🔧 Updating registry entry...`);

      // Delete old entry
      await registryManager.deleteAddon(addon.id);
      console.log(`  ✓ Deleted old entry: ${addon.id}`);

      // Create new entry with correct ID from config
      // Use the registry.create method directly to preserve the exact addonId
      const registry = registryManager.getRegistry();
      await registry.load();

      const newAddon = registry.create({
        id: configAddonId,
        name: config.addon?.name || addon.name,
        slug: (config.addon?.name || addon.name)
          .toLowerCase()
          .trim()
          .replace(/[^\w\s-]/g, "")
          .replace(/[\s_-]+/g, "-")
          .replace(/^-+|-+$/g, ""),
        configPath: configPath,
        serviceName: config.serviceName || `stremio-addon-${configAddonId}`,
        port: config.addon?.port || addon.port || 7000,
        domain: config.addon?.domain || addon.domain,
      });

      await registry.save();
      console.log(`  ✓ Created new entry: ${newAddon.id}\n`);
    }

    // List final state
    const finalAddons = await registryManager.listAddons();
    console.log(`\n📊 Final registry:`);
    for (const addon of finalAddons) {
      console.log(`   - ${addon.id}: ${addon.name}`);
    }

    console.log('\n✅ Registry updated!\n');
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

updateRegistry();
