/**
 * Product-scoped env map for TranslatedSubtitles.
 * No RD / TorBox / STREAM_PROVIDER keys.
 */

import type { AddonManagerConfig } from "./types.js";
import type { EnvVarMetadata } from "./env-manager.js";
import { TRANSLATED_SUBTITLES_DEFAULT_PORT } from "./product.js";
import { DEFAULT_LLM_MODEL_ID, resolveLlmModelCatalogEntry } from "./llm-model-catalog.js";

export const DEFAULT_TARGET_LANG = "eng";
export const DEFAULT_OPENSUBTITLES_BASE_URL = "https://opensubtitles-v3.strem.io";
export const DEFAULT_LLM_MODELS_DIR = "/data/models";
export const DEFAULT_LLM_SERVER_URL = "http://127.0.0.1:8081";
export const DEFAULT_SUBTITLE_CACHE_DIR = "/data/subtitle-cache";
export const DEFAULT_SUBTITLE_CACHE_TTL_SEC = 2592000;
export const DEFAULT_ADDON_REQUEST_LOG = "/data/logs/request-log.jsonl";
export const DEFAULT_ADDON_SERVER_LOG = "/data/logs/server.log";

const TARGET_LANG_RE = /^[a-z]{2,3}$/;

export const STREAMING_ONLY_ENV_KEYS: readonly string[] = [
  "RD_API_TOKEN",
  "REAL_DEBRID_API_KEY",
  "TORBOX_API_TOKEN",
  "STREAM_PROVIDER_MODE",
  "STREAM_PROVIDER_ORDER",
  "TORRENT_LIMIT",
  "AVAILABILITY_CHECK_LIMIT",
  "MAX_STREAMS",
  "MAX_CONCURRENCY",
  "MAX_CONCURRENT_VIEWERS",
  "LOCAL_LIBRARY_DATA_DIR",
  "LOCAL_LIBRARY_SCAN_MAX_DEPTH",
  "LOCAL_LIBRARY_SCAN_MAX_FILES",
  "LOCAL_LIBRARY_MAX_FUZZY_RESULTS",
  "LOCAL_LIBRARY_FUZZY_THRESHOLD",
];

export const TRANSLATED_SUBTITLES_ENV_METADATA: Record<string, EnvVarMetadata> = {
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
    description: "Addon server port (container listen port for custom_script)",
    default: TRANSLATED_SUBTITLES_DEFAULT_PORT,
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
  },
  ENABLE_MANAGEMENT_API: {
    description:
      "Expose /management UI and APIs. Public dual-app is false; admin / classic bake is true.",
    default: "false",
    type: "boolean",
    required: false,
    sensitive: false,
    generateable: false,
    source: "classic install / service file",
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
  TARGET_LANG: {
    description: "Single target subtitle language (ISO 639-2/3), e.g. heb, eng",
    default: DEFAULT_TARGET_LANG,
    type: "string",
    required: true,
    sensitive: false,
    generateable: false,
    source: "config.addon.targetLang",
    validation: (value) => {
      if (!TARGET_LANG_RE.test(value.trim().toLowerCase())) {
        return { valid: false, error: "TARGET_LANG must be a 2–3 letter ISO 639 code" };
      }
      return { valid: true };
    },
  },
  LLM_MODEL_ID: {
    description: "Catalog model id (default qwen3-1.7b-q4_k_m)",
    default: DEFAULT_LLM_MODEL_ID,
    type: "string",
    required: true,
    sensitive: false,
    generateable: false,
    source: "config.addon.llmModelId",
  },
  LLM_MODEL_URL: {
    description: "Pinned Hugging Face GGUF download URL from the model catalog",
    type: "string",
    required: false,
    sensitive: false,
    generateable: false,
    source: "catalog",
  },
  LLM_MODEL_FILENAME: {
    description: "Expected GGUF filename in LLM_MODELS_DIR",
    type: "string",
    required: false,
    sensitive: false,
    generateable: false,
    source: "catalog",
  },
  LLM_MODEL_SHA256: {
    description: "Expected SHA-256 of the GGUF (when catalog-pinned)",
    type: "string",
    required: false,
    sensitive: false,
    generateable: false,
    source: "catalog",
  },
  LLM_MODEL_BYTES: {
    description: "Expected GGUF size in bytes (when catalog-pinned)",
    type: "number",
    required: false,
    sensitive: false,
    generateable: false,
    source: "catalog",
  },
  LLM_MODELS_DIR: {
    description: "Durable directory for downloaded GGUF files",
    default: DEFAULT_LLM_MODELS_DIR,
    type: "string",
    required: false,
    sensitive: false,
    generateable: false,
    source: "manual",
  },
  LLM_MODEL_PATH: {
    description: "Optional offline drop-in path to a pre-downloaded GGUF",
    type: "string",
    required: false,
    sensitive: false,
    generateable: false,
    source: "manual",
  },
  LLM_SERVER_URL: {
    description: "llama.cpp sidecar URL",
    default: DEFAULT_LLM_SERVER_URL,
    type: "string",
    required: false,
    sensitive: false,
    generateable: false,
    source: "manual",
  },
  LLM_THREADS: {
    description: "Optional CPU thread count for the sidecar",
    type: "number",
    min: 1,
    max: 128,
    required: false,
    sensitive: false,
    generateable: false,
    source: "manual",
  },
  OPENSUBTITLES_BASE_URL: {
    description: "Upstream OpenSubtitles v3 Stremio addon base",
    default: DEFAULT_OPENSUBTITLES_BASE_URL,
    type: "string",
    required: false,
    sensitive: false,
    generateable: false,
    source: "manual",
  },
  SUBTITLE_CACHE_DIR: {
    description: "Disk cache for translated subtitle files",
    default: DEFAULT_SUBTITLE_CACHE_DIR,
    type: "string",
    required: false,
    sensitive: false,
    generateable: false,
    source: "manual",
  },
  SUBTITLE_CACHE_TTL_SEC: {
    description: "Translated subtitle cache TTL in seconds",
    default: DEFAULT_SUBTITLE_CACHE_TTL_SEC,
    type: "number",
    min: 60,
    required: false,
    sensitive: false,
    generateable: false,
    source: "manual",
  },
  TRANSLATION_GLOSSARY: {
    description: "Optional Name=Spelling lines for character/name consistency",
    type: "string",
    required: false,
    sensitive: false,
    generateable: false,
    source: "manual",
  },
  ADDON_REQUEST_LOG: {
    description: "Request log path (Gateway data volume when mounted)",
    default: DEFAULT_ADDON_REQUEST_LOG,
    type: "string",
    required: false,
    sensitive: false,
    generateable: false,
    source: "manual",
  },
  ADDON_SERVER_LOG: {
    description: "Server log path (Gateway data volume when mounted)",
    default: DEFAULT_ADDON_SERVER_LOG,
    type: "string",
    required: false,
    sensitive: false,
    generateable: false,
    source: "manual",
  },
};

/**
 * Config-derived env for TranslatedSubtitles (no streaming provider keys).
 */
export function getTranslatedSubtitlesEnvVarsFromConfig(config: AddonManagerConfig): Record<string, string> {
  const model = resolveLlmModelCatalogEntry(config.addon.llmModelId);
  const targetLang = (config.addon.targetLang || DEFAULT_TARGET_LANG).trim().toLowerCase();

  const envVars: Record<string, string> = {
    NODE_ENV: "production",
    PORT: String(config.addon.port || TRANSLATED_SUBTITLES_DEFAULT_PORT),
    TARGET_LANG: targetLang,
    LLM_MODEL_ID: model.id,
    LLM_MODEL_URL: model.url,
    LLM_MODEL_FILENAME: model.filename,
    LLM_MODELS_DIR: DEFAULT_LLM_MODELS_DIR,
    LLM_SERVER_URL: DEFAULT_LLM_SERVER_URL,
    OPENSUBTITLES_BASE_URL: DEFAULT_OPENSUBTITLES_BASE_URL,
    SUBTITLE_CACHE_DIR: DEFAULT_SUBTITLE_CACHE_DIR,
    SUBTITLE_CACHE_TTL_SEC: String(DEFAULT_SUBTITLE_CACHE_TTL_SEC),
    ADDON_REQUEST_LOG: DEFAULT_ADDON_REQUEST_LOG,
    ADDON_SERVER_LOG: DEFAULT_ADDON_SERVER_LOG,
    ENABLE_MANAGEMENT_API: "true",
  };

  if (model.sha256) {
    envVars.LLM_MODEL_SHA256 = model.sha256;
  }
  if (typeof model.expectedBytes === "number" && model.expectedBytes > 0) {
    envVars.LLM_MODEL_BYTES = String(model.expectedBytes);
  }

  if (config.addon.password) {
    envVars.ADDON_PASSWORD = config.addon.password;
  }
  if (config.addon.domain) {
    envVars.ADDON_DOMAIN = config.addon.domain;
  }

  return envVars;
}

export function stripStreamingOnlyEnvKeys(env: Record<string, string>): Record<string, string> {
  const next = { ...env };
  for (const key of STREAMING_ONLY_ENV_KEYS) {
    delete next[key];
  }
  return next;
}
