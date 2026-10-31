/**
 * Movie title matching for torrent discovery results.
 *
 * Torrentio is IMDB-keyed, but wrong releases still appear under the right id.
 * Quality ranking alone then promotes a high-res mismatch (e.g. "The Age of Hubble"
 * above "The Age of Adaline"). Require the movie's significant name tokens in the
 * torrent title before we offer the stream.
 */

import { normalizeForMatch, tokenizeNormalized } from "./local-library/tokens.js";

/** Articles / prepositions that appear in many unrelated titles. */
const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "at",
  "by",
  "for",
  "from",
  "in",
  "into",
  "of",
  "on",
  "or",
  "the",
  "to",
  "vs",
  "with",
]);

/**
 * Significant words from a Cinemeta movie/show name (stopwords stripped).
 * Tokens shorter than 2 chars are already dropped by tokenizeNormalized.
 */
export function significantTitleTokens(name: string | null | undefined): string[] {
  if (!name?.trim()) return [];
  const tokens = tokenizeNormalized(normalizeForMatch(name));
  return [...tokens].filter((t) => !STOPWORDS.has(t));
}

function extractYears(text: string): number[] {
  const years: number[] = [];
  for (const m of text.matchAll(/\b((?:19|20)\d{2})\b/g)) {
    years.push(parseInt(m[1], 10));
  }
  return years;
}

function parseYear(year: number | string | null | undefined): number | null {
  if (year == null) return null;
  const n = typeof year === "number" ? year : parseInt(String(year), 10);
  return Number.isFinite(n) && n >= 1900 && n <= 2100 ? n : null;
}

/**
 * True when the torrent title looks like a release of `movieName`.
 *
 * Rules:
 * - Empty movie name → accept (cannot filter).
 * - Every significant token must appear when there are few of them, or enough
 *   coverage when the longest distinctive token (≥5 chars) is present.
 * - If the movie year is known and the torrent names other year(s), at least
 *   one of those years must be within ±1 of the movie year.
 */
export function torrentTitleMatchesMovie(
  torrentTitle: string | null | undefined,
  movieName: string | null | undefined,
  year?: number | string | null
): boolean {
  if (!movieName?.trim()) return true;
  if (!torrentTitle?.trim()) return false;

  const movieTokens = significantTitleTokens(movieName);
  if (movieTokens.length === 0) return true;

  const torrentNorm = normalizeForMatch(torrentTitle);
  const torrentTokens = tokenizeNormalized(torrentNorm);

  const hits = movieTokens.filter((t) => torrentTokens.has(t));
  const hitRatio = hits.length / movieTokens.length;

  const byLen = [...movieTokens].sort((a, b) => b.length - a.length);
  const longest = byLen[0]!;
  const hasLongest = torrentTokens.has(longest);

  let nameOk: boolean;
  if (longest.length >= 5 && hasLongest) {
    // Distinctive word present (Adaline). Allow dropping a short shared word
    // like "Age"; still rejects Hubble which never has Adaline.
    nameOk = movieTokens.length <= 2 ? hitRatio >= 0.5 : hitRatio >= 0.6;
  } else if (movieTokens.length <= 2) {
    nameOk = hits.length === movieTokens.length;
  } else {
    nameOk = hitRatio >= 0.8;
  }

  if (!nameOk) return false;

  const expectedYear = parseYear(year ?? null);
  if (expectedYear == null) return true;

  const torrentYears = extractYears(torrentTitle);
  if (torrentYears.length === 0) return true;

  return torrentYears.some((y) => Math.abs(y - expectedYear) <= 1);
}
