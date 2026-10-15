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
 * | `config.paths.localLibraryDataDir` | `LOCAL_LIBRARY_DATA_DIR` | string | `<addonDir>/local-library` | Install sets this; omit env on host → addon defaults to `<cwd>/local-library`; set `""` in config to disable |
 * | (manual) | `LOCAL_LIBRARY_SCAN_MAX_DEPTH` | number | 12 | Max folder depth when scanning roots |
 * | (manual) | `LOCAL_LIBRARY_SCAN_MAX_FILES` | number | 5000 | Max indexed video files |
 * | (manual) | `LOCAL_LIBRARY_MAX_FUZZY_RESULTS` | number | 3 | Title fuzzy matches per request (0 = off) |
 * | (manual) | `LOCAL_LIBRARY_FUZZY_THRESHOLD` | number | 0.38 | Min fuzzy score 0.15–0.95 |
 * | `config.secrets.torboxToken` | `TORBOX_API_TOKEN` | string | - | Optional, sensitive |
 * | `config.addon.streamProviderMode` | `STREAM_PROVIDER_MODE` | string | "parallel" | "parallel" or "ordered" |
 * | `config.addon.streamProviderOrder` | `STREAM_PROVIDER_ORDER` | string | "real-debrid" | Comma-separated provider IDs |
 * | (classic install) | `ENABLE_MANAGEMENT_API` | boolean | false (server) / true (classic bake) | Server default false; classic install/update sets true |
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
import path from "node:path";
import type { AddonManagerConfig } from "./types.js";
import type { AddonProduct } from "./product.js";
import { normalizeAddonProduct } from "./product.js";
import {
  TRANSLATED_SUBTITLES_ENV_METADATA,
  getTranslatedSubtitlesEnvVarsFromConfig,
  stripStreamingOnlyEnvKeys,
} from "./translated-subtitles-env.js";

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
  LOCAL_LIBRARY_DATA_DIR: {
    description:
      "Auto-managed: install/update writes <addonDirectory>/local-library. If the variable is missing from systemd, the addon still defaults to that folder under its working directory. Set paths.localLibraryDataDir in YAML only to override the path, or \"\" to disable and omit this line from the unit. You rarely need to edit this row.",
    default: undefined,
    type: "string",
    required: false,
    sensitive: false,
    generateable: false,
    source: "config.paths.localLibraryDataDir",
  },
  LOCAL_LIBRARY_SCAN_MAX_DEPTH: {
    description: "Maximum directory depth when scanning folder roots",
    default: 12,
    type: "number",
    min: 0,
    max: 32,
    required: false,
    sensitive: false,
    generateable: false,
    source: "manual (addon-server)",
  },
  LOCAL_LIBRARY_SCAN_MAX_FILES: {
    description: "Maximum number of video files to keep in the local library index",
    default: 5000,
    type: "number",
    min: 1,
    max: 50000,
    required: false,
    sensitive: false,
    generateable: false,
    source: "manual (addon-server)",
  },
  LOCAL_LIBRARY_MAX_FUZZY_RESULTS: {
    description: "Max local streams from title fuzzy matching per request (0 disables fuzzy)",
    default: 3,
    type: "number",
    min: 0,
    max: 20,
    required: false,
    sensitive: false,
    generateable: false,
    source: "manual (addon-server)",
  },
  LOCAL_LIBRARY_FUZZY_THRESHOLD: {
    description: "Minimum fuzzy match score (0.15–0.95) to surface a title-matched local file",
    default: 0.38,
    type: "number",
    min: 0.15,
    max: 0.95,
    required: false,
    sensitive: false,
    generateable: false,
    source: "manual (addon-server)",
  },
  TORBOX_API_TOKEN: {
    description: "TorBox API token for stream fetching (optional; enables TorBox as a stream provider)",
    type: "string",
    required: false,
    sensitive: true,
    generateable: false,
    source: "config.secrets.torboxToken",
  },
  STREAM_PROVIDER_MODE: {
    description: "How to query multiple providers: 'parallel' (all at once, results merged) or 'ordered' (fallback chain)",
    default: "parallel",
    type: "string",
    required: false,
    sensitive: false,
    generateable: false,
    source: "config.addon.streamProviderMode",
    validation: (value) =>
      ["parallel", "ordered"].includes(value)
        ? { valid: true }
        : { valid: false, error: "Must be 'parallel' or 'ordered'" },
  },
  STREAM_PROVIDER_ORDER: {
    description: "Comma-separated provider IDs in priority order, e.g. 'real-debrid,torbox'",
    default: "real-debrid",
    type: "string",
    required: false,
    sensitive: false,
    generateable: false,
    source: "config.addon.streamProviderOrder",
  },
  ENABLE_MANAGEMENT_API: {
    description:
      "Expose /management UI and APIs. Server default is false (public dual-app). Classic single-app install/update bakes true.",
    default: "false",
    type: "boolean",
    required: false,
    sensitive: false,
    generateable: false,
    source: "classic install / service file",
  },
  MAX_CONCURRENT_VIEWERS: {
    description: "Maximum number of concurrent viewers (unique IPs). 0 = unlimited.",
    default: "10",
    type: "number",
    required: false,
    sensitive: false,
    generateable: false,
    source: "config.addon.maxConcurrentViewers",
  },
  DEPLOY_INSTALL_SCRIPT_REL_PATH: {
    description: "Relative path to install deploy script under cwd (admin artifact)",
    default: "deploy/install.sh",
    type: "string",
    required: false,
    sensitive: false,
    generateable: false,
    source: "manual",
  },
  DEPLOY_UPDATE_SCRIPT_REL_PATH: {
    description: "Relative path to update deploy script under cwd (admin artifact)",
    default: "deploy/update.sh",
    type: "string",
    required: false,
    sensitive: false,
    generateable: false,
    source: "manual",
  },
};

/**
 * Environment Variable Manager class
 */
export class EnvVarManager {
  /**
   * Resolved local-library data directory for the addon host, or null if the feature is disabled.
   * Uses `config.paths.localLibraryDataDir` when set; empty string means disabled.
   * Otherwise defaults to `<addonDirectory>/local-library` when addonDirectory is set.
   */
  public static getLocalLibraryDataDir(config: AddonManagerConfig): string | null {
    const explicit = config.paths.localLibraryDataDir;
    if (explicit !== undefined && explicit.trim() === "") {
      return null;
    }
    const addonDir = config.paths.addonDirectory?.trim();
    if (!addonDir) {
      return null;
    }
    const dir = (explicit?.trim() || path.posix.join(addonDir, "local-library")).replace(/\/+$/, "");
    return dir || null;
  }

  /**
   * Absolute path to `library.json` on the addon host (POSIX), or null if local library is disabled.
   */
  public static getLocalLibraryJsonPath(config: AddonManagerConfig): string | null {
    const dir = this.getLocalLibraryDataDir(config);
    return dir ? path.posix.join(dir, "library.json") : null;
  }

  /**
   * Resolve product from config (legacy configs without product are streaming).
   */
  public static getProductFromConfig(config: AddonManagerConfig): AddonProduct {
    return normalizeAddonProduct(config.product);
  }

  /**
   * Get all environment variable metadata for a product (default: streaming).
   */
  public static getAllEnvVarMetadata(product?: AddonProduct): Record<string, EnvVarMetadata> {
    const resolved = normalizeAddonProduct(product);
    if (resolved === "translated_subtitles") {
      return { ...TRANSLATED_SUBTITLES_ENV_METADATA };
    }
    return { ...ENV_VAR_METADATA };
  }

  /**
   * Get metadata for a specific environment variable
   */
  public static getEnvVarMetadata(key: string, product?: AddonProduct): EnvVarMetadata | undefined {
    const map = this.getAllEnvVarMetadata(product);
    if (map[key]) {
      return map[key];
    }
    if (product === undefined) {
      return TRANSLATED_SUBTITLES_ENV_METADATA[key];
    }
    return undefined;
  }

  /**
   * Get default environment variables
   */
  public static getDefaultEnvVars(product?: AddonProduct): Record<string, string> {
    const defaults: Record<string, string> = {};

    for (const [key, metadata] of Object.entries(this.getAllEnvVarMetadata(product))) {
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
    if (this.getProductFromConfig(config) === "translated_subtitles") {
      return getTranslatedSubtitlesEnvVarsFromConfig(config);
    }
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

    const localLibDir = this.getLocalLibraryDataDir(config);
    if (localLibDir) {
      envVars.LOCAL_LIBRARY_DATA_DIR = localLibDir;
    }

    if (config.secrets.torboxToken) {
      envVars.TORBOX_API_TOKEN = config.secrets.torboxToken;
    }

    if (config.addon.streamProviderMode) {
      envVars.STREAM_PROVIDER_MODE = config.addon.streamProviderMode;
    }

    if (config.addon.streamProviderOrder && config.addon.streamProviderOrder.length > 0) {
      envVars.STREAM_PROVIDER_ORDER = config.addon.streamProviderOrder.join(",");
    }

    // Classic installs are single-app admin units — always enable management.
    // Dual-app custom_script path must set public=false / admin=true separately.
    envVars.ENABLE_MANAGEMENT_API = "true";

    if (config.addon.maxConcurrentViewers !== undefined) {
      envVars.MAX_CONCURRENT_VIEWERS = String(config.addon.maxConcurrentViewers);
    }

    return envVars;
  }

  /**
   * Validate environment variable value
   * @param key Environment variable name
   * @param value Environment variable value (as string)
   * @returns Validation result with clear error message if invalid
   */
  public static validateEnvVar(
    key: string,
    value: string,
    product?: AddonProduct
  ): { valid: boolean; error?: string } {
    const metadata = this.getEnvVarMetadata(key, product);
    const knownKeys = Object.keys(this.getAllEnvVarMetadata(product ?? this.inferProductForKey(key)));

    if (!metadata) {
      return {
        valid: false,
        error: `Unknown environment variable: ${key}. Valid variables: ${knownKeys.join(", ")}`,
      };
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
  public static validateEnvVars(
    envVars: Record<string, string>,
    product?: AddonProduct
  ): { valid: boolean; errors: Array<{ key: string; error: string }> } {
    const errors: Array<{ key: string; error: string }> = [];

    for (const [key, value] of Object.entries(envVars)) {
      const result = this.validateEnvVar(key, value, product);
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
    const metadata = this.getEnvVarMetadata(key);

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
    const product = this.getProductFromConfig(config);
    const fromConfig = this.getEnvVarsFromConfig(config);
    const defaults = this.getDefaultEnvVars(product);

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

    if (product === "translated_subtitles") {
      return stripStreamingOnlyEnvKeys(merged);
    }

    return merged;
  }

  private static inferProductForKey(key: string): AddonProduct {
    if (TRANSLATED_SUBTITLES_ENV_METADATA[key] && !ENV_VAR_METADATA[key]) {
      return "translated_subtitles";
    }
    return "streaming";
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
