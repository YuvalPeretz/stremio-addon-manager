/**
 * Configuration Module Types
 */

import type { OperatingSystem, LinuxDistribution } from '../types/common.js';

/**
 * Access method for the addon
 */
export enum AccessMethod {
  CUSTOM_DOMAIN = 'custom_domain',
  DUCKDNS = 'duckdns',
  STATIC_IP_WITH_DOMAIN = 'static_ip_domain',
  LOCAL_NETWORK = 'local_network',
}

/**
 * Installation type
 */
export enum InstallationType {
  LOCAL = 'local',
  REMOTE = 'remote',
}

/**
 * Provider type
 */
export enum Provider {
  REAL_DEBRID = 'real-debrid',
  ALL_DEBRID = 'alldebrid',
  PREMIUMIZE = 'premiumize',
  TORBOX = 'torbox',
}

/**
 * Target machine configuration
 */
export interface TargetConfig {
  host?: string;
  port?: number;
  username?: string;
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
    frequency: 'daily' | 'weekly' | 'monthly';
    retention: number;
  };
  ssl: boolean;
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
 * Complete addon manager configuration
 */
export interface AddonManagerConfig {
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
    name: 'My_Private_Addon',
    version: '1.0.0',
    domain: '',
    password: '',
    provider: Provider.REAL_DEBRID,
    torrentLimit: 15,
    port: 7000,
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
      frequency: 'weekly',
      retention: 7,
    },
    ssl: true,
    duckdnsUpdater: false,
    autoStart: true,
  },
};

