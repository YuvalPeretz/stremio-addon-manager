/**
 * Configuration Module Types
 */

import type { OperatingSystem, LinuxDistribution } from "../types/common.js";

/**
 * Access method for the addon
 */
export enum AccessMethod {
  CUSTOM_DOMAIN = "custom_domain",
  DUCKDNS = "duckdns",
  STATIC_IP_WITH_DOMAIN = "static_ip_domain",
  LOCAL_NETWORK = "local_network",
}

/**
 * Installation type
 */
export enum InstallationType {
  LOCAL = "local",
  REMOTE = "remote",
}

/**
 * Provider type
 */
export enum Provider {
  REAL_DEBRID = "real-debrid",
  ALL_DEBRID = "alldebrid",
  PREMIUMIZE = "premiumize",
  TORBOX = "torbox",
}

/**
 * Target machine configuration
 */
export interface TargetConfig {
  host?: string;
  port?: number;
  username?: string;
  password?: string;
  privateKeyPath?: string;
  os?: OperatingSystem;
  distro?: LinuxDistribution;
}

/**
 * Addon configuration
 */
export interface AddonConfig {
  name: string;
  version: string;
  domain: string;
  password: string;
  provider: Provider;
  torrentLimit: number;
  port?: number;
  /**
   * Number of torrents to check for instant availability in Real-Debrid cache.
   * Higher values = more API calls but better chance of finding cached torrents.
   * Recommended range: 5-50, default: 15
   */
  availabilityCheckLimit?: number;
  /**
   * Maximum number of streams to return before stopping processing (early return optimization).
   * Higher values = more processing time but more options for users.
   * Recommended range: 1-20, default: 5
   */
  maxStreams?: number;
  /**
   * Number of torrents to process in parallel simultaneously.
   * Higher values = faster processing but more load on Real-Debrid API.
   * Recommended range: 1-10, default: 3
   */
  maxConcurrency?: number;
  /**
   * Environment variable overrides.
   * These take precedence over config-derived values when generating service files.
   * Use null to remove an override and reset to default/config value.
   */
  environmentVariables?: Record<string, string | null>;
}

/**
 * Feature configuration
 */
export interface FeatureConfig {
  firewall: boolean;
  fail2ban: boolean;
  caching: {
    enabled: boolean;
    ttl: number;
    maxSize: number;
  };
  rateLimiting: {
    enabled: boolean;
    stream: number;
    stats: number;
  };
  authentication: boolean;
  backups: {
    enabled: boolean;
    frequency: "daily" | "weekly" | "monthly";
    retention: number;
  };
  ssl: boolean;
  sslEmail?: string; // Email address for Let's Encrypt certificate registration
  duckdnsUpdater: boolean;
  autoStart: boolean;
}

/**
 * Paths configuration
 */
export interface PathsConfig {
  addonDirectory: string;
  nginxConfig: string;
  serviceFile: string;
  logs: string;
  backups: string;
  sshKey?: string;
}

/**
 * Encrypted secrets
 */
export interface SecretsConfig {
  realDebridToken?: string;
  duckdnsToken?: string;
  [key: string]: string | undefined;
}

/**
 * Installation configuration
 */
export interface InstallationConfig {
  type: InstallationType;
  accessMethod: AccessMethod;
  target?: TargetConfig;
}

/**
 * Update history entry for addon
 */
export interface AddonUpdateHistoryEntry {
  timestamp: Date;
  fromVersion: string;
  toVersion: string;
  success: boolean;
  duration: number;                   // milliseconds
  backupId?: string;
  rollbackId?: string;               // If this was a rollback
  error?: string;                     // Error message if failed
  initiatedBy?: 'user' | 'auto';     // Who initiated the update
}

/**
 * Backup entry for addon
 */
export interface AddonBackupEntry {
  id: string;                         // backup-20260121-143022
  timestamp: Date;
  version: string;                    // Version at time of backup
  path: string;                       // Path to backup archive
  size: number;                       // Backup size in bytes
  type: 'pre-update' | 'manual' | 'scheduled';
}

/**
 * Addon metadata stored in registry
 */
export interface AddonMetadata {
  id: string;
  name: string;
  slug: string;
  configPath: string;
  serviceName: string;
  port: number;
  domain: string;
  createdAt: string;
  updatedAt: string;
  
  // Version tracking
  version?: string;                   // Current installed version
  installedAt?: string;               // When first installed (ISO date string)
  lastUpdated?: string;               // Last update timestamp (ISO date string)
  updateHistory?: AddonUpdateHistoryEntry[];
  
  // Backup tracking
  backups?: AddonBackupEntry[];
  maxBackups?: number;                // Keep last N backups (default: 5)
}

/**
 * Addon registry structure (data format)
 */
export interface AddonRegistryData {
  version: string;
  defaultAddonId?: string;
  addons: AddonMetadata[];
}

/**
 * Complete addon manager configuration
 */
export interface AddonManagerConfig {
  addonId?: string;
  serviceName?: string;
  installation: InstallationConfig;
  addon: AddonConfig;
  features: FeatureConfig;
  paths: PathsConfig;
  secrets: SecretsConfig;
}

/**
 * Default configuration values
 */
export const DEFAULT_CONFIG: Partial<AddonManagerConfig> = {
  addon: {
    name: "My_Private_Addon",
    version: "1.0.0",
    domain: "",
    password: "",
    provider: Provider.REAL_DEBRID,
    torrentLimit: 15,
    port: 7000,
    availabilityCheckLimit: 15,
    maxStreams: 5,
    maxConcurrency: 3,
  },
  features: {
    firewall: true,
    fail2ban: true,
    caching: {
      enabled: true,
      ttl: 7200, // 2 hours
      maxSize: 100, // 100MB
    },
    rateLimiting: {
      enabled: true,
      stream: 50,
      stats: 120,
    },
    authentication: true,
    backups: {
      enabled: true,
      frequency: "weekly",
      retention: 7,
    },
    ssl: true,
    duckdnsUpdater: false,
    autoStart: true,
  },
};
