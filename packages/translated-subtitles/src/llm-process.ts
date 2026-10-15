/**
 * llama.cpp HTTP sidecar: healthcheck existing server or spawn llama-server.
 */

import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { ServerConfig } from "./config.js";
import { applyCatalogModel } from "./config.js";
import type { FetchLike, LlmHealth } from "./types.js";
import { ensureModelFile, removeInactiveGgufs } from "./model-downloader.js";

const HEALTH_TIMEOUT_MS = 1500;
const READY_TIMEOUT_MS = 180_000;
const READY_POLL_MS = 500;

export class LlmSidecarError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LlmSidecarError";
  }
}

export function parseServerPort(serverUrl: string): number {
  try {
    const parsed = new URL(serverUrl);
    if (parsed.port) {
      return parseInt(parsed.port, 10);
    }
    return parsed.protocol === "https:" ? 443 : 80;
  } catch {
    return 8081;
  }
}

export function parseServerHost(serverUrl: string): string {
  try {
    return new URL(serverUrl).hostname || "127.0.0.1";
  } catch {
    return "127.0.0.1";
  }
}

function whichSync(command: string): string | undefined {
  const pathEnv = process.env.PATH ?? "";
  const ext = process.platform === "win32" ? [".exe", ".cmd", ""] : [""];
  const dirs = pathEnv.split(path.delimiter);
  for (const dir of dirs) {
    for (const suffix of ext) {
      const candidate = path.join(dir, command + suffix);
      if (fs.existsSync(candidate)) {
        try {
          fs.accessSync(candidate, fs.constants.X_OK);
          return candidate;
        } catch {
          if (process.platform === "win32") {
            return candidate;
          }
        }
      }
    }
  }
  return undefined;
}

export function resolveLlamaBinary(explicit: string): string | undefined {
  if (explicit && fs.existsSync(explicit)) {
    return explicit;
  }
  return whichSync("llama-server") ?? whichSync("llama.cpp");
}

export async function probeLlmHealth(
  serverUrl: string,
  fetchFn: FetchLike = fetch,
  timeoutMs: number = HEALTH_TIMEOUT_MS
): Promise<LlmHealth> {
  const url = `${serverUrl.replace(/\/+$/, "")}/health`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchFn(url, { signal: controller.signal });
    if (response.ok) {
      return { healthy: true, url: serverUrl };
    }
    return { healthy: false, url: serverUrl, reason: `HTTP ${response.status}` };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { healthy: false, url: serverUrl, reason: message };
  } finally {
    clearTimeout(timer);
  }
}

export interface ReplaceModelResult {
  modelId: string;
  filename: string;
  attachedSibling: boolean;
  pruned: string[];
  llm: LlmHealth;
}

export class LlmSidecar {
  private child: ChildProcess | undefined;
  private lastHealth: LlmHealth;
  private readyPromise: Promise<void> | undefined;
  private lastPruned: string[] = [];

  constructor(
    private readonly config: ServerConfig,
    private readonly fetchFn: FetchLike = fetch
  ) {
    this.lastHealth = { healthy: false, url: config.llmServerUrl, reason: "not started" };
  }

  getStatus(): LlmHealth {
    return this.lastHealth;
  }

  async probeHealth(): Promise<LlmHealth> {
    this.lastHealth = await probeLlmHealth(this.config.llmServerUrl, this.fetchFn);
    return this.lastHealth;
  }

  async ensureReady(): Promise<void> {
    if (this.readyPromise) {
      return this.readyPromise;
    }
    this.readyPromise = this.startOrAttach();
    try {
      await this.readyPromise;
    } catch (err) {
      this.readyPromise = undefined;
      throw err;
    }
  }

  /**
   * Stop a sidecar we spawned, delete other GGUFs in LLM_MODELS_DIR, then load `modelId`.
   * Attached sibling processes are not killed; the new file is still downloaded.
   */
  async replaceModel(modelId: string): Promise<ReplaceModelResult> {
    const nextId = modelId.trim();
    if (!nextId) {
      throw new LlmSidecarError("modelId is required");
    }

    await this.stop();

    const dropIn = this.config.llmModelPath.trim();
    const extraKeep = dropIn ? [dropIn] : [];

    const entry = applyCatalogModel(this.config, nextId);
    this.readyPromise = this.startOrAttach({ skipAttach: true, extraKeep });
    let pruned: string[] = [];
    try {
      await this.readyPromise;
      pruned = this.lastPruned;
    } catch (err) {
      this.readyPromise = undefined;
      throw err;
    }

    return {
      modelId: this.config.llmModelId,
      filename: entry.filename,
      attachedSibling: this.child === undefined && this.lastHealth.healthy,
      pruned,
      llm: this.lastHealth,
    };
  }

  async stop(): Promise<void> {
    const child = this.child;
    this.child = undefined;
    this.readyPromise = undefined;
    if (!child || child.exitCode !== null || child.killed) {
      return;
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        resolve();
      }, 4000);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
      child.kill("SIGTERM");
    });
  }

  private async startOrAttach(options?: { skipAttach?: boolean; extraKeep?: string[] }): Promise<void> {
    if (!options?.skipAttach) {
      const existing = await this.probeHealth();
      if (existing.healthy) {
        console.log(`✓ llama.cpp sidecar already healthy at ${this.config.llmServerUrl}`);
        return;
      }
    }

    this.pruneInactiveModels(options?.extraKeep);

    const modelPath = await ensureModelFile(
      {
        destDir: this.config.llmModelsDir,
        filename: this.config.llmModelFilename,
        url: this.config.llmModelUrl,
        expectedBytes: this.config.llmModelBytes,
        sha256: this.config.llmModelSha256,
        existingPath: this.config.llmModelPath || undefined,
      },
      this.fetchFn
    );

    if (options?.skipAttach) {
      const stillUp = await this.probeHealth();
      if (stillUp.healthy) {
        console.log(
          `llama.cpp still attached at ${this.config.llmServerUrl}; new GGUF is on disk. Restart the llama service to load it.`
        );
        return;
      }
    }

    const bin = resolveLlamaBinary(this.config.llmLlamaBin);
    if (!bin) {
      throw new LlmSidecarError(
        "llama-server binary not found. Set LLM_LLAMA_BIN or install llama.cpp on PATH."
      );
    }

    const host = parseServerHost(this.config.llmServerUrl);
    const port = parseServerPort(this.config.llmServerUrl);
    const args = ["-m", modelPath, "--host", host, "--port", String(port)];
    if (this.config.llmThreads !== undefined) {
      args.push("-t", String(this.config.llmThreads));
    }

    console.log(`Starting llama.cpp: ${bin} ${args.join(" ")}`);
    const child = spawn(bin, args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    this.child = child;

    child.stdout?.on("data", (chunk: Buffer) => {
      const line = chunk.toString("utf8").trim();
      if (line) {
        console.log(`[llama.cpp] ${line}`);
      }
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      const line = chunk.toString("utf8").trim();
      if (line) {
        console.warn(`[llama.cpp] ${line}`);
      }
    });
    child.on("exit", (code, signal) => {
      if (this.child === child) {
        this.child = undefined;
        this.readyPromise = undefined;
        this.lastHealth = {
          healthy: false,
          url: this.config.llmServerUrl,
          reason: `exited code=${code} signal=${signal ?? ""}`,
        };
      }
    });

    const deadline = Date.now() + READY_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) {
        throw new LlmSidecarError(`llama-server exited during startup (code ${child.exitCode})`);
      }
      const health = await this.probeHealth();
      if (health.healthy) {
        console.log(`✓ llama.cpp sidecar ready at ${this.config.llmServerUrl}`);
        return;
      }
      await sleep(READY_POLL_MS);
    }
    throw new LlmSidecarError(`llama-server did not become healthy within ${READY_TIMEOUT_MS}ms`);
  }

  private pruneInactiveModels(extraKeep: string[] = []): void {
    const keep = [...extraKeep];
    const dropIn = this.config.llmModelPath.trim();
    if (dropIn) {
      keep.push(dropIn);
    }
    const result = removeInactiveGgufs(
      this.config.llmModelsDir,
      this.config.llmModelFilename,
      keep
    );
    this.lastPruned = result.deleted;
    if (result.deleted.length > 0) {
      console.log(`Pruned inactive GGUF files: ${result.deleted.join(", ")}`);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
