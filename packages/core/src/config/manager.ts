/**
 * Configuration Manager
 * Handles loading, saving, and managing configuration files
 */

import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import yaml from "js-yaml";
import { logger } from "../utils/logger.js";
import type { AddonManagerConfig } from "./types.js";
import { DEFAULT_CONFIG, InstallationType, AccessMethod } from "./types.js";
import { generateServiceName } from "./registry-manager.js";
import { autoMigrateIfNeeded, legacyConfigExists } from "./migration.js";
import { ServiceManager } from "../service/manager.js";

/**
 * Configuration Manager class
 */
export class ConfigManager {
  private config: AddonManagerConfig | null = null;
  private configPath: string;
  private addonId?: string;

  /**
   * Create a new ConfigManager instance
   * @param addonId Optional addon ID for addon-specific config
   * @param configPath Optional path to configuration file (overrides addonId-based path)
   */
  constructor(addonId?: string, configPath?: string) {
    this.addonId = addonId;

    if (configPath) {
      this.configPath = configPath;
    } else if (addonId) {
      // Addon-specific config path
      const homeDir = os.homedir();
      this.configPath = path.join(homeDir, ".stremio-addon-manager", "addons", addonId, "config.yaml");
    } else {
      // Legacy config path (backward compatibility)
      const homeDir = os.homedir();
      this.configPath = path.join(homeDir, ".stremio-addon-manager", "config.yaml");
    }
  }

  /**
   * Get the configuration file path
   */
  public getConfigPath(): string {
    return this.configPath;
  }

  /**
   * Get the addon ID (if set)
   */
  public getAddonId(): string | undefined {
    return this.addonId;
  }

  /**
   * Get config path for a specific addon ID
   */
  public static getConfigPathForAddon(addonId: string): string {
    const homeDir = os.homedir();
    return path.join(homeDir, ".stremio-addon-manager", "addons", addonId, "config.yaml");
  }

  /**
   * List all addon config paths
   */
  public static async listAddonConfigs(): Promise<string[]> {
    const homeDir = os.homedir();
    const addonsDir = path.join(homeDir, ".stremio-addon-manager", "addons");

    try {
      const entries = await fs.readdir(addonsDir, { withFileTypes: true });
      const configPaths: string[] = [];

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const configPath = path.join(addonsDir, entry.name, "config.yaml");
          try {
            await fs.access(configPath);
            configPaths.push(configPath);
          } catch {
            // Config file doesn't exist, skip
          }
        }
      }

      return configPaths;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw error;
    }
  }

  /**
   * Load configuration from file
   * If addonId is set, ensures addonId and serviceName are set in config
   * If no addonId is provided and legacy config exists, auto-migrates to new system
   */
  public async load(): Promise<AddonManagerConfig> {
    try {
      const fileContent = await fs.readFile(this.configPath, "utf-8");
      const loadedConfig = yaml.load(fileContent) as Partial<AddonManagerConfig>;

      // Merge with defaults
      this.config = this.mergeWithDefaults(loadedConfig);

      // Set addonId and serviceName if addonId was provided in constructor
      if (this.addonId) {
        this.config.addonId = this.addonId;
        if (!this.config.serviceName) {
          this.config.serviceName = generateServiceName(this.addonId);
        }
      }

      logger.info("Configuration loaded successfully", { path: this.configPath, addonId: this.addonId });
      return this.config;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        // Config file not found
        // If no addonId provided (legacy mode) and legacy config exists, try to migrate
        if (!this.addonId && (await legacyConfigExists())) {
          logger.info("Legacy config detected, attempting auto-migration");
          const migratedAddonId = await autoMigrateIfNeeded();
          if (migratedAddonId) {
            // Migration successful, reload with migrated addon ID
            logger.info("Migration successful, loading migrated config", { addonId: migratedAddonId });
            this.addonId = migratedAddonId;
            this.configPath = ConfigManager.getConfigPathForAddon(migratedAddonId);
            // Recursively call load() to load the migrated config
            return await this.load();
          }
        }

        logger.warn("Configuration file not found, using defaults", { path: this.configPath });
        this.config = this.mergeWithDefaults({});

        // Set addonId and serviceName if addonId was provided in constructor
        if (this.addonId) {
          this.config.addonId = this.addonId;
          this.config.serviceName = generateServiceName(this.addonId);
        }

        return this.config;
      }

      logger.error("Failed to load configuration", error);
      throw new Error(`Failed to load configuration: ${(error as Error).message}`);
    }
  }

  /**
   * Save configuration to file
   * @param config Optional configuration to save (uses current config if not provided)
   * @param options Optional save options
   * @param options.syncServiceFile If true, sync the service file with the saved config
   * @param options.restartService If true, restart the service after syncing (only if syncServiceFile is true)
   * @returns Information about what was updated (service file sync results)
   */
  public async save(
    config?: AddonManagerConfig,
    options?: { syncServiceFile?: boolean; restartService?: boolean }
  ): Promise<{ serviceFileSynced?: boolean; serviceFileChanges?: string[] }> {
    const configToSave = config || this.config;

    if (!configToSave) {
      throw new Error("No configuration to save");
    }

    try {
      // Ensure directory exists
      const configDir = path.dirname(this.configPath);
      await fs.mkdir(configDir, { recursive: true });

      // Convert to YAML
      const yamlContent = yaml.dump(configToSave, {
        indent: 2,
        lineWidth: 100,
        noRefs: true,
      });

      // Write to file
      await fs.writeFile(this.configPath, yamlContent, "utf-8");

      this.config = configToSave;
      logger.info("Configuration saved successfully", { path: this.configPath });

      // Optionally sync service file
      let serviceFileSynced = false;
      let serviceFileChanges: string[] | undefined;

      if (options?.syncServiceFile) {
        try {
          // Edge case: Handle missing serviceName or addonId
          if (!configToSave.serviceName && !this.addonId) {
            logger.warn("Cannot sync service file: no service name or addon ID available");
          } else {
            // Get service name from config
            const serviceName =
              configToSave.serviceName || (this.addonId ? generateServiceName(this.addonId) : "stremio-addon");

            // Edge case: Verify service exists before syncing
            try {
              const serviceManager = new ServiceManager(serviceName);

              // Try to get service status to verify it exists
              await serviceManager.status();

              // Sync service file
              const syncResult = await serviceManager.syncServiceFile(configToSave, {
                restartService: options.restartService,
              });

              serviceFileSynced = syncResult.updated;
              serviceFileChanges = syncResult.changes;

              if (syncResult.updated) {
                logger.info("Service file synced with configuration", {
                  service: serviceName,
                  changes: syncResult.changes?.length || 0,
                });
              } else {
                logger.info("Service file is already up to date", { service: serviceName });
              }
            } catch (serviceError) {
              const errorMsg = (serviceError as Error).message;
              // Edge case: Service doesn't exist - that's okay, config is saved
              if (errorMsg.includes("does not exist") || errorMsg.includes("ENOENT") || errorMsg.includes("not found")) {
                logger.info("Service does not exist yet, config saved but service file not synced", {
                  service: serviceName,
                });
              } else {
                // Re-throw other service errors
                throw serviceError;
              }
            }
          }
        } catch (error) {
          logger.warn("Failed to sync service file after config save", error);
          // Don't throw - config save succeeded, service file sync is optional
          // Edge case: Config save succeeded but service sync failed - this is acceptable
        }
      }

      return {
        serviceFileSynced,
        serviceFileChanges,
      };
    } catch (error) {
      logger.error("Failed to save configuration", error);
      throw new Error(`Failed to save configuration: ${(error as Error).message}`);
    }
  }

  /**
   * Get the current configuration
   */
  public get(): AddonManagerConfig {
    if (!this.config) {
      throw new Error("Configuration not loaded. Call load() first.");
    }
    return this.config;
  }

  /**
   * Get a specific configuration value
   */
  public getValue<K extends keyof AddonManagerConfig>(key: K): AddonManagerConfig[K] {
    if (!this.config) {
      throw new Error("Configuration not loaded. Call load() first.");
    }
    return this.config[key];
  }

  /**
   * Set a specific configuration value
   */
  public setValue<K extends keyof AddonManagerConfig>(key: K, value: AddonManagerConfig[K]): void {
    if (!this.config) {
      throw new Error("Configuration not loaded. Call load() first.");
    }
    this.config[key] = value;
  }

  /**
   * Get a nested configuration value using dot notation
   */
  public getNestedValue(path: string): unknown {
    if (!this.config) {
      throw new Error("Configuration not loaded. Call load() first.");
    }

    const keys = path.split(".");
    let value: unknown = this.config;

    for (const key of keys) {
      if (value && typeof value === "object" && key in value) {
        value = (value as Record<string, unknown>)[key];
      } else {
        return undefined;
      }
    }

    return value;
  }

  /**
   * Set a nested configuration value using dot notation
   */
  public setNestedValue(path: string, value: unknown): void {
    if (!this.config) {
      throw new Error("Configuration not loaded. Call load() first.");
    }

    const keys = path.split(".");
    const lastKey = keys.pop();

    if (!lastKey) {
      throw new Error("Invalid path");
    }

    let current: Record<string, unknown> = this.config as unknown as Record<string, unknown>;

    for (const key of keys) {
      if (!(key in current)) {
        current[key] = {};
      }
      current = current[key] as Record<string, unknown>;
    }

    current[lastKey] = value;
  }

  /**
   * Reset configuration to defaults
   */
  public reset(): AddonManagerConfig {
    this.config = this.mergeWithDefaults({});
    logger.info("Configuration reset to defaults");
    return this.config;
  }

  /**
   * Validate configuration
   */
  public validate(config?: AddonManagerConfig): { valid: boolean; errors: string[] } {
    const configToValidate = config || this.config;

    if (!configToValidate) {
      return { valid: false, errors: ["No configuration to validate"] };
    }

    const errors: string[] = [];

    // Validate addon configuration
    if (!configToValidate.addon) {
      errors.push("Missing addon configuration");
    } else {
      if (!configToValidate.addon.name) {
        errors.push("Addon name is required");
      }
      if (!configToValidate.addon.domain) {
        errors.push("Addon domain is required");
      }
      if (!configToValidate.addon.password) {
        errors.push("Addon password is required");
      }
      // Validate torrentLimit (type check and range)
      if (typeof configToValidate.addon.torrentLimit !== "number" || isNaN(configToValidate.addon.torrentLimit)) {
        errors.push("Torrent limit must be a valid number");
      } else if (configToValidate.addon.torrentLimit < 1 || configToValidate.addon.torrentLimit > 50) {
        errors.push("Torrent limit must be between 1 and 50");
      }

      // Validate availabilityCheckLimit (if provided) - type check and range
      if (configToValidate.addon.availabilityCheckLimit !== undefined) {
        if (
          typeof configToValidate.addon.availabilityCheckLimit !== "number" ||
          isNaN(configToValidate.addon.availabilityCheckLimit)
        ) {
          errors.push("Availability check limit must be a valid number");
        } else if (
          configToValidate.addon.availabilityCheckLimit < 5 ||
          configToValidate.addon.availabilityCheckLimit > 50
        ) {
          errors.push("Availability check limit must be between 5 and 50");
        }
      }

      // Validate maxStreams (if provided) - type check and range
      if (configToValidate.addon.maxStreams !== undefined) {
        if (typeof configToValidate.addon.maxStreams !== "number" || isNaN(configToValidate.addon.maxStreams)) {
          errors.push("Max streams must be a valid number");
        } else if (configToValidate.addon.maxStreams < 1 || configToValidate.addon.maxStreams > 20) {
          errors.push("Max streams must be between 1 and 20");
        }
      }

      // Validate maxConcurrency (if provided) - type check and range
      if (configToValidate.addon.maxConcurrency !== undefined) {
        if (typeof configToValidate.addon.maxConcurrency !== "number" || isNaN(configToValidate.addon.maxConcurrency)) {
          errors.push("Max concurrency must be a valid number");
        } else if (configToValidate.addon.maxConcurrency < 1 || configToValidate.addon.maxConcurrency > 10) {
          errors.push("Max concurrency must be between 1 and 10");
        }
      }
    }

    // Validate installation configuration
    if (!configToValidate.installation) {
      errors.push("Missing installation configuration");
    }

    // Validate features configuration
    if (!configToValidate.features) {
      errors.push("Missing features configuration");
    }

    // Validate paths configuration
    if (!configToValidate.paths) {
      errors.push("Missing paths configuration");
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Check if configuration file exists
   */
  public async exists(): Promise<boolean> {
    try {
      await fs.access(this.configPath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Delete configuration file
   */
  public async delete(): Promise<void> {
    try {
      await fs.unlink(this.configPath);
      this.config = null;
      logger.info("Configuration file deleted", { path: this.configPath });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        logger.error("Failed to delete configuration", error);
        throw new Error(`Failed to delete configuration: ${(error as Error).message}`);
      }
    }
  }

  /**
   * Merge loaded configuration with defaults
   */
  private mergeWithDefaults(loaded: Partial<AddonManagerConfig>): AddonManagerConfig {
    return {
      installation: loaded.installation || {
        type: InstallationType.LOCAL,
        accessMethod: AccessMethod.DUCKDNS,
      },
      addon: {
        ...DEFAULT_CONFIG.addon!,
        ...loaded.addon,
      },
      features: {
        ...DEFAULT_CONFIG.features!,
        ...loaded.features,
        caching: {
          ...DEFAULT_CONFIG.features!.caching,
          ...(loaded.features?.caching || {}),
        },
        rateLimiting: {
          ...DEFAULT_CONFIG.features!.rateLimiting,
          ...(loaded.features?.rateLimiting || {}),
        },
        backups: {
          ...DEFAULT_CONFIG.features!.backups,
          ...(loaded.features?.backups || {}),
        },
      },
      paths: loaded.paths || {
        addonDirectory: this.addonId ? this.generateAddonPath("addonDirectory") : "",
        nginxConfig: this.addonId ? this.generateAddonPath("nginxConfig") : "",
        serviceFile: this.addonId ? this.generateAddonPath("serviceFile") : "",
        logs: this.addonId ? this.generateAddonPath("logs") : "",
        backups: this.addonId ? this.generateAddonPath("backups") : "",
      },
      secrets: loaded.secrets || {},
    };
  }

  /**
   * Generate addon-specific path
   */
  private generateAddonPath(type: "addonDirectory" | "nginxConfig" | "serviceFile" | "logs" | "backups"): string {
    if (!this.addonId) {
      return "";
    }

    const serviceName = generateServiceName(this.addonId);

    switch (type) {
      case "addonDirectory":
        // Use /opt for system-wide or ~/ for user-specific
        return `/opt/stremio-addon-${this.addonId}`;
      case "nginxConfig":
        return `/etc/nginx/sites-available/stremio-addon-${this.addonId}`;
      case "serviceFile":
        return `/etc/systemd/system/${serviceName}.service`;
      case "logs":
        const homeDir = os.homedir();
        return path.join(homeDir, ".stremio-addon-manager", "addons", this.addonId, "logs");
      case "backups":
        const homeDir2 = os.homedir();
        return path.join(homeDir2, ".stremio-addon-manager", "addons", this.addonId, "backups");
      default:
        return "";
    }
  }
}
