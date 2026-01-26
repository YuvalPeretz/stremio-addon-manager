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

/**
 * Extract infoHash from magnet link
 */
function extractInfoHash(magnetLink: string): string | null {
  const match = magnetLink.match(/urn:btih:([a-zA-Z0-9]+)/i);
  return match ? match[1].toLowerCase() : null;
}

/**
 * Process Real-Debrid stream (with caching)
 */
async function processRealDebridStream(
  magnetLink: string,
  rdClient: RealDebridClient,
  cacheManager: CacheManager,
  fileIndex: number = 0,
  seasonEpisode: SeasonEpisode | null = null
): Promise<{ url: string; title: string } | null> {
  // Extract infoHash for caching
  const infoHash = extractInfoHash(magnetLink);
  // Include season/episode in cache key for series
  const cacheKey = seasonEpisode
    ? `stream_${infoHash}_S${seasonEpisode.season}E${seasonEpisode.episode}`
    : `stream_${infoHash}_${fileIndex}`;

  // Check cache first
  if (infoHash) {
    const cached = cacheManager.getStream(cacheKey);
    if (cached) {
      return cached as { url: string; title: string };
    }
  }

  try {
    // Step 1: Add magnet to Real-Debrid
    console.log("Adding magnet to Real-Debrid...");
    const addResult = await rdClient.addMagnet(magnetLink);
    const torrentId = addResult.id;

    // Step 2: Get torrent info first to see available files
    console.log("Getting torrent info...");
    let torrentInfo = await rdClient.getTorrentInfo(torrentId);

    // Step 3: Find the best matching file if we have episode info
    let selectedFileId = fileIndex;
    let selectedFileIndex = fileIndex;
    if (seasonEpisode && torrentInfo.files && torrentInfo.files.length > 0) {
      const matchResult = findMatchingFile(torrentInfo.files, seasonEpisode.season, seasonEpisode.episode);
      selectedFileId = matchResult.fileId;
      selectedFileIndex = matchResult.index;
      console.log(
        `Selected file ID ${selectedFileId} (index ${selectedFileIndex}) for S${seasonEpisode.season}E${seasonEpisode.episode}`
      );
    }

    // Step 4: Select the specific file (or all if single file torrent)
    console.log("Selecting files...");
    if (torrentInfo.files && torrentInfo.files.length > 1) {
      // Select only the matching file using file ID
      await rdClient.selectFiles(torrentId, selectedFileId.toString());
    } else {
      // Single file torrent or no file info, select all
      await rdClient.selectFiles(torrentId);
    }

    // Step 5: Poll for torrent readiness (with adaptive wait time)
    // Check if torrent is already ready (cached torrents are often instant)
    torrentInfo = await rdClient.getTorrentInfo(torrentId);
    let attempts = 0;
    const maxAttempts = 10;
    const initialWait = 500; // Start with 500ms instead of 2000ms

    while (
      torrentInfo.status !== "downloaded" &&
      torrentInfo.status !== "waiting_files_selection" &&
      attempts < maxAttempts
    ) {
      // Adaptive wait: shorter for first attempts, longer if still processing
      const waitTime = attempts < 2 ? initialWait : 1000;
      await new Promise((resolve) => setTimeout(resolve, waitTime));
      torrentInfo = await rdClient.getTorrentInfo(torrentId);
      attempts++;
    }

    if (torrentInfo.status !== "downloaded" && torrentInfo.status !== "waiting_files_selection") {
      throw new Error(`Torrent not ready after ${attempts} attempts: ${torrentInfo.status}`);
    }

    // Step 6: Get the file link
    if (torrentInfo.links && torrentInfo.links.length > 0) {
      // Use the selected file index, or first file if index is out of range
      const link = torrentInfo.links[selectedFileIndex] || torrentInfo.links[0];

      // Step 7: Unrestrict the link
      console.log("Unrestricting link...");
      const unrestrictedResult = await rdClient.unrestrictLink(link);

      const streamData = {
        url: unrestrictedResult.download,
        title: `RD: ${torrentInfo.filename || "Stream"}`,
      };

      // Store in cache
      if (infoHash) {
        cacheManager.setStream(cacheKey, streamData);
        console.log(`[CACHE MISS] Processed and cached stream for ${infoHash.substring(0, 8)}...`);
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

  try {
    // Step 1: Extract season/episode if this is a series
    const seasonEpisode = type === "series" ? extractSeasonEpisode(id) : null;
    if (seasonEpisode) {
      console.log(`Looking for Season ${seasonEpisode.season}, Episode ${seasonEpisode.episode}`);
    }

    // Step 2: Get metadata from Cinemeta
    const metadata = await getCinemetaMetadata(type, id, cacheManager);
    if (!metadata) {
      console.log("No metadata found for:", id);
      return { streams: [] };
    }

    console.log(`Found metadata: ${metadata.name} (${metadata.year})`);

    // Step 3: Search for torrents using Torrentio
    const torrents = await searchTorrents(id, type, cacheManager);

    if (torrents.length === 0) {
      console.log("No torrents found for:", id);
      return { streams: [] };
    }

    console.log(`Found ${torrents.length} torrents from Torrentio`);

    // Step 4: Filter and prioritize torrents for series
    let filteredTorrents: TorrentInfo[] = torrents;
    if (seasonEpisode) {
      // Score and filter torrents based on episode matching
      const scoredTorrents: ScoredTorrent[] = torrents.map((torrent) => ({
        ...torrent,
        matchScore: getEpisodeMatchScore(torrent.title, seasonEpisode.season, seasonEpisode.episode),
        matches: matchesEpisode(torrent.title, seasonEpisode.season, seasonEpisode.episode),
      }));

      // Separate matching and non-matching torrents
      const matchingTorrents = scoredTorrents.filter((t) => t.matches).sort((a, b) => b.matchScore - a.matchScore);
      const nonMatchingTorrents = scoredTorrents.filter((t) => !t.matches);

      // Prioritize matching torrents, but include some non-matching as fallback
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

    // Step 6: Process torrents in parallel (with concurrency limit) for faster response
    const streams: Stream[] = [];
    const maxConcurrency = config.maxConcurrency;
    const maxStreams = config.maxStreams;
    const torrentsToProcess = cachedTorrents.slice(0, config.torrentLimit);

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
        console.log(`Processing torrent: ${torrent.title.substring(0, 50)}...${matchInfo}`);

        // Try to add magnet to Real-Debrid with episode info
        const streamUrl = await processRealDebridStream(magnetLink, rdClient, cacheManager, 0, seasonEpisode);

        if (streamUrl && streamUrl.url) {
          // Match legacy code exactly - include notWebReady: false
          // This ensures compatibility across all platforms (mobile, TV, desktop)
          const stream: Stream = {
            name: `RD+ ${torrent.quality || ""}`.trim(),
            title: torrent.title,
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
    return { streams };
  } catch (error) {
    console.error("Stream handler error:", error);
    return { streams: [] };
  }
}
