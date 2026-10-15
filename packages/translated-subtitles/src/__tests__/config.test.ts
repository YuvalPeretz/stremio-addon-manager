import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseGlossary } from "../config.js";
import { DEFAULT_MODEL_ID } from "../model-catalog.js";
import { DEFAULT_PORT, DEFAULT_TARGET_LANG } from "../env-keys.js";

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

async function freshLoadConfig(): Promise<import("../config.js").ServerConfig> {
  vi.resetModules();
  const { loadConfig } = await import("../config.js");
  return loadConfig();
}

describe("parseGlossary", () => {
  it("parses Name=Spelling lines and ignores blanks", () => {
    const entries = parseGlossary("Frodo=פרודו\n\n# comment\nGandalf=גנדלף\nbadline");
    expect(entries).toEqual([
      { source: "Frodo", target: "פרודו" },
      { source: "Gandalf", target: "גנדלף" },
    ]);
  });
});

describe("loadConfig", () => {
  it("defaults target lang, port, and model id", async () => {
    vi.stubEnv("ADDON_PASSWORD", "");
    vi.stubEnv("TARGET_LANG", "");
    vi.stubEnv("LLM_MODEL_ID", "");
    vi.stubEnv("PORT", "");
    const config = await freshLoadConfig();
    expect(config.targetLang).toBe(DEFAULT_TARGET_LANG);
    expect(config.port).toBe(DEFAULT_PORT);
    expect(config.llmModelId).toBe(DEFAULT_MODEL_ID);
    expect(config.authEnabled).toBe(false);
  });

  it("fills model URL/filename/bytes/sha from the catalog", async () => {
    vi.stubEnv("LLM_MODEL_ID", "qwen3-1.7b-q4_k_m");
    const config = await freshLoadConfig();
    expect(config.llmModelUrl).toContain("Qwen_Qwen3-1.7B-Q4_K_M.gguf");
    expect(config.llmModelFilename).toBe("Qwen_Qwen3-1.7B-Q4_K_M.gguf");
    expect(config.llmModelBytes).toBe(1_282_439_584);
    expect(config.llmModelSha256).toHaveLength(64);
  });

  it("clamps TRANSLATE_BATCH_SIZE to 4–12", async () => {
    vi.stubEnv("TRANSLATE_BATCH_SIZE", "99");
    const config = await freshLoadConfig();
    expect(config.translateBatchSize).toBe(8);
  });

  it("enables auth when ADDON_PASSWORD is set", async () => {
    vi.stubEnv("ADDON_PASSWORD", "secret");
    const config = await freshLoadConfig();
    expect(config.authEnabled).toBe(true);
    expect(config.addonPassword).toBe("secret");
  });

  it("honors TARGET_LANG override", async () => {
    vi.stubEnv("TARGET_LANG", "SPA");
    const config = await freshLoadConfig();
    expect(config.targetLang).toBe("spa");
  });

  it("applyCatalogModel fills catalog fields and clears drop-in path", async () => {
    vi.stubEnv("LLM_MODEL_ID", "qwen3-1.7b-q4_k_m");
    vi.stubEnv("LLM_MODEL_PATH", "/data/models/custom.gguf");
    const config = await freshLoadConfig();
    const { applyCatalogModel } = await import("../config.js");
    const entry = applyCatalogModel(config, "qwen3-0.6b-q4_k_m");
    expect(entry.id).toBe("qwen3-0.6b-q4_k_m");
    expect(config.llmModelId).toBe("qwen3-0.6b-q4_k_m");
    expect(config.llmModelFilename).toBe("Qwen_Qwen3-0.6B-Q4_K_M.gguf");
    expect(config.llmModelPath).toBe("");
  });
});
