/**
 * Configuration Manager
 * Handles loading, saving, and managing configuration files
 */
import type { AddonManagerConfig } from "./types.js";
/**
 * Configuration Manager class
 */
export declare class ConfigManager {
    private config;
    private configPath;
    /**
     * Create a new ConfigManager instance
     * @param configPath Path to configuration file (default: ~/.stremio-addon-manager/config.yaml)
     */
    constructor(configPath?: string);
    /**
     * Get the configuration file path
     */
    getConfigPath(): string;
    /**
     * Load configuration from file
     */
    load(): Promise<AddonManagerConfig>;
    /**
     * Save configuration to file
     */
    save(config?: AddonManagerConfig): Promise<void>;
    /**
     * Get the current configuration
     */
    get(): AddonManagerConfig;
    /**
     * Get a specific configuration value
     */
    getValue<K extends keyof AddonManagerConfig>(key: K): AddonManagerConfig[K];
    /**
     * Set a specific configuration value
     */
    setValue<K extends keyof AddonManagerConfig>(key: K, value: AddonManagerConfig[K]): void;
    /**
     * Get a nested configuration value using dot notation
     */
    getNestedValue(path: string): unknown;
    /**
     * Set a nested configuration value using dot notation
     */
    setNestedValue(path: string, value: unknown): void;
    /**
     * Reset configuration to defaults
     */
    reset(): AddonManagerConfig;
    /**
     * Validate configuration
     */
    validate(config?: AddonManagerConfig): {
        valid: boolean;
        errors: string[];
    };
    /**
     * Check if configuration file exists
     */
    exists(): Promise<boolean>;
    /**
     * Delete configuration file
     */
    delete(): Promise<void>;
    /**
     * Merge loaded configuration with defaults
     */
    private mergeWithDefaults;
}
//# sourceMappingURL=manager.d.ts.map