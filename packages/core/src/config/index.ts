/**
 * Config Module - Configuration Management
 */

export { ConfigManager } from "./manager.js";
export { AddonRegistry } from "./registry.js";
export { AddonRegistryManager, generateServiceName } from "./registry-manager.js";
export { migrateLegacyConfig, autoMigrateIfNeeded, legacyConfigExists } from "./migration.js";
export { EnvVarManager } from "./env-manager.js";
export type {
  AddonManagerConfig,
  AddonConfig,
  InstallationConfig,
  FeatureConfig,
  PathsConfig,
  SecretsConfig,
  TargetConfig,
  AddonMetadata,
  AddonRegistryData,
} from "./types.js";
export type { EnvVarMetadata } from "./env-manager.js";
export { AccessMethod, InstallationType, Provider, DEFAULT_CONFIG } from "./types.js";
