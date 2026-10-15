import { describe, it, expect } from "vitest";
import {
  extractSeasonEpisode,
  matchesEpisode,
  getEpisodeMatchScore,
  findMatchingFile,
  absoluteEpisodeFromVideos,
  isSeriesBatchPack,
  looksLikeMovieRelease,
  scoreEpisodeFilename,
  pickBestEpisodeFileIndex,
} from "../episode-matching.js";
import type { RealDebridFile } from "../types.js";

// ─── Helper ───────────────────────────────────────────────────────────────────

function makeFile(path: string, id: number = 1): RealDebridFile {
  return { id, path, bytes: 1_000_000_000, selected: 1 };
}

// ─── extractSeasonEpisode ─────────────────────────────────────────────────────

describe("extractSeasonEpisode", () => {
  it("extracts season and episode from valid series ID", () => {
    expect(extractSeasonEpisode("tt0434665:6:3")).toEqual({ season: 6, episode: 3 });
  });

  it("handles double-digit season and episode", () => {
    expect(extractSeasonEpisode("tt0434665:12:24")).toEqual({ season: 12, episode: 24 });
  });

  it("returns null for movie ID (no episode parts)", () => {
    expect(extractSeasonEpisode("tt1234567")).toBeNull();
  });

  it("returns null for incomplete ID (season only)", () => {
    expect(extractSeasonEpisode("tt1234567:1")).toBeNull();
  });

  it("returns null when season is not a number", () => {
    expect(extractSeasonEpisode("tt1234567:abc:3")).toBeNull();
  });

  it("returns null when episode is not a number", () => {
    expect(extractSeasonEpisode("tt1234567:1:xyz")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(extractSeasonEpisode("")).toBeNull();
  });
});

// ─── matchesEpisode ───────────────────────────────────────────────────────────

describe("matchesEpisode", () => {
  it("matches S06E03 format", () => {
    expect(matchesEpisode("Show S06E03 1080p BluRay", 6, 3)).toBe(true);
  });

  it("matches S6E3 short format", () => {
    expect(matchesEpisode("Show S6E3 720p", 6, 3)).toBe(true);
  });

  it("matches 6x03 format", () => {
    expect(matchesEpisode("Show 6x03 WEBRip", 6, 3)).toBe(true);
  });

  it("matches 06x03 padded format", () => {
    expect(matchesEpisode("Show 06x03 WEBRip", 6, 3)).toBe(true);
  });

  it("matches 'Season 6 Episode 3' format", () => {
    expect(matchesEpisode("Show Season 6 Episode 3 Complete", 6, 3)).toBe(true);
  });

  it("does not match wrong episode number", () => {
    expect(matchesEpisode("Show S06E04 1080p", 6, 3)).toBe(false);
  });

  it("does not match wrong season number", () => {
    expect(matchesEpisode("Show S07E03 1080p", 6, 3)).toBe(false);
  });

  it("returns false for null title", () => {
    expect(matchesEpisode(null, 6, 3)).toBe(false);
  });

  it("returns false for undefined title", () => {
    expect(matchesEpisode(undefined, 6, 3)).toBe(false);
  });

  it("returns false when season is 0", () => {
    expect(matchesEpisode("Show S06E03", 0, 3)).toBe(false);
  });

  it("returns false when episode is 0", () => {
    expect(matchesEpisode("Show S06E03", 6, 0)).toBe(false);
  });

  it("is case-insensitive for S/E notation", () => {
    expect(matchesEpisode("show s06e03 webrip", 6, 3)).toBe(true);
  });

  it("matches a season 1 episode 1 (edge case: no padding needed)", () => {
    expect(matchesEpisode("Pilot S01E01", 1, 1)).toBe(true);
  });
});

// ─── absoluteEpisodeFromVideos ────────────────────────────────────────────────

describe("absoluteEpisodeFromVideos", () => {
  it("computes absolute index across seasons (Naruto-style)", () => {
    const videos = [
      ...Array.from({ length: 35 }, (_, i) => ({ season: 1, episode: i + 1 })),
      ...Array.from({ length: 48 }, (_, i) => ({ season: 2, episode: i + 1 })),
      ...Array.from({ length: 40 }, (_, i) => ({ season: 3, episode: i + 1 })),
    ];
    expect(absoluteEpisodeFromVideos(videos, 3, 40)).toBe(123); // 35+48+40
  });

  it("ignores season 0 specials", () => {
    const videos = [
      { season: 0, episode: 1 },
      { season: 1, episode: 1 },
      { season: 1, episode: 2 },
    ];
    expect(absoluteEpisodeFromVideos(videos, 1, 2)).toBe(2);
  });

  it("returns null when episode not found", () => {
    expect(absoluteEpisodeFromVideos([{ season: 1, episode: 1 }], 2, 1)).toBeNull();
  });
});

describe("isSeriesBatchPack / looksLikeMovieRelease", () => {
  it("detects episode-range batch packs", () => {
    expect(isSeriesBatchPack("Show 001-220 Complete Series")).toBe(true);
    expect(isSeriesBatchPack("Show Batch Dual Audio")).toBe(true);
  });

  it("does not treat complete-series+movies as movie-only", () => {
    expect(looksLikeMovieRelease("Show Complete Series + Movies Batch")).toBe(false);
  });

  it("flags standalone movie releases", () => {
    expect(looksLikeMovieRelease("Show The Movie 1080p")).toBe(true);
  });
});

// ─── getEpisodeMatchScore ─────────────────────────────────────────────────────

describe("getEpisodeMatchScore", () => {
  it("S-padded format (S06E03) scores 10", () => {
    expect(getEpisodeMatchScore("Show S06E03 1080p", 6, 3)).toBeGreaterThanOrEqual(10);
  });

  it("padded x-format (06x03) scores 9", () => {
    const score = getEpisodeMatchScore("Show 06x03", 6, 3);
    expect(score).toBeGreaterThanOrEqual(9);
  });

  it("Season N Episode N format scores 8", () => {
    const score = getEpisodeMatchScore("Show Season 6 Episode 3", 6, 3);
    expect(score).toBeGreaterThanOrEqual(8);
  });

  it("S6E3 short format scores 7", () => {
    const score = getEpisodeMatchScore("Show S6E3", 6, 3);
    expect(score).toBeGreaterThanOrEqual(7);
  });

  it("padded format scores higher than short format", () => {
    const padded = getEpisodeMatchScore("Show S06E03", 6, 3);
    const short = getEpisodeMatchScore("Show S6E3", 6, 3);
    expect(padded).toBeGreaterThan(short);
  });

  it("multi-episode pack gets penalty (score decremented)", () => {
    const single = getEpisodeMatchScore("Show S06E03 1080p", 6, 3);
    // A pack title contains multiple SxxExx patterns
    const pack = getEpisodeMatchScore("Show S06E01-E12 Complete Season 6", 6, 3);
    // Pack should score lower because of the multi-episode penalty
    expect(pack).toBeLessThan(single);
  });

  it("batch pack with absolute episode gets a boost", () => {
    const batch = getEpisodeMatchScore("Show 001-220 Complete Batch", 3, 40, 123);
    const unrelated = getEpisodeMatchScore("Unrelated Show S01E01", 3, 40, 123);
    expect(batch).toBeGreaterThan(unrelated);
  });

  it("returns 0 for null title", () => {
    expect(getEpisodeMatchScore(null, 6, 3)).toBe(0);
  });

  it("returns 0 for no match", () => {
    expect(getEpisodeMatchScore("Show unrelated S07E04", 6, 3)).toBe(0);
  });
});

// ─── scoreEpisodeFilename / pickBestEpisodeFileIndex ───────────────────────────

describe("scoreEpisodeFilename / pickBestEpisodeFileIndex", () => {
  it("picks absolute-numbered episode over movie in a batch pack", () => {
    const names = ["Show The Movie.mkv", "Show - 123.mkv", "Show - 122.mkv"];
    expect(pickBestEpisodeFileIndex(names, 3, 40, 123)).toBe(1);
  });

  it("trusts knownFileIdx when it clearly matches absolute ep", () => {
    const names = ["Show - 100.mkv", "Show - 123.mkv", "Show - 124.mkv"];
    expect(pickBestEpisodeFileIndex(names, 3, 40, 123, 1)).toBe(1);
  });

  it("ignores knownFileIdx that does not match episode (batch pack mis-index)", () => {
    const names = [
      "Season 04/Show Episode 170.mkv",
      "Season 03/Show Episode 123.mkv",
    ];
    expect(pickBestEpisodeFileIndex(names, 3, 40, 123, 0)).toBe(1);
  });

  it("rejects knownFileIdx that points at a movie", () => {
    const names = ["Show The Movie.mkv", "Show - 123.mkv"];
    expect(pickBestEpisodeFileIndex(names, 3, 40, 123, 0)).toBe(1);
  });

  it("scores SxxExx higher than absolute alone", () => {
    const sxx = scoreEpisodeFilename("Show.S03E40.mkv", 3, 40, 123);
    const abs = scoreEpisodeFilename("Show - 123.mkv", 3, 40, 123);
    expect(sxx).toBeGreaterThan(abs);
  });
});

// ─── findMatchingFile ─────────────────────────────────────────────────────────

describe("findMatchingFile", () => {
  it("returns zero fallback for empty files array", () => {
    const result = findMatchingFile([], 6, 3);
    expect(result).toEqual({ fileId: 0, file: null, index: 0 });
  });

  it("returns zero fallback for undefined files", () => {
    const result = findMatchingFile(undefined, 6, 3);
    expect(result).toEqual({ fileId: 0, file: null, index: 0 });
  });

  it("returns first file for movie (no season/episode)", () => {
    const files = [makeFile("/movie.mkv", 1), makeFile("/extras.mkv", 2)];
    const result = findMatchingFile(files, null, null);
    expect(result.file).toBe(files[0]);
  });

  it("selects file matching S06E03 over other episode files", () => {
    const files = [
      makeFile("/Show/S06E04.mkv", 1),
      makeFile("/Show/S06E03.mkv", 2),
      makeFile("/Show/S06E02.mkv", 3),
    ];
    const result = findMatchingFile(files, 6, 3);
    expect(result.fileId).toBe(2); // S06E03 → id=2
  });

  it("returns first file as fallback when no clear episode match", () => {
    const files = [
      makeFile("/extras/behind-the-scenes.mkv", 1),
      makeFile("/extras/trailer.mkv", 2),
    ];
    const result = findMatchingFile(files, 6, 3);
    expect(result.file).toBe(files[0]);
  });

  it("penalizes movie-pattern filenames heavily (picks episode over movie file)", () => {
    const files = [
      makeFile("/Show Movie Special.mkv", 1),
      makeFile("/Show/S06E03.mkv", 2),
    ];
    const result = findMatchingFile(files, 6, 3);
    expect(result.fileId).toBe(2); // episode file wins despite being second
  });

  it("prefers .mkv over non-video files", () => {
    const files = [
      makeFile("/Show/S06E03.nfo", 1),
      makeFile("/Show/S06E03.mkv", 2),
    ];
    const result = findMatchingFile(files, 6, 3);
    expect(result.fileId).toBe(2); // mkv beats nfo
  });

  it("handles single-file torrent (returns it)", () => {
    const files = [makeFile("/Show.S06E03.1080p.mkv", 42)];
    const result = findMatchingFile(files, 6, 3);
    expect(result.fileId).toBe(42);
  });

  it("returns index alongside fileId", () => {
    const files = [
      makeFile("/Show/S06E01.mkv", 10),
      makeFile("/Show/S06E03.mkv", 11),
    ];
    const result = findMatchingFile(files, 6, 3);
    expect(result.index).toBe(1); // second file (index 1)
    expect(result.fileId).toBe(11);
  });

  it("picks absolute episode file when SxxExx is absent", () => {
    const files = [
      makeFile("/Show The Movie.mkv", 1),
      makeFile("/[Group] Show - 123.mkv", 2),
      makeFile("/[Group] Show - 124.mkv", 3),
    ];
    const result = findMatchingFile(files, 3, 40, 123);
    expect(result.fileId).toBe(2);
  });
});
