/**
 * Configuration Manager
 * Handles loading, saving, and managing configuration files
 */
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import yaml from "js-yaml";
import { logger } from "../utils/logger.js";
import { DEFAULT_CONFIG, InstallationType, AccessMethod } from "./types.js";
/**
 * Configuration Manager class
 */
export class ConfigManager {
    config = null;
    configPath;
    /**
     * Create a new ConfigManager instance
     * @param configPath Path to configuration file (default: ~/.stremio-addon-manager/config.yaml)
     */
    constructor(configPath) {
        if (configPath) {
            this.configPath = configPath;
        }
        else {
            const homeDir = os.homedir();
            this.configPath = path.join(homeDir, ".stremio-addon-manager", "config.yaml");
        }
    }
    /**
     * Get the configuration file path
     */
    getConfigPath() {
        return this.configPath;
    }
    /**
     * Load configuration from file
     */
    async load() {
        try {
            const fileContent = await fs.readFile(this.configPath, "utf-8");
            const loadedConfig = yaml.load(fileContent);
            // Merge with defaults
            this.config = this.mergeWithDefaults(loadedConfig);
            logger.info("Configuration loaded successfully", { path: this.configPath });
            return this.config;
        }
        catch (error) {
            if (error.code === "ENOENT") {
                logger.warn("Configuration file not found, using defaults", { path: this.configPath });
                this.config = this.mergeWithDefaults({});
                return this.config;
            }
            logger.error("Failed to load configuration", error);
            throw new Error(`Failed to load configuration: ${error.message}`);
        }
    }
    /**
     * Save configuration to file
     */
    async save(config) {
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
        }
        catch (error) {
            logger.error("Failed to save configuration", error);
            throw new Error(`Failed to save configuration: ${error.message}`);
        }
    }
    /**
     * Get the current configuration
     */
    get() {
        if (!this.config) {
            throw new Error("Configuration not loaded. Call load() first.");
        }
        return this.config;
    }
    /**
     * Get a specific configuration value
     */
    getValue(key) {
        if (!this.config) {
            throw new Error("Configuration not loaded. Call load() first.");
        }
        return this.config[key];
    }
    /**
     * Set a specific configuration value
     */
    setValue(key, value) {
        if (!this.config) {
            throw new Error("Configuration not loaded. Call load() first.");
        }
        this.config[key] = value;
    }
    /**
     * Get a nested configuration value using dot notation
     */
    getNestedValue(path) {
        if (!this.config) {
            throw new Error("Configuration not loaded. Call load() first.");
        }
        const keys = path.split(".");
        let value = this.config;
        for (const key of keys) {
            if (value && typeof value === "object" && key in value) {
                value = value[key];
            }
            else {
                return undefined;
            }
        }
        return value;
    }
    /**
     * Set a nested configuration value using dot notation
     */
    setNestedValue(path, value) {
        if (!this.config) {
            throw new Error("Configuration not loaded. Call load() first.");
        }
        const keys = path.split(".");
        const lastKey = keys.pop();
        if (!lastKey) {
            throw new Error("Invalid path");
        }
        let current = this.config;
        for (const key of keys) {
            if (!(key in current)) {
                current[key] = {};
            }
            current = current[key];
        }
        current[lastKey] = value;
    }
    /**
     * Reset configuration to defaults
     */
    reset() {
        this.config = this.mergeWithDefaults({});
        logger.info("Configuration reset to defaults");
        return this.config;
    }
    /**
     * Validate configuration
     */
    validate(config) {
        const configToValidate = config || this.config;
        if (!configToValidate) {
            return { valid: false, errors: ["No configuration to validate"] };
        }
        const errors = [];
        // Validate addon configuration
        if (!configToValidate.addon) {
            errors.push("Missing addon configuration");
        }
        else {
            if (!configToValidate.addon.name) {
                errors.push("Addon name is required");
            }
            if (!configToValidate.addon.domain) {
                errors.push("Addon domain is required");
            }
            if (!configToValidate.addon.password) {
                errors.push("Addon password is required");
            }
            if (configToValidate.addon.torrentLimit < 5 || configToValidate.addon.torrentLimit > 25) {
                errors.push("Torrent limit must be between 5 and 25");
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
    async exists() {
        try {
            await fs.access(this.configPath);
            return true;
        }
        catch {
            return false;
        }
    }
    /**
     * Delete configuration file
     */
    async delete() {
        try {
            await fs.unlink(this.configPath);
            this.config = null;
            logger.info("Configuration file deleted", { path: this.configPath });
        }
        catch (error) {
            if (error.code !== "ENOENT") {
                logger.error("Failed to delete configuration", error);
                throw new Error(`Failed to delete configuration: ${error.message}`);
            }
        }
    }
    /**
     * Merge loaded configuration with defaults
     */
    mergeWithDefaults(loaded) {
        return {
            installation: loaded.installation || {
                type: InstallationType.LOCAL,
                accessMethod: AccessMethod.DUCKDNS,
            },
            addon: {
                ...DEFAULT_CONFIG.addon,
                ...loaded.addon,
            },
            features: {
                ...DEFAULT_CONFIG.features,
                ...loaded.features,
                caching: {
                    ...DEFAULT_CONFIG.features.caching,
                    ...(loaded.features?.caching || {}),
                },
                rateLimiting: {
                    ...DEFAULT_CONFIG.features.rateLimiting,
                    ...(loaded.features?.rateLimiting || {}),
                },
                backups: {
                    ...DEFAULT_CONFIG.features.backups,
                    ...(loaded.features?.backups || {}),
                },
            },
            paths: loaded.paths || {
                addonDirectory: "",
                nginxConfig: "",
                serviceFile: "",
                logs: "",
                backups: "",
            },
            secrets: loaded.secrets || {},
        };
    }
}
//# sourceMappingURL=manager.js.map