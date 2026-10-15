/**
 * OpenSubtitles v3 Stremio addon client (unauthenticated).
 * Prefer English when present; otherwise the first usable track.
 */

import { isEnglishLang, normalizeLang } from "./languages.js";
import type { ContentType, FetchLike, OpenSubtitlesItem, SubtitleFormat } from "./types.js";

export interface OpenSubtitlesListResponse {
  subtitles?: OpenSubtitlesItem[];
}

export class OpenSubtitlesError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpenSubtitlesError";
  }
}

function isUsable(item: OpenSubtitlesItem): boolean {
  return typeof item.url === "string" && item.url.trim().length > 0;
}

export function pickSourceTrack(items: OpenSubtitlesItem[]): OpenSubtitlesItem | undefined {
  const usable = items.filter(isUsable);
  if (usable.length === 0) {
    return undefined;
  }
  const english = usable.find((item) => isEnglishLang(item.lang));
  return english ?? usable[0];
}

export function formatFromUrl(url: string): SubtitleFormat {
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    if (pathname.endsWith(".vtt") || pathname.endsWith(".webvtt")) {
      return "vtt";
    }
  } catch {
    if (/\.vtt(\?|$)/i.test(url)) {
      return "vtt";
    }
  }
  return "srt";
}

export class OpenSubtitlesClient {
  constructor(
    private readonly baseUrl: string,
    private readonly fetchFn: FetchLike = fetch
  ) {}

  async listSubtitles(type: ContentType, id: string): Promise<OpenSubtitlesItem[]> {
    const encodedId = encodeURIComponent(id);
    const url = `${this.baseUrl.replace(/\/+$/, "")}/subtitles/${type}/${encodedId}.json`;
    const response = await this.fetchFn(url, {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      throw new OpenSubtitlesError(
        `OpenSubtitles list failed: HTTP ${response.status} for ${type}/${id}`
      );
    }
    const body = (await response.json()) as OpenSubtitlesListResponse;
    if (!body || !Array.isArray(body.subtitles)) {
      return [];
    }
    return body.subtitles.filter((item) => item && typeof item === "object");
  }

  async pickBestSource(type: ContentType, id: string): Promise<OpenSubtitlesItem | undefined> {
    const items = await this.listSubtitles(type, id);
    return pickSourceTrack(items);
  }

  async downloadSubtitle(sourceUrl: string): Promise<string> {
    const response = await this.fetchFn(sourceUrl, {
      headers: { Accept: "text/plain, text/vtt, application/x-subrip, */*" },
      redirect: "follow",
    });
    if (!response.ok) {
      throw new OpenSubtitlesError(`Subtitle download failed: HTTP ${response.status}`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length >= 2 && buffer[0] === 0x1f && buffer[1] === 0x8b) {
      const { gunzipSync } = await import("node:zlib");
      return gunzipSync(buffer).toString("utf8");
    }
    if (buffer.length >= 2 && buffer[0] === 0x50 && buffer[1] === 0x4b) {
      throw new OpenSubtitlesError("Subtitle file is a ZIP archive; expected SRT or VTT");
    }
    return buffer.toString("utf8");
  }
}

export function describeSourceLang(item: OpenSubtitlesItem): string {
  return normalizeLang(item.lang) || "und";
}
