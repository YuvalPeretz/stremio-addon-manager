import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ServerConfig } from "../config.js";
import type { LlmSidecar } from "../llm-process.js";
import type { TranslatePipeline } from "../pipeline.js";
import { createServer } from "../server.js";

function baseConfig(): ServerConfig {
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
    llmModelsDir: "/tmp",
    llmModelPath: "",
    llmServerUrl: "http://127.0.0.1:18081",
    llmLlamaBin: "",
    openSubtitlesBaseUrl: "https://opensubtitles-v3.strem.io",
    subtitleCacheDir: "/tmp",
    subtitleCacheTtlSec: 60,
    translationGlossary: [],
    translateBatchSize: 8,
    requestLogPath: "/tmp/req.jsonl",
    serverLogPath: "/tmp/server.log",
  };
}

async function listen(app: ReturnType<typeof createServer>): Promise<{ server: Server; port: number }> {
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const port = (server.address() as AddressInfo).port;
  return { server, port };
}

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((err) => (err ? reject(err) : resolve()));
        })
    )
  );
});

describe("POST /:password/llm/switch", () => {
  it("is available when ENABLE_MANAGEMENT_API is false", async () => {
    const replaceModel = vi.fn(async () => ({
      modelId: "qwen3-0.6b-q4_k_m",
      filename: "Qwen_Qwen3-0.6B-Q4_K_M.gguf",
      attachedSibling: false,
      pruned: ["/data/models/old.gguf"],
      llm: { healthy: true, url: "http://127.0.0.1:18081" },
    }));
    const app = createServer({
      config: baseConfig(),
      pipeline: {} as TranslatePipeline,
      sidecar: { replaceModel } as unknown as LlmSidecar,
    });
    const { server, port } = await listen(app);
    servers.push(server);

    const response = await fetch(`http://127.0.0.1:${port}/secret/llm/switch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ modelId: "qwen3-0.6b-q4_k_m" }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; modelId: string };
    expect(body.ok).toBe(true);
    expect(body.modelId).toBe("qwen3-0.6b-q4_k_m");
    expect(replaceModel).toHaveBeenCalledWith("qwen3-0.6b-q4_k_m");
  });

  it("rejects a missing modelId and a wrong password", async () => {
    const replaceModel = vi.fn();
    const app = createServer({
      config: baseConfig(),
      pipeline: {} as TranslatePipeline,
      sidecar: { replaceModel } as unknown as LlmSidecar,
    });
    const { server, port } = await listen(app);
    servers.push(server);

    const missing = await fetch(`http://127.0.0.1:${port}/secret/llm/switch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(missing.status).toBe(400);
    expect(replaceModel).not.toHaveBeenCalled();

    const unauthorized = await fetch(`http://127.0.0.1:${port}/wrong/llm/switch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ modelId: "qwen3-0.6b-q4_k_m" }),
    });
    expect(unauthorized.status).toBe(401);
    expect(replaceModel).not.toHaveBeenCalled();
  });
});
