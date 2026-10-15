/**
 * Exclusive translation engine: at most one of llama.cpp or CTranslate2 is live.
 */

import type { ServerConfig } from "./config.js";
import { applyCatalogModel } from "./config.js";
import { LlmSidecar, type ReplaceModelResult } from "./llm-process.js";
import { MtSidecar } from "./mt-process.js";
import { LlamaCompletionClient, LlmTranslator, type CueTranslator } from "./translator.js";
import { MtTranslator } from "./mt-translator.js";
import { catalogEngine, requireModelById } from "./model-catalog.js";
import { removeInactiveGgufs, removeInactiveMtDirs } from "./model-downloader.js";
import type { CatalogEngine, FetchLike, LlmHealth } from "./types.js";

export class EngineManagerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EngineManagerError";
  }
}

export interface EngineSidecar {
  ensureReady(options?: { skipAttach?: boolean; extraKeep?: string[] }): Promise<void>;
  stop(): Promise<void>;
  probeHealth(): Promise<LlmHealth>;
  getStatus(): LlmHealth;
}

export interface LlmEngineSidecar extends EngineSidecar {
  replaceModel(modelId: string): Promise<ReplaceModelResult>;
}

export interface EngineReplaceResult {
  modelId: string;
  engine: CatalogEngine;
  filename: string;
  attachedSibling: boolean;
  pruned: string[];
  llm?: LlmHealth;
  mt?: LlmHealth;
}

export interface EngineManagerOptions {
  llm?: LlmEngineSidecar;
  mt?: EngineSidecar;
  fetchFn?: FetchLike;
}

export class EngineManager {
  private readonly llm: LlmEngineSidecar;
  private readonly mt: EngineSidecar;
  private llmTranslator: LlmTranslator | undefined;
  private mtTranslator: MtTranslator | undefined;
  private readonly fetchFn: FetchLike;

  constructor(
    private readonly config: ServerConfig,
    options: EngineManagerOptions = {}
  ) {
    this.fetchFn = options.fetchFn ?? fetch;
    this.llm = options.llm ?? new LlmSidecar(config, this.fetchFn);
    this.mt = options.mt ?? new MtSidecar(config, this.fetchFn);
  }

  activeEngine(): CatalogEngine {
    return this.config.engine === "mt" ? "mt" : "llm";
  }

  translator(): CueTranslator {
    if (this.activeEngine() === "mt") {
      if (!this.mtTranslator) {
        this.mtTranslator = new MtTranslator(
          this.config.mtServerUrl,
          this.config.targetLang,
          this.fetchFn
        );
      }
      return this.mtTranslator;
    }
    if (!this.llmTranslator) {
      const completion = new LlamaCompletionClient(this.config.llmServerUrl, this.fetchFn);
      this.llmTranslator = new LlmTranslator(
        completion,
        this.config.targetLang,
        this.config.translationGlossary,
        this.config.translateBatchSize
      );
    }
    return this.llmTranslator;
  }

  async ensureReady(): Promise<void> {
    if (this.activeEngine() === "mt") {
      await this.mt.ensureReady();
      return;
    }
    await this.llm.ensureReady();
  }

  async probeActive(): Promise<{ engine: CatalogEngine; llm?: LlmHealth; mt?: LlmHealth }> {
    if (this.activeEngine() === "mt") {
      const mt = await this.mt.probeHealth();
      return { engine: "mt", mt };
    }
    const llm = await this.llm.probeHealth();
    return { engine: "llm", llm };
  }

  async stop(): Promise<void> {
    await Promise.all([this.llm.stop(), this.mt.stop()]);
  }

  async replace(modelId: string): Promise<EngineReplaceResult> {
    const nextId = modelId.trim();
    if (!nextId) {
      throw new EngineManagerError("modelId is required");
    }
    const next = requireModelById(nextId);
    const nextEngine = catalogEngine(next);
    const prevEngine = this.activeEngine();

    if (prevEngine === "llm" && nextEngine === "llm") {
      const result = await this.llm.replaceModel(nextId);
      this.dropTranslators();
      return {
        modelId: result.modelId,
        engine: "llm",
        filename: result.filename,
        attachedSibling: result.attachedSibling,
        pruned: result.pruned,
        llm: result.llm,
      };
    }

    const dropIn = this.config.llmModelPath.trim();
    const extraKeep = dropIn ? [dropIn] : [];
    const pruned: string[] = [];

    if (prevEngine === "llm") {
      await this.llm.stop();
      const ggufs = removeInactiveGgufs(this.config.llmModelsDir, "", extraKeep);
      pruned.push(...ggufs.deleted);
    }
    if (prevEngine === "mt") {
      await this.mt.stop();
      const mtDirs = removeInactiveMtDirs(this.config.mtModelsDir, "");
      pruned.push(...mtDirs.deleted);
    }

    const entry = applyCatalogModel(this.config, nextId);
    this.dropTranslators();

    if (nextEngine === "mt") {
      await this.mt.ensureReady({ skipAttach: true });
      const mt = this.mt.getStatus();
      const leftoverLlm = await this.llm.probeHealth();
      return {
        modelId: this.config.llmModelId,
        engine: "mt",
        filename: entry.filename,
        attachedSibling: leftoverLlm.healthy,
        pruned,
        mt,
        llm: leftoverLlm.healthy ? leftoverLlm : undefined,
      };
    }

    await this.llm.ensureReady({ skipAttach: true, extraKeep });
    const llm = this.llm.getStatus();
    const leftoverMt = await this.mt.probeHealth();
    return {
      modelId: this.config.llmModelId,
      engine: "llm",
      filename: entry.filename,
      attachedSibling: leftoverMt.healthy,
      pruned,
      llm,
      mt: leftoverMt.healthy ? leftoverMt : undefined,
    };
  }

  private dropTranslators(): void {
    this.llmTranslator = undefined;
    this.mtTranslator = undefined;
  }
}
