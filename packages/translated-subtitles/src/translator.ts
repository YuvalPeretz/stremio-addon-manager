/**
 * Batch cue translation via llama.cpp (OpenAI-compatible or native /completion).
 * Timestamps are never sent. Output is validated 1:1 against cue count.
 */

import {
  MAX_TRANSLATE_BATCH_SIZE,
  MIN_TRANSLATE_BATCH_SIZE,
} from "./env-keys.js";
import { languageName } from "./languages.js";
import type { FetchLike, GlossaryEntry } from "./types.js";

export class TranslationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TranslationError";
  }
}

export interface CompletionClient {
  complete(prompt: string): Promise<string>;
}

interface OpenAiChatResponse {
  choices?: Array<{ message?: { content?: string | null } }>;
}

interface LlamaCompletionResponse {
  content?: string;
}

export class LlamaCompletionClient implements CompletionClient {
  constructor(
    private readonly serverUrl: string,
    private readonly fetchFn: FetchLike = fetch
  ) {}

  async complete(prompt: string): Promise<string> {
    const base = this.serverUrl.replace(/\/+$/, "");
    const chat = await this.tryChat(base, prompt);
    if (chat !== undefined) {
      return chat;
    }
    return this.tryCompletion(base, prompt);
  }

  private async tryChat(base: string, prompt: string): Promise<string | undefined> {
    try {
      const response = await this.fetchFn(`${base}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [
            {
              role: "system",
              content:
                "You are a precise subtitle translator. Output only numbered translations. No commentary.",
            },
            { role: "user", content: prompt },
          ],
          temperature: 0.1,
          max_tokens: 2048,
        }),
      });
      if (!response.ok) {
        return undefined;
      }
      const body = (await response.json()) as OpenAiChatResponse;
      const content = body.choices?.[0]?.message?.content;
      return typeof content === "string" ? content : undefined;
    } catch {
      return undefined;
    }
  }

  private async tryCompletion(base: string, prompt: string): Promise<string> {
    const response = await this.fetchFn(`${base}/completion`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt,
        n_predict: 2048,
        temperature: 0.1,
        stop: ["</s>", "<|im_end|>", "<|endoftext|>"],
      }),
    });
    if (!response.ok) {
      throw new TranslationError(`LLM completion failed: HTTP ${response.status}`);
    }
    const body = (await response.json()) as LlamaCompletionResponse;
    if (typeof body.content !== "string") {
      throw new TranslationError("LLM completion returned no content");
    }
    return body.content;
  }
}

export function clampBatchSize(size: number): number {
  if (Number.isNaN(size)) {
    return MIN_TRANSLATE_BATCH_SIZE;
  }
  return Math.min(MAX_TRANSLATE_BATCH_SIZE, Math.max(MIN_TRANSLATE_BATCH_SIZE, Math.floor(size)));
}

export function buildTranslatePrompt(
  texts: string[],
  targetLang: string,
  glossary: readonly GlossaryEntry[],
  strict: boolean
): string {
  const langLabel = `${languageName(targetLang)} (${targetLang})`;
  const glossaryBlock =
    glossary.length > 0
      ? `Glossary (do not translate these names; use the given spelling):\n${glossary
          .map((g) => `${g.source}=${g.target}`)
          .join("\n")}\n\n`
      : "";
  const cues = texts.map((t, i) => `${i + 1}. ${t}`).join("\n");
  const rules = strict
    ? `Return EXACTLY ${texts.length} lines. Each line MUST start with the cue number and a period (1. 2. 3.). No extra lines, no markdown, no thinking.`
    : `Return exactly ${texts.length} numbered lines (1. 2. 3.). Translate only the cue text. Do not add commentary.`;

  return [
    `Translate each subtitle cue into ${langLabel}.`,
    rules,
    "Preserve meaning. Keep line breaks inside a cue as the character | if needed, otherwise one output line per cue.",
    "/no_think",
    "",
    glossaryBlock + `Cues:\n${cues}`,
  ].join("\n");
}

export function stripThinking(raw: string): string {
  return raw.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}

export function parseNumberedTranslations(raw: string, expected: number): string[] | undefined {
  const cleaned = stripThinking(raw)
    .replace(/^```(?:\w+)?\s*/m, "")
    .replace(/```$/m, "")
    .trim();

  const found = new Map<number, string>();
  for (const line of cleaned.split(/\r?\n/)) {
    const match = /^\s*(\d+)\s*[.)\-:]\s*(.*)$/.exec(line);
    if (!match) {
      continue;
    }
    const n = parseInt(match[1], 10);
    if (n >= 1 && n <= expected && !found.has(n)) {
      found.set(n, match[2] ?? "");
    }
  }

  if (found.size !== expected) {
    return undefined;
  }
  const out: string[] = [];
  for (let i = 1; i <= expected; i += 1) {
    const text = found.get(i);
    if (text === undefined) {
      return undefined;
    }
    out.push(text);
  }
  return out;
}

export interface CueTranslator {
  translateTexts(texts: string[], sourceLang?: string): Promise<string[]>;
}

export class LlmTranslator implements CueTranslator {
  private readonly batchSize: number;

  constructor(
    private readonly client: CompletionClient,
    private readonly targetLang: string,
    private readonly glossary: readonly GlossaryEntry[],
    batchSize: number,
    private readonly maxRetries: number = 1
  ) {
    this.batchSize = clampBatchSize(batchSize);
  }

  async translateTexts(texts: string[], _sourceLang?: string): Promise<string[]> {
    if (texts.length === 0) {
      return [];
    }
    const out: string[] = [];
    for (let i = 0; i < texts.length; i += this.batchSize) {
      const batch = texts.slice(i, i + this.batchSize);
      const translated = await this.translateBatch(batch);
      out.push(...translated);
    }
    if (out.length !== texts.length) {
      throw new TranslationError(`Translated ${out.length} cues, expected ${texts.length}`);
    }
    return out;
  }

  private async translateBatch(texts: string[]): Promise<string[]> {
    let lastError = "unknown";
    const attempts = this.maxRetries + 1;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const prompt = buildTranslatePrompt(texts, this.targetLang, this.glossary, attempt > 0);
      const raw = await this.client.complete(prompt);
      const parsed = parseNumberedTranslations(raw, texts.length);
      if (parsed) {
        return parsed;
      }
      lastError = `cue count mismatch (attempt ${attempt + 1})`;
    }
    throw new TranslationError(`LLM output failed validation: ${lastError}`);
  }
}
