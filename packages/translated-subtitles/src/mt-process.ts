/**
 * CTranslate2 HTTP sidecar: healthcheck existing server or spawn mt-sidecar/server.py.
 */

import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ServerConfig } from "./config.js";
import type { FetchLike, LlmHealth } from "./types.js";
import { parseServerHost, parseServerPort, probeLlmHealth } from "./llm-process.js";
import { ensureMtModelDir, removeInactiveMtDirs } from "./model-downloader.js";

const HEALTH_TIMEOUT_MS = 1500;
const READY_TIMEOUT_MS = 180_000;
const READY_POLL_MS = 500;

export class MtSidecarError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MtSidecarError";
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

export function resolveMtSidecarScript(): string {
  const fromModule = fileURLToPath(new URL("../mt-sidecar/server.py", import.meta.url));
  if (fs.existsSync(fromModule)) {
    return fromModule;
  }
  const fromCwd = path.join(process.cwd(), "mt-sidecar", "server.py");
  if (fs.existsSync(fromCwd)) {
    return fromCwd;
  }
  throw new MtSidecarError(`mt-sidecar/server.py not found (tried ${fromModule})`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class MtSidecar {
  private child: ChildProcess | undefined;
  private lastHealth: LlmHealth;
  private readyPromise: Promise<void> | undefined;
  private lastPruned: string[] = [];

  constructor(
    private readonly config: ServerConfig,
    private readonly fetchFn: FetchLike = fetch
  ) {
    this.lastHealth = { healthy: false, url: config.mtServerUrl, reason: "not started" };
  }

  getStatus(): LlmHealth {
    return this.lastHealth;
  }

  async probeHealth(): Promise<LlmHealth> {
    this.lastHealth = await probeLlmHealth(this.config.mtServerUrl, this.fetchFn, HEALTH_TIMEOUT_MS);
    return this.lastHealth;
  }

  async ensureReady(options?: { skipAttach?: boolean; extraKeep?: string[] }): Promise<void> {
    if (this.readyPromise && !options?.skipAttach) {
      return this.readyPromise;
    }
    this.readyPromise = this.startOrAttach(options);
    try {
      await this.readyPromise;
    } catch (err) {
      this.readyPromise = undefined;
      throw err;
    }
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

  takePruned(): string[] {
    return this.lastPruned;
  }

  private async startOrAttach(options?: { skipAttach?: boolean }): Promise<void> {
    if (!options?.skipAttach) {
      const existing = await this.probeHealth();
      if (existing.healthy) {
        console.log(`✓ CTranslate2 sidecar already healthy at ${this.config.mtServerUrl}`);
        return;
      }
    }

    this.pruneInactiveModels();

    const modelDir = await ensureMtModelDir(
      {
        destDir: this.config.mtModelsDir,
        dirName: this.config.mtModelDirName,
        url: this.config.mtModelUrl,
        expectedBytes: this.config.mtModelBytes,
        sha256: this.config.mtModelSha256,
        files: this.config.mtModelFiles,
      },
      this.fetchFn
    );

    if (options?.skipAttach) {
      const stillUp = await this.probeHealth();
      if (stillUp.healthy) {
        console.log(
          `CTranslate2 still attached at ${this.config.mtServerUrl}; NLLB files are on disk. Restart the nllb service to load them.`
        );
        return;
      }
    }

    const host = parseServerHost(this.config.mtServerUrl);
    const port = parseServerPort(this.config.mtServerUrl);
    const bin = this.config.mtCt2Bin.trim();
    let command: string;
    let args: string[];
    if (bin) {
      command = bin;
      args = ["--model", modelDir, "--host", host, "--port", String(port)];
    } else {
      command = this.config.mtPython.trim() || whichSync("python3") || whichSync("python") || "python3";
      const script = resolveMtSidecarScript();
      args = [script, "--model", modelDir, "--host", host, "--port", String(port)];
    }

    console.log(`Starting CTranslate2: ${command} ${args.join(" ")}`);
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    this.child = child;

    child.stdout?.on("data", (chunk: Buffer) => {
      const line = chunk.toString("utf8").trim();
      if (line) {
        console.log(`[nllb] ${line}`);
      }
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      const line = chunk.toString("utf8").trim();
      if (line) {
        console.warn(`[nllb] ${line}`);
      }
    });
    child.on("exit", (code, signal) => {
      if (this.child === child) {
        this.child = undefined;
        this.readyPromise = undefined;
        this.lastHealth = {
          healthy: false,
          url: this.config.mtServerUrl,
          reason: `exited code=${code} signal=${signal ?? ""}`,
        };
      }
    });

    const deadline = Date.now() + READY_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) {
        throw new MtSidecarError(`CTranslate2 sidecar exited during startup (code ${child.exitCode})`);
      }
      const health = await this.probeHealth();
      if (health.healthy) {
        console.log(`✓ CTranslate2 sidecar ready at ${this.config.mtServerUrl}`);
        return;
      }
      await sleep(READY_POLL_MS);
    }
    throw new MtSidecarError(`CTranslate2 sidecar did not become healthy within ${READY_TIMEOUT_MS}ms`);
  }

  private pruneInactiveModels(): void {
    const result = removeInactiveMtDirs(this.config.mtModelsDir, this.config.mtModelDirName);
    this.lastPruned = result.deleted;
    if (result.deleted.length > 0) {
      console.log(`Pruned inactive NLLB dirs: ${result.deleted.join(", ")}`);
    }
  }
}
