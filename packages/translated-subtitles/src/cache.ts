/**
 * Disk cache for translated subtitles, keyed by (sourceUrl, targetLang, modelId).
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { CacheMeta, SubtitleFormat } from "./types.js";

export function buildCacheKey(sourceUrl: string, targetLang: string, modelId: string): string {
  return createHash("sha256")
    .update(`${sourceUrl}\0${targetLang}\0${modelId}`)
    .digest("hex")
    .slice(0, 32);
}

export class SubtitleCache {
  constructor(
    private readonly dir: string,
    private readonly ttlSec: number
  ) {}

  ensureDir(): void {
    fs.mkdirSync(this.dir, { recursive: true });
  }

  metaPath(key: string): string {
    return path.join(this.dir, `${key}.meta.json`);
  }

  filePath(key: string, format: SubtitleFormat): string {
    return path.join(this.dir, `${key}.${format}`);
  }

  writeMeta(key: string, meta: CacheMeta): void {
    this.ensureDir();
    fs.writeFileSync(this.metaPath(key), JSON.stringify(meta), "utf8");
  }

  readMeta(key: string): CacheMeta | undefined {
    const p = this.metaPath(key);
    if (!fs.existsSync(p)) {
      return undefined;
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(p, "utf8")) as CacheMeta;
      if (!parsed.sourceUrl || !parsed.targetLang || !parsed.modelId || !parsed.format) {
        return undefined;
      }
      return parsed;
    } catch {
      return undefined;
    }
  }

  get(key: string, format?: SubtitleFormat): string | undefined {
    const meta = this.readMeta(key);
    if (!meta) {
      return undefined;
    }
    if (this.isExpired(meta)) {
      this.remove(key);
      return undefined;
    }
    const preferred = format ?? meta.format;
    const candidates: SubtitleFormat[] = preferred === "vtt" ? ["vtt", "srt"] : ["srt", "vtt"];
    for (const ext of candidates) {
      const p = this.filePath(key, ext);
      if (fs.existsSync(p)) {
        return fs.readFileSync(p, "utf8");
      }
    }
    return undefined;
  }

  set(key: string, body: string, meta: CacheMeta): void {
    this.ensureDir();
    fs.writeFileSync(this.filePath(key, meta.format), body, "utf8");
    this.writeMeta(key, meta);
  }

  remove(key: string): void {
    for (const ext of ["srt", "vtt", "meta.json"] as const) {
      const p = path.join(this.dir, `${key}.${ext}`);
      if (fs.existsSync(p)) {
        fs.unlinkSync(p);
      }
    }
  }

  private isExpired(meta: CacheMeta): boolean {
    if (!meta.createdAt || this.ttlSec <= 0) {
      return false;
    }
    return Date.now() - meta.createdAt > this.ttlSec * 1000;
  }
}
