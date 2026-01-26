/**
 * Torrent Search using Torrentio API
 */

import axios from "axios";
import type { TorrentInfo, CinemetaMetadata } from "./types.js";
import type { CacheManager } from "./cache.js";

/**
 * Get metadata from Cinemeta (with caching)
 */
export async function getCinemetaMetadata(
  type: string,
  id: string,
  cacheManager: CacheManager
): Promise<CinemetaMetadata | null> {
  // For series, strip season:episode from ID (e.g., tt0434665:6:3 -> tt0434665)
  const baseId = id.split(":")[0];
  const cacheKey = `meta_${type}_${baseId}`;

  // Check cache first
  const cached = cacheManager.getMetadata(cacheKey);
  if (cached) {
    return cached as CinemetaMetadata;
  }

  try {
    const url = `https://v3-cinemeta.strem.io/meta/${type}/${baseId}.json`;
    console.log(`Fetching metadata from: ${url}`);
    const response = await axios.get(url);
    const metadata = response.data.meta as CinemetaMetadata;

    // Store in cache
    cacheManager.setMetadata(cacheKey, metadata);
    console.log(`[CACHE MISS] Fetched and cached metadata for ${id}`);

    return metadata;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      console.error("Cinemeta API Error:", error.message);
    }
    return null;
  }
}

/**
 * Search for torrents using Torrentio API (with caching)
 */
export async function searchTorrents(
  imdbId: string,
  type: string,
  cacheManager: CacheManager
): Promise<TorrentInfo[]> {
  const cacheKey = `torrents_${type}_${imdbId}`;

  // Check cache first
  const cached = cacheManager.getTorrentSearch(cacheKey);
  if (cached) {
    return cached as TorrentInfo[];
  }

  try {
    // Use Torrentio's public API to get torrents
    const torrentioUrl = `https://torrentio.strem.fun/stream/${type}/${imdbId}.json`;

    const response = await axios.get(torrentioUrl, {
      timeout: 10000,
      headers: {
        "User-Agent": "Stremio",
      },
    });

    if (response.data && response.data.streams) {
      // Parse Torrentio streams and extract info hashes
      const torrents: TorrentInfo[] = response.data.streams
        .filter((stream: { infoHash?: string }) => stream.infoHash)
        .map((stream: { title?: string; name?: string; infoHash: string }) => ({
          title: stream.title || stream.name,
          infoHash: stream.infoHash,
          magnetLink: `magnet:?xt=urn:btih:${stream.infoHash}`,
          quality: stream.name || "unknown",
          size: "unknown",
        }));

      // Store in cache
      cacheManager.setTorrentSearch(cacheKey, torrents);
      console.log(`[CACHE MISS] Fetched and cached ${torrents.length} torrents for ${imdbId}`);

      return torrents;
    }

    return [];
  } catch (error) {
    if (axios.isAxiosError(error)) {
      console.error("Torrent search error:", error.message);
    }
    return [];
  }
}

