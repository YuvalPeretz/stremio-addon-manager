/**
 * Configuration Module Types
 */
import type { OperatingSystem, LinuxDistribution } from '../types/common.js';
/**
 * Access method for the addon
 */
export declare enum AccessMethod {
    CUSTOM_DOMAIN = "custom_domain",
    DUCKDNS = "duckdns",
    STATIC_IP_WITH_DOMAIN = "static_ip_domain",
    LOCAL_NETWORK = "local_network"
}
/**
 * Installation type
 */
export declare enum InstallationType {
    LOCAL = "local",
    REMOTE = "remote"
}
/**
 * Provider type
 */
export declare enum Provider {
    REAL_DEBRID = "real-debrid",
    ALL_DEBRID = "alldebrid",
    PREMIUMIZE = "premiumize",
    TORBOX = "torbox"
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
export declare const DEFAULT_CONFIG: Partial<AddonManagerConfig>;
//# sourceMappingURL=types.d.ts.map