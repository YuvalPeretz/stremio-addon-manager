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

  // Common patterns to match
  const patterns = [
    // S06E03, S6E3
    new RegExp(`[s]${seasonPadded}[e]${episodePadded}`, "i"),
    new RegExp(`[s]${seasonStr}[e]${episodeStr}`, "i"),
    // 6x03, 06x03
    new RegExp(`\\b${seasonStr}x${episodePadded}\\b`, "i"),
    new RegExp(`\\b${seasonPadded}x${episodePadded}\\b`, "i"),
    // Season 6 Episode 3
    new RegExp(`season\\s*${seasonStr}\\s*episode\\s*${episodeStr}`, "i"),
    // E03 (episode only - less reliable, but sometimes used)
    new RegExp(`\\b[e]${episodePadded}\\b`, "i"),
  ];

  // Check if any pattern matches
  for (const pattern of patterns) {
    if (pattern.test(title)) {
      return true;
    }
  }

  return false;
}

/**
 * Score how well a torrent matches the episode (higher = better match)
 */
export function getEpisodeMatchScore(title: string | null | undefined, season: number, episode: number): number {
  if (!title || !season || !episode) return 0;

  const seasonStr = season.toString();
  const episodeStr = episode.toString();
  const seasonPadded = seasonStr.padStart(2, "0");
  const episodePadded = episodeStr.padStart(2, "0");

  let score = 0;

  // Exact matches get higher scores
  if (new RegExp(`[s]${seasonPadded}[e]${episodePadded}`, "i").test(title)) {
    score += 10; // S06E03 format
  }
  if (new RegExp(`\\b${seasonPadded}x${episodePadded}\\b`, "i").test(title)) {
    score += 9; // 06x03 format
  }
  if (new RegExp(`season\\s*${seasonStr}\\s*episode\\s*${episodeStr}`, "i").test(title)) {
    score += 8; // Season 6 Episode 3
  }
  if (new RegExp(`[s]${seasonStr}[e]${episodeStr}`, "i").test(title)) {
    score += 7; // S6E3 format
  }
  if (new RegExp(`\\b${seasonStr}x${episodePadded}\\b`, "i").test(title)) {
    score += 6; // 6x03 format
  }

  // Penalize if title contains other episodes (multi-episode packs)
  const otherEpisodePattern = new RegExp(`[s]\\d+[e]\\d+`, "gi");
  const matches = title.match(otherEpisodePattern);
  if (matches && matches.length > 1) {
    score -= 5; // Multi-episode torrents are less reliable
  }

  return score;
}

/**
 * Find the best matching file ID for a season/episode in a torrent
 * Returns the file ID (or index if no ID available) and the file object
 */
export function findMatchingFile(
  files: RealDebridFile[] | undefined,
  season: number | null,
  episode: number | null
): MatchingFileResult {
  if (!files || !Array.isArray(files) || files.length === 0) {
    return { fileId: 0, file: null, index: 0 };
  }

  if (!season || !episode) {
    // For movies or when no episode info, return first file
    const firstFile = files[0];
    return { fileId: (firstFile.id as number) || 0, file: firstFile, index: 0 };
  }

  const seasonStr = season.toString();
  const episodeStr = episode.toString();
  const seasonPadded = seasonStr.padStart(2, "0");
  const episodePadded = episodeStr.padStart(2, "0");

  // Score each file based on how well it matches
  interface ScoredFile {
    file: RealDebridFile;
    index: number;
    score: number;
    filename: string;
    fileId: number;
  }

  const scoredFiles: ScoredFile[] = files.map((file, index) => {
    const filename = ((file.path || file.filename || "") as string).toLowerCase();
    let score = 0;

    // Exact matches get highest scores
    if (new RegExp(`[s]${seasonPadded}[e]${episodePadded}`, "i").test(filename)) {
      score += 10; // S06E03 format
    }
    if (new RegExp(`\\b${seasonPadded}x${episodePadded}\\b`, "i").test(filename)) {
      score += 9; // 06x03 format
    }
    if (new RegExp(`season\\s*${seasonStr}\\s*episode\\s*${episodeStr}`, "i").test(filename)) {
      score += 8; // Season 6 Episode 3
    }
    if (new RegExp(`[s]${seasonStr}[e]${episodeStr}`, "i").test(filename)) {
      score += 7; // S6E3 format
    }
    if (new RegExp(`\\b${seasonStr}x${episodePadded}\\b`, "i").test(filename)) {
      score += 6; // 6x03 format
    }

    // Penalize files that match other episodes (check if filename contains episode patterns that don't match)
    const otherEpisodePattern = new RegExp(`[s](\\d+)[e](\\d+)`, "gi");
    const matches = [...filename.matchAll(otherEpisodePattern)];
    if (matches.length > 0) {
      for (const match of matches) {
        const foundSeason = parseInt(match[1], 10);
        const foundEpisode = parseInt(match[2], 10);
        if (foundSeason !== season || foundEpisode !== episode) {
          score -= 5; // Contains other episodes
        }
      }
    }

    return {
      file,
      index,
      score,
      filename,
      fileId: (file.id as number) || index,
    };
  });

  // Sort by score (highest first) and return the best match
  scoredFiles.sort((a, b) => b.score - a.score);
  const bestMatch = scoredFiles[0];

  if (bestMatch.score > 0) {
    console.log(`Found matching file: ${bestMatch.filename.substring(0, 60)} (score: ${bestMatch.score})`);
    return { fileId: bestMatch.fileId, file: bestMatch.file, index: bestMatch.index };
  }

  // If no good match found, return first file as fallback
  console.log(`No clear episode match in filenames, using first file`);
  const firstFile = files[0];
  return { fileId: (firstFile.id as number) || 0, file: firstFile, index: 0 };
}
