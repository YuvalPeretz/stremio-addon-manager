/**
 * Configuration Module Types
 */

import type { OperatingSystem, LinuxDistribution } from "../types/common.js";
import type { AddonProduct } from "./product.js";

export type { AddonProduct } from "./product.js";
export {
  DEFAULT_ADDON_PRODUCT,
  normalizeAddonProduct,
  isTranslatedSubtitlesProduct,
  productPackageDir,
  productLabel,
  TRANSLATED_SUBTITLES_DEFAULT_PORT,
} from "./product.js";

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
  CUSTOM_SCRIPT = "custom_script",
}

/**
 * Artifact staging mode for custom-script installs.
 * - built: stage packaged addon-server (package.json + dist)
 * - source: stage source tree (package.json + src)
 */
export type CustomScriptArtifactMode = "built" | "source";

/**
 * Whether install and update use the same script file or separate files.
 */
export type CustomScriptUpdateScriptMode = "same" | "separate";

/**
 * Deploy mode passed to the user script as DEPLOY_MODE.
 */
export type CustomScriptDeployMode = "install" | "update" | "config";

/**
 * Custom-script installation settings (dual Gateway apps).
 * Scripts are embedded only in the ADMIN artifact; publicUrl is Stremio, managementUrl is private admin.
 */
export interface CustomScriptConfig {
  artifactMode: CustomScriptArtifactMode;
  updateScriptMode: CustomScriptUpdateScriptMode;
  /** Relative path inside the ADMIN artifact (default: deploy/install.sh) */
  installScriptRelPath: string;
  /** Relative path inside the ADMIN artifact (default: deploy/update.sh) */
  updateScriptRelPath: string;
  /** Env var names the user opted to inject into the script process */
  injectedVars: string[];
  /** Full base URL for the public Stremio app (may include /svc-xxx/ path prefix) */
  publicUrl: string;
  /** Full base URL for the private admin app (may include /svc-xxx/ path prefix) */
  managementUrl: string;
  /**
   * Gateway Manager SSH target (`user@host` or `user@host:port`).
   * When set, Electron uploads staged ADDON/ADMIN trees via SSHManager before the user script runs
   * and injects ADDON_REMOTE_STAGING / ADMIN_REMOTE_STAGING / MANAGER_SSH.
   */
  managerSsh?: string;
  /**
   * Optional SSH password for Manager uploads (key auth still preferred / tried first).
   * Persisted for update re-runs. Never log this value.
   */
  managerSshPassword?: string;
  /** Health check path under publicUrl (default: /health) */
  healthPath?: string;
  /** SHA-256 of last confirmed script content (for confirm-on-change) */
  lastScriptHash?: string;
  /**
   * Last install/same-mode deploy script body (secret-free).
   * Used when managementUrl scripts GET is unreachable (LAN HTTPS/TLS).
   */
  lastInstallScriptContent?: string;
  /**
   * Last separate update-script body when updateScriptMode === "separate".
   * Used with lastInstallScriptContent for offline/LAN management fallback.
   */
  lastUpdateScriptContent?: string;
  /** Last full env map applied via DEPLOY_MODE=config (for merge-before-write) */
  lastAppliedEnv?: Record<string, string>;
  /** Last local path used for the install script (wizard convenience) */
  lastLocalInstallScriptPath?: string;
  /** Last local path used for the update script (wizard convenience) */
  lastLocalUpdateScriptPath?: string;
}

/**
 * Defaults for custom-script config fields
 */
export const DEFAULT_CUSTOM_SCRIPT_CONFIG: Pick<
  CustomScriptConfig,
  | "artifactMode"
  | "updateScriptMode"
  | "installScriptRelPath"
  | "updateScriptRelPath"
  | "injectedVars"
  | "healthPath"
> = {
  artifactMode: "built",
  updateScriptMode: "same",
  installScriptRelPath: "deploy/install.sh",
  updateScriptRelPath: "deploy/update.sh",
  injectedVars: [],
  healthPath: "/health",
};

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
  /** Provider mode: "parallel" queries all simultaneously; "ordered" tries in priority order */
  streamProviderMode?: "parallel" | "ordered";
  /** Ordered list of provider IDs to use, e.g. [Provider.REAL_DEBRID, Provider.TORBOX] */
  streamProviderOrder?: Provider[];
  /** Maximum number of concurrent viewers (unique IPs). 0 = unlimited. Default: 10. */
  maxConcurrentViewers?: number;
  /**
   * Environment variable overrides.
   * These take precedence over config-derived values when generating service files.
   * Use null to remove an override and reset to default/config value.
   */
  environmentVariables?: Record<string, string | null>;
  /** TranslatedSubtitles: single ISO 639-2/3 target language (e.g. heb, eng). */
  targetLang?: string;
  /** TranslatedSubtitles: catalog model id (default qwen3-1.7b-q4_k_m). */
  llmModelId?: string;
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
  /**
   * Directory for addon-server local library (`library.json`). If unset, install/sync uses
   * `<addonDirectory>/local-library`. Set to empty string to omit LOCAL_LIBRARY_DATA_DIR from the unit (feature off).
   */
  localLibraryDataDir?: string;
}

/**
 * Encrypted secrets
 */
export interface SecretsConfig {
  realDebridToken?: string;
  duckdnsToken?: string;
  torboxToken?: string;
  [key: string]: string | undefined;
}

/**
 * Installation configuration
 */
export interface InstallationConfig {
  type: InstallationType;
  accessMethod: AccessMethod;
  target?: TargetConfig;
  /** Present when type === InstallationType.CUSTOM_SCRIPT */
  customScript?: CustomScriptConfig;
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
  /**
   * Installable product. Missing on legacy entries — treat as `"streaming"`.
   */
  product?: AddonProduct;
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
  /** Installable product. Missing on legacy configs — treat as `"streaming"`. */
  product?: AddonProduct;
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
  product: "streaming",
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
    streamProviderMode: "parallel",
    streamProviderOrder: [Provider.REAL_DEBRID],
    maxConcurrentViewers: 10,
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
