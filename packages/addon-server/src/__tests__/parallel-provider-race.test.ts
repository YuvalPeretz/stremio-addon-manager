import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  dedupeRemoteStreams,
  mergeLateStreamsIntoCache,
  raceFirstUsableProvider,
} from "../parallel-provider-race.js";
import { CacheManager } from "../cache.js";
import type { ServerConfig } from "../config.js";
import type { Stream } from "../types.js";

function makeStream(overrides: Partial<Stream> & { url: string }): Stream {
  return {
    name: overrides.name ?? "Stream",
    title: overrides.title ?? "Title",
    url: overrides.url,
    infoHash: overrides.infoHash,
    discoveryTier: overrides.discoveryTier,
    rdCacheScore: overrides.rdCacheScore,
    behaviorHints: overrides.behaviorHints,
  };
}

function makeConfig(): ServerConfig {
  return {
    cacheTtl: {
      metadata: 60,
      torrentSearch: 60,
      streams: 60,
    },
  } as unknown as ServerConfig;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("dedupeRemoteStreams", () => {
  it("drops identical URLs keeping the first", () => {
    const a = makeStream({ url: "https://cdn/a", infoHash: "aaa", name: "first" });
    const b = makeStream({ url: "https://cdn/a", infoHash: "aaa", name: "second" });
    const out = dedupeRemoteStreams([a, b]);
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("first");
  });

  it("keeps same infoHash from different providers (different URLs)", () => {
    const rd = makeStream({
      url: "https://rd/a",
      infoHash: "abc",
      behaviorHints: { bingeGroup: "real-debrid" },
    });
    const tb = makeStream({
      url: "https://tb/a",
      infoHash: "abc",
      behaviorHints: { bingeGroup: "torbox" },
    });
    expect(dedupeRemoteStreams([rd, tb])).toHaveLength(2);
  });
});

describe("mergeLateStreamsIntoCache", () => {
  let cache: CacheManager;
  const key = "request_series_tt1:1:1__p1_parallel_real-debrid|torbox";
  const ttl = 180;

  beforeEach(() => {
    cache = new CacheManager(makeConfig());
  });

  it("does not wipe early cache when late streams are empty", () => {
    const early = [makeStream({ url: "https://rd/1", infoHash: "aaa", rdCacheScore: 10 })];
    cache.setStream(key, { streams: early });

    const result = mergeLateStreamsIntoCache(cache, key, early, [], ttl);
    expect(result).toBeNull();
    expect(cache.peekStream(key)).toEqual({ streams: early });
  });

  it("merges late streams, re-sorts, and writes cache", () => {
    const early = [
      makeStream({
        url: "https://rd/weak",
        title: "480p",
        infoHash: "aaa",
        rdCacheScore: 1,
        behaviorHints: { bingeGroup: "real-debrid" },
      }),
    ];
    const late = [
      makeStream({
        url: "https://tb/strong",
        title: "1080p BluRay",
        infoHash: "bbb",
        rdCacheScore: 50,
        behaviorHints: { bingeGroup: "torbox" },
      }),
    ];
    cache.setStream(key, { streams: early });

    const merged = mergeLateStreamsIntoCache(cache, key, early, late, ttl);
    expect(merged).not.toBeNull();
    expect(merged).toHaveLength(2);
    // Higher rdCacheScore sorts first among remotes
    expect(merged![0].url).toBe("https://tb/strong");
    expect(merged![1].url).toBe("https://rd/weak");

    const cached = cache.peekStream(key) as { streams: Stream[] };
    expect(cached.streams).toHaveLength(2);
    expect(cached.streams[0].url).toBe("https://tb/strong");
  });

  it("dedupes identical URLs during merge", () => {
    const early = [makeStream({ url: "https://same", infoHash: "aaa" })];
    const late = [makeStream({ url: "https://same", infoHash: "aaa", name: "dup" })];
    const merged = mergeLateStreamsIntoCache(cache, key, early, late, ttl);
    expect(merged).toHaveLength(1);
    expect(merged![0].name).toBe("Stream");
  });
});

describe("raceFirstUsableProvider", () => {
  it("returns the first non-empty provider without waiting for the other", async () => {
    let lateResolved = false;
    const rd = delay(5).then(() => [
      makeStream({ url: "https://rd/1", behaviorHints: { bingeGroup: "real-debrid" } }),
    ]);
    const tb = delay(50).then(() => {
      lateResolved = true;
      return [makeStream({ url: "https://tb/1", behaviorHints: { bingeGroup: "torbox" } })];
    });

    const { early, late } = await raceFirstUsableProvider(rd, tb);
    expect(early.source).toBe("real-debrid");
    expect(early.streams).toHaveLength(1);
    expect(lateResolved).toBe(false);

    const lateResult = await late;
    expect(lateResolved).toBe(true);
    expect(lateResult.source).toBe("torbox");
    expect(lateResult.streams).toHaveLength(1);
  });

  it("skips an empty early finisher and waits for the other", async () => {
    const tb = delay(5).then(() => [] as Stream[]);
    const rd = delay(20).then(() => [
      makeStream({ url: "https://rd/1", behaviorHints: { bingeGroup: "real-debrid" } }),
    ]);

    const { early, late } = await raceFirstUsableProvider(rd, tb);
    expect(early.source).toBe("real-debrid");
    expect(early.streams).toHaveLength(1);
    const lateResult = await late;
    expect(lateResult.source).toBe("torbox");
    expect(lateResult.streams).toHaveLength(0);
  });

  it("resolves empty early when both providers finish empty", async () => {
    const { early, late } = await raceFirstUsableProvider(
      Promise.resolve([]),
      Promise.resolve([])
    );
    expect(early.streams).toHaveLength(0);
    expect((await late).streams).toHaveLength(0);
  });

  it("treats a rejected provider as empty and still races the other", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const rd = Promise.reject(new Error("rd down"));
    const tb = delay(10).then(() => [
      makeStream({ url: "https://tb/1", behaviorHints: { bingeGroup: "torbox" } }),
    ]);

    const { early, late } = await raceFirstUsableProvider(rd, tb);
    expect(early.source).toBe("torbox");
    expect(early.streams).toHaveLength(1);
    expect((await late).streams).toHaveLength(0);
    errSpy.mockRestore();
  });
});
