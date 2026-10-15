/**
 * Invalidate all addon caches tied to a Stremio stream request so
 * the pipeline can re-run (metadata, torrent list, per-hash RD link cache, subtitles, response).
 */

import type { CacheManager } from "../cache.js";

/** Public stream response cache (RD portion only) — must match stream-handler. */
export function buildRequestStreamListKey(type: string, stremioId: string): string {
  return `request_${type}_${stremioId}`;
}

export function buildMetaKey(type: string, stremioId: string): string {
  const baseId = stremioId.split(":")[0] ?? stremioId;
  return `meta_${type}_${baseId}`;
}

export function buildTorrentSearchKey(type: string, stremioId: string): string {
  return `torrents_v3_${type}_${stremioId}`;
}

export function buildSubtitlesKey(stremioId: string): string {
  return `subtitles_${stremioId}`;
}

export interface InvalidateStreamCachesResult {
  requestKey: string;
  keysDeleted: {
    request: number;
    meta: number;
    torrents: number;
    subtitles: number;
    perHashStreamKeys: number;
  };
}

/**
 * @param infoHashes  Lowercase/uppercase; per-torrent keys in stream cache are cleared by info hash prefix
 */
export function invalidateForStreamRequery(
  cacheManager: CacheManager,
  type: string,
  stremioId: string,
  infoHashes?: string[] | null
): InvalidateStreamCachesResult {
  const rKey = buildRequestStreamListKey(type, stremioId);
  let perHash = 0;
  const hashes = (infoHashes ?? []).filter((h) => h && h.length > 0);
  for (const h of hashes) {
    perHash += cacheManager.deleteStreamCacheKeysByInfoHashPrefix(h);
  }
  return {
    requestKey: rKey,
    keysDeleted: {
      request: cacheManager.delStream(rKey),
      meta: cacheManager.delMetadata(buildMetaKey(type, stremioId)),
      torrents: cacheManager.delTorrentSearch(buildTorrentSearchKey(type, stremioId)),
      subtitles: cacheManager.delMetadata(buildSubtitlesKey(stremioId)),
      perHashStreamKeys: perHash,
    },
  };
}

/** For management detail: show which string keys are targeted. */
export function listRelatedStreamCacheKeyNames(
  type: string,
  stremioId: string,
  infoHashes?: string[] | null
): string[] {
  const keys: string[] = [
    buildRequestStreamListKey(type, stremioId),
    buildMetaKey(type, stremioId),
    buildTorrentSearchKey(type, stremioId),
    buildSubtitlesKey(stremioId),
  ];
  for (const h of infoHashes ?? []) {
    if (h) keys.push(`stream_${h.toLowerCase()}_*`);
  }
  return keys;
}
