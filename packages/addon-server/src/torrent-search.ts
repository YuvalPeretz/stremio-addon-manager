/**
 * Torrent Search — multi-source aggregator
 *
 * Sources queried in parallel:
 *  1. Torrentio + Real-Debrid key  (same as Stremio; returns only RD-cached content
 *                                   with exact fileIdx — fastest, highest quality)
 *  2. Torrentio public              (no RD filter; broader results, fileIdx still included)
 *  3. Knightcrawler                 (independent Torrentio-compatible index; good fallback
 *                                   if Torrentio is unreachable from the server)
 *
 * Key improvements over the single-source approach:
 *  - Never caches empty results (a transient failure won't poison the cache)
 *  - Captures `fileIdx` from every source, enabling targeted RD file selection
 *  - Deduplicates by infoHash (keeping the entry with the best source priority)
 */

import axios from "axios";
import type { TorrentInfo, CinemetaMetadata } from "./types.js";
import type { CacheManager } from "./cache.js";

// ─── Internal type ────────────────────────────────────────────────────────────

interface TorrentioStream {
  name?: string;
  title?: string;
  infoHash?: string;
  /** File index within the torrent — provided by Torrentio when it knows
   *  which file matches the requested episode/movie */
  fileIdx?: number;
  /** Direct URL (present when Torrentio is called with a Real-Debrid key) */
  url?: string;
}

// ─── Metadata ────────────────────────────────────────────────────────────────

export async function getCinemetaMetadata(
  type: string,
  id: string,
  cacheManager: CacheManager
): Promise<CinemetaMetadata | null> {
  const baseId = id.split(":")[0];
  const cacheKey = `meta_${type}_${baseId}`;

  const cached = cacheManager.getMetadata(cacheKey);
  if (cached) return cached as CinemetaMetadata;

  try {
    const url = `https://v3-cinemeta.strem.io/meta/${type}/${baseId}.json`;
    console.log(`Fetching metadata from: ${url}`);
    const response = await axios.get(url);
    const metadata = response.data.meta as CinemetaMetadata;
    cacheManager.setMetadata(cacheKey, metadata);
    console.log(`[CACHE MISS] Fetched and cached metadata for ${id}`);
    return metadata;
  } catch (error) {
    if (axios.isAxiosError(error)) console.error("Cinemeta API Error:", error.message);
    return null;
  }
}

// ─── Torrent search helpers ───────────────────────────────────────────────────

/**
 * Fetch a Torrentio-compatible stream endpoint and return the raw stream list.
 * Returns [] on any error so callers can treat it as "no results".
 */
async function fetchTorrentioEndpoint(
  url: string,
  label: string
): Promise<TorrentioStream[]> {
  try {
    const response = await axios.get(url, {
      timeout: 15000,
      headers: { "User-Agent": "Stremio" },
    });
    const streams: TorrentioStream[] = response.data?.streams ?? [];
    console.log(`[${label}] returned ${streams.length} streams`);
    return streams;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      console.warn(`[${label}] failed: ${error.message}`);
    }
    return [];
  }
}

/** Convert raw Torrentio streams into our TorrentInfo format */
function streamsToTorrentInfo(
  streams: TorrentioStream[],
  source: string
): TorrentInfo[] {
  return streams
    .filter((s) => s.infoHash)
    .map((s) => ({
      title: s.title || s.name || "Unknown",
      infoHash: s.infoHash!.toLowerCase(),
      magnetLink: `magnet:?xt=urn:btih:${s.infoHash}`,
      quality: s.name || "unknown",
      size: "unknown",
      fileIdx: s.fileIdx,
      source,
    }));
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Search for torrents from multiple sources in parallel.
 *
 * @param imdbId     IMDB ID (may include :season:episode suffix for series)
 * @param type       "movie" | "series"
 * @param cacheManager
 * @param rdApiToken Real-Debrid API token — when provided, Torrentio is also
 *                   queried with the RD key so we get RD-pre-filtered results
 *                   with exact fileIdx (mirrors what Stremio does).
 */
export async function searchTorrents(
  imdbId: string,
  type: string,
  cacheManager: CacheManager,
  rdApiToken?: string
): Promise<TorrentInfo[]> {
  const cacheKey = `torrents_v2_${type}_${imdbId}`;

  const cached = cacheManager.getTorrentSearch(cacheKey);
  if (cached) return cached as TorrentInfo[];

  const hasRdToken =
    rdApiToken &&
    rdApiToken.trim().length > 0 &&
    rdApiToken !== "YOUR_REAL_DEBRID_TOKEN_HERE";

  // Build the three source URLs
  const baseConfig = "sort=qualitysize%7Clanguage=hebrew,english";
  const rdConfig = hasRdToken
    ? `realdebrid=${encodeURIComponent(rdApiToken!)}%7C${baseConfig}`
    : null;

  const torrentioBase = "https://torrentio.strem.fun";
  const knightcrawlerBase = "https://knightcrawler.elfhosted.com";
  const streamPath = `/stream/${type}/${imdbId}.json`;

  const fetches: Promise<{ streams: TorrentioStream[]; source: string }>[] = [];

  // Source 1: Torrentio with RD key (highest priority — matches Stremio behaviour)
  if (rdConfig) {
    fetches.push(
      fetchTorrentioEndpoint(
        `${torrentioBase}/${rdConfig}${streamPath}`,
        "Torrentio+RD"
      ).then((streams) => ({ streams, source: "Torrentio+RD" }))
    );
  }

  // Source 2: Torrentio public (broader, no RD filtering)
  fetches.push(
    fetchTorrentioEndpoint(
      `${torrentioBase}/${baseConfig}${streamPath}`,
      "Torrentio"
    ).then((streams) => ({ streams, source: "Torrentio" }))
  );

  // Source 3: Knightcrawler (independent index, resilient fallback)
  fetches.push(
    fetchTorrentioEndpoint(
      `${knightcrawlerBase}${streamPath}`,
      "Knightcrawler"
    ).then((streams) => ({ streams, source: "Knightcrawler" }))
  );

  const results = await Promise.allSettled(fetches);

  // Merge results; RD-sourced entries win on duplicate infoHash
  // (they carry a reliable fileIdx from Torrentio's episode matching)
  const seenHashes = new Map<string, TorrentInfo>();

  for (const result of results) {
    if (result.status !== "fulfilled") continue;
    const { streams, source } = result.value;
    const infos = streamsToTorrentInfo(streams, source);
    for (const info of infos) {
      const existing = seenHashes.get(info.infoHash);
      // Prefer entries with a fileIdx; among those prefer the RD-sourced one
      const betterThanExisting =
        !existing ||
        (info.fileIdx !== undefined && existing.fileIdx === undefined) ||
        (source === "Torrentio+RD" && existing.source !== "Torrentio+RD");
      if (betterThanExisting) seenHashes.set(info.infoHash, info);
    }
  }

  const torrents = Array.from(seenHashes.values());

  const bySource = torrents.reduce<Record<string, number>>((acc, t) => {
    acc[t.source ?? "unknown"] = (acc[t.source ?? "unknown"] ?? 0) + 1;
    return acc;
  }, {});
  console.log(
    `[torrent-search] ${torrents.length} unique torrents for ${imdbId}`,
    bySource
  );

  // Only cache non-empty results — a transient failure must not poison the cache
  if (torrents.length > 0) {
    cacheManager.setTorrentSearch(cacheKey, torrents);
  } else {
    console.warn(
      `[torrent-search] No torrents found for ${imdbId} — skipping cache`
    );
  }

  return torrents;
}
