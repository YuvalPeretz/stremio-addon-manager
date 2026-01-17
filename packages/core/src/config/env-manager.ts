/**
 * Environment Variable Manager
 * Manages environment variables for addon services, including mapping from config,
 * validation, defaults, and generation
 *
 * ## Configuration to Environment Variable Mapping
 *
 * The following mapping defines how configuration values are converted to environment variables:
 *
 * | Config Path | Environment Variable | Type | Default | Notes |
 * |------------|---------------------|------|---------|-------|
 * | `config.addon.port` | `PORT` | number | 7000 | Server port (1024-65535) |
 * | `config.secrets.realDebridToken` | `RD_API_TOKEN` | string | - | Required, sensitive |
 * | `config.addon.password` | `ADDON_PASSWORD` | string | - | Required, sensitive, generateable |
 * | `config.addon.domain` | `ADDON_DOMAIN` | string | - | Optional, for manifest base URL |
 * | `config.addon.torrentLimit` | `TORRENT_LIMIT` | number | 15 | Max torrents to process (1-50) |
 * | `config.addon.availabilityCheckLimit` | `AVAILABILITY_CHECK_LIMIT` | number | 15 | Torrents to check for cache (5-50) |
 * | `config.addon.maxStreams` | `MAX_STREAMS` | number | 5 | Max streams to return (1-20) |
 * | `config.addon.maxConcurrency` | `MAX_CONCURRENCY` | number | 3 | Parallel processing limit (1-10) |
 * | `system` | `NODE_ENV` | string | "production" | Node.js environment |
 *
 * ## Override Priority
 *
 * When generating environment variables, the following priority order is used:
 * 1. **Overrides** (`config.addon.environmentVariables`) - Highest priority
 * 2. **Config-derived values** - From config fields (see mapping above)
 * 3. **Defaults** - From metadata defaults
 *
 * Use `null` in overrides to reset a variable to its default/config value.
 */

import crypto from "node:crypto";
import type { AddonManagerConfig } from "./types.js";

/**
 * Environment variable metadata
 */
export interface EnvVarMetadata {
  description: string;
  default?: string | number;
  type: "string" | "number" | "boolean";
  min?: number;
  max?: number;
  minLength?: number;
  maxLength?: number;
  required: boolean;
  sensitive: boolean;
  generateable: boolean;
  source: string; // Config path where value comes from (e.g., "config.addon.port")
  validation?: (value: string) => { valid: boolean; error?: string };
}

/**
 * Environment variable metadata registry
 */
const ENV_VAR_METADATA: Record<string, EnvVarMetadata> = {
  NODE_ENV: {
    description: "Node.js environment",
    default: "production",
    type: "string",
    required: true,
    sensitive: false,
    generateable: false,
    source: "system",
  },
  PORT: {
    description: "Addon server port",
    default: 7000,
    type: "number",
    min: 1024,
    max: 65535,
    required: true,
    sensitive: false,
    generateable: false,
    source: "config.addon.port",
    validation: (value) => {
      const port = parseInt(value, 10);
      if (isNaN(port) || port < 1024 || port > 65535) {
        return { valid: false, error: "Port must be a number between 1024 and 65535" };
      }
      return { valid: true };
    },
  },
  RD_API_TOKEN: {
    description: "Real-Debrid API token",
    default: undefined,
    type: "string",
    minLength: 1,
    required: true,
    sensitive: true,
    generateable: false,
    source: "config.secrets.realDebridToken",
    validation: (value) => {
      if (!value || value.trim().length === 0) {
        return { valid: false, error: "Real-Debrid API token is required" };
      }
      return { valid: true };
    },
  },
  ADDON_PASSWORD: {
    description: "Addon authentication password",
    default: undefined,
    type: "string",
    minLength: 8,
    required: true,
    sensitive: true,
    generateable: true,
    source: "config.addon.password",
    validation: (value) => {
      if (!value || value.length < 8) {
        return { valid: false, error: "Password must be at least 8 characters long" };
      }
      return { valid: true };
    },
  },
  ADDON_DOMAIN: {
    description: "Addon domain for manifest base URL",
    default: undefined,
    type: "string",
    minLength: 1,
    required: false,
    sensitive: false,
    generateable: false,
    source: "config.addon.domain",
    validation: (value) => {
      if (value && value.trim().length === 0) {
        return { valid: false, error: "Domain cannot be empty if provided" };
      }
      // Basic domain validation
      if (value && !/^([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$|^localhost$|^(\d{1,3}\.){3}\d{1,3}$/.test(value)) {
        return { valid: false, error: "Invalid domain format" };
      }
      return { valid: true };
    },
  },
  TORRENT_LIMIT: {
    description: "Maximum number of torrents to process",
    default: 15,
    type: "number",
    min: 1,
    max: 50,
    required: true,
    sensitive: false,
    generateable: false,
    source: "config.addon.torrentLimit",
    validation: (value) => {
      const num = parseInt(value, 10);
      if (isNaN(num) || num < 1 || num > 50) {
        return { valid: false, error: "Torrent limit must be between 1 and 50" };
      }
      return { valid: true };
    },
  },
  AVAILABILITY_CHECK_LIMIT: {
    description: "Number of torrents to check for instant availability",
    default: 15,
    type: "number",
    min: 5,
    max: 50,
    required: false,
    sensitive: false,
    generateable: false,
    source: "config.addon.availabilityCheckLimit",
    validation: (value) => {
      const num = parseInt(value, 10);
      if (isNaN(num) || num < 5 || num > 50) {
        return { valid: false, error: "Availability check limit must be between 5 and 50" };
      }
      return { valid: true };
    },
  },
  MAX_STREAMS: {
    description: "Maximum number of streams to return",
    default: 5,
    type: "number",
    min: 1,
    max: 20,
    required: false,
    sensitive: false,
    generateable: false,
    source: "config.addon.maxStreams",
    validation: (value) => {
      const num = parseInt(value, 10);
      if (isNaN(num) || num < 1 || num > 20) {
        return { valid: false, error: "Max streams must be between 1 and 20" };
      }
      return { valid: true };
    },
  },
  MAX_CONCURRENCY: {
    description: "Number of torrents to process in parallel",
    default: 3,
    type: "number",
    min: 1,
    max: 10,
    required: false,
    sensitive: false,
    generateable: false,
    source: "config.addon.maxConcurrency",
    validation: (value) => {
      const num = parseInt(value, 10);
      if (isNaN(num) || num < 1 || num > 10) {
        return { valid: false, error: "Max concurrency must be between 1 and 10" };
      }
      return { valid: true };
    },
  },
};

/**
 * Environment Variable Manager class
 */
export class EnvVarManager {
  /**
   * Get all environment variable metadata
   */
  public static getAllEnvVarMetadata(): Record<string, EnvVarMetadata> {
    return { ...ENV_VAR_METADATA };
  }

  /**
   * Get metadata for a specific environment variable
   */
  public static getEnvVarMetadata(key: string): EnvVarMetadata | undefined {
    return ENV_VAR_METADATA[key];
  }

  /**
   * Get default environment variables
   */
  public static getDefaultEnvVars(): Record<string, string> {
    const defaults: Record<string, string> = {};

    for (const [key, metadata] of Object.entries(ENV_VAR_METADATA)) {
      if (metadata.default !== undefined) {
        defaults[key] = String(metadata.default);
      }
    }

    return defaults;
  }

  /**
   * Get environment variables from configuration
   */
  public static getEnvVarsFromConfig(config: AddonManagerConfig): Record<string, string> {
    const envVars: Record<string, string> = {
      NODE_ENV: "production",
    };

    // Map config values to environment variables
    if (config.addon.port) {
      envVars.PORT = String(config.addon.port);
    } else {
      envVars.PORT = "7000";
    }

    if (config.secrets.realDebridToken) {
      envVars.RD_API_TOKEN = config.secrets.realDebridToken;
    }

    if (config.addon.password) {
      envVars.ADDON_PASSWORD = config.addon.password;
    }

    if (config.addon.domain) {
      envVars.ADDON_DOMAIN = config.addon.domain;
    }

    if (config.addon.torrentLimit) {
      envVars.TORRENT_LIMIT = String(config.addon.torrentLimit);
    } else {
      envVars.TORRENT_LIMIT = "15";
    }

    if (config.addon.availabilityCheckLimit) {
      envVars.AVAILABILITY_CHECK_LIMIT = String(config.addon.availabilityCheckLimit);
    } else {
      envVars.AVAILABILITY_CHECK_LIMIT = "15";
    }

    if (config.addon.maxStreams) {
      envVars.MAX_STREAMS = String(config.addon.maxStreams);
    } else {
      envVars.MAX_STREAMS = "5";
    }

    if (config.addon.maxConcurrency) {
      envVars.MAX_CONCURRENCY = String(config.addon.maxConcurrency);
    } else {
      envVars.MAX_CONCURRENCY = "3";
    }

    return envVars;
  }

  /**
   * Validate environment variable value
   * @param key Environment variable name
   * @param value Environment variable value (as string)
   * @returns Validation result with clear error message if invalid
   */
  public static validateEnvVar(key: string, value: string): { valid: boolean; error?: string } {
    const metadata = ENV_VAR_METADATA[key];

    if (!metadata) {
      return { valid: false, error: `Unknown environment variable: ${key}. Valid variables: ${Object.keys(ENV_VAR_METADATA).join(", ")}` };
    }

    // Check required
    if (metadata.required && (!value || value.trim().length === 0)) {
      return { valid: false, error: `${key} is required. ${metadata.description}` };
    }

    // Skip validation for empty optional values
    if (!metadata.required && (!value || value.trim().length === 0)) {
      return { valid: true };
    }

    // Type validation
    if (metadata.type === "number") {
      const num = parseFloat(value);
      if (isNaN(num) || !Number.isInteger(parseFloat(value))) {
        return { valid: false, error: `${key} must be an integer number. Received: "${value}"` };
      }

      if (metadata.min !== undefined && num < metadata.min) {
        return { valid: false, error: `${key} must be at least ${metadata.min} (received: ${num}). ${metadata.description}` };
      }

      if (metadata.max !== undefined && num > metadata.max) {
        return { valid: false, error: `${key} must be at most ${metadata.max} (received: ${num}). ${metadata.description}` };
      }
    }

    // Boolean type validation
    if (metadata.type === "boolean") {
      const lowerValue = value.toLowerCase().trim();
      if (lowerValue !== "true" && lowerValue !== "false" && lowerValue !== "1" && lowerValue !== "0") {
        return { valid: false, error: `${key} must be a boolean (true/false, 1/0). Received: "${value}"` };
      }
    }

    // String length validation
    if (metadata.type === "string") {
      if (metadata.minLength !== undefined && value.length < metadata.minLength) {
        return { valid: false, error: `${key} must be at least ${metadata.minLength} characters long (received: ${value.length}). ${metadata.description}` };
      }

      if (metadata.maxLength !== undefined && value.length > metadata.maxLength) {
        return { valid: false, error: `${key} must be at most ${metadata.maxLength} characters long (received: ${value.length}). ${metadata.description}` };
      }
    }

    // Custom validation (includes format validation for URLs, domains, ports, etc.)
    if (metadata.validation) {
      const result = metadata.validation(value);
      if (!result.valid) {
        return { valid: false, error: result.error || `${key} validation failed` };
      }
    }

    return { valid: true };
  }

  /**
   * Validate multiple environment variables at once
   * @param envVars Record of environment variable key-value pairs
   * @returns Validation result with all errors
   */
  public static validateEnvVars(envVars: Record<string, string>): { valid: boolean; errors: Array<{ key: string; error: string }> } {
    const errors: Array<{ key: string; error: string }> = [];

    for (const [key, value] of Object.entries(envVars)) {
      const result = this.validateEnvVar(key, value);
      if (!result.valid && result.error) {
        errors.push({ key, error: result.error });
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Generate value for a generateable environment variable
   */
  public static generateEnvVarValue(key: string, _config?: AddonManagerConfig): string | undefined {
    const metadata = ENV_VAR_METADATA[key];

    if (!metadata || !metadata.generateable) {
      return undefined;
    }

    switch (key) {
      case "ADDON_PASSWORD":
        // Generate a secure random password
        return crypto.randomBytes(16).toString("base64").replace(/[^a-zA-Z0-9]/g, "").substring(0, 16);

      default:
        return undefined;
    }
  }

  /**
   * Merge environment variables with overrides
   * Overrides take precedence over config-derived values
   * Null values in overrides are treated as "reset to default/config"
   */
  public static mergeEnvVars(
    config: AddonManagerConfig,
    overrides?: Record<string, string | null>
  ): Record<string, string> {
    const fromConfig = this.getEnvVarsFromConfig(config);
    const defaults = this.getDefaultEnvVars();

    // Start with defaults
    const merged: Record<string, string> = { ...defaults };

    // Apply config-derived values
    for (const [key, value] of Object.entries(fromConfig)) {
      if (value !== undefined && value !== null && value !== "") {
        merged[key] = value;
      }
    }

    // Apply overrides (highest priority)
    if (overrides) {
      for (const [key, value] of Object.entries(overrides)) {
        if (value === null || value === undefined) {
          // Remove override (reset to default/config)
          delete merged[key];
        } else {
          merged[key] = value;
        }
      }
    }

    return merged;
  }

  /**
   * Get environment variable value source
   */
  public static getEnvVarSource(key: string, config: AddonManagerConfig, overrides?: Record<string, string | null>): "default" | "config" | "override" {
    if (overrides && key in overrides) {
      return "override";
    }

    const fromConfig = this.getEnvVarsFromConfig(config);
    if (key in fromConfig) {
      return "config";
    }

    return "default";
  }
}
