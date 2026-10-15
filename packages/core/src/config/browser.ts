/**
 * Browser-safe config exports for Electron renderer (no Node I/O, SSH, or service code).
 */

export type { AddonProduct } from "./product.js";
export {
  DEFAULT_ADDON_PRODUCT,
  normalizeAddonProduct,
  isTranslatedSubtitlesProduct,
  productPackageDir,
  productLabel,
  TRANSLATED_SUBTITLES_DEFAULT_PORT,
} from "./product.js";

export type { LlmModelCatalogEntry } from "./llm-model-catalog.js";
export {
  LLM_MODEL_CATALOG,
  DEFAULT_LLM_MODEL_ID,
  getLlmModelCatalogEntry,
  resolveLlmModelCatalogEntry,
  llmModelWizardCopy,
} from "./llm-model-catalog.js";

export { DEFAULT_TARGET_LANG } from "./translated-subtitles-env.js";
