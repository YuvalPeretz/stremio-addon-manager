/**
 * List-cheap / translate-on-fetch pipeline with disk cache and in-flight coalescing.
 */

import type { ServerConfig } from "./config.js";
import { buildCacheKey, SubtitleCache } from "./cache.js";
import { formatFromUrl, OpenSubtitlesClient, describeSourceLang } from "./opensubtitles-client.js";
import { cueTexts, parseSubtitle, rebundleSubtitle } from "./subtitle-parse.js";
import type { CueTranslator } from "./translator.js";
import type { CacheMeta, ContentType, StremioSubtitle, SubtitleFormat } from "./types.js";

export type EnsureEngineReady = () => Promise<void>;
export type TranslatorProvider = () => CueTranslator;

export class TranslatePipeline {
  private readonly inflight = new Map<string, Promise<string>>();

  constructor(
    private readonly config: ServerConfig,
    private readonly osClient: OpenSubtitlesClient,
    private readonly cache: SubtitleCache,
    private readonly getTranslator: TranslatorProvider,
    private readonly ensureEngineReady?: EnsureEngineReady
  ) {}

  prepareTrack(
    sourceUrl: string,
    formatHint?: SubtitleFormat,
    sourceLang?: string
  ): { cacheKey: string; format: SubtitleFormat } {
    const format = formatHint ?? formatFromUrl(sourceUrl);
    const cacheKey = buildCacheKey(sourceUrl, this.config.targetLang, this.config.llmModelId);
    const existing = this.cache.readMeta(cacheKey);
    if (!existing) {
      this.cache.writeMeta(cacheKey, {
        sourceUrl,
        targetLang: this.config.targetLang,
        modelId: this.config.llmModelId,
        format,
        createdAt: Date.now(),
        sourceLang,
      });
    }
    return { cacheKey, format: existing?.format ?? format };
  }

  async listOneTrack(
    type: ContentType,
    id: string,
    fileBaseUrl: string
  ): Promise<StremioSubtitle[]> {
    const source = await this.osClient.pickBestSource(type, id);
    if (!source) {
      return [];
    }
    const { cacheKey, format } = this.prepareTrack(source.url, undefined, describeSourceLang(source));
    return [
      {
        id: `translated-${this.config.targetLang}`,
        url: `${fileBaseUrl.replace(/\/+$/, "")}/translated/${cacheKey}.${format}`,
        lang: this.config.targetLang,
      },
    ];
  }

  async getTranslated(cacheKey: string, requestedFormat?: SubtitleFormat): Promise<string> {
    const cached = this.cache.get(cacheKey, requestedFormat);
    if (cached !== undefined) {
      return cached;
    }
    const existing = this.inflight.get(cacheKey);
    if (existing) {
      return existing;
    }
    const work = this.translateMiss(cacheKey);
    this.inflight.set(cacheKey, work);
    try {
      return await work;
    } finally {
      this.inflight.delete(cacheKey);
    }
  }

  private async translateMiss(cacheKey: string): Promise<string> {
    const meta = this.cache.readMeta(cacheKey);
    if (!meta) {
      throw new PipelineError("Unknown cache key", 404);
    }
    if (this.ensureEngineReady) {
      await this.ensureEngineReady();
    }
    const sourceBody = await this.osClient.downloadSubtitle(meta.sourceUrl);
    const parsed = parseSubtitle(sourceBody, meta.format);
    const texts = cueTexts(parsed);
    const translated = await this.getTranslator().translateTexts(texts, meta.sourceLang);
    const body = rebundleSubtitle(parsed, translated);
    const nextMeta: CacheMeta = {
      ...meta,
      format: parsed.format,
      createdAt: Date.now(),
    };
    this.cache.set(cacheKey, body, nextMeta);
    return body;
  }
}

export class PipelineError extends Error {
  constructor(
    message: string,
    readonly statusCode: number
  ) {
    super(message);
    this.name = "PipelineError";
  }
}
