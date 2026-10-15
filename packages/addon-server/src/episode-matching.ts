/**
 * Episode Matching Utilities
 * Functions for matching TV series episodes in torrent titles and filenames
 */

import type { TorrentInfo, RealDebridFile } from "./types.js";

export interface SeasonEpisode {
  season: number;
  episode: number;
}

export interface ScoredTorrent extends TorrentInfo {
  matchScore: number;
  matches: boolean;
}

export interface MatchingFileResult {
  fileId: number;
  file: RealDebridFile | null;
  index: number;
}

export interface CinemetaVideo {
  season?: number;
  episode?: number;
  id?: string;
  name?: string;
}

/**
 * Absolute episode index (1-based) among Cinemeta videos with season > 0.
 * Used for anime/batch packs numbered 001–N instead of SxxExx.
 * Example: Naruto S03E40 → absolute 123 (35+48+40).
 */
export function absoluteEpisodeFromVideos(
  videos: CinemetaVideo[] | null | undefined,
  season: number,
  episode: number
): number | null {
  if (!videos || videos.length === 0) return null;
  const ordered = videos
    .filter((v) => (v.season ?? 0) > 0 && (v.episode ?? 0) > 0)
    .sort((a, b) => (a.season! - b.season!) || (a.episode! - b.episode!));
  const idx = ordered.findIndex((v) => v.season === season && v.episode === episode);
  return idx >= 0 ? idx + 1 : null;
}

/**
 * Extract season and episode from Stremio ID
 * Format: tt0434665:6:3 -> { season: 6, episode: 3 }
 */
export function extractSeasonEpisode(id: string): SeasonEpisode | null {
  const parts = id.split(":");
  if (parts.length >= 3) {
    const season = parseInt(parts[1], 10);
    const episode = parseInt(parts[2], 10);
    if (!isNaN(season) && !isNaN(episode)) {
      return { season, episode };
    }
  }
  return null;
}

/**
 * Check if a torrent title matches a specific season/episode
 * Supports formats: S06E03, 6x03, Season 6 Episode 3, S6E3, etc.
 */
export function matchesEpisode(title: string | null | undefined, season: number, episode: number): boolean {
  if (!title || !season || !episode) return false;

  const seasonStr = season.toString();
  const episodeStr = episode.toString();
  const seasonPadded = seasonStr.padStart(2, "0");
  const episodePadded = episodeStr.padStart(2, "0");

  const patterns = [
    new RegExp(`[s\\s]${seasonPadded}[e\\s]${episodePadded}`, "i"),
    new RegExp(`[s\\s]${seasonStr}[e\\s]${episodeStr}`, "i"),
    new RegExp(`\\b${seasonStr}x${episodePadded}\\b`, "i"),
    new RegExp(`\\b${seasonPadded}x${episodePadded}\\b`, "i"),
    new RegExp(`season\\s*${seasonStr}\\s*episode\\s*${episodeStr}`, "i"),
  ];

  for (const pattern of patterns) {
    if (pattern.test(title)) {
      return true;
    }
  }

  return false;
}

/**
 * Batch/complete-series packs (e.g. "001-220") that can contain the absolute episode.
 */
export function isSeriesBatchPack(title: string | null | undefined): boolean {
  if (!title) return false;
  return (
    /\b0*1\s*[-–~]\s*\d{2,4}\b/i.test(title) ||
    /\bcomplete\s+series\b/i.test(title) ||
    /\bbatch\b/i.test(title) ||
    /\bintegrale\b/i.test(title) ||
    /\b0+\d{2,3}\s*[-–]\s*\d{2,4}\b/i.test(title)
  );
}

/**
 * True when title looks like a movie/OVA pack rather than a TV episode release.
 */
export function looksLikeMovieRelease(title: string | null | undefined): boolean {
  if (!title) return false;
  const lower = title.toLowerCase();
  // Complete series + movies is a batch pack, not a movie-only title
  if (isSeriesBatchPack(title) && /\bmovies?\b/.test(lower)) return false;
  return (
    /\b(?:the\s+)?movie\b/i.test(title) ||
    /\bfilm\b/i.test(title) ||
    /\btheatrical\b/i.test(title)
  );
}

/**
 * Score how well a torrent matches the episode (higher = better match)
 */
export function getEpisodeMatchScore(
  title: string | null | undefined,
  season: number,
  episode: number,
  absoluteEpisode?: number | null
): number {
  if (!title || !season || !episode) return 0;

  const seasonStr = season.toString();
  const episodeStr = episode.toString();
  const seasonPadded = seasonStr.padStart(2, "0");
  const episodePadded = episodeStr.padStart(2, "0");

  let score = 0;

  if (new RegExp(`[s\\s]${seasonPadded}[e\\s]${episodePadded}`, "i").test(title)) {
    score += 10;
  }
  if (new RegExp(`\\b${seasonPadded}x${episodePadded}\\b`, "i").test(title)) {
    score += 9;
  }
  if (new RegExp(`season\\s*${seasonStr}\\s*episode\\s*${episodeStr}`, "i").test(title)) {
    score += 8;
  }
  if (new RegExp(`[s\\s]${seasonStr}[e\\s]${episodeStr}`, "i").test(title)) {
    score += 7;
  }
  if (new RegExp(`\\b${seasonStr}x${episodePadded}\\b`, "i").test(title)) {
    score += 6;
  }

  if (absoluteEpisode != null && absoluteEpisode > 0 && isSeriesBatchPack(title)) {
    score += 4;
  }

  if (looksLikeMovieRelease(title)) {
    score -= 15;
  }

  const otherEpisodePattern = new RegExp(`[s\\s]\\d+[e\\s]\\d+`, "gi");
  const matches = title.match(otherEpisodePattern);
  if (matches && matches.length > 1) {
    score -= 5;
  }

  return score;
}

/**
 * Score a single video filename for episode selection inside a multi-file torrent.
 * Higher = better. Shared by RD and TorBox pickers.
 */
export function scoreEpisodeFilename(
  filename: string,
  season: number,
  episode: number,
  absoluteEpisode?: number | null
): number {
  const name = filename.toLowerCase();
  let score = 0;

  const videoExtensions = [".mkv", ".mp4", ".avi", ".m4v", ".webm", ".mov", ".ts", ".wmv"];
  const hasVideoExtension = videoExtensions.some((ext) => name.endsWith(ext));
  if (!hasVideoExtension) {
    score -= 50;
  }

  if (/\b(?:the\s+)?movie\b|\bfilm\b|\btheatrical\b/.test(name)) {
    score -= 100;
  }
  if (/\bova\b|\boav\b/.test(name) && !new RegExp(`s0?${season}e0?${episode}`, "i").test(name)) {
    score -= 40;
  }

  const seasonStr = String(season);
  const episodeStr = String(episode);
  const seasonPadded = seasonStr.padStart(2, "0");
  const episodePadded = episodeStr.padStart(2, "0");

  if (new RegExp(`s${seasonPadded}e${episodePadded}`, "i").test(name)) score += 100;
  else if (new RegExp(`s${seasonStr}e${episodeStr}\\b`, "i").test(name)) score += 95;
  else if (new RegExp(`\\b${seasonPadded}x${episodePadded}\\b`, "i").test(name)) score += 90;
  else if (new RegExp(`\\b${seasonStr}x${episodePadded}\\b`, "i").test(name)) score += 85;
  else if (new RegExp(`season\\s*${seasonStr}\\s*episode\\s*${episodeStr}`, "i").test(name)) score += 80;

  if (absoluteEpisode != null && absoluteEpisode > 0) {
    const abs = String(absoluteEpisode);
    const absPad = abs.padStart(3, "0");
    const absPad2 = abs.padStart(2, "0");
    const absPatterns = [
      new RegExp(`\\be(?:p(?:isode)?)?[\\s._-]*0*${abs}\\b`, "i"),
      new RegExp(`\\[${absPad}\\]`),
      new RegExp(`\\[${absPad2}\\]`),
      new RegExp(`\\[${abs}\\]`),
      new RegExp(`(?:^|[\\s._-])0*${absPad}(?:[\\s._-]|$)`),
      new RegExp(`(?:^|[\\s._-])0*${absPad2}(?:[\\s._-]|$)`),
    ];
    if (absPatterns.some((p) => p.test(name))) {
      score += 70;
    }
  }

  const otherEpisodePattern = /s(\d+)e(\d+)/gi;
  for (const match of name.matchAll(otherEpisodePattern)) {
    const foundSeason = parseInt(match[1], 10);
    const foundEpisode = parseInt(match[2], 10);
    if (foundSeason !== season || foundEpisode !== episode) {
      score -= 30;
    }
  }

  return score;
}

/**
 * Pick best file index from a list of names (0-based). Returns -1 if none.
 */
export function pickBestEpisodeFileIndex(
  fileNames: string[],
  season: number,
  episode: number,
  absoluteEpisode?: number | null,
  knownFileIdx?: number
): number {
  if (fileNames.length === 0) return -1;

  if (knownFileIdx !== undefined && knownFileIdx >= 0 && knownFileIdx < fileNames.length) {
    const knownScore = scoreEpisodeFilename(
      fileNames[knownFileIdx],
      season,
      episode,
      absoluteEpisode
    );
    // Only trust discovery index when it clearly matches SxxExx or absolute ep
    // (score ≥ 50). Otherwise fall through — Torrentio fileIdx is sometimes wrong
    // for large batch packs.
    if (knownScore >= 50) {
      return knownFileIdx;
    }
  }

  let bestIdx = -1;
  let bestScore = -Infinity;
  for (let i = 0; i < fileNames.length; i++) {
    const s = scoreEpisodeFilename(fileNames[i], season, episode, absoluteEpisode);
    if (s > bestScore) {
      bestScore = s;
      bestIdx = i;
    }
  }

  if (bestScore <= 0) return -1;
  return bestIdx;
}

/**
 * Find the best matching file ID for a season/episode in a torrent
 */
export function findMatchingFile(
  files: RealDebridFile[] | undefined,
  season: number | null,
  episode: number | null,
  absoluteEpisode?: number | null,
  knownFileIdx?: number
): MatchingFileResult {
  if (!files || !Array.isArray(files) || files.length === 0) {
    return { fileId: 0, file: null, index: 0 };
  }

  if (!season || !episode) {
    const firstFile = files[0];
    return { fileId: (firstFile.id as number) || 0, file: firstFile, index: 0 };
  }

  const names = files.map((f) => (f.path || f.filename || "").toString());
  const bestIdx = pickBestEpisodeFileIndex(names, season, episode, absoluteEpisode, knownFileIdx);

  if (bestIdx >= 0) {
    const best = files[bestIdx];
    console.log(
      `✓ Selected: ${(best.path || best.filename || "").toString()} (idx=${bestIdx}, abs=${absoluteEpisode ?? "n/a"})`
    );
    return {
      fileId: (best.id as number) || bestIdx,
      file: best,
      index: bestIdx,
    };
  }

  console.log(`⚠️  No clear episode match in filenames, using first video-like file`);
  const firstVideo = files.findIndex((f) =>
    /\.(mkv|mp4|avi|m4v|webm|mov)$/i.test((f.path || f.filename || "").toString())
  );
  const idx = firstVideo >= 0 ? firstVideo : 0;
  const file = files[idx];
  return { fileId: (file.id as number) || idx, file, index: idx };
}
