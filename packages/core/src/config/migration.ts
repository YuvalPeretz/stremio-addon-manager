/**
 * Configuration Migration Utility
 * Handles migration from legacy single-addon config to multi-addon registry system
 */

import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { logger } from "../utils/logger.js";
import { ConfigManager } from "./manager.js";
import { AddonRegistry } from "./registry.js";
import { AddonRegistryManager, generateServiceName } from "./registry-manager.js";
import { OSDetector } from "../os/index.js";
import type { AddonManagerConfig } from "./types.js";

const execAsync = promisify(exec);

/**
 * Legacy config path
 */
function getLegacyConfigPath(): string {
  const homeDir = os.homedir();
  return path.join(homeDir, ".stremio-addon-manager", "config.yaml");
}

/**
 * Check if legacy config exists
 */
export async function legacyConfigExists(): Promise<boolean> {
  try {
    await fs.access(getLegacyConfigPath());
    return true;
  } catch {
    return false;
  }
}

/**
 * Migrate legacy config to new multi-addon system
 */
export async function migrateLegacyConfig(): Promise<{ success: boolean; addonId?: string; error?: string }> {
  try {
    // Check if legacy config exists
    if (!(await legacyConfigExists())) {
      logger.info("No legacy config found, skipping migration");
      return { success: true };
    }

    logger.info("Starting migration from legacy config to multi-addon system");

    // Load legacy config
    const legacyManager = new ConfigManager();
    const legacyConfig = await legacyManager.load();

    // Validate legacy config has required fields
    if (!legacyConfig.addon?.name) {
      logger.warn("Legacy config missing addon name, cannot migrate");
      return { success: false, error: "Legacy config missing addon name" };
    }

    // Generate addon ID from name
    const addonName = legacyConfig.addon.name;
    const addonId = addonName
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, "")
      .replace(/[\s_-]+/g, "-")
      .replace(/^-+|-+$/g, "");

    if (!addonId) {
      logger.warn("Could not generate valid addon ID from name", { name: addonName });
      return { success: false, error: "Could not generate valid addon ID from addon name" };
    }

    // Check if addon already exists in registry
    const registry = new AddonRegistry();
    await registry.load();

    // Ensure unique ID
    let finalAddonId = addonId;
    let counter = 1;
    while (registry.exists(finalAddonId)) {
      finalAddonId = `${addonId}-${counter}`;
      counter++;
    }

    logger.info("Migrating legacy config", { addonId: finalAddonId, name: addonName });

    // Create addon directory
    const homeDir = os.homedir();
    const addonDir = path.join(homeDir, ".stremio-addon-manager", "addons", finalAddonId);
    await fs.mkdir(addonDir, { recursive: true });

    // Create new config manager for addon
    const newConfigManager = new ConfigManager(finalAddonId);
    const newConfigPath = newConfigManager.getConfigPath();

    // Copy config and set addonId/serviceName
    const migratedConfig: AddonManagerConfig = {
      ...legacyConfig,
      addonId: finalAddonId,
      serviceName: generateServiceName(finalAddonId),
    };

    // Update paths to be addon-specific
    if (legacyConfig.paths) {
      migratedConfig.paths = {
        addonDirectory: legacyConfig.paths.addonDirectory || `/opt/stremio-addon-${finalAddonId}`,
        nginxConfig: legacyConfig.paths.nginxConfig || `/etc/nginx/sites-available/stremio-addon-${finalAddonId}`,
        serviceFile:
          legacyConfig.paths.serviceFile || `/etc/systemd/system/${migratedConfig.serviceName}.service`,
        logs: legacyConfig.paths.logs || path.join(addonDir, "logs"),
        backups: legacyConfig.paths.backups || path.join(addonDir, "backups"),
        sshKey: legacyConfig.paths.sshKey,
      };
    }

    // Save new config
    await newConfigManager.save(migratedConfig);

    // Register addon in registry
    const registryManager = new AddonRegistryManager(registry);
    await registryManager.initialize();

    let port = legacyConfig.addon.port || 7000;
    const domain = legacyConfig.addon.domain || "";

    // Check for conflicts
    if (registry.portInUse(port)) {
      logger.warn("Port conflict detected during migration", { port, addonId: finalAddonId });
      // Try to find available port
      const availablePort = await registryManager.findAvailablePort(port);
      logger.info("Using alternative port", { originalPort: port, newPort: availablePort });
      port = availablePort;
    }

    if (domain && registry.domainInUse(domain)) {
      logger.warn("Domain conflict detected during migration", { domain, addonId: finalAddonId });
      // Domain conflict - we'll still register but log warning
    }

    // Create registry entry
    registry.create({
      id: finalAddonId,
      name: addonName,
      slug: addonId,
      configPath: newConfigPath,
      serviceName: migratedConfig.serviceName!,
      port,
      domain,
    });

    // Set as default addon
    registry.setDefaultAddonId(finalAddonId);

    // Save registry
    await registry.save();

    // Migrate service name if service exists
    const oldServiceName = "stremio-addon";
    const newServiceName = migratedConfig.serviceName!;
    await migrateServiceName(oldServiceName, newServiceName, migratedConfig);

    // Migrate paths (directories, nginx configs)
    await migratePaths(legacyConfig, migratedConfig, finalAddonId);

    // Backup legacy config
    const backupPath = getLegacyConfigPath() + ".backup";
    try {
      await fs.copyFile(getLegacyConfigPath(), backupPath);
      logger.info("Legacy config backed up", { backupPath });
    } catch (error) {
      logger.warn("Failed to backup legacy config", error);
    }

    // Remove legacy config file after successful migration
    // This ensures legacyConfigExists() returns false after migration
    try {
      await fs.unlink(getLegacyConfigPath());
      logger.info("Legacy config file removed after successful migration", {
        legacyPath: getLegacyConfigPath(),
        backupPath,
      });
    } catch (error) {
      logger.warn("Failed to remove legacy config file after migration", error);
      // Don't fail migration if we can't remove the file - it's backed up anyway
    }

    logger.info("Migration completed successfully", {
      addonId: finalAddonId,
      name: addonName,
      configPath: newConfigPath,
      serviceName: newServiceName,
    });

    return { success: true, addonId: finalAddonId };
  } catch (error) {
    logger.error("Migration failed", error);
    return { success: false, error: (error as Error).message };
  }
}

/**
 * Migrate service name from old to new
 */
async function migrateServiceName(
  oldServiceName: string,
  newServiceName: string,
  config: AddonManagerConfig
): Promise<void> {
  try {
    // Only migrate on Linux (systemd)
    const systemInfo = OSDetector.detect();
    if (systemInfo.os !== "linux") {
      logger.info("Service migration only supported on Linux, skipping");
      return;
    }

    // Check if old service exists
    try {
      const { stdout } = await execAsync(`systemctl list-units --type=service --no-legend ${oldServiceName}.service`);
      if (!stdout.trim()) {
        logger.info("Old service does not exist, skipping service migration");
        return;
      }
    } catch {
      logger.info("Old service does not exist, skipping service migration");
      return;
    }

    logger.info("Migrating service name", { oldServiceName, newServiceName });

    // Stop old service
    try {
      await execAsync(`sudo systemctl stop ${oldServiceName}`);
      logger.info("Stopped old service");
    } catch (error) {
      logger.warn("Failed to stop old service (may not be running)", error);
    }

    // Disable old service
    try {
      await execAsync(`sudo systemctl disable ${oldServiceName}`);
      logger.info("Disabled old service");
    } catch (error) {
      logger.warn("Failed to disable old service", error);
    }

    // Read old service file
    const oldServiceFile = `/etc/systemd/system/${oldServiceName}.service`;
    let serviceContent: string;
    try {
      serviceContent = await fs.readFile(oldServiceFile, "utf-8");
    } catch (error) {
      logger.warn("Could not read old service file, creating new one", error);
      // Service file doesn't exist, skip migration
      return;
    }

    // Update service content with new name and paths
    const newServiceContent = serviceContent
      .replace(new RegExp(oldServiceName, "g"), newServiceName)
      .replace(/Description=.*/g, `Description=Stremio Private Addon: ${config.addon.name}`);

    // Write new service file
    const newServiceFile = config.paths?.serviceFile || `/etc/systemd/system/${newServiceName}.service`;
    await fs.writeFile(newServiceFile, newServiceContent, "utf-8");
    logger.info("Created new service file", { newServiceFile });

    // Reload systemd
    await execAsync("sudo systemctl daemon-reload");
    logger.info("Reloaded systemd daemon");

    // Enable and start new service
    try {
      await execAsync(`sudo systemctl enable ${newServiceName}`);
      await execAsync(`sudo systemctl start ${newServiceName}`);
      logger.info("Enabled and started new service");
    } catch (error) {
      logger.warn("Failed to enable/start new service", error);
    }

    // Remove old service file (optional, keep as backup)
    // await execAsync(`sudo rm ${oldServiceFile}`);
    logger.info("Service migration completed");
  } catch (error) {
    logger.error("Service migration failed", error);
    // Don't fail entire migration if service migration fails
  }
}

/**
 * Migrate paths (directories, nginx configs)
 */
async function migratePaths(
  oldConfig: AddonManagerConfig,
  newConfig: AddonManagerConfig,
  addonId: string
): Promise<void> {
  const newServiceName = newConfig.serviceName!;
  try {
    const systemInfo = OSDetector.detect();
    if (systemInfo.os !== "linux") {
      logger.info("Path migration only supported on Linux, skipping");
      return;
    }

    // Migrate addon directory if it exists
    const oldAddonDir = oldConfig.paths?.addonDirectory || "/opt/stremio-addon";
    const newAddonDir = newConfig.paths?.addonDirectory || `/opt/stremio-addon-${addonId}`;

    if (oldAddonDir !== newAddonDir) {
      try {
        // Check if old directory exists
        await fs.access(oldAddonDir);
        logger.info("Migrating addon directory", { oldAddonDir, newAddonDir });

        // Move directory (requires sudo)
        await execAsync(`sudo mv ${oldAddonDir} ${newAddonDir}`);
        logger.info("Moved addon directory");
      } catch (error) {
        logger.warn("Could not migrate addon directory (may not exist)", error);
      }
    }

    // Migrate nginx config if it exists
    const oldNginxConfig = oldConfig.paths?.nginxConfig || "/etc/nginx/sites-available/stremio-addon";
    const newNginxConfig = newConfig.paths?.nginxConfig || `/etc/nginx/sites-available/stremio-addon-${addonId}`;

    if (oldNginxConfig !== newNginxConfig) {
      try {
        // Check if old nginx config exists
        await fs.access(oldNginxConfig);
        logger.info("Migrating nginx config", { oldNginxConfig, newNginxConfig });

        // Read old config
        let nginxContent = await fs.readFile(oldNginxConfig, "utf-8");

        // Update service name references in nginx config
        nginxContent = nginxContent.replace(/stremio-addon/g, newServiceName);

        // Write new config
        await fs.writeFile(newNginxConfig, nginxContent, "utf-8");
        logger.info("Created new nginx config");

        // Update symlink in sites-enabled
        const oldSymlink = `/etc/nginx/sites-enabled/stremio-addon`;
        const newSymlink = `/etc/nginx/sites-enabled/${newServiceName}`;

        try {
          // Remove old symlink
          await execAsync(`sudo rm ${oldSymlink}`);
        } catch {
          // Symlink may not exist
        }

        // Create new symlink
        await execAsync(`sudo ln -s ${newNginxConfig} ${newSymlink}`);
        logger.info("Updated nginx symlink");

        // Test and reload nginx
        try {
          await execAsync("sudo nginx -t");
          await execAsync("sudo systemctl reload nginx");
          logger.info("Reloaded nginx");
        } catch (error) {
          logger.warn("Failed to reload nginx", error);
        }
      } catch (error) {
        logger.warn("Could not migrate nginx config (may not exist)", error);
      }
    }

    logger.info("Path migration completed");
  } catch (error) {
    logger.error("Path migration failed", error);
    // Don't fail entire migration if path migration fails
  }
}

/**
 * Auto-migrate legacy config if it exists
 * Called automatically on first load
 */
export async function autoMigrateIfNeeded(): Promise<string | undefined> {
  try {
    if (await legacyConfigExists()) {
      logger.info("Legacy config detected, attempting auto-migration");
      const result = await migrateLegacyConfig();
      if (result.success && result.addonId) {
        logger.info("Auto-migration successful", { addonId: result.addonId });
        return result.addonId;
      } else {
        logger.warn("Auto-migration failed", { error: result.error });
      }
    }
  } catch (error) {
    logger.error("Auto-migration error", error);
  }
  return undefined;
}
