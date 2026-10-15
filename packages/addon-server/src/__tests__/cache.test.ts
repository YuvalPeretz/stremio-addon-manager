import { describe, it, expect, beforeEach } from "vitest";
import { CacheManager } from "../cache.js";
import type { ServerConfig } from "../config.js";

// Minimal config — only what CacheManager's constructor reads
function makeConfig(ttlOverride?: Partial<ServerConfig["cacheTtl"]>): ServerConfig {
  return {
    cacheTtl: {
      metadata: 60,
      torrentSearch: 60,
      streams: 60,
      ...ttlOverride,
    },
  } as unknown as ServerConfig;
}

let cache: CacheManager;

beforeEach(() => {
  cache = new CacheManager(makeConfig());
});

// ─── Metadata cache ───────────────────────────────────────────────────────────

describe("metadata cache", () => {
  it("miss returns undefined and increments misses", () => {
    const val = cache.getMetadata("nonexistent");
    expect(val).toBeUndefined();
    expect(cache.getStats().metadataMisses).toBe(1);
    expect(cache.getStats().metadataHits).toBe(0);
  });

  it("set then get increments hits and returns value", () => {
    cache.setMetadata("key1", { name: "Breaking Bad" });
    const val = cache.getMetadata("key1");
    expect(val).toEqual({ name: "Breaking Bad" });
    expect(cache.getStats().metadataHits).toBe(1);
    expect(cache.getStats().metadataMisses).toBe(0);
  });

  it("overwriting a key replaces the value", () => {
    cache.setMetadata("key1", "first");
    cache.setMetadata("key1", "second");
    expect(cache.getMetadata("key1")).toBe("second");
  });
});

// ─── Stream cache ─────────────────────────────────────────────────────────────

describe("stream cache", () => {
  it("miss returns undefined and increments streamMisses", () => {
    const val = cache.getStream("missing");
    expect(val).toBeUndefined();
    expect(cache.getStats().streamMisses).toBe(1);
  });

  it("setStream then getStream returns value", () => {
    cache.setStream("s1", { streams: [{ url: "https://rd.com/1" }] });
    const val = cache.getStream("s1");
    expect(val).toMatchObject({ streams: [{ url: "https://rd.com/1" }] });
    expect(cache.getStats().streamHits).toBe(1);
  });

  it("setStream with TTL override stores value (retrievable immediately)", () => {
    // TTL of 3 seconds — should still be readable right after set
    cache.setStream("s2", { streams: [] }, 3);
    expect(cache.getStream("s2")).toBeDefined();
  });

  it("peekStream returns value without updating hit/miss stats", () => {
    cache.setStream("s3", { streams: [] });
    cache.getStats(); // read baseline
    cache.peekStream("s3");
    // stats should not change from peek
    expect(cache.getStats().streamHits).toBe(0);
    expect(cache.getStats().streamMisses).toBe(0);
  });
});

// ─── Torrent search cache ─────────────────────────────────────────────────────

describe("torrent search cache", () => {
  it("miss increments torrentSearchMisses", () => {
    cache.getTorrentSearch("ts_miss");
    expect(cache.getStats().torrentSearchMisses).toBe(1);
  });

  it("set then get increments torrentSearchHits", () => {
    cache.setTorrentSearch("ts1", [{ title: "Naruto S06E03" }]);
    cache.getTorrentSearch("ts1");
    expect(cache.getStats().torrentSearchHits).toBe(1);
  });
});

// ─── clearLayer ───────────────────────────────────────────────────────────────

describe("clearLayer", () => {
  beforeEach(() => {
    cache.setMetadata("m1", "meta");
    cache.setTorrentSearch("t1", "torrents");
    cache.setStream("s1", "stream");
  });

  it("clearLayer('stream') removes only stream entries", () => {
    cache.clearLayer("stream");
    expect(cache.getSizes().streams).toBe(0);
    expect(cache.getSizes().metadata).toBe(1);
    expect(cache.getSizes().torrentSearch).toBe(1);
  });

  it("clearLayer('metadata') removes only metadata entries", () => {
    cache.clearLayer("metadata");
    expect(cache.getSizes().metadata).toBe(0);
    expect(cache.getSizes().streams).toBe(1);
  });

  it("clearLayer('all') empties all three stores and resets stats", () => {
    // create some stats
    cache.getMetadata("m1");
    cache.clearLayer("all");
    const sizes = cache.getSizes();
    expect(sizes.metadata).toBe(0);
    expect(sizes.torrentSearch).toBe(0);
    expect(sizes.streams).toBe(0);
    // stats reset
    const stats = cache.getStats();
    expect(stats.metadataHits + stats.metadataMisses).toBe(0);
  });
});

// ─── deleteStreamCacheKeysByInfoHashPrefix ────────────────────────────────────

describe("deleteStreamCacheKeysByInfoHashPrefix", () => {
  it("deletes all keys starting with stream_<hash>", () => {
    const hash = "aabbccdd1122";
    cache.setStream(`stream_${hash}_fi0`, "url-a");
    cache.setStream(`stream_${hash}_S1E1`, "url-b");
    cache.setStream(`stream_${hash}_S1E2`, "url-c");
    cache.setStream("stream_otherhash_fi0", "unrelated");

    const deleted = cache.deleteStreamCacheKeysByInfoHashPrefix(hash);
    expect(deleted).toBe(3);
    expect(cache.getStream(`stream_${hash}_fi0`)).toBeUndefined();
    expect(cache.getStream(`stream_${hash}_S1E1`)).toBeUndefined();
    expect(cache.getStream("stream_otherhash_fi0")).toBeDefined(); // untouched
  });

  it("returns 0 when no matching keys exist", () => {
    expect(cache.deleteStreamCacheKeysByInfoHashPrefix("deadbeef")).toBe(0);
  });
});

// ─── getSizes ────────────────────────────────────────────────────────────────

describe("getSizes", () => {
  it("reflects actual entry counts after inserts", () => {
    cache.setMetadata("a", 1);
    cache.setMetadata("b", 2);
    cache.setStream("s", 3);
    const sizes = cache.getSizes();
    expect(sizes.metadata).toBe(2);
    expect(sizes.streams).toBe(1);
    expect(sizes.torrentSearch).toBe(0);
  });
});
