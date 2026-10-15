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
export {
  ConfigManager,
  AddonRegistry,
  AddonRegistryManager,
  generateServiceName,
  EnvVarManager,
  CUSTOM_SCRIPT_REGISTRY_PORT,
  domainFromPublicUrl,
} from "./config/index.js";
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
  CustomScriptConfig,
  CustomScriptArtifactMode,
  CustomScriptUpdateScriptMode,
  CustomScriptDeployMode,
  CreateAddonOptions,
  AddonProduct,
  LlmModelCatalogEntry,
} from "./config/index.js";
export {
  AccessMethod,
  InstallationType,
  Provider,
  DEFAULT_CONFIG,
  DEFAULT_CUSTOM_SCRIPT_CONFIG,
  DEFAULT_ADDON_PRODUCT,
  normalizeAddonProduct,
  isTranslatedSubtitlesProduct,
  productPackageDir,
  productLabel,
  TRANSLATED_SUBTITLES_DEFAULT_PORT,
  LLM_MODEL_CATALOG,
  DEFAULT_LLM_MODEL_ID,
  getLlmModelCatalogEntry,
  resolveLlmModelCatalogEntry,
  llmModelWizardCopy,
  TRANSLATED_SUBTITLES_ENV_METADATA,
  STREAMING_ONLY_ENV_KEYS,
  getTranslatedSubtitlesEnvVarsFromConfig,
  stripStreamingOnlyEnvKeys,
  DEFAULT_TARGET_LANG,
  DEFAULT_OPENSUBTITLES_BASE_URL,
  DEFAULT_LLM_MODELS_DIR,
  DEFAULT_LLM_SERVER_URL,
} from "./config/index.js";

// Export Utils module
export { logger, initLogger, getLogger, LogLevel } from "./utils/index.js";
export type { Logger, LoggerConfig } from "./utils/index.js";
export { normalizeBaseUrl, joinBaseUrl, preferHttpForLoopback } from "./utils/index.js";

// Export Installation module
export {
  InstallationManager,
  UpdateManager,
  CustomScriptInstaller,
  hashScriptContent,
  parseManagerSsh,
  preflightBash,
  resolveBashPath,
  runBashScript,
  detectPythonInBash,
  createPython3ShimDir,
  runBashCommand,
  PYTHON_DOWNLOAD_URL,
  SSH_HELP_URL,
  resolveBundledAddonServerPath,
  readBundledAddonServerVersion,
  resolveBundledProductPath,
  readBundledProductVersion,
} from "./installation/index.js";
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
  CustomScriptRunOptions,
  CustomScriptRunResult,
  CustomScriptAddonIdentity,
  StagedArtifacts,
  RemoteStagingPaths,
  ParsedManagerSsh,
  BashPreflightResult,
  BashPreflightErrorCode,
  ScriptRunOptions,
  ScriptRunResult,
  PythonPreflightInfo,
  PythonResolvedAs,
  ToolPreflightInfo,
} from "./installation/index.js";
export { InstallationStep, StepStatus, UpdateStep, UpdateStepStatus } from "./installation/index.js";

// Export Server module
export { ServerDetector, ServerConnection, ConnectionProfileManager, normalizeHealthPayload } from "./server/index.js";
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
