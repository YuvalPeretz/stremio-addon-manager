/**
 * Public API for @stremio-addon-manager/translated-subtitles.
 * Importing this module does not start the HTTP server (see ./main.js).
 */

export { loadConfig, parseGlossary, applyCatalogModel, type ServerConfig } from "./config.js";
export {
  PRODUCT_ID,
  DEFAULT_TARGET_LANG,
  DEFAULT_PORT,
  DEFAULT_LLM_SERVER_URL,
  DEFAULT_OPENSUBTITLES_BASE_URL,
  TRANSLATED_SUBTITLES_ENV_KEYS,
  TRANSLATED_SUBTITLES_ENV_DEFINITIONS,
  type TranslatedSubtitlesEnvKey,
} from "./env-keys.js";
export {
  DEFAULT_MODEL_ID,
  loadModelCatalog,
  getModelCatalog,
  getDefaultModelId,
  getModelById,
  requireModelById,
  getCatalogJsonPath,
} from "./model-catalog.js";
export { manifest, MANIFEST_ID, type AddonManifest } from "./manifest.js";
export { createServer, type ServerDeps } from "./server.js";
export { parseSubtitle, rebundleSubtitle, cueTexts, detectFormat } from "./subtitle-parse.js";
export { buildCacheKey, SubtitleCache } from "./cache.js";
export type {
  ModelCatalogEntry,
  ModelCatalogFile,
  EnvVarDefinition,
  StremioSubtitle,
  GlossaryEntry,
  SubtitleCue,
  ParsedSubtitle,
} from "./types.js";
