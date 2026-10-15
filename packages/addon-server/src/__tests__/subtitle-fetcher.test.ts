import { describe, it, expect, vi, beforeEach } from "vitest";
import axios from "axios";
import { fetchSubtitles } from "../subtitle-fetcher.js";
import { CacheManager } from "../cache.js";
import type { ServerConfig } from "../config.js";

vi.mock("axios");
const mockedAxios = vi.mocked(axios, true);

function makeCache(): CacheManager {
  return new CacheManager({
    cacheTtl: { metadata: 60, torrentSearch: 60, streams: 60 },
  } as unknown as ServerConfig);
}

function makeWyzieResponse(subs: Array<{ lang: string; url: string }>) {
  return { data: subs, status: 200 };
}

beforeEach(() => {
  vi.resetAllMocks();
});

// ─── Cache hit ────────────────────────────────────────────────────────────────

describe("fetchSubtitles — cache hit", () => {
  it("returns cached value and never calls axios", async () => {
    const cache = makeCache();
    // Pre-populate the cache the way fetchSubtitles does it
    cache.setMetadata("subtitles_tt1234567:1:1", [{ id: "en", url: "https://s.com/en.srt", lang: "eng" }]);

    const result = await fetchSubtitles("series", "tt1234567:1:1", cache);

    expect(mockedAxios.get).not.toHaveBeenCalled();
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("en");
  });
});

// ─── Successful response ──────────────────────────────────────────────────────

describe("fetchSubtitles — 200 success", () => {
  it("parses subtitle list and caches it", async () => {
    const cache = makeCache();
    mockedAxios.get = vi.fn().mockResolvedValueOnce(
      makeWyzieResponse([
        { lang: "en", url: "https://subs.example.com/en.srt" },
        { lang: "he", url: "https://subs.example.com/he.srt" },
        { lang: "fr", url: "https://subs.example.com/fr.srt" },
      ])
    );

    const result = await fetchSubtitles("series", "tt1234567:1:1", cache);

    expect(result).toHaveLength(3);
    // Should be cached now
    const cached = cache.getMetadata("subtitles_tt1234567:1:1");
    expect(cached).toBeDefined();
  });

  it("sorts English first, Hebrew second", async () => {
    const cache = makeCache();
    mockedAxios.get = vi.fn().mockResolvedValueOnce(
      makeWyzieResponse([
        { lang: "fr", url: "https://s.com/fr.srt" },
        { lang: "he", url: "https://s.com/he.srt" },
        { lang: "en", url: "https://s.com/en.srt" },
      ])
    );

    const result = await fetchSubtitles("series", "tt1234567:1:2", cache);

    expect(result[0].id).toBe("en");
    expect(result[1].id).toBe("he");
  });

  it("maps language codes to Stremio 3-letter codes", async () => {
    const cache = makeCache();
    mockedAxios.get = vi.fn().mockResolvedValueOnce(
      makeWyzieResponse([{ lang: "en", url: "https://s.com/en.srt" }])
    );

    const result = await fetchSubtitles("movie", "tt1234567", cache);
    expect(result[0].lang).toBe("eng");
  });

  it("skips duplicate languages (keeps first occurrence)", async () => {
    const cache = makeCache();
    mockedAxios.get = vi.fn().mockResolvedValueOnce(
      makeWyzieResponse([
        { lang: "en", url: "https://s.com/en1.srt" },
        { lang: "en", url: "https://s.com/en2.srt" }, // duplicate
      ])
    );

    const result = await fetchSubtitles("movie", "tt9999", cache);
    expect(result.filter((s) => s.id === "en")).toHaveLength(1);
  });
});

// ─── 401 / 403 — auth required (regression test for bug we fixed) ─────────────

describe("fetchSubtitles — 401/403 auth errors", () => {
  it("401: returns [] and CACHES the empty result to prevent repeated calls", async () => {
    const cache = makeCache();
    const axiosError = Object.assign(new Error("Unauthorized"), {
      isAxiosError: true,
      response: { status: 401 },
    });
    mockedAxios.isAxiosError = vi.fn().mockReturnValue(true);
    mockedAxios.get = vi.fn().mockRejectedValueOnce(axiosError);

    const result = await fetchSubtitles("series", "tt1234567:1:1", cache);

    expect(result).toEqual([]);
    // Empty result must be cached — the fix prevents repeated 401 HTTP calls
    const cached = cache.getMetadata("subtitles_tt1234567:1:1");
    expect(cached).toEqual([]);
  });

  it("403: same behaviour as 401", async () => {
    const cache = makeCache();
    const axiosError = Object.assign(new Error("Forbidden"), {
      isAxiosError: true,
      response: { status: 403 },
    });
    mockedAxios.isAxiosError = vi.fn().mockReturnValue(true);
    mockedAxios.get = vi.fn().mockRejectedValueOnce(axiosError);

    const result = await fetchSubtitles("movie", "tt9999", cache);
    expect(result).toEqual([]);
    expect(cache.getMetadata("subtitles_tt9999")).toEqual([]);
  });
});

// ─── 400 / 404 — no subtitles (transient absence, must NOT be cached) ─────────

describe("fetchSubtitles — 400/404 no subtitles", () => {
  it("400: returns [] but does NOT cache", async () => {
    const cache = makeCache();
    const axiosError = Object.assign(new Error("Bad Request"), {
      isAxiosError: true,
      response: { status: 400 },
    });
    mockedAxios.isAxiosError = vi.fn().mockReturnValue(true);
    mockedAxios.get = vi.fn().mockRejectedValueOnce(axiosError);

    const result = await fetchSubtitles("movie", "tt8888", cache);
    expect(result).toEqual([]);
    // NOT cached — next request should retry
    expect(cache.getMetadata("subtitles_tt8888")).toBeUndefined();
  });

  it("404: returns [] but does NOT cache", async () => {
    const cache = makeCache();
    const axiosError = Object.assign(new Error("Not Found"), {
      isAxiosError: true,
      response: { status: 404 },
    });
    mockedAxios.isAxiosError = vi.fn().mockReturnValue(true);
    mockedAxios.get = vi.fn().mockRejectedValueOnce(axiosError);

    const result = await fetchSubtitles("movie", "tt7777", cache);
    expect(result).toEqual([]);
    expect(cache.getMetadata("subtitles_tt7777")).toBeUndefined();
  });
});

// ─── Network error ────────────────────────────────────────────────────────────

describe("fetchSubtitles — network error", () => {
  it("returns [] and does NOT cache on network failure", async () => {
    const cache = makeCache();
    const networkError = Object.assign(new Error("Network Error"), {
      isAxiosError: true,
      response: undefined, // no HTTP status — pure network failure
    });
    mockedAxios.isAxiosError = vi.fn().mockReturnValue(true);
    mockedAxios.get = vi.fn().mockRejectedValueOnce(networkError);

    const result = await fetchSubtitles("series", "tt0000:1:1", cache);
    expect(result).toEqual([]);
    expect(cache.getMetadata("subtitles_tt0000:1:1")).toBeUndefined();
  });
});
