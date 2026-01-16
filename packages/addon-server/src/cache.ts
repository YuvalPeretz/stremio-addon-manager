/**
 * Cache Manager
 */

import NodeCache from "node-cache";
import type { CacheStats } from "./types.js";
import type { ServerConfig } from "./config.js";

export class CacheManager {
  private metadataCache: NodeCache;
  private torrentSearchCache: NodeCache;
  private streamCache: NodeCache;
  private stats: CacheStats;

  constructor(config: ServerConfig) {
    this.metadataCache = new NodeCache({ stdTTL: config.cacheTtl.metadata });
    this.torrentSearchCache = new NodeCache({ stdTTL: config.cacheTtl.torrentSearch });
    this.streamCache = new NodeCache({ stdTTL: config.cacheTtl.streams });

    this.stats = {
      torrentSearchHits: 0,
      torrentSearchMisses: 0,
      streamHits: 0,
      streamMisses: 0,
      metadataHits: 0,
      metadataMisses: 0,
    };
  }

  /**
   * Get metadata from cache
   */
  getMetadata(key: string): unknown | undefined {
    const value = this.metadataCache.get(key);
    if (value) {
      this.stats.metadataHits++;
      console.log(`[CACHE HIT] Metadata for ${key}`);
    } else {
      this.stats.metadataMisses++;
    }
    return value;
  }

  /**
   * Set metadata in cache
   */
  setMetadata(key: string, value: unknown): void {
    this.metadataCache.set(key, value);
  }

  /**
   * Get torrent search results from cache
   */
  getTorrentSearch(key: string): unknown | undefined {
    const value = this.torrentSearchCache.get(key);
    if (value) {
      this.stats.torrentSearchHits++;
      console.log(`[CACHE HIT] Torrents for ${key}`);
    } else {
      this.stats.torrentSearchMisses++;
    }
    return value;
  }

  /**
   * Set torrent search results in cache
   */
  setTorrentSearch(key: string, value: unknown): void {
    this.torrentSearchCache.set(key, value);
  }

  /**
   * Get stream from cache
   */
  getStream(key: string): unknown | undefined {
    const value = this.streamCache.get(key);
    if (value) {
      this.stats.streamHits++;
      console.log(`[CACHE HIT] Stream for ${key}`);
    } else {
      this.stats.streamMisses++;
    }
    return value;
  }

  /**
   * Set stream in cache
   */
  setStream(key: string, value: unknown): void {
    this.streamCache.set(key, value);
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    return { ...this.stats };
  }

  /**
   * Get cache sizes
   */
  getSizes(): { metadata: number; torrentSearch: number; streams: number } {
    return {
      metadata: this.metadataCache.keys().length,
      torrentSearch: this.torrentSearchCache.keys().length,
      streams: this.streamCache.keys().length,
    };
  }

  /**
   * Log cache statistics
   */
  logStats(): void {
    const totalMetadataRequests = this.stats.metadataHits + this.stats.metadataMisses;
    const totalTorrentSearchRequests = this.stats.torrentSearchHits + this.stats.torrentSearchMisses;
    const totalStreamRequests = this.stats.streamHits + this.stats.streamMisses;

    const metadataHitRate =
      totalMetadataRequests > 0 ? ((this.stats.metadataHits / totalMetadataRequests) * 100).toFixed(1) : "0.0";
    const torrentSearchHitRate =
      totalTorrentSearchRequests > 0
        ? ((this.stats.torrentSearchHits / totalTorrentSearchRequests) * 100).toFixed(1)
        : "0.0";
    const streamHitRate =
      totalStreamRequests > 0 ? ((this.stats.streamHits / totalStreamRequests) * 100).toFixed(1) : "0.0";

    const sizes = this.getSizes();

    console.log("\n=== CACHE STATISTICS ===");
    console.log(
      `Metadata Cache: ${this.stats.metadataHits} hits, ${this.stats.metadataMisses} misses (${metadataHitRate}% hit rate)`
    );
    console.log(
      `Torrent Search Cache: ${this.stats.torrentSearchHits} hits, ${this.stats.torrentSearchMisses} misses (${torrentSearchHitRate}% hit rate)`
    );
    console.log(
      `Stream Cache: ${this.stats.streamHits} hits, ${this.stats.streamMisses} misses (${streamHitRate}% hit rate)`
    );
    console.log(`Cache Sizes: ${sizes.metadata} metadata, ${sizes.torrentSearch} searches, ${sizes.streams} streams`);
    console.log("========================\n");
  }
}
