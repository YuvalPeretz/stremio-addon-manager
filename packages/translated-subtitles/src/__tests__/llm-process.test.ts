import type { ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ServerConfig } from "../config.js";
import { LlmSidecar, LlmSidecarError } from "../llm-process.js";
import { GGUF_MAGIC, removeInactiveGgufs } from "../model-downloader.js";
import type { FetchLike } from "../types.js";

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "tsub-llm-"));
}

function fakeGguf(size = 32): Buffer {
  const buf = Buffer.alloc(size, 0x61);
  buf.write(GGUF_MAGIC, 0, "ascii");
  return buf;
}

function failingFetch(): FetchLike {
  return async (_input, _init): Promise<Response> => new Response(null, { status: 500 });
}

function fakeOwnedChild(): ChildProcess {
  const exitListeners: Array<() => void> = [];
  const fake = {
    exitCode: null as number | null,
    killed: false,
    kill(_signal?: NodeJS.Signals | number): boolean {
      fake.killed = true;
      fake.exitCode = 0;
      for (const listener of exitListeners) {
        listener();
      }
      return true;
    },
    once(event: string, listener: () => void): ChildProcess {
      if (event === "exit") {
        exitListeners.push(listener);
      }
      return fake as unknown as ChildProcess;
    },
  };
  return fake as unknown as ChildProcess;
}

function baseConfig(modelsDir: string): ServerConfig {
  return {
    port: 8080,
    nodeEnv: "test",
    addonPassword: "secret",
    authEnabled: true,
    enableManagementApi: false,
    targetLang: "heb",
    llmModelId: "qwen3-1.7b-q4_k_m",
    llmModelUrl: "https://example.test/old.gguf",
    llmModelFilename: "Qwen_Qwen3-1.7B-Q4_K_M.gguf",
    llmModelSha256: "",
    llmModelBytes: 0,
    llmModelsDir: modelsDir,
    llmModelPath: "",
    llmServerUrl: "http://127.0.0.1:18081",
    llmLlamaBin: "",
    openSubtitlesBaseUrl: "https://opensubtitles-v3.strem.io",
    subtitleCacheDir: modelsDir,
    subtitleCacheTtlSec: 60,
    translationGlossary: [],
    translateBatchSize: 8,
    requestLogPath: path.join(modelsDir, "req.jsonl"),
    serverLogPath: path.join(modelsDir, "server.log"),
  };
}

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  dirs.length = 0;
});

describe("LlmSidecar.replaceModel", () => {
  it("rejects an empty model id", async () => {
    const dir = tmpDir();
    dirs.push(dir);
    const sidecar = new LlmSidecar(baseConfig(dir));
    await expect(sidecar.replaceModel("  ")).rejects.toBeInstanceOf(LlmSidecarError);
  });

  it("rejects an unknown catalog id before download", async () => {
    const dir = tmpDir();
    dirs.push(dir);
    const sidecar = new LlmSidecar(baseConfig(dir));
    await expect(sidecar.replaceModel("not-a-real-model")).rejects.toThrow(/Unknown LLM_MODEL_ID/);
  });

  it("stops an owned child, unlinks other GGUFs, and keeps LLM_MODEL_PATH", async () => {
    const dir = tmpDir();
    dirs.push(dir);
    const oldFile = path.join(dir, "Qwen_Qwen3-1.7B-Q4_K_M.gguf");
    const dropIn = path.join(dir, "custom-dropin.gguf");
    const leftoverPart = path.join(dir, "old.gguf.part");
    fs.writeFileSync(oldFile, fakeGguf());
    fs.writeFileSync(dropIn, fakeGguf());
    fs.writeFileSync(leftoverPart, fakeGguf(16));

    const config = baseConfig(dir);
    config.llmModelPath = dropIn;
    const sidecar = new LlmSidecar(config, failingFetch());
    const child = fakeOwnedChild();
    (sidecar as unknown as { child?: ChildProcess }).child = child;

    await expect(sidecar.replaceModel("qwen3-0.6b-q4_k_m")).rejects.toThrow();

    expect(child.killed).toBe(true);
    expect(fs.existsSync(oldFile)).toBe(false);
    expect(fs.existsSync(leftoverPart)).toBe(false);
    expect(fs.existsSync(dropIn)).toBe(true);
    expect(config.llmModelId).toBe("qwen3-0.6b-q4_k_m");
    expect(config.llmModelPath).toBe("");
  });
});

describe("LlmSidecar cold start prune", () => {
  it("deletes inactive GGUFs before download", async () => {
    const dir = tmpDir();
    dirs.push(dir);
    const keep = path.join(dir, "Qwen_Qwen3-1.7B-Q4_K_M.gguf");
    const oldFile = path.join(dir, "stale.gguf");
    const leftoverPart = path.join(dir, "stale.gguf.part");
    fs.writeFileSync(keep, fakeGguf());
    fs.writeFileSync(oldFile, fakeGguf());
    fs.writeFileSync(leftoverPart, fakeGguf(16));

    const config = baseConfig(dir);
    config.llmModelBytes = 1_000_000;
    const sidecar = new LlmSidecar(config, failingFetch());
    await expect(sidecar.ensureReady()).rejects.toThrow();

    expect(fs.existsSync(oldFile)).toBe(false);
    expect(fs.existsSync(leftoverPart)).toBe(false);
  });
});

describe("removeInactiveGgufs used by sidecar", () => {
  it("is safe on an empty directory", () => {
    const dir = tmpDir();
    dirs.push(dir);
    expect(removeInactiveGgufs(dir, "keep.gguf")).toEqual({ deleted: [], kept: [] });
  });
});
