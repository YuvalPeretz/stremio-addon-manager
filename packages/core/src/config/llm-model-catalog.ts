/**
 * LLM GGUF catalog for TranslatedSubtitles.
 * Weights are downloaded on the target host — never bundled in Electron/CLI/core.
 */

export interface LlmModelCatalogEntry {
  id: string;
  label: string;
  family: string;
  tier: string;
  ramBlurb: string;
  qualityBlurb: string;
  recommended: boolean;
  experimental: boolean;
  url: string;
  filename: string;
  sha256?: string;
  expectedBytes?: number;
}

/** Pinned bartowski Q4_K_M (live-probed 2026-08-15). */
export const DEFAULT_LLM_MODEL_ID = "qwen3-1.7b-q4_k_m";

export const LLM_MODEL_CATALOG: readonly LlmModelCatalogEntry[] = [
  {
    id: "qwen3-0.6b-q4_k_m",
    label: "Qwen3-0.6B",
    family: "Qwen3",
    tier: "Ultra-light",
    ramBlurb: "~2 GB RAM",
    qualityBlurb: "experimental quality",
    recommended: false,
    experimental: true,
    url: "https://huggingface.co/bartowski/Qwen_Qwen3-0.6B-GGUF/resolve/main/Qwen_Qwen3-0.6B-Q4_K_M.gguf",
    filename: "Qwen_Qwen3-0.6B-Q4_K_M.gguf",
  },
  {
    id: "qwen3-1.7b-q4_k_m",
    label: "Qwen3-1.7B",
    family: "Qwen3",
    tier: "Light",
    ramBlurb: "~3 GB RAM",
    qualityBlurb: "recommended minimum",
    recommended: true,
    experimental: false,
    url: "https://huggingface.co/bartowski/Qwen_Qwen3-1.7B-GGUF/resolve/main/Qwen_Qwen3-1.7B-Q4_K_M.gguf",
    filename: "Qwen_Qwen3-1.7B-Q4_K_M.gguf",
    sha256: "72c5c3cb38fa32d5256e2fe30d03e7a64c6c79e668ad84057e3bd66e250b24fb",
    expectedBytes: 1282439584,
  },
  {
    id: "gemma3-1b-q4_k_m",
    label: "Gemma 3 1B",
    family: "Gemma 3",
    tier: "Light alt",
    ramBlurb: "~2 GB RAM",
    qualityBlurb: "weaker multilingual",
    recommended: false,
    experimental: false,
    url: "https://huggingface.co/bartowski/google_gemma-3-1b-it-GGUF/resolve/main/google_gemma-3-1b-it-Q4_K_M.gguf",
    filename: "google_gemma-3-1b-it-Q4_K_M.gguf",
  },
  {
    id: "qwen3-4b-q4_k_m",
    label: "Qwen3-4B",
    family: "Qwen3",
    tier: "Balanced",
    ramBlurb: "~5 GB RAM",
    qualityBlurb: "better context (Pi 5 8GB / PC)",
    recommended: false,
    experimental: false,
    url: "https://huggingface.co/bartowski/Qwen_Qwen3-4B-GGUF/resolve/main/Qwen_Qwen3-4B-Q4_K_M.gguf",
    filename: "Qwen_Qwen3-4B-Q4_K_M.gguf",
  },
];

export function getLlmModelCatalogEntry(id: string): LlmModelCatalogEntry | undefined {
  return LLM_MODEL_CATALOG.find((entry) => entry.id === id);
}

export function resolveLlmModelCatalogEntry(id?: string | null): LlmModelCatalogEntry {
  const resolved = (id && getLlmModelCatalogEntry(id)) || getLlmModelCatalogEntry(DEFAULT_LLM_MODEL_ID);
  if (!resolved) {
    throw new Error(`LLM model catalog is missing default id ${DEFAULT_LLM_MODEL_ID}`);
  }
  return resolved;
}

export function llmModelWizardCopy(entry: LlmModelCatalogEntry): string {
  const quality = entry.recommended ? `**${entry.qualityBlurb}**` : entry.qualityBlurb;
  return `${entry.tier} · ${entry.ramBlurb} · ${quality}`;
}
