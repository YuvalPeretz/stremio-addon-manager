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
  /** Source that produced this result, for logging */
  source?: string;
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
  subtitles?: Subtitle[];
  behaviorHints?: {
    bingeGroup?: string;
    notWebReady?: boolean;
  };
}

export interface StreamResponse {
  streams: Stream[];
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
