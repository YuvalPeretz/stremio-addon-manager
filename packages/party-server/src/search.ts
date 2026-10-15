/**
 * Content Search & Stream Resolution
 * Uses Cinemeta for search and the addon server for stream resolution.
 */

import axios from "axios";
import NodeCache from "node-cache";
import { normalizeAddonUrl } from "./auth.js";
import type {
  SearchResult,
  SeasonInfo,
  EpisodeInfo,
  ResolveStreamResponse,
  Subtitle,
} from "./types.js";

const searchCache = new NodeCache({ stdTTL: 3600 }); // 1 hour
const metaCache = new NodeCache({ stdTTL: 86400 }); // 24 hours

const CINEMETA_BASE = "https://v3-cinemeta.strem.io";

// ─── Cinemeta Search ─────────────────────────────────────────

interface CinemetaMeta {
  id?: string;
  imdb_id?: string;
  type?: string;
  name?: string;
  year?: string;
  poster?: string;
  description?: string;
}

/**
 * Search for movies and/or series using Cinemeta
 */
export async function searchContent(
  query: string,
  type?: "movie" | "series"
): Promise<SearchResult[]> {
  const cacheKey = `search_${type || "all"}_${query}`;
  const cached = searchCache.get<SearchResult[]>(cacheKey);
  if (cached) return cached;

  const types = type ? [type] : ["movie", "series"] as const;
  const results: SearchResult[] = [];

  const fetches = types.map(async (t) => {
    try {
      const url = `${CINEMETA_BASE}/catalog/${t}/top/search=${encodeURIComponent(query)}.json`;
      const response = await axios.get(url, { timeout: 8000 });
      const metas: CinemetaMeta[] = response.data?.metas ?? [];

      for (const meta of metas.slice(0, 20)) {
        if (!meta.id && !meta.imdb_id) continue;
        results.push({
          id: (meta.imdb_id || meta.id) as string,
          type: t,
          name: meta.name ?? "Unknown",
          year: parseInt(meta.year ?? "0", 10),
          poster: meta.poster ?? "",
          description: meta.description ?? "",
        });
      }
    } catch (error) {
      console.error(`Cinemeta search error (${t}):`, error instanceof Error ? error.message : error);
    }
  });

  await Promise.all(fetches);

  searchCache.set(cacheKey, results);
  console.log(`✓ Search "${query}" returned ${results.length} results`);
  return results;
}

// ─── Series Episode Listing ──────────────────────────────────

interface CinemetaVideo {
  id?: string;
  season?: number;
  episode?: number;
  title?: string;
  name?: string;
}

/**
 * Get all seasons and episodes for a series
 */
export async function getSeriesEpisodes(imdbId: string): Promise<SeasonInfo[]> {
  const cacheKey = `episodes_${imdbId}`;
  const cached = metaCache.get<SeasonInfo[]>(cacheKey);
  if (cached) return cached;

  try {
    const url = `${CINEMETA_BASE}/meta/series/${imdbId}.json`;
    const response = await axios.get(url, { timeout: 8000 });
    const videos: CinemetaVideo[] = response.data?.meta?.videos ?? [];

    const seasonMap = new Map<number, EpisodeInfo[]>();

    for (const video of videos) {
      const season = video.season;
      const episode = video.episode;
      if (season === undefined || episode === undefined) continue;
      if (season <= 0) continue; // skip specials (season 0)

      if (!seasonMap.has(season)) {
        seasonMap.set(season, []);
      }

      seasonMap.get(season)!.push({
        number: episode,
        title: video.title || video.name || `Episode ${episode}`,
        id: video.id || `${imdbId}:${season}:${episode}`,
      });
    }

    const seasons: SeasonInfo[] = [];
    for (const [num, episodes] of seasonMap.entries()) {
      episodes.sort((a, b) => a.number - b.number);
      seasons.push({ number: num, episodes });
    }
    seasons.sort((a, b) => a.number - b.number);

    metaCache.set(cacheKey, seasons);
    console.log(`✓ Found ${seasons.length} seasons for ${imdbId}`);
    return seasons;
  } catch (error) {
    console.error(`Episode listing error for ${imdbId}:`, error instanceof Error ? error.message : error);
    return [];
  }
}

// ─── Stream Resolution ───────────────────────────────────────

interface AddonStream {
  url?: string;
  name?: string;
  title?: string;
  subtitles?: Subtitle[];
}

/**
 * Try fetching streams from a single URL. Returns the streams array or null on failure.
 */
async function tryFetchStreams(streamUrl: string): Promise<AddonStream[] | null> {
  try {
    const response = await axios.get<{ streams?: AddonStream[] }>(streamUrl, { timeout: 60000 });
    const streams = response.data?.streams ?? [];
    return streams.length > 0 ? streams : null;
  } catch {
    return null;
  }
}

/**
 * Fetch ALL available streams for content — returns the raw list so the host
 * can pick the desired quality/source. Falls back to localhost for hairpin NAT.
 */
export async function getAvailableStreams(
  addonUrl: string,
  password: string,
  type: "movie" | "series",
  imdbId: string,
  season?: number,
  episode?: number,
  localAddonPort?: number,
): Promise<Array<{ url: string; name?: string; title?: string }>> {
  const baseUrl = normalizeAddonUrl(addonUrl);
  const stremioId =
    type === "series" && season !== undefined && episode !== undefined
      ? `${imdbId}:${season}:${episode}`
      : imdbId;

  const buildUrl = (base: string) =>
    password
      ? `${base}/${password}/stream/${type}/${stremioId}.json`
      : `${base}/stream/${type}/${stremioId}.json`;

  let streams = await tryFetchStreams(buildUrl(baseUrl));
  if (!streams && localAddonPort) {
    streams = await tryFetchStreams(buildUrl(`http://localhost:${localAddonPort}`));
  }

  if (!streams) return [];

  return streams
    .filter((s) => !!s.url)
    .map((s) => ({ url: s.url!, name: s.name, title: s.title }));
}

/**
 * Resolve a stream URL from the addon server via Real-Debrid.
 * Falls back to localhost when the public addon URL is unreachable from within
 * the server (hairpin NAT — server cannot route to its own public IP from LAN).
 */
export async function resolveStream(
  addonUrl: string,
  password: string,
  type: "movie" | "series",
  imdbId: string,
  season?: number,
  episode?: number,
  localAddonPort?: number,
): Promise<ResolveStreamResponse | null> {
  const baseUrl = normalizeAddonUrl(addonUrl);
  const stremioId =
    type === "series" && season !== undefined && episode !== undefined
      ? `${imdbId}:${season}:${episode}`
      : imdbId;

  const buildUrl = (base: string) =>
    password
      ? `${base}/${password}/stream/${type}/${stremioId}.json`
      : `${base}/stream/${type}/${stremioId}.json`;

  const publicUrl = buildUrl(baseUrl);
  console.log(`Resolving stream: ${publicUrl}`);

  // Try public URL first, then local fallback (handles hairpin NAT)
  let streams = await tryFetchStreams(publicUrl);
  let usedLocalhost = false;
  if (!streams && localAddonPort) {
    const localUrl = buildUrl(`http://localhost:${localAddonPort}`);
    console.log(`Public URL failed, retrying via localhost: ${localUrl}`);
    streams = await tryFetchStreams(localUrl);
    usedLocalhost = streams !== null;
  }

  if (!streams) {
    console.log(`No streams found for ${stremioId}`);
    return null;
  }

  const bestStream = streams.find((s) => s.url);
  if (!bestStream?.url) {
    console.log(`No streams with valid URLs for ${stremioId}`);
    return null;
  }

  const subtitles = bestStream.subtitles ?? [];
  console.log(`✓ Resolved stream for ${stremioId} via ${usedLocalhost ? 'localhost' : 'public URL'} (${subtitles.length} subtitles)`);

  return {
    streamUrl: bestStream.url,
    subtitles,
    metadata: {
      title: bestStream.title ?? bestStream.name ?? "Unknown",
      year: 0,
      poster: "",
    },
  };
}
