/**
 * @stremio-addon-manager/core
 *
 * Core shared logic for Stremio Addon Manager
 * Provides OS detection, SSH management, service control, and configuration management
 */

// Export common types
export type { SystemInfo, Result, ExecutionResult } from "./types/common.js";
export { OperatingSystem, LinuxDistribution, Architecture } from "./types/common.js";

// Export OS module
export { OSDetector } from "./os/index.js";

// Export SSH module
export { SSHManager } from "./ssh/index.js";
export type { SSHConfig, SSHExecResult, SSHConnection } from "./ssh/index.js";
export { SSHEvent } from "./ssh/index.js";

// Export Service module
export { ServiceManager, getServiceNameFromAddonId } from "./service/index.js";
export type { ServiceInfo, ServiceConfig } from "./service/index.js";
export { ServiceStatus } from "./service/index.js";

// Export Config module
export { ConfigManager, AddonRegistry, AddonRegistryManager, generateServiceName, EnvVarManager } from "./config/index.js";
export {
  migrateLegacyConfig,
  autoMigrateIfNeeded,
  legacyConfigExists,
} from "./config/index.js";
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
} from "./config/index.js";
export { AccessMethod, InstallationType, Provider, DEFAULT_CONFIG } from "./config/index.js";

// Export Utils module
export { logger, initLogger, getLogger, LogLevel } from "./utils/index.js";
export type { Logger, LoggerConfig } from "./utils/index.js";

// Export Installation module
export { InstallationManager, UpdateManager } from "./installation/index.js";
export type {
  InstallationOptions,
  InstallationResult,
  InstallationProgress,
  PrerequisiteCheck,
  ProgressCallback,
  UpdateOptions,
  UpdateResult,
  UpdateInfo,
  PreUpdateCheck,
  UpdateProgress,
  RollbackOptions,
  RollbackResult,
  BackupOptions,
  BackupEntry,
  UpdateHistoryEntry,
  VersionComparison,
} from "./installation/index.js";
export { InstallationStep, StepStatus, UpdateStep, UpdateStepStatus } from "./installation/index.js";

// Export Server module
export { ServerDetector, ServerConnection, ConnectionProfileManager } from "./server/index.js";
export type {
  ServerInfo,
  AddonManifest,
  Catalog,
  Extra,
  ServerConnectionConfig,
  ServerHealth,
  ConnectionProfile,
  ServerStats,
  ServerDetectionResult,
} from "./server/index.js";
