import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TranslatePipeline } from "../pipeline.js";
import { createServer } from "../server.js";
import { testServerConfig } from "./helpers/server-config.js";

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

describe("POST /:password/engine/switch", () => {
  it("is available when ENABLE_MANAGEMENT_API is false", async () => {
    const replace = vi.fn(async () => ({
      modelId: "nllb-200-distilled-600m-int8",
      engine: "mt" as const,
      filename: "nllb-200-distilled-600M-ct2-int8",
      attachedSibling: false,
      pruned: ["/data/models/old.gguf"],
      mt: { healthy: true, url: "http://127.0.0.1:18082" },
    }));
    const app = createServer({
      config: testServerConfig({ enableManagementApi: false }),
      pipeline: {} as TranslatePipeline,
      engines: { replace, probeActive: vi.fn() },
    });
    const { server, port } = await listen(app);
    servers.push(server);

    const response = await fetch(`http://127.0.0.1:${port}/secret/engine/switch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ modelId: "nllb-200-distilled-600m-int8" }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; modelId: string; engine: string };
    expect(body.ok).toBe(true);
    expect(body.modelId).toBe("nllb-200-distilled-600m-int8");
    expect(body.engine).toBe("mt");
    expect(replace).toHaveBeenCalledWith("nllb-200-distilled-600m-int8");
  });

  it("keeps POST /llm/switch as an alias", async () => {
    const replace = vi.fn(async () => ({
      modelId: "qwen3-0.6b-q4_k_m",
      engine: "llm" as const,
      filename: "Qwen_Qwen3-0.6B-Q4_K_M.gguf",
      attachedSibling: false,
      pruned: [],
      llm: { healthy: true, url: "http://127.0.0.1:18081" },
    }));
    const app = createServer({
      config: testServerConfig(),
      pipeline: {} as TranslatePipeline,
      engines: { replace, probeActive: vi.fn() },
    });
    const { server, port } = await listen(app);
    servers.push(server);

    const response = await fetch(`http://127.0.0.1:${port}/secret/llm/switch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ modelId: "qwen3-0.6b-q4_k_m" }),
    });
    expect(response.status).toBe(200);
    expect(replace).toHaveBeenCalledWith("qwen3-0.6b-q4_k_m");
  });

  it("rejects a missing modelId and a wrong password", async () => {
    const replace = vi.fn();
    const app = createServer({
      config: testServerConfig(),
      pipeline: {} as TranslatePipeline,
      engines: { replace, probeActive: vi.fn() },
    });
    const { server, port } = await listen(app);
    servers.push(server);

    const missing = await fetch(`http://127.0.0.1:${port}/secret/engine/switch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(missing.status).toBe(400);
    expect(replace).not.toHaveBeenCalled();

    const unauthorized = await fetch(`http://127.0.0.1:${port}/wrong/engine/switch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ modelId: "qwen3-0.6b-q4_k_m" }),
    });
    expect(unauthorized.status).toBe(401);
    expect(replace).not.toHaveBeenCalled();
  });
});
