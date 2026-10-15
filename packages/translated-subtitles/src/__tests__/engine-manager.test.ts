import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EngineManager, type EngineSidecar, type LlmEngineSidecar } from "../engine-manager.js";
import type { LlmHealth } from "../types.js";
import { testServerConfig } from "./helpers/server-config.js";

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "tsub-engine-"));
}

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  dirs.length = 0;
});

function health(url: string, healthy = false): LlmHealth {
  return { healthy, url, reason: healthy ? undefined : "down" };
}

function fakeLlm(overrides: Partial<LlmEngineSidecar> = {}): LlmEngineSidecar {
  const url = "http://127.0.0.1:18081";
  return {
    ensureReady: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    probeHealth: vi.fn(async () => health(url)),
    getStatus: vi.fn(() => health(url, true)),
    replaceModel: vi.fn(async (modelId: string) => ({
      modelId,
      filename: "Qwen_Qwen3-0.6B-Q4_K_M.gguf",
      attachedSibling: false,
      pruned: [],
      llm: health(url, true),
    })),
    ...overrides,
  };
}

function fakeMt(overrides: Partial<EngineSidecar> = {}): EngineSidecar {
  const url = "http://127.0.0.1:18082";
  return {
    ensureReady: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    probeHealth: vi.fn(async () => health(url)),
    getStatus: vi.fn(() => health(url, true)),
    ...overrides,
  };
}

describe("EngineManager exclusive switch", () => {
  it("LLM→MT stops llama, deletes GGUFs, keeps an outside drop-in, and does not start llama", async () => {
    const root = tmpDir();
    dirs.push(root);
    const modelsDir = path.join(root, "models");
    const mtDir = path.join(root, "nllb");
    const outside = path.join(root, "outside");
    fs.mkdirSync(modelsDir, { recursive: true });
    fs.mkdirSync(mtDir, { recursive: true });
    fs.mkdirSync(outside, { recursive: true });
    const gguf = path.join(modelsDir, "Qwen_Qwen3-1.7B-Q4_K_M.gguf");
    const part = path.join(modelsDir, "old.gguf.part");
    const dropIn = path.join(outside, "custom.gguf");
    fs.writeFileSync(gguf, "gguf");
    fs.writeFileSync(part, "part");
    fs.writeFileSync(dropIn, "drop");

    const llm = fakeLlm();
    const mt = fakeMt();
    const config = testServerConfig({
      engine: "llm",
      llmModelsDir: modelsDir,
      llmModelPath: dropIn,
      mtModelsDir: mtDir,
    });
    const manager = new EngineManager(config, { llm, mt });
    const result = await manager.replace("nllb-200-distilled-600m-int8");

    expect(llm.stop).toHaveBeenCalled();
    expect(llm.ensureReady).not.toHaveBeenCalled();
    expect(llm.replaceModel).not.toHaveBeenCalled();
    expect(mt.ensureReady).toHaveBeenCalledWith({ skipAttach: true });
    expect(fs.existsSync(gguf)).toBe(false);
    expect(fs.existsSync(part)).toBe(false);
    expect(fs.existsSync(dropIn)).toBe(true);
    expect(config.engine).toBe("mt");
    expect(config.llmModelPath).toBe("");
    expect(result.engine).toBe("mt");
    expect(result.pruned.some((p) => p.endsWith("Qwen_Qwen3-1.7B-Q4_K_M.gguf"))).toBe(true);
  });

  it("MT→LLM stops CTranslate2 and removes the NLLB dir", async () => {
    const root = tmpDir();
    dirs.push(root);
    const modelsDir = path.join(root, "models");
    const mtDir = path.join(root, "nllb");
    const extract = path.join(mtDir, "nllb-200-distilled-600M-ct2-int8");
    fs.mkdirSync(modelsDir, { recursive: true });
    fs.mkdirSync(extract, { recursive: true });
    fs.writeFileSync(path.join(extract, "model.bin"), "weights");

    const llm = fakeLlm();
    const mt = fakeMt();
    const config = testServerConfig({
      engine: "mt",
      llmModelId: "nllb-200-distilled-600m-int8",
      llmModelsDir: modelsDir,
      mtModelsDir: mtDir,
      mtModelDirName: "nllb-200-distilled-600M-ct2-int8",
    });
    const manager = new EngineManager(config, { llm, mt });
    const result = await manager.replace("qwen3-1.7b-q4_k_m");

    expect(mt.stop).toHaveBeenCalled();
    expect(mt.ensureReady).not.toHaveBeenCalled();
    expect(llm.ensureReady).toHaveBeenCalled();
    expect(fs.existsSync(extract)).toBe(false);
    expect(config.engine).toBe("llm");
    expect(result.engine).toBe("llm");
  });

  it("cold start with NLLB never probes or spawns llama", async () => {
    const llm = fakeLlm();
    const mt = fakeMt();
    const config = testServerConfig({
      engine: "mt",
      llmModelId: "nllb-200-distilled-600m-int8",
    });
    const manager = new EngineManager(config, { llm, mt });
    await manager.ensureReady();
    expect(mt.ensureReady).toHaveBeenCalled();
    expect(llm.ensureReady).not.toHaveBeenCalled();
    expect(llm.probeHealth).not.toHaveBeenCalled();
  });

  it("LLM→LLM uses replaceModel", async () => {
    const llm = fakeLlm();
    const mt = fakeMt();
    const config = testServerConfig({ engine: "llm" });
    const manager = new EngineManager(config, { llm, mt });
    await manager.replace("qwen3-0.6b-q4_k_m");
    expect(llm.replaceModel).toHaveBeenCalledWith("qwen3-0.6b-q4_k_m");
    expect(mt.stop).not.toHaveBeenCalled();
  });
});
