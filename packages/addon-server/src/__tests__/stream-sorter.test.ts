import { describe, it, expect } from "vitest";
import {
  parseResolution,
  scoreTorrent,
  scoreRdInstantAvailability,
  buildStreamName,
  sortTorrents,
  sortStreams,
  scoreAudioPreference,
} from "../stream-sorter.js";
import type { TorrentInfo, Stream } from "../types.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeTorrent(overrides: Partial<TorrentInfo> = {}): TorrentInfo {
  return {
    title: "Show S01E01",
    infoHash: "abc123",
    magnetLink: "magnet:?xt=urn:btih:abc123",
    quality: "",
    size: "",
    ...overrides,
  };
}

function makeStream(overrides: Partial<Stream> = {}): Stream {
  return {
    name: "Real-Debrid",
    title: "Show S01E01\n👤 100 💾 2 GB",
    url: "https://example.com/stream",
    ...overrides,
  };
}

// ─── parseResolution ─────────────────────────────────────────────────────────

describe("parseResolution", () => {
  it("detects 1080p", () => {
    expect(parseResolution("Naruto S06E03 1080p BluRay")).toBe("1080p");
  });

  it("detects 4K from 2160p", () => {
    expect(parseResolution("Movie.2160p.UHD.HEVC")).toBe("4K");
  });

  it("detects 4K from uhd keyword", () => {
    expect(parseResolution("Show UHD BluRay")).toBe("4K");
  });

  it("detects 720p", () => {
    expect(parseResolution("some.show.720p.x265")).toBe("720p");
  });

  it("detects 480p", () => {
    expect(parseResolution("low.res.480p.webrip")).toBe("480p");
  });

  it("detects 360p", () => {
    expect(parseResolution("ancient.360p.file")).toBe("360p");
  });

  it("returns empty string when no resolution found", () => {
    expect(parseResolution("no resolution info at all")).toBe("");
  });

  it("is case-insensitive", () => {
    expect(parseResolution("Movie.1080P.BluRay")).toBe("1080p");
  });
});

// ─── scoreTorrent ─────────────────────────────────────────────────────────────

describe("scoreTorrent", () => {
  it("1080p scores higher than 720p", () => {
    const hd = makeTorrent({ title: "Show S01E01 1080p WEBRip" });
    const sd = makeTorrent({ title: "Show S01E01 720p WEBRip" });
    expect(scoreTorrent(hd)).toBeGreaterThan(scoreTorrent(sd));
  });

  it("HEVC adds codec bonus", () => {
    const withHevc = makeTorrent({ title: "Show 1080p HEVC" });
    const noHevc = makeTorrent({ title: "Show 1080p" });
    expect(scoreTorrent(withHevc)).toBeGreaterThan(scoreTorrent(noHevc));
  });

  it("Hebrew audio adds bonus", () => {
    const hebrew = makeTorrent({ title: "Show 1080p Hebrew" });
    const noHebrew = makeTorrent({ title: "Show 1080p" });
    expect(scoreTorrent(hebrew)).toBeGreaterThan(scoreTorrent(noHebrew));
  });

  it("suspiciously small file (< 100 MB) gets heavy penalty", () => {
    const normal = makeTorrent({ title: "Show S01E01 1080p 💾 2.5 GB" });
    const tiny = makeTorrent({ title: "Show S01E01 1080p 💾 0.05 GB" });
    expect(scoreTorrent(normal)).toBeGreaterThan(scoreTorrent(tiny));
  });

  it("more seeds gives higher score (up to cap)", () => {
    const manySeeds = makeTorrent({ title: "Show 720p 👤 100" });
    const fewSeeds = makeTorrent({ title: "Show 720p 👤 2" });
    expect(scoreTorrent(manySeeds)).toBeGreaterThan(scoreTorrent(fewSeeds));
  });

  it("seed bonus is capped at +20 (200 seeds == 40 seeds in terms of bonus)", () => {
    const lotsSeeds = makeTorrent({ title: "Show 👤 200" });
    const capped = makeTorrent({ title: "Show 👤 40" });
    // Both should get exactly +20 seed bonus (min(200*0.5,20) == min(40*0.5,20) == 20)
    expect(scoreTorrent(lotsSeeds)).toBe(scoreTorrent(capped));
  });

  it("Torrentio/Q source adds source bonus", () => {
    const q = makeTorrent({ title: "Show 1080p", source: "Torrentio/Q" });
    const s = makeTorrent({ title: "Show 1080p", source: "Torrentio/S" });
    expect(scoreTorrent(q)).toBeGreaterThan(scoreTorrent(s));
  });

  it("remux adds large bonus", () => {
    const remux = makeTorrent({ title: "Show 1080p Remux" });
    const webdl = makeTorrent({ title: "Show 1080p WEB-DL" });
    expect(scoreTorrent(remux)).toBeGreaterThan(scoreTorrent(webdl));
  });

  it("Dual Audio ranks above single-language dub packs", () => {
    const dual = makeTorrent({ title: "Show S01E01 1080p Dual Audio" });
    const ita = makeTorrent({ title: "Show S01E01 1080p ITA" });
    expect(scoreTorrent(dual)).toBeGreaterThan(scoreTorrent(ita));
  });
});

describe("scoreAudioPreference", () => {
  it("boosts dual/multi", () => {
    expect(scoreAudioPreference("Show Dual Audio 1080p")).toBeGreaterThan(0);
    expect(scoreAudioPreference("Show Multi-Audio")).toBeGreaterThan(0);
  });

  it("penalizes single-language dub tags without dual/multi", () => {
    expect(scoreAudioPreference("Show ITA 1080p")).toBeLessThan(0);
    expect(scoreAudioPreference("Show GERMAN Dub")).toBeLessThan(0);
  });

  it("does not penalize dual packs that also mention a language", () => {
    expect(scoreAudioPreference("Show Dual Audio ITA ENG")).toBeGreaterThan(0);
  });
});

// ─── scoreRdInstantAvailability ───────────────────────────────────────────────

describe("scoreRdInstantAvailability", () => {
  it("returns 0 for null", () => {
    expect(scoreRdInstantAvailability(null)).toBe(0);
  });

  it("returns 0 for undefined", () => {
    expect(scoreRdInstantAvailability(undefined)).toBe(0);
  });

  it("returns 0 for empty object", () => {
    expect(scoreRdInstantAvailability({})).toBe(0);
  });

  it("counts top-level array elements", () => {
    // Array of 2 items → score += 2
    expect(scoreRdInstantAvailability([1, 2])).toBe(2);
  });

  it("walks nested objects and arrays", () => {
    // { rd: [{ a: 1 }, { b: 2 }] }
    // walk: object → values → array (score+=2) → obj (score+0) → obj (score+0)
    const data = { rd: [{ a: 1 }, { b: 2 }] };
    // outer object: 0; "rd" value is array of 2 → +2; each element is object with no arrays → +0
    expect(scoreRdInstantAvailability(data)).toBe(2);
  });

  it("accumulates across deeply nested structures", () => {
    const data = { a: [1, 2], b: { c: [3, 4, 5] } };
    // array [1,2] → +2; array [3,4,5] → +3; total = 5
    expect(scoreRdInstantAvailability(data)).toBe(5);
  });
});

// ─── buildStreamName ──────────────────────────────────────────────────────────

describe("buildStreamName", () => {
  it("uses Real-Debrid as default provider", () => {
    const torrent = makeTorrent({ title: "Show 1080p" });
    const { name } = buildStreamName(torrent);
    expect(name).toContain("Real-Debrid");
  });

  it("uses custom provider name", () => {
    const torrent = makeTorrent({ title: "Show 1080p" });
    const { name } = buildStreamName(torrent, "TorBox");
    expect(name).toContain("TorBox");
  });

  it("includes resolution tag", () => {
    const torrent = makeTorrent({ title: "Show 1080p WEBRip" });
    const { name } = buildStreamName(torrent);
    expect(name).toContain("1080p");
  });

  it("includes Q tag for Torrentio/Q source", () => {
    const torrent = makeTorrent({ title: "Show 1080p", source: "Torrentio/Q" });
    const { name } = buildStreamName(torrent);
    expect(name).toContain("Q");
  });

  it("includes S tag for Torrentio/S source", () => {
    const torrent = makeTorrent({ title: "Show 1080p", source: "Torrentio/S" });
    const { name } = buildStreamName(torrent);
    expect(name).toContain("S");
  });

  it("includes HEVC tag when present", () => {
    const torrent = makeTorrent({ title: "Show 1080p HEVC" });
    const { name } = buildStreamName(torrent);
    expect(name).toContain("HEVC");
  });

  it("DV takes precedence over HDR in tags", () => {
    const torrent = makeTorrent({ title: "Show 2160p Dolby Vision HDR10+" });
    const { name } = buildStreamName(torrent);
    expect(name).toContain("DV");
    expect(name).not.toContain("HDR");
  });

  it("returns just provider name when no recognizable tags", () => {
    const torrent = makeTorrent({ title: "Show no tags here" });
    const { name } = buildStreamName(torrent);
    expect(name).toBe("Real-Debrid");
  });

  it("tier note appears in title for Torrentio/Q", () => {
    const torrent = makeTorrent({ title: "Show 1080p", source: "Torrentio/Q" });
    const { title } = buildStreamName(torrent);
    expect(title).toContain("quality-ranked");
  });

  it("Hebrew flag emoji included for heb torrents", () => {
    const torrent = makeTorrent({ title: "Show 1080p Hebrew" });
    const { name } = buildStreamName(torrent);
    expect(name).toContain("🇮🇱");
  });
});

// ─── sortTorrents ─────────────────────────────────────────────────────────────

describe("sortTorrents", () => {
  it("puts higher-quality torrents first", () => {
    const torrents = [
      makeTorrent({ title: "Show 720p WEBRip", infoHash: "aaa" }),
      makeTorrent({ title: "Show 1080p BluRay HEVC", infoHash: "bbb" }),
      makeTorrent({ title: "Show 480p", infoHash: "ccc" }),
    ];
    const sorted = sortTorrents(torrents);
    expect(sorted[0].infoHash).toBe("bbb"); // 1080p BluRay HEVC = highest
    expect(sorted[sorted.length - 1].infoHash).toBe("ccc"); // 480p = lowest
  });
});

// ─── sortStreams ──────────────────────────────────────────────────────────────

describe("sortStreams", () => {
  it("local streams always sort after remote streams", () => {
    const remote = makeStream({ discoveryTier: "quality", url: "https://rd.com/a" });
    const local = makeStream({ discoveryTier: "local", url: "https://local.com/b" });
    const sorted = sortStreams([local, remote]);
    expect(sorted[0]).toBe(remote);
    expect(sorted[1]).toBe(local);
  });

  it("higher rdCacheScore sorts first among remote streams", () => {
    const strong = makeStream({ rdCacheScore: 10, url: "https://rd.com/strong" });
    const weak = makeStream({ rdCacheScore: 2, url: "https://rd.com/weak" });
    const sorted = sortStreams([weak, strong]);
    expect(sorted[0]).toBe(strong);
  });

  it("quality tier sorts before seeders tier at same rdCacheScore", () => {
    const qualityStream = makeStream({ discoveryTier: "quality", rdCacheScore: 5, url: "https://rd.com/q" });
    const seedersStream = makeStream({ discoveryTier: "seeders", rdCacheScore: 5, url: "https://rd.com/s" });
    const sorted = sortStreams([seedersStream, qualityStream]);
    expect(sorted[0]).toBe(qualityStream);
  });

  it("among same tier and same rdCacheScore, higher quality title sorts first", () => {
    const hd = makeStream({
      discoveryTier: "quality",
      rdCacheScore: 5,
      title: "Show 1080p HEVC",
      name: "Real-Debrid | Q | 1080p",
      url: "https://rd.com/hd",
    });
    const sd = makeStream({
      discoveryTier: "quality",
      rdCacheScore: 5,
      title: "Show 480p",
      name: "Real-Debrid | Q | 480p",
      url: "https://rd.com/sd",
    });
    const sorted = sortStreams([sd, hd]);
    expect(sorted[0]).toBe(hd);
  });

  it("handles empty array", () => {
    expect(sortStreams([])).toEqual([]);
  });

  it("preserves all streams (does not drop any)", () => {
    const streams = [
      makeStream({ url: "https://a.com" }),
      makeStream({ url: "https://b.com" }),
      makeStream({ url: "https://c.com" }),
    ];
    expect(sortStreams(streams)).toHaveLength(3);
  });

  it("puts magnet streams after direct http(s) remotes and local files", () => {
    const magnet = makeStream({
      name: "Real-Debrid | 1080p",
      title: "Show 1080p HEVC",
      url: "magnet:?xt=urn:btih:deadbeef",
      discoveryTier: "quality",
      rdCacheScore: 50,
    });
    const torbox = makeStream({
      name: "TorBox | 720p",
      title: "Show 720p",
      url: "https://torbox.example/file",
      discoveryTier: "quality",
    });
    const local = makeStream({
      name: "Local",
      title: "Show 1080p",
      url: "https://local.example/file",
      discoveryTier: "local",
    });
    const sorted = sortStreams([magnet, local, torbox]);
    expect(sorted.map((s) => s.url)).toEqual([torbox.url, local.url, magnet.url]);
  });

  it("sub-sorts magnets by rdCacheScore, then Torrentio Q before S, then quality", () => {
    const magnetQ = makeStream({
      name: "Real-Debrid | Q | 720p",
      title: "Show 720p",
      url: "magnet:?xt=urn:btih:aaa",
      discoveryTier: "quality",
      rdCacheScore: 5,
    });
    const magnetS = makeStream({
      name: "Real-Debrid | S | 1080p",
      title: "Show 1080p HEVC",
      url: "magnet:?xt=urn:btih:bbb",
      discoveryTier: "seeders",
      rdCacheScore: 5,
    });
    const magnetStrong = makeStream({
      name: "Real-Debrid | Q | 480p",
      title: "Show 480p",
      url: "magnet:?xt=urn:btih:ccc",
      discoveryTier: "quality",
      rdCacheScore: 20,
    });
    const https = makeStream({
      name: "TorBox | 480p",
      title: "Show 480p",
      url: "https://torbox.example/file",
    });
    const sorted = sortStreams([magnetS, https, magnetQ, magnetStrong]);
    expect(sorted.map((s) => s.url)).toEqual([https.url, magnetStrong.url, magnetQ.url, magnetS.url]);
  });

  it("treats infoHash streams without an http(s) url as magnets", () => {
    const hashOnly = makeStream({
      name: "Real-Debrid",
      title: "Show 1080p",
      url: "",
      infoHash: "abcdef",
    });
    const direct = makeStream({ url: "https://rd.example/file" });
    const sorted = sortStreams([hashOnly, direct]);
    expect(sorted[0]).toBe(direct);
    expect(sorted[1]).toBe(hashOnly);
  });
});
