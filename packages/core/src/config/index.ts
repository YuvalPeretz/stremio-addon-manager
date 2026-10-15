/**
 * Config Module - Configuration Management
 */

export { ConfigManager } from "./manager.js";
export { AddonRegistry } from "./registry.js";
export {
  AddonRegistryManager,
  generateServiceName,
  CUSTOM_SCRIPT_REGISTRY_PORT,
  domainFromPublicUrl,
} from "./registry-manager.js";
export type { CreateAddonOptions } from "./registry-manager.js";
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
  CustomScriptConfig,
  CustomScriptArtifactMode,
  CustomScriptUpdateScriptMode,
  CustomScriptDeployMode,
} from "./types.js";
export type { EnvVarMetadata } from "./env-manager.js";
export type { AddonProduct } from "./product.js";
export {
  DEFAULT_ADDON_PRODUCT,
  normalizeAddonProduct,
  isTranslatedSubtitlesProduct,
  productPackageDir,
  productLabel,
  TRANSLATED_SUBTITLES_DEFAULT_PORT,
} from "./product.js";
export {
  LLM_MODEL_CATALOG,
  DEFAULT_LLM_MODEL_ID,
  getLlmModelCatalogEntry,
  resolveLlmModelCatalogEntry,
  catalogEngine,
  engineSwitchConfirmCopy,
  llmModelWizardCopy,
} from "./llm-model-catalog.js";
export type { LlmModelCatalogEntry, CatalogEngine } from "./llm-model-catalog.js";
export {
  TRANSLATED_SUBTITLES_ENV_METADATA,
  STREAMING_ONLY_ENV_KEYS,
  getTranslatedSubtitlesEnvVarsFromConfig,
  stripStreamingOnlyEnvKeys,
  DEFAULT_TARGET_LANG,
  DEFAULT_OPENSUBTITLES_BASE_URL,
  DEFAULT_LLM_MODELS_DIR,
  DEFAULT_LLM_SERVER_URL,
  DEFAULT_MT_MODELS_DIR,
  DEFAULT_MT_SERVER_URL,
} from "./translated-subtitles-env.js";
export {
  AccessMethod,
  InstallationType,
  Provider,
  DEFAULT_CONFIG,
  DEFAULT_CUSTOM_SCRIPT_CONFIG,
} from "./types.js";
