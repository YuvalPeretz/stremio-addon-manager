/**
 * Stremio catalog + meta responses built from the indexed local library.
 */

import type { IndexedFileRecord } from "./types.js";
import type { CinemetaMetadata } from "../types.js";
import { normalizeForMatch } from "./tokens.js";

export interface StremioMetaPreview {
  id: string;
  type: "movie" | "series";
  name: string;
  poster?: string;
  posterShape?: "poster" | "square" | "landscape";
  description?: string;
}

export interface StremioVideo {
  id: string;
  title: string;
  released: string;
  season?: number;
  episode?: number;
  thumbnail?: string;
}

export interface StremioFullMeta {
  id: string;
  type: "movie" | "series";
  name: string;
  poster?: string;
  posterShape?: "poster" | "square" | "landscape";
  background?: string;
  description?: string;
  releaseInfo?: string;
  genres?: string[];
  videos?: StremioVideo[];
  behaviorHints?: { defaultVideoId?: string };
}

/** Parse Stremio catalog extra path segment e.g. `search=foo&skip=10` */
export function parseCatalogExtraArgs(extraArgs: string | undefined): { search?: string; skip: number } {
  if (!extraArgs) return { skip: 0 };
  const out: Record<string, string> = {};
  for (const part of extraArgs.split("&")) {
    if (!part) continue;
    const eq = part.indexOf("=");
    if (eq === -1) out[decodeURIComponent(part)] = "";
    else {
      const k = decodeURIComponent(part.slice(0, eq));
      const v = decodeURIComponent(part.slice(eq + 1).replace(/\+/g, " "));
      out[k] = v;
    }
  }
  const skip = Math.max(0, parseInt(out.skip || "0", 10) || 0);
  return { search: out.search?.trim() || undefined, skip };
}

function pickDisplayName(recs: IndexedFileRecord[]): string {
  const withDn = recs.find((r) => r.effective.displayName?.trim());
  if (withDn) return withDn.effective.displayName!.trim();
  return recs[0]?.basename.replace(/\.[^.]+$/i, "") || "Unknown";
}

function matchesSearch(name: string, recs: IndexedFileRecord[], q: string): boolean {
  const n = normalizeForMatch(name);
  if (n.includes(q)) return true;
  for (const r of recs) {
    if (normalizeForMatch(r.basename).includes(q)) return true;
    for (const a of r.effective.aliases || []) {
      if (normalizeForMatch(a).includes(q)) return true;
    }
  }
  return false;
}

function isMovieLike(r: IndexedFileRecord): boolean {
  const m = r.effective;
  if (m.type === "series") return false;
  if (typeof m.season === "number" || typeof m.episode === "number") return false;
  return true;
}

function isSeriesLike(r: IndexedFileRecord): boolean {
  const m = r.effective;
  if (m.type === "movie") return false;
  if (m.type === "series") return true;
  return typeof m.season === "number" && typeof m.episode === "number";
}

const CATALOG_PAGE = 100;

/**
 * Build catalog meta previews for Stremio Discover / Search.
 */
export function buildLocalCatalogMetas(
  indexed: IndexedFileRecord[],
  stremioType: string,
  catalogId: string,
  extra: { search?: string; skip: number }
): StremioMetaPreview[] {
  if (catalogId !== "local") return [];

  const searchRaw = extra.search?.trim();
  const searchNorm = searchRaw ? normalizeForMatch(searchRaw) : "";
  const skip = extra.skip;

  const withImdb = indexed.filter((r) => /^tt\d+$/i.test(r.effective.imdbId || ""));

  if (stremioType === "movie") {
    const movies = withImdb.filter(isMovieLike);
    const byImdb = new Map<string, IndexedFileRecord[]>();
    for (const r of movies) {
      const id = r.effective.imdbId!.toLowerCase();
      if (!byImdb.has(id)) byImdb.set(id, []);
      byImdb.get(id)!.push(r);
    }
    const metas: StremioMetaPreview[] = [];
    for (const [imdbId, recs] of byImdb) {
      const name = pickDisplayName(recs);
      const year = recs.find((x) => x.effective.year)?.effective.year;
      if (searchNorm && !matchesSearch(name, recs, searchNorm)) continue;
      metas.push({
        id: imdbId,
        type: "movie",
        name: year ? `${name} (${year})` : name,
        posterShape: "poster",
        description: "Local file",
      });
    }
    metas.sort((a, b) => a.name.localeCompare(b.name));
    return metas.slice(skip, skip + CATALOG_PAGE);
  }

  if (stremioType === "series") {
    const series = withImdb.filter(isSeriesLike);
    const byImdb = new Map<string, IndexedFileRecord[]>();
    for (const r of series) {
      const id = r.effective.imdbId!.toLowerCase();
      if (!byImdb.has(id)) byImdb.set(id, []);
      byImdb.get(id)!.push(r);
    }
    const metas: StremioMetaPreview[] = [];
    for (const [imdbId, recs] of byImdb) {
      const name = pickDisplayName(recs);
      const year = recs.find((x) => x.effective.year)?.effective.year;
      if (searchNorm && !matchesSearch(name, recs, searchNorm)) continue;
      metas.push({
        id: imdbId,
        type: "series",
        name: year ? `${name} (${year})` : name,
        posterShape: "poster",
        description: "Local library",
      });
    }
    metas.sort((a, b) => a.name.localeCompare(b.name));
    return metas.slice(skip, skip + CATALOG_PAGE);
  }

  return [];
}

interface CinemetaVideo {
  id?: string;
  name?: string;
  title?: string;
  season?: number;
  episode?: number;
  number?: number;
  released?: string;
}

function isoReleasedFallback(year?: number): string {
  const y = year && year > 1880 ? year : new Date().getFullYear();
  return `${y}-01-01T00:00:00.000Z`;
}

function videosFromCinemetaSeries(meta: CinemetaMetadata): StremioVideo[] {
  const videos = (meta as { videos?: CinemetaVideo[] }).videos;
  if (!videos?.length) return [];
  const out: StremioVideo[] = [];
  for (const v of videos) {
    if (!v.id) continue;
    const title = (v.name || v.title || `Episode ${v.number ?? v.episode ?? ""}`).trim();
    out.push({
      id: v.id,
      title,
      released: v.released || isoReleasedFallback(meta.year as number | undefined),
      season: v.season,
      episode: v.episode ?? v.number,
    });
  }
  return out;
}

/**
 * Full meta for detail page; enriches from Cinemeta when available.
 */
export async function buildLocalMeta(
  indexed: IndexedFileRecord[],
  stremioType: string,
  metaId: string,
  fetchCinemeta: (type: string, id: string) => Promise<CinemetaMetadata | null>
): Promise<StremioFullMeta | null> {
  const baseId = metaId.split(":")[0]!.toLowerCase();
  if (!/^tt\d+$/.test(baseId)) return null;

  const matching = indexed.filter((r) => (r.effective.imdbId || "").toLowerCase() === baseId);
  if (matching.length === 0) return null;

  const cinemeta = await fetchCinemeta(stremioType, baseId);

  if (stremioType === "movie") {
    const movieRecs = matching.filter(isMovieLike);
    if (movieRecs.length === 0) return null;
    const localName = pickDisplayName(movieRecs);
    const year = movieRecs.find((x) => x.effective.year)?.effective.year ?? cinemeta?.year;
    return {
      id: baseId,
      type: "movie",
      name: cinemeta?.name || localName,
      poster: typeof cinemeta?.poster === "string" ? cinemeta.poster : undefined,
      background: typeof cinemeta?.background === "string" ? cinemeta.background : undefined,
      description: (cinemeta?.description as string | undefined) || "Playback from your local library.",
      releaseInfo: year != null ? String(year) : undefined,
      genres: Array.isArray(cinemeta?.genres) ? (cinemeta!.genres as string[]) : undefined,
      posterShape: "poster",
    };
  }

  if (stremioType === "series") {
    const localName = pickDisplayName(matching);
    const year = matching.find((x) => x.effective.year)?.effective.year;

    const withEp = matching.filter(
      (r) => typeof r.effective.season === "number" && typeof r.effective.episode === "number"
    );
    let videos: StremioVideo[] = withEp
      .sort((a, b) => {
        const sa = a.effective.season! - b.effective.season!;
        if (sa !== 0) return sa;
        return a.effective.episode! - b.effective.episode!;
      })
      .map((r) => ({
        id: `${baseId}:${r.effective.season}:${r.effective.episode}`,
        title: r.effective.displayName?.trim() || r.basename.replace(/\.[^.]+$/i, ""),
        released: isoReleasedFallback(r.effective.year ?? year),
        season: r.effective.season,
        episode: r.effective.episode,
      }));

    if (videos.length === 0 && cinemeta) {
      videos = videosFromCinemetaSeries(cinemeta);
    }

    return {
      id: baseId,
      type: "series",
      name: cinemeta?.name || localName,
      poster: typeof cinemeta?.poster === "string" ? cinemeta.poster : undefined,
      background: typeof cinemeta?.background === "string" ? cinemeta.background : undefined,
      description:
        (cinemeta?.description as string | undefined) ||
        (videos.length ? "Episodes from your local library (and guide data when needed)." : "Local series placeholder — set season/episode on files."),
      releaseInfo: year != null ? String(year) : cinemeta?.year != null ? String(cinemeta.year) : undefined,
      genres: Array.isArray(cinemeta?.genres) ? (cinemeta!.genres as string[]) : undefined,
      posterShape: "poster",
      videos: videos.length > 0 ? videos : undefined,
    };
  }

  return null;
}
