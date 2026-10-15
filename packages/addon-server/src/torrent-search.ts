/**
 * Torrent Search — multi-source aggregator
 *
 * Sources queried in parallel (all public — no RD token passed to any third party):
 *  1. Torrentio/Q — sort=qualitysize (language=hebrew,english) — listed first after merge
 *  2. Torrentio/S — sort=seeders     — fills in popular hashes not seen in (1)
 *
 * IMPORTANT: The RD API token is NEVER sent to Torrentio or any other discovery source.
 * Sending the token to third-party servers causes Real-Debrid to detect multiple public IPs
 * (the Pi's IP + the third-party server's IP) and suspend the account.
 * All Real-Debrid API calls are made directly from this server (the Pi) only.
 * Filtering to RD-cached-only is handled by the caller's getCachedAvailability check.
 *
 * Key behaviours:
 *  - Episode IDs (e.g. tt0409591:2:42) have their colons URL-encoded (%3A) — Torrentio's
 *    backend nodes are inconsistent: unencoded colons cause 502 on some nodes.
 *  - Transient 502/503/504 errors are retried with exponential back-off (up to 3 retries).
 *  - Never caches empty results — a transient failure must not poison the cache.
 *  - Captures `fileIdx` from every source, enabling targeted RD file selection.
 *  - Deduplicates by infoHash (keeping the entry with a fileIdx when available).
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
 * Retries transient HTTP errors (502/503/504/522) and request timeouts.
 *
 * Torrentio regularly needs 15–25s under load; a 15s cut-off returns empty streams
 * even when the origin would have succeeded a few seconds later.
 *
 * @param timeout Request timeout in milliseconds. Use 0 for no timeout.
 * @param maxRetries Maximum number of retries for transient HTTP failures (default: 3).
 *                   Timeouts only retry once (each attempt is expensive).
 */
async function fetchTorrentioEndpoint(
  url: string,
  label: string,
  timeout: number = 35000,
  maxRetries: number = 3
): Promise<TorrentioStream[]> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await axios.get(url, {
        // timeout: 0 means no timeout in axios
        timeout: timeout > 0 ? timeout : 0,
        headers: { "User-Agent": "Stremio" },
      });
      const streams: TorrentioStream[] = response.data?.streams ?? [];
      if (attempt > 0) {
        console.log(`[${label}] succeeded on retry ${attempt}/${maxRetries}`);
      }
      console.log(`[${label}] returned ${streams.length} streams`);
      return streams;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const statusCode = error.response?.status;
        const isTimeout =
          error.code === "ECONNABORTED" ||
          error.code === "ETIMEDOUT" ||
          /timeout/i.test(error.message);
        // Cloudflare 522 = origin timed out behind CF — common when Torrentio is overloaded.
        const isRetryableHttp =
          statusCode === 502 || statusCode === 503 || statusCode === 504 || statusCode === 522;
        // Timeouts only get one retry — each attempt burns the full timeout budget.
        const retriesAllowed = isTimeout ? Math.min(1, maxRetries) : maxRetries;
        const isRetryable = isRetryableHttp || isTimeout;

        if (isRetryable && attempt < retriesAllowed) {
          const delayMs =
            timeout === 0
              ? Math.min(2000 * Math.pow(2, attempt), 8000)
              : Math.min(1000 * Math.pow(2, attempt), 4000);

          const reason =
            statusCode !== undefined && statusCode !== null
              ? String(statusCode)
              : isTimeout
                ? "timeout"
                : error.code ?? "error";
          console.warn(
            `[${label}] failed with ${reason} (attempt ${attempt + 1}/${retriesAllowed + 1}), retrying in ${delayMs}ms...`
          );
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          continue;
        }

        const statusMsg = statusCode !== undefined && statusCode !== null ? ` (${statusCode})` : "";
        console.warn(`[${label}] failed: ${error.message}${statusMsg}`);
        return [];
      }

      console.warn(`[${label}] failed: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  }

  return [];
}

/** Convert raw Torrentio streams into our TorrentInfo format */
function streamsToTorrentInfo(streams: TorrentioStream[], source: string): TorrentInfo[] {
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

/**
 * Merge quality-sorted and seeder-sorted Torrentio results: Q order first, then S-only hashes.
 */
function mergeTorrentioResults(
  qualityStreams: TorrentioStream[],
  seederStreams: TorrentioStream[]
): TorrentInfo[] {
  const SOURCE_Q = "Torrentio/Q";
  const SOURCE_S = "Torrentio/S";
  const qualityInfos = streamsToTorrentInfo(qualityStreams, SOURCE_Q);
  const seederInfos = streamsToTorrentInfo(seederStreams, SOURCE_S);

  const byHash = new Map<string, TorrentInfo>();
  for (const info of qualityInfos) {
    byHash.set(info.infoHash, info);
  }
  for (const info of seederInfos) {
    const existing = byHash.get(info.infoHash);
    if (!existing) {
      byHash.set(info.infoHash, info);
    } else if (info.fileIdx !== undefined && existing.fileIdx === undefined) {
      byHash.set(info.infoHash, { ...existing, fileIdx: info.fileIdx });
    }
  }

  const torrents: TorrentInfo[] = [];
  const seen = new Set<string>();
  for (const info of qualityInfos) {
    const merged = byHash.get(info.infoHash);
    if (merged && !seen.has(merged.infoHash)) {
      torrents.push(merged);
      seen.add(merged.infoHash);
    }
  }
  for (const info of seederInfos) {
    const merged = byHash.get(info.infoHash);
    if (merged && !seen.has(merged.infoHash)) {
      torrents.push(merged);
      seen.add(merged.infoHash);
    }
  }
  return torrents;
}

async function queryTorrentioPair(
  torrentioBase: string,
  streamPath: string,
  qualityConfig: string,
  seedersConfig: string,
  labelSuffix: string,
  timeout: number,
  maxRetries: number
): Promise<TorrentInfo[]> {
  const [qualityStreams, seederStreams] = await Promise.all([
    fetchTorrentioEndpoint(
      `${torrentioBase}/${qualityConfig}${streamPath}`,
      `Torrentio/quality${labelSuffix}`,
      timeout,
      maxRetries
    ),
    fetchTorrentioEndpoint(
      `${torrentioBase}/${seedersConfig}${streamPath}`,
      `Torrentio/seeders${labelSuffix}`,
      timeout,
      maxRetries
    ),
  ]);
  return mergeTorrentioResults(qualityStreams, seederStreams);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Search for torrents from multiple sources in parallel.
 *
 * NOTE: The RD API token is intentionally NOT accepted here. Passing the token to any
 * third-party service (e.g. Torrentio) causes RD to detect multiple public IPs and
 * suspend the account. Filtering to RD-cached torrents is the caller's responsibility
 * via its own getCachedAvailability check, which runs from the Pi's IP only.
 *
 * @param imdbId     IMDB ID (may include :season:episode suffix for series)
 * @param type       "movie" | "series"
 * @param cacheManager
 * @param timeout    Request timeout in milliseconds. Use 0 for no timeout (default: 35000).
 *                   Torrentio often needs ~20s when busy; 15s caused empty results on the Pi.
 */
export async function searchTorrents(
  imdbId: string,
  type: string,
  cacheManager: CacheManager,
  timeout: number = 35000
): Promise<TorrentInfo[]> {
  // v4: language-filter primary + no-language fallback (Torrentio often 522s with language= on some titles)
  const cacheKey = `torrents_v4_${type}_${imdbId}`;

  const cached = cacheManager.getTorrentSearch(cacheKey);
  if (cached) return cached as TorrentInfo[];

  // Build the source URLs.
  // IMPORTANT: The episode ID (e.g. tt0409591:2:42) MUST have its colons URL-encoded
  // (%3A) in the path.  Torrentio's backend servers are inconsistent — unencoded colons
  // cause 502 errors on some nodes while encoded form works reliably on all nodes.
  const encodedId = imdbId.replace(/:/g, "%3A");
  const torrentioBase = "https://torrentio.strem.fun";
  const streamPath = `/stream/${type}/${encodedId}.json`;

  // Prefer hebrew+english when Torrentio can serve it. Some titles (esp. new movies) get
  // Cloudflare 522 with the language filter but succeed immediately without it — see fallback.
  let torrents = await queryTorrentioPair(
    torrentioBase,
    streamPath,
    "sort=qualitysize%7Clanguage=hebrew,english",
    "sort=seeders%7Clanguage=hebrew,english",
    "",
    timeout,
    1 // one retry only — if language filter 522s, fall back instead of burning ~80s
  );

  if (torrents.length === 0) {
    console.warn(
      `[torrent-search] Language-filtered Torrentio empty for ${imdbId} — retrying without language filter`
    );
    torrents = await queryTorrentioPair(
      torrentioBase,
      streamPath,
      "sort=qualitysize",
      "sort=seeders",
      "/nolang",
      timeout,
      2
    );
  }

  if (torrents.length === 0) {
    console.warn(`[torrent-search] All Torrentio sources returned 0 results for ${imdbId}`);
  }

  const bySource = torrents.reduce<Record<string, number>>((acc, t) => {
    acc[t.source ?? "unknown"] = (acc[t.source ?? "unknown"] ?? 0) + 1;
    return acc;
  }, {});
  console.log(`[torrent-search] ${torrents.length} unique torrents for ${imdbId}`, bySource);

  // Only cache non-empty results — a transient failure must not poison the cache
  if (torrents.length > 0) {
    cacheManager.setTorrentSearch(cacheKey, torrents);
  } else {
    console.warn(`[torrent-search] No torrents found for ${imdbId} — skipping cache`);
  }

  return torrents;
}
