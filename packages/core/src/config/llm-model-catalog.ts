/**
 * LLM GGUF catalog for TranslatedSubtitles.
 * Weights are downloaded on the target host — never bundled in Electron/CLI/core.
 */

export type CatalogEngine = "llm" | "mt";

export interface LlmModelCatalogEntry {
  id: string;
  label: string;
  family: string;
  engine: CatalogEngine;
  tier: string;
  ramBlurb: string;
  qualityBlurb: string;
  recommended: boolean;
  experimental: boolean;
  url: string;
  filename: string;
  sha256?: string;
  expectedBytes?: number;
  /** Extra snapshot files for MT (CTranslate2 directory). */
  files?: readonly string[];
}

/** Pinned bartowski Q4_K_M (live-probed 2026-08-15). */
export const DEFAULT_LLM_MODEL_ID = "qwen3-1.7b-q4_k_m";

export const LLM_MODEL_CATALOG: readonly LlmModelCatalogEntry[] = [
  {
    id: "qwen3-0.6b-q4_k_m",
    label: "Qwen3-0.6B",
    family: "Qwen3",
    engine: "llm",
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
    engine: "llm",
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
    engine: "llm",
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
    engine: "llm",
    tier: "Balanced",
    ramBlurb: "~5 GB RAM",
    qualityBlurb: "better context (Pi 5 8GB / PC)",
    recommended: false,
    experimental: false,
    url: "https://huggingface.co/bartowski/Qwen_Qwen3-4B-GGUF/resolve/main/Qwen_Qwen3-4B-Q4_K_M.gguf",
    filename: "Qwen_Qwen3-4B-Q4_K_M.gguf",
  },
  {
    id: "nllb-200-distilled-600m-int8",
    label: "NLLB-200 distilled 600M",
    family: "NLLB",
    engine: "mt",
    tier: "Fast / literal",
    ramBlurb: "~1.5 GB RAM",
    qualityBlurb: "not an LLM — fast line-by-line MT",
    recommended: false,
    experimental: false,
    url: "https://huggingface.co/JustFrederik/nllb-200-distilled-600M-ct2-int8/resolve/main/model.bin",
    filename: "nllb-200-distilled-600M-ct2-int8",
    sha256: "ed1beaf75134de7505315a5223162f56acff397eff6b50638a500d3936fe707b",
    expectedBytes: 622595991,
    files: ["model.bin", "sentencepiece.bpe.model", "config.json", "shared_vocabulary.txt"],
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

export function catalogEngine(entry: LlmModelCatalogEntry): CatalogEngine {
  return entry.engine === "mt" ? "mt" : "llm";
}

/** Confirm-dialog copy when switching translation engines in Configuration. */
export function engineSwitchConfirmCopy(fromId: string, toId: string): string {
  const from = getLlmModelCatalogEntry(fromId);
  const to = getLlmModelCatalogEntry(toId);
  const fromEng = from ? catalogEngine(from) : "llm";
  const toEng = to ? catalogEngine(to) : "llm";
  if (fromEng === "llm" && toEng === "mt") {
    return "This will stop llama, delete GGUFs in the models directory, download NLLB, and start CTranslate2.";
  }
  if (fromEng === "mt" && toEng === "llm") {
    return "This will stop CTranslate2, delete the NLLB model directory, download the GGUF, and start llama.";
  }
  return "This deletes the previous GGUF in the models directory, then downloads the new file. Llama will reload.";
}

export function llmModelWizardCopy(entry: LlmModelCatalogEntry): string {
  const quality = entry.recommended ? `**${entry.qualityBlurb}**` : entry.qualityBlurb;
  return `${entry.tier} · ${entry.ramBlurb} · ${quality}`;
}
