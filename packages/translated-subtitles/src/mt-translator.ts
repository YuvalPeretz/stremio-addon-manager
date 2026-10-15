/**
 * Batch cue translation via the CTranslate2 NLLB sidecar.
 * Glossary is LLM-only — this translator never sends it.
 */

import { requireFloresCode } from "./flores-lang.js";
import type { FetchLike } from "./types.js";
import { TranslationError, type CueTranslator } from "./translator.js";

interface MtTranslateResponse {
  translations?: unknown;
  error?: string;
}

export class MtTranslator implements CueTranslator {
  constructor(
    private readonly serverUrl: string,
    private readonly targetLang: string,
    private readonly fetchFn: FetchLike = fetch
  ) {}

  async translateTexts(texts: string[], sourceLang?: string): Promise<string[]> {
    if (texts.length === 0) {
      return [];
    }
    let source: string;
    let target: string;
    try {
      source = requireFloresCode(sourceLang, "source");
      target = requireFloresCode(this.targetLang, "target");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new TranslationError(message);
    }
    const base = this.serverUrl.replace(/\/+$/, "");
    const response = await this.fetchFn(`${base}/translate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source, target, texts }),
    });
    if (!response.ok) {
      throw new TranslationError(`NLLB translate failed: HTTP ${response.status}`);
    }
    const body = (await response.json()) as MtTranslateResponse;
    if (!Array.isArray(body.translations) || !body.translations.every((t) => typeof t === "string")) {
      const errMsg = typeof body.error === "string" ? body.error : "NLLB translate returned no translations";
      throw new TranslationError(errMsg);
    }
    if (body.translations.length !== texts.length) {
      throw new TranslationError(
        `NLLB translated ${body.translations.length} cues, expected ${texts.length}`
      );
    }
    return body.translations;
  }
}
