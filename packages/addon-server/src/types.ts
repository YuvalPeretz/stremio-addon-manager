/**
 * TypeScript types and interfaces for the addon server
 */

export interface TorrentInfo {
  title: string;
  infoHash: string;
  magnetLink: string;
  quality: string;
  size: string;
  /**
   * 0-based file index within the torrent, provided by Torrentio.
   * When present we can skip the expensive findMatchingFile step in
   * Real-Debrid processing and select the file directly.
   */
  fileIdx?: number;
  /**
   * Discovery source label, e.g. Torrentio/Q (quality-sorted fetch) or Torrentio/S (seeder-sorted).
   * Used for Stremio list ordering and stream name prefixes.
   */
  source?: string;
  /** From RD instantAvailability; higher = stronger cache signal on RD (sorting only). */
  rdCacheScore?: number;
}

export interface Subtitle {
  id: string;
  url: string;
  lang: string;
}

export interface Stream {
  name: string;
  title: string;
  url: string;
  /** Set for RD streams; stripped before JSON to Stremio (used for request log + cache invalidation). */
  infoHash?: string;
  /** Present when resolved from a Torrentio discovery tier — used to sort Q before S in the picker */
  discoveryTier?: "local" | "quality" | "seeders";
  /** Stronger RD instantAvailability payload sorts higher among RD streams. */
  rdCacheScore?: number;
  subtitles?: Subtitle[];
  behaviorHints?: {
    bingeGroup?: string;
    notWebReady?: boolean;
  };
}

export interface StreamResponse {
  streams: Stream[];
  /**
   * Cinemeta catalog title (show/movie). For server request logging and management search only;
   * never sent to Stremio (stripped in JSON helpers that only pass `streams`).
   */
  logContext?: { showName: string | null };
}

export interface CinemetaMetadata {
  name: string;
  year?: number;
  type: string;
  id: string;
  [key: string]: unknown;
}

export interface CacheStats {
  torrentSearchHits: number;
  torrentSearchMisses: number;
  streamHits: number;
  streamMisses: number;
  metadataHits: number;
  metadataMisses: number;
}

export interface StatsResponse {
  addonStatus: string;
  rdConnected: boolean;
  cacheStats: CacheStats;
  cacheSizes: {
    metadata: number;
    torrentSearch: number;
    streams: number;
  };
  memoryUsage: string;
  version: string;
  uptime: number;
}

export interface RealDebridAddMagnetResponse {
  id: string;
  uri: string;
}

export interface RealDebridTorrentInfo {
  id: string;
  filename: string;
  status: string;
  links: string[];
  files?: RealDebridFile[];
  [key: string]: unknown;
}

export interface RealDebridFile {
  id?: number;
  path?: string;
  filename?: string;
  [key: string]: unknown;
}

export interface RealDebridUnrestrictResponse {
  download: string;
  [key: string]: unknown;
}

export interface PendingDownload {
  torrentId: string;
  infoHash: string;
  fileIdx?: number;
  seasonEpisode?: { season: number; episode: number } | null;
  addedAt: number;
}

export type ProcessRDResult =
  | { kind: "stream"; url: string; title: string }
  | { kind: "pending"; torrentId: string }
  | { kind: "dmca" }
  | { kind: "null" };
