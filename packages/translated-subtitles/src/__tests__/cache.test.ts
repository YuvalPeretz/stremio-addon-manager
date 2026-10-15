import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildCacheKey, SubtitleCache } from "../cache.js";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  dirs.length = 0;
});

describe("buildCacheKey", () => {
  it("is stable for the same source/lang/model and changes when any part changes", () => {
    const a = buildCacheKey("https://x/a.srt", "heb", "qwen3-1.7b-q4_k_m");
    const b = buildCacheKey("https://x/a.srt", "heb", "qwen3-1.7b-q4_k_m");
    const c = buildCacheKey("https://x/a.srt", "spa", "qwen3-1.7b-q4_k_m");
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[a-f0-9]{32}$/);
  });
});

describe("SubtitleCache", () => {
  it("round-trips body + meta and expires after TTL", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tsub-cache-"));
    dirs.push(dir);
    const cache = new SubtitleCache(dir, 1);
    const key = buildCacheKey("https://x/a.srt", "heb", "m");
    cache.set(key, "1\n00:00:01,000 --> 00:00:02,000\nHi\n", {
      sourceUrl: "https://x/a.srt",
      targetLang: "heb",
      modelId: "m",
      format: "srt",
      createdAt: Date.now() - 5_000,
    });
    expect(cache.get(key)).toBeUndefined();
  });

  it("returns a fresh hit", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tsub-cache-"));
    dirs.push(dir);
    const cache = new SubtitleCache(dir, 3600);
    const key = "abc123def4567890abc123def4567890";
    cache.set(key, "BODY", {
      sourceUrl: "https://x/a.srt",
      targetLang: "heb",
      modelId: "m",
      format: "srt",
      createdAt: Date.now(),
    });
    expect(cache.get(key)).toBe("BODY");
    expect(cache.readMeta(key)?.sourceUrl).toBe("https://x/a.srt");
  });
});
