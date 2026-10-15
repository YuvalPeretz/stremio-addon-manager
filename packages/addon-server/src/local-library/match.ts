/**
 * Match indexed local files to Stremio stream requests (exact imdb + fuzzy title fallbacks).
 */

import type { CinemetaMetadata } from "../types.js";
import type { IndexedFileRecord } from "./types.js";
import type { LocalFileMetadata } from "./types.js";
import { jaccardTokens, normalizeForMatch, tokenizeNormalized } from "./tokens.js";
import { stringSimilarityNorm } from "./fuzzy-score.js";

export interface ParsedStremioId {
  imdbId: string;
  season: number | null;
  episode: number | null;
}

export function parseStremioContentId(id: string): ParsedStremioId | null {
  const base = id.split(":")[0];
  if (!/^tt\d+$/i.test(base)) return null;
  const imdbId = base.toLowerCase();
  const parts = id.split(":");
  if (parts.length >= 3) {
    const season = parseInt(parts[1], 10);
    const episode = parseInt(parts[2], 10);
    if (!isNaN(season) && !isNaN(episode)) {
      return { imdbId, season, episode };
    }
  }
  return { imdbId, season: null, episode: null };
}

/**
 * Exact match: same imdbId; movie request matches type movie or unset; series request matches S/E when set on file.
 */
export function findExactMatches(
  stremioType: string,
  stremioId: string,
  indexed: IndexedFileRecord[]
): IndexedFileRecord[] {
  const parsed = parseStremioContentId(stremioId);
  if (!parsed) return [];

  const isSeriesRequest = stremioType === "series" && parsed.season !== null && parsed.episode !== null;

  return indexed.filter((rec) => {
    const m = rec.effective;
    if (!m.imdbId || m.imdbId.toLowerCase() !== parsed.imdbId) return false;

    if (isSeriesRequest) {
      if (m.type === "movie") return false;
      // Require explicit S/E on the file so we do not attach one file to every episode.
      if (typeof m.season !== "number" || typeof m.episode !== "number") return false;
      return m.season === parsed.season && m.episode === parsed.episode;
    }

    // Movie request (id without :season:episode)
    if (m.type === "series") return false;
    if (typeof m.season === "number" || typeof m.episode === "number") return false;
    return true;
  });
}

export interface FuzzyMatchOptions {
  excludeFileIds: Set<string>;
  maxResults: number;
  /** Minimum combined score in [0, 1] */
  threshold: number;
}

interface CinemetaVideo {
  id?: string;
  name?: string;
  title?: string;
  season?: number;
  episode?: number;
  number?: number;
}

/**
 * Build strings from Cinemeta meta to compare against local filenames / display names.
 */
export function getCinemetaTargetStrings(
  stremioType: string,
  stremioId: string,
  meta: CinemetaMetadata
): string[] {
  const out = new Set<string>();
  const name = (meta.name || "").trim();
  if (name) out.add(name);
  const year = meta.year;
  if (year != null && name) out.add(`${name} ${year}`);

  if (stremioType === "series") {
    const parts = stremioId.split(":");
    const season = parts.length >= 2 ? parseInt(parts[1], 10) : NaN;
    const episode = parts.length >= 3 ? parseInt(parts[2], 10) : NaN;
    const videos = (meta as { videos?: CinemetaVideo[] }).videos;
    if (videos && !isNaN(season) && !isNaN(episode)) {
      const hit = videos.find((v) => {
        if (v.id === stremioId) return true;
        const s = v.season;
        const e = v.episode ?? v.number;
        return s === season && e === episode;
      });
      if (hit) {
        const epTitle = (hit.name || hit.title || "").trim();
        if (epTitle) {
          out.add(epTitle);
          if (name) {
            out.add(`${name} ${epTitle}`);
            out.add(`${name} ${season} ${episode}`);
          }
        }
      }
    }
  }

  return [...out].filter(Boolean);
}

function isFuzzyCandidate(rec: IndexedFileRecord, parsed: ParsedStremioId, isSeriesRequest: boolean): boolean {
  const m = rec.effective;

  if (isSeriesRequest && parsed.season != null && parsed.episode != null) {
    if (m.type === "movie") return false;
    const sameImdb = m.imdbId?.toLowerCase() === parsed.imdbId;
    if (sameImdb && typeof m.season === "number" && typeof m.episode === "number") {
      if (m.season !== parsed.season || m.episode !== parsed.episode) return false;
    }
  } else {
    if (m.type === "series" && (typeof m.season === "number" || typeof m.episode === "number")) {
      return false;
    }
  }

  return true;
}

function scoreFuzzyRecord(
  rec: IndexedFileRecord,
  targets: string[],
  metaYear: number | undefined,
  isSeriesRequest: boolean,
  season: number,
  episode: number
): number {
  const m = rec.effective;
  const blobs: string[] = [];
  if (m.displayName?.trim()) blobs.push(m.displayName.trim());
  if (m.aliases?.length) blobs.push(...m.aliases.map((a) => a.trim()).filter(Boolean));
  const baseTitle = rec.basename.replace(/\.[^/.]+$/i, "");
  blobs.push(baseTitle);

  const normTargets = targets.map((t) => normalizeForMatch(t)).filter((t) => t.length > 0);
  if (normTargets.length === 0) return 0;

  let best = 0;
  for (const blob of blobs) {
    const n = normalizeForMatch(blob);
    if (!n) continue;
    for (const nt of normTargets) {
      best = Math.max(best, stringSimilarityNorm(n, nt));
      best = Math.max(best, jaccardTokens(tokenizeNormalized(n), tokenizeNormalized(nt)));
    }
  }

  let bonus = 0;
  if (metaYear !== undefined && m.year === metaYear) bonus += 0.12;
  if (isSeriesRequest && !isNaN(season) && !isNaN(episode)) {
    const lower = rec.basename.toLowerCase();
    const pats = [
      `s${season}e${episode}`,
      `s${String(season).padStart(2, "0")}e${String(episode).padStart(2, "0")}`,
      `${season}x${episode}`,
    ];
    if (pats.some((p) => lower.includes(p))) bonus += 0.12;
  }

  return Math.min(1, best * 0.88 + bonus);
}

/**
 * Title-based matches for files that did not hit exact imdb rules. Requires Cinemeta context.
 */
export function findFuzzyMatches(
  stremioType: string,
  stremioId: string,
  indexed: IndexedFileRecord[],
  cinemeta: CinemetaMetadata,
  opts: FuzzyMatchOptions
): IndexedFileRecord[] {
  const parsed = parseStremioContentId(stremioId);
  if (!parsed) return [];

  const isSeriesRequest = stremioType === "series" && parsed.season !== null && parsed.episode !== null;
  const season = parsed.season ?? NaN;
  const episode = parsed.episode ?? NaN;

  const targets = getCinemetaTargetStrings(stremioType, stremioId, cinemeta);
  if (targets.length === 0) return [];

  const scored: { rec: IndexedFileRecord; score: number }[] = [];

  for (const rec of indexed) {
    if (opts.excludeFileIds.has(rec.fileId)) continue;
    if (!isFuzzyCandidate(rec, parsed, isSeriesRequest)) continue;
    if (!hasFuzzySignals(rec.effective, rec.basename)) continue;

    const score = scoreFuzzyRecord(rec, targets, cinemeta.year, isSeriesRequest, season, episode);
    if (score >= opts.threshold) {
      scored.push({ rec, score });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  const out: IndexedFileRecord[] = [];
  const seen = new Set<string>();
  for (const { rec } of scored) {
    if (seen.has(rec.fileId)) continue;
    seen.add(rec.fileId);
    out.push(rec);
    if (out.length >= opts.maxResults) break;
  }
  return out;
}

/** Fuzzy needs at least a display name, alias, or a basename that is not only dots / tiny noise */
function hasFuzzySignals(m: LocalFileMetadata, basename: string): boolean {
  if (m.displayName?.trim()) return true;
  if (m.aliases?.some((a) => a.trim().length > 1)) return true;
  const stem = basename.replace(/\.[^/.]+$/i, "").trim();
  return stem.length >= 3;
}
