/**
 * Stream Handler
 * Main logic for handling stream requests
 */

import type { Stream, StreamResponse, TorrentInfo } from "./types.js";
import type { RealDebridClient } from "./real-debrid.js";
import type { CacheManager } from "./cache.js";
import type { ServerConfig } from "./config.js";
import { getCinemetaMetadata, searchTorrents } from "./torrent-search.js";
import {
  extractSeasonEpisode,
  matchesEpisode,
  getEpisodeMatchScore,
  findMatchingFile,
  type SeasonEpisode,
  type ScoredTorrent,
} from "./episode-matching.js";
import { sortTorrents, sortStreams, buildStreamName } from "./stream-sorter.js";
import { fetchSubtitles } from "./subtitle-fetcher.js";

/**
 * Extract infoHash from magnet link
 */
function extractInfoHash(magnetLink: string): string | null {
  const match = magnetLink.match(/urn:btih:([a-zA-Z0-9]+)/i);
  return match ? match[1].toLowerCase() : null;
}

/**
 * Process a Real-Debrid stream from a magnet link.
 *
 * @param magnetLink    Magnet link for the torrent
 * @param rdClient      RD API client
 * @param cacheManager
 * @param knownFileIdx  When provided (from Torrentio), skip findMatchingFile and
 *                      use this index directly — faster and more reliable
 * @param seasonEpisode Fallback for episode matching when knownFileIdx is absent
 */
async function processRealDebridStream(
  magnetLink: string,
  rdClient: RealDebridClient,
  cacheManager: CacheManager,
  knownFileIdx?: number,
  seasonEpisode: SeasonEpisode | null = null
): Promise<{ url: string; title: string } | null> {
  const infoHash = extractInfoHash(magnetLink);
  const cacheKey =
    knownFileIdx !== undefined
      ? `stream_${infoHash}_fi${knownFileIdx}`
      : seasonEpisode
        ? `stream_${infoHash}_S${seasonEpisode.season}E${seasonEpisode.episode}`
        : `stream_${infoHash}_0`;

  if (infoHash) {
    const cached = cacheManager.getStream(cacheKey);
    if (cached) return cached as { url: string; title: string };
  }

  try {
    console.log("Adding magnet to Real-Debrid...");
    const addResult = await rdClient.addMagnet(magnetLink);
    const torrentId = addResult.id;

    console.log("Getting torrent info...");
    let torrentInfo = await rdClient.getTorrentInfo(torrentId);

    // Determine which file to select
    let selectedFileId: number;
    let selectedFileIndex: number;

    if (knownFileIdx !== undefined) {
      // Torrentio already identified the correct file — use it directly
      selectedFileIndex = knownFileIdx;
      // RD file IDs are 1-based; map index to ID by looking at the files array
      if (torrentInfo.files && torrentInfo.files.length > knownFileIdx) {
        selectedFileId = (torrentInfo.files[knownFileIdx] as { id?: number }).id ?? knownFileIdx + 1;
      } else {
        selectedFileId = knownFileIdx + 1;
      }
      console.log(`Using Torrentio-provided fileIdx=${knownFileIdx} (RD fileId=${selectedFileId})`);
    } else if (seasonEpisode && torrentInfo.files && torrentInfo.files.length > 0) {
      const matchResult = findMatchingFile(torrentInfo.files, seasonEpisode.season, seasonEpisode.episode);
      selectedFileId = matchResult.fileId;
      selectedFileIndex = matchResult.index;
      console.log(`findMatchingFile → fileId=${selectedFileId} index=${selectedFileIndex} for S${seasonEpisode.season}E${seasonEpisode.episode}`);
    } else {
      selectedFileId = 0;
      selectedFileIndex = 0;
    }

    console.log("Selecting files...");
    if (torrentInfo.files && torrentInfo.files.length > 1) {
      await rdClient.selectFiles(torrentId, selectedFileId.toString());
    } else {
      await rdClient.selectFiles(torrentId);
    }

    torrentInfo = await rdClient.getTorrentInfo(torrentId);
    let attempts = 0;
    const maxAttempts = 10;
    while (
      torrentInfo.status !== "downloaded" &&
      torrentInfo.status !== "waiting_files_selection" &&
      attempts < maxAttempts
    ) {
      const waitTime = attempts < 2 ? 500 : 1000;
      await new Promise((resolve) => setTimeout(resolve, waitTime));
      torrentInfo = await rdClient.getTorrentInfo(torrentId);
      attempts++;
    }

    if (torrentInfo.status !== "downloaded" && torrentInfo.status !== "waiting_files_selection") {
      throw new Error(`Torrent not ready after ${attempts} attempts: ${torrentInfo.status}`);
    }

    if (torrentInfo.links && torrentInfo.links.length > 0) {
      const link = torrentInfo.links[selectedFileIndex] || torrentInfo.links[0];
      console.log("Unrestricting link...");
      const unrestrictedResult = await rdClient.unrestrictLink(link);
      const streamData = {
        url: unrestrictedResult.download,
        title: `RD: ${torrentInfo.filename || "Stream"}`,
      };
      if (infoHash) {
        cacheManager.setStream(cacheKey, streamData);
        console.log(`[CACHE MISS] Cached stream for ${infoHash.substring(0, 8)}...`);
      }
      return streamData;
    }

    throw new Error("No links available");
  } catch (error) {
    console.error("Process RD stream error:", error);
    return null;
  }
}

/**
 * Main stream handler function
 */
export async function handleStreamRequest(
  params: { type: string; id: string },
  rdClient: RealDebridClient,
  cacheManager: CacheManager,
  config: ServerConfig
): Promise<StreamResponse> {
  const { type, id } = params;
  console.log(`Stream request: ${type} ${id}`);

  // Check request-level cache first (this caches the ENTIRE response)
  const requestCacheKey = `request_${type}_${id}`;
  const cachedResponse = cacheManager.getStream(requestCacheKey);
  if (cachedResponse) {
    const cached = cachedResponse as StreamResponse;
    // Reject stale empty responses — a previously-failed lookup shouldn't be
    // served forever.  Non-empty responses are always valid to serve.
    if (cached.streams.length === 0) {
      console.log(`Ignoring cached empty response for ${type}/${id} — will retry`);
    } else {
      console.log(`✓ Returning cached response for ${type}/${id} (${cached.streams.length} streams)`);
      return cached;
    }
  }

  try {
    // Step 1: Extract season/episode if this is a series
    const seasonEpisode = type === "series" ? extractSeasonEpisode(id) : null;
    if (seasonEpisode) {
      console.log(`Looking for Season ${seasonEpisode.season}, Episode ${seasonEpisode.episode}`);
    }

    // Step 2: Fetch subtitles in parallel with metadata (for faster response)
    const subtitlesPromise = fetchSubtitles(type, id, cacheManager);

    // Step 3: Get metadata from Cinemeta
    const metadata = await getCinemetaMetadata(type, id, cacheManager);
    if (!metadata) {
      console.log("No metadata found for:", id);
      // Do NOT cache metadata failures — they may recover
      return { streams: [] };
    }

    console.log(`Found metadata: ${metadata.name} (${metadata.year})`);

    // Step 4: Search for torrents from all sources (Torrentio+RD, Torrentio, Knightcrawler)
    // Pass the RD API token so Torrentio returns RD-pre-filtered results with fileIdx,
    // matching exactly what the user sees in Stremio.
    const torrents = await searchTorrents(id, type, cacheManager, config.rdApiToken);

    if (torrents.length === 0) {
      console.log("No torrents found for:", id);
      // Do NOT cache empty torrent results — the sources may return results next time
      return { streams: [] };
    }

    console.log(`Found ${torrents.length} torrents from Torrentio`);

    // Step 5: Filter and prioritize torrents for series
    // Within each group, sort by quality score so the best resolution/codec
    // is processed first and appears first in the Stremio stream picker.
    let filteredTorrents: TorrentInfo[] = sortTorrents(torrents);
    if (seasonEpisode) {
      const scoredTorrents: ScoredTorrent[] = filteredTorrents.map((torrent) => ({
        ...torrent,
        matchScore: getEpisodeMatchScore(torrent.title, seasonEpisode.season, seasonEpisode.episode),
        matches: matchesEpisode(torrent.title, seasonEpisode.season, seasonEpisode.episode),
      }));

      // Within each bucket, order is already best-quality-first from sortTorrents
      const matchingTorrents = scoredTorrents.filter((t) => t.matches);
      const nonMatchingTorrents = scoredTorrents.filter((t) => !t.matches);

      filteredTorrents = [...matchingTorrents, ...nonMatchingTorrents.slice(0, 3)];

      console.log(
        `Filtered to ${matchingTorrents.length} matching torrents (${nonMatchingTorrents.length} non-matching available as fallback)`
      );

      if (matchingTorrents.length === 0) {
        console.log(
          `⚠️  WARNING: No torrents found that clearly match S${seasonEpisode.season}E${seasonEpisode.episode}. Using best available torrents.`
        );
      }
    }

    // Step 5: Check instant availability for prioritized torrents (faster processing)
    const limitedTorrents = filteredTorrents.slice(0, config.availabilityCheckLimit);
    const infoHashes = limitedTorrents.map((t) => t.infoHash).filter(Boolean) as string[];

    // Preserve scored torrent information (for episode matching display)
    // This map will be used later to check if a torrent matches the episode
    const scoredTorrentMap = new Map<string, ScoredTorrent>();
    if (seasonEpisode) {
      // Populate map from limitedTorrents (the ones we'll actually process)
      limitedTorrents.forEach((torrent) => {
        if ("matches" in torrent && "matchScore" in torrent) {
          scoredTorrentMap.set(torrent.infoHash, torrent as ScoredTorrent);
        }
      });
    }

    let cachedTorrents: (TorrentInfo | ScoredTorrent)[] = [];
    if (infoHashes.length > 0) {
      try {
        console.log(`Checking instant availability for ${infoHashes.length} torrents...`);
        const availability = await rdClient.getCachedAvailability(infoHashes);

        // Prioritize cached torrents
        const cachedHashes = new Set<string>();
        if (availability && typeof availability === "object") {
          Object.keys(availability).forEach((hash) => {
            const hashData = (availability as Record<string, unknown>)[hash];
            if (hashData && typeof hashData === "object" && Object.keys(hashData).length > 0) {
              cachedHashes.add(hash.toLowerCase());
            }
          });
        }

        // Separate cached and non-cached torrents
        const cached = limitedTorrents.filter((t) => cachedHashes.has(t.infoHash.toLowerCase()));
        const nonCached = limitedTorrents.filter((t) => !cachedHashes.has(t.infoHash.toLowerCase()));

        // Prioritize cached torrents first
        cachedTorrents = [...cached, ...nonCached];
        console.log(`Found ${cached.length} cached torrents, ${nonCached.length} non-cached`);
      } catch (error) {
        console.error("Instant availability check failed, using all torrents:", error);
        cachedTorrents = limitedTorrents;
      }
    } else {
      cachedTorrents = limitedTorrents;
    }

    // Step 7: Process torrents in parallel (with concurrency limit) for faster response
    const streams: Stream[] = [];
    const maxConcurrency = config.maxConcurrency; // Process multiple torrents concurrently
    const maxStreams = config.maxStreams; // Stop when we have enough working streams
    const torrentsToProcess = cachedTorrents; // Process all cached torrents up to availabilityCheckLimit

    // Helper function to process a single torrent
    const processTorrent = async (torrent: TorrentInfo | ScoredTorrent): Promise<Stream | null> => {
      if (!torrent.infoHash) return null;

      const magnetLink = torrent.magnetLink || `magnet:?xt=urn:btih:${torrent.infoHash}`;

      try {
        // Check if this torrent matches the episode (from scored torrent map)
        const scoredTorrent = scoredTorrentMap.get(torrent.infoHash);
        const matchInfo =
          seasonEpisode && scoredTorrent && scoredTorrent.matches
            ? ` [MATCHES S${seasonEpisode.season}E${seasonEpisode.episode}]`
            : "";
        
        // Highlight Hebrew audio content
        const hasHebrew = /\bheb\b|hebrew|עברית/i.test(torrent.title);
        const hebrewInfo = hasHebrew ? " [🇮🇱 HEBREW AUDIO]" : "";
        
        const sourceTag = torrent.source ? ` [${torrent.source}]` : "";
        const fileIdxTag = torrent.fileIdx !== undefined ? ` fileIdx=${torrent.fileIdx}` : "";
        console.log(`Processing torrent: ${torrent.title.substring(0, 50)}...${matchInfo}${hebrewInfo}${sourceTag}${fileIdxTag}`);

        // If Torrentio provided a fileIdx, use it directly (faster, more reliable).
        // Otherwise fall back to episode-title matching.
        const fileIdx = torrent.fileIdx;
        const episodeFallback = fileIdx !== undefined ? null : seasonEpisode;
        const streamUrl = await processRealDebridStream(
          magnetLink, rdClient, cacheManager, fileIdx, episodeFallback
        );

        if (streamUrl && streamUrl.url) {
          const { name, title } = buildStreamName(torrent);
          const stream: Stream = {
            name,
            title,
            url: streamUrl.url,
            behaviorHints: {
              bingeGroup: "real-debrid",
              notWebReady: false,
            },
          };
          return stream;
        }
      } catch (error) {
        console.error(`✗ Failed to process ${torrent.infoHash}:`, error);
        return null;
      }
      return null;
    };

    // Process torrents in parallel batches
    let processedCount = 0;
    for (let i = 0; i < torrentsToProcess.length && streams.length < maxStreams; i += maxConcurrency) {
      const batch = torrentsToProcess.slice(i, i + maxConcurrency);
      const results = await Promise.allSettled(batch.map(processTorrent));
      processedCount += batch.length;

      for (const result of results) {
        if (result.status === "fulfilled" && result.value) {
          streams.push(result.value);
          console.log(`✓ Added stream: ${result.value.title.substring(0, 40)}`);

          // Early return if we have enough streams
          if (streams.length >= maxStreams) {
            console.log(`Reached target of ${maxStreams} streams, stopping processing`);
            break;
          }
        }
      }

      // Early exit if we have enough streams
      if (streams.length >= maxStreams) {
        break;
      }
    }

    console.log(`Returning ${streams.length} streams (processed ${processedCount} torrents)`);
    
    // Step 8: Await subtitles and add them to all streams
    const subtitles = await subtitlesPromise;
    if (subtitles.length > 0) {
      console.log(`✓ Adding ${subtitles.length} subtitle languages to ${streams.length} streams`);
      streams.forEach(stream => {
        stream.subtitles = subtitles;
      });
    }
    
    // Final display sort: best quality / most seeds at the top
    sortStreams(streams);

    const response: StreamResponse = { streams };

    // Only cache non-empty responses — empty means something failed transiently
    // and we don't want to lock users out for the full cache TTL.
    if (streams.length > 0) {
      cacheManager.setStream(requestCacheKey, response);
      console.log(`✓ Cached response for ${type}/${id} (${streams.length} streams)`);
    } else {
      console.warn(`No streams resolved for ${type}/${id} — not caching empty result`);
    }

    return response;
  } catch (error) {
    console.error("Stream handler error:", error);
    // Do NOT cache errors — the next request should retry fresh
    return { streams: [] };
  }
}
