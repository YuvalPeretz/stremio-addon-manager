/**
 * Stream Handler
 * Main logic for handling stream requests
 */

import type { Stream, StreamResponse, TorrentInfo, PendingDownload, ProcessRDResult } from "./types.js";
import type { RealDebridClient } from "./real-debrid.js";
import type { CacheManager } from "./cache.js";
import type { ServerConfig } from "./config.js";
import { getCinemetaMetadata, searchTorrents } from "./torrent-search.js";
import { fetchTorBoxStreams } from "./torbox-stream.js";
import {
  extractSeasonEpisode,
  matchesEpisode,
  getEpisodeMatchScore,
  findMatchingFile,
  absoluteEpisodeFromVideos,
  isSeriesBatchPack,
  type SeasonEpisode,
  type ScoredTorrent,
  type CinemetaVideo,
} from "./episode-matching.js";
import { sortStreams, buildStreamName, scoreTorrent, scoreRdInstantAvailability } from "./stream-sorter.js";
import { fetchSubtitles } from "./subtitle-fetcher.js";
import type { LocalLibraryManager } from "./local-library/manager.js";
import {
  mergeLateStreamsIntoCache,
  raceFirstUsableProvider,
} from "./parallel-provider-race.js";

/**
 * Pre-fetch and fully process the next N episodes in the background.
 *
 * Calls the full handleStreamRequest pipeline for each episode so the
 * RD-unrestricted stream URLs are cached — not just the raw torrent list.
 * This means the next episode will be served instantly from cache with no
 * additional RD API calls when the user actually navigates to it.
 *
 * Uses a global lock + in-flight set to prevent overlapping cascades when
 * multiple stream requests arrive nearly simultaneously (e.g. user browses
 * E07 → E06 → E05 in quick succession).
 */

const preFetchInFlight = new Set<string>();
let preFetchRunning = false;
const preFetchQueue: Array<{
  episodeIds: string[];
  rdClient: RealDebridClient;
  cacheManager: CacheManager;
  config: ServerConfig;
  localContext?: { manager: LocalLibraryManager; playbackBase: string };
}> = [];

// Single-flight deduplication: Stremio fires 3–4 requests for the same episode simultaneously.
// Without this, each request starts its own independent addMagnet pipeline, multiplying RD API load.
const inFlightStreams = new Map<string, Promise<StreamResponse>>();

// Pending downloads: key is "type/id", value tracks the RD torrent being downloaded.
// When all cached-torrent attempts fail, we queue one and show a placeholder stream.
const pendingDownloads = new Map<string, PendingDownload>();
const PENDING_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
// TorBox requestdl CDN URLs expire (exact TTL varies by CDN but can be as short as 15–20 min).
// Keep the aggregate stream cache short so that when Stremio retries after a failure it gets
// fresh URLs rather than the same expired ones.  The torrentIdCache in torbox-stream.ts keeps
// torrent_id in memory, so a cache-miss re-fetch only calls requestdl (~1s) not the full
// createtorrent + requestdl pipeline (~6s).
const TORBOX_STREAM_CACHE_TTL_SEC = 3 * 60; // 3 minutes

/** Per-request aggregate cache key (RD + TorBox merged list). Fingerprint avoids stale RD-only caches after enabling TorBox or changing order/mode. */
function streamAggregateCacheKey(type: string, id: string, config: ServerConfig): string {
  const tbConfigured = config.torboxApiToken.trim().length > 0 ? "1" : "0";
  const mode = config.streamProviderMode;
  const order = config.streamProviderOrder.map((p) => p.trim().toLowerCase()).join("|");
  return `request_${type}_${id}__p${tbConfigured}_${mode}_${order}`;
}

/**
 * Whether a stream response counts as a successful episode load for next-episode prefetch.
 * Success = at least one playable stream URL (RD/TorBox/local/cache). Pending-download
 * placeholders, empty results, and errors do not qualify.
 */
export function isSuccessfulEpisodeLoad(response: StreamResponse): boolean {
  return response.streams.some(
    (s) => typeof s.url === "string" && s.url.length > 0 && !s.url.includes("/pending-status/")
  );
}

/**
 * Gate for next-episode prefetch: series request + successful original load.
 * Exported for unit tests.
 */
export function shouldPreFetchNextEpisode(type: string, id: string, response: StreamResponse): boolean {
  if (type !== "series") return false;
  if (!extractSeasonEpisode(id)) return false;
  return isSuccessfulEpisodeLoad(response);
}

function preFetchNextEpisodes(
  currentId: string,
  currentSeason: number,
  currentEpisode: number,
  rdClient: RealDebridClient,
  cacheManager: CacheManager,
  config: ServerConfig,
  localContext?: { manager: LocalLibraryManager; playbackBase: string }
): void {
  const imdbId = currentId.split(":")[0];
  const episodesToPreFetch = 1;

  const episodeIds: string[] = [];
  let episode = currentEpisode + 1;
  for (let i = 0; i < episodesToPreFetch; i++) {
    const epId = `${imdbId}:${currentSeason}:${episode}`;
    if (!preFetchInFlight.has(epId)) {
      episodeIds.push(epId);
    }
    episode++;
  }

  if (episodeIds.length === 0) {
    console.log(`[pre-fetch] All next episodes already queued/in-flight, skipping`);
    return;
  }

  console.log(`[pre-fetch] Queuing full pipeline for: ${episodeIds.join(", ")}`);
  for (const id of episodeIds) preFetchInFlight.add(id);
  preFetchQueue.push({ episodeIds, rdClient, cacheManager, config, localContext });
  drainPreFetchQueue();
}

/** Queue next-episode prefetch only after the original episode loaded successfully. */
function scheduleNextEpisodePreFetchIfSuccessful(
  type: string,
  id: string,
  response: StreamResponse,
  rdClient: RealDebridClient,
  cacheManager: CacheManager,
  config: ServerConfig,
  localContext?: { manager: LocalLibraryManager; playbackBase: string }
): void {
  if (!shouldPreFetchNextEpisode(type, id, response)) return;
  const seasonEpisode = extractSeasonEpisode(id);
  if (!seasonEpisode) return;
  preFetchNextEpisodes(
    id,
    seasonEpisode.season,
    seasonEpisode.episode,
    rdClient,
    cacheManager,
    config,
    localContext
  );
}

function drainPreFetchQueue(): void {
  if (preFetchRunning) return;
  const job = preFetchQueue.shift();
  if (!job) return;
  preFetchRunning = true;

  void (async (): Promise<void> => {
    for (const episodeId of job.episodeIds) {
      try {
        const result = await handleStreamRequest(
          { type: "series", id: episodeId },
          job.rdClient,
          job.cacheManager,
          job.config,
          true,
          job.localContext
        );
        if (result.streams.length > 0) {
          console.log(`[pre-fetch] ✓ Fully cached ${result.streams.length} streams for ${episodeId}`);
        } else {
          console.log(`[pre-fetch] No streams resolved for ${episodeId} (will retry on demand)`);
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.debug(`[pre-fetch] Failed for ${episodeId}: ${msg}`);
      }
      // Generous pause between episodes to avoid bursting RD API (429 rate-limits)
      await new Promise<void>((resolve) => setTimeout(resolve, 5000));
    }
    preFetchRunning = false;
    drainPreFetchQueue();
  })();
}

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
 * @param knownFileIdx  When provided (from Torrentio), preferred file index —
 *                      validated against season/absolute episode scoring
 * @param seasonEpisode Episode context for multi-file torrents
 * @param absoluteEpisode Cinemeta absolute ep (anime/batch packs); optional
 */
async function processRealDebridStream(
  magnetLink: string,
  rdClient: RealDebridClient,
  cacheManager: CacheManager,
  knownFileIdx?: number,
  seasonEpisode: SeasonEpisode | null = null,
  allowPending: boolean = false,
  absoluteEpisode?: number | null
): Promise<ProcessRDResult> {
  const infoHash = extractInfoHash(magnetLink);
  const cacheKey =
    knownFileIdx !== undefined
      ? `stream_${infoHash}_fi${knownFileIdx}`
      : seasonEpisode
      ? `stream_${infoHash}_S${seasonEpisode.season}E${seasonEpisode.episode}`
      : `stream_${infoHash}_0`;

  if (infoHash) {
    const cached = cacheManager.getStream(cacheKey);
    if (cached) {
      const c = cached as { url: string; title: string };
      return { kind: "stream", url: c.url, title: c.title };
    }
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

    if (seasonEpisode && torrentInfo.files && torrentInfo.files.length > 0) {
      // Prefer discovery fileIdx when sane; otherwise score by SxxExx / absolute ep
      const matchResult = findMatchingFile(
        torrentInfo.files,
        seasonEpisode.season,
        seasonEpisode.episode,
        absoluteEpisode,
        knownFileIdx
      );
      selectedFileId = matchResult.fileId;
      selectedFileIndex = matchResult.index;
      console.log(
        `findMatchingFile → fileId=${selectedFileId} index=${selectedFileIndex} for S${seasonEpisode.season}E${seasonEpisode.episode} abs=${absoluteEpisode ?? "n/a"} knownIdx=${knownFileIdx ?? "n/a"}`
      );
    } else if (knownFileIdx !== undefined) {
      selectedFileIndex = knownFileIdx;
      if (torrentInfo.files && torrentInfo.files.length > knownFileIdx) {
        selectedFileId = (torrentInfo.files[knownFileIdx] as { id?: number }).id ?? knownFileIdx + 1;
      } else {
        selectedFileId = knownFileIdx + 1;
      }
      console.log(`Using Torrentio-provided fileIdx=${knownFileIdx} (RD fileId=${selectedFileId})`);
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

    // If the torrent is actively downloading (not already cached by RD), skip it
    // immediately — we don't want to block for minutes waiting for a download to finish.
    // The stream handler will fall through to the next torrent candidate instead.
    if (torrentInfo.status === "downloading" || torrentInfo.status === "queued") {
      if (allowPending) return { kind: "pending", torrentId };
      return { kind: "null" };
    }

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
      return { kind: "stream", ...streamData };
    }

    throw new Error("No links available");
  } catch (error) {
    const rdStatus = (error as { rdStatus?: number }).rdStatus;
    if (rdStatus === 451) {
      console.log(`Torrent DMCA-blocked on RD (451) — skipping`);
      return { kind: "dmca" };
    }
    console.error(`RD stream error (${rdStatus ?? "network"}): ${error instanceof Error ? error.message : String(error)}`);
    return { kind: "null" };
  }
}

function buildPlaceholderStream(
  type: string,
  id: string,
  pending: PendingDownload,
  baseUrl: string
): Stream {
  const ageMin = Math.floor((Date.now() - pending.addedAt) / 60_000);
  const title =
    ageMin < 1
      ? "Queued on Real-Debrid — check back in a few minutes"
      : `Downloading on Real-Debrid (${ageMin} min ago)\nCheck back in a few minutes`;
  return {
    name: "⏳ RD Downloading",
    title,
    url: `${baseUrl}/pending-status/${type}/${encodeURIComponent(id)}`,
    behaviorHints: { notWebReady: true },
  };
}

async function checkAndResolvePending(
  pending: PendingDownload,
  type: string,
  id: string,
  rdClient: RealDebridClient,
  cacheManager: CacheManager,
  baseUrl: string,
  config: ServerConfig
): Promise<StreamResponse | null> {
  try {
    const torrentInfo = await rdClient.getTorrentInfo(pending.torrentId);

    if (torrentInfo.status === "downloading" || torrentInfo.status === "queued") {
      console.log(`[pending] ${type}/${id} still ${torrentInfo.status} on RD`);
      return { streams: [buildPlaceholderStream(type, id, pending, baseUrl)] };
    }

    if (torrentInfo.status === "downloaded") {
      const fileIdx = pending.fileIdx ?? 0;
      const link = torrentInfo.links?.[fileIdx] ?? torrentInfo.links?.[0];
      if (!link) {
        console.warn(`[pending] ${type}/${id} downloaded but no links — clearing`);
        return null;
      }
      const unresult = await rdClient.unrestrictLink(link);
      const rdStream: Stream = {
        name: "⬛ RD",
        title: torrentInfo.filename as string || "Stream",
        url: unresult.download,
        infoHash: pending.infoHash,
        behaviorHints: { bingeGroup: "real-debrid", notWebReady: false },
      };
      const aggKey = streamAggregateCacheKey(type, id, config);
      cacheManager.setStream(aggKey, { streams: [rdStream] });
      pendingDownloads.delete(`${type}/${id}`);
      console.log(`[pending] ✓ ${type}/${id} download complete — serving stream`);
      return { streams: [rdStream] };
    }

    console.warn(`[pending] ${type}/${id} unexpected RD status: ${torrentInfo.status} — clearing`);
    return null;
  } catch (error) {
    const rdStatus = (error as { rdStatus?: number }).rdStatus;
    console.warn(
      `[pending] Error checking ${type}/${id} (${rdStatus ?? "network"}): ${error instanceof Error ? error.message : String(error)}`
    );
    return null;
  }
}

async function tryQueuePendingDownload(
  candidates: (TorrentInfo | ScoredTorrent)[],
  rdClient: RealDebridClient,
  cacheManager: CacheManager,
  seasonEpisode: SeasonEpisode | null,
  absoluteEpisode?: number | null
): Promise<PendingDownload | null> {
  // Prefer episode-matching torrents for series; try up to 5 candidates
  const ordered = seasonEpisode
    ? [
        ...candidates.filter((t): boolean => "matches" in t && Boolean((t as ScoredTorrent).matches)),
        ...candidates.filter((t): boolean => !("matches" in t) || !Boolean((t as ScoredTorrent).matches)),
      ]
    : candidates;

  const limit = Math.min(ordered.length, 5);
  for (let i = 0; i < limit; i++) {
    if (i > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, 200));
    }
    const torrent = ordered[i];
    if (!torrent.infoHash) continue;

    const magnetLink = torrent.magnetLink || `magnet:?xt=urn:btih:${torrent.infoHash}`;
    const fileIdx = torrent.fileIdx;

    const result = await processRealDebridStream(
      magnetLink,
      rdClient,
      cacheManager,
      fileIdx,
      seasonEpisode,
      true,
      absoluteEpisode
    );

    if (result.kind === "pending") {
      console.log(`[pending] Queued download: ${torrent.infoHash.substring(0, 8)}... torrentId=${result.torrentId}`);
      return {
        torrentId: result.torrentId,
        infoHash: torrent.infoHash,
        fileIdx: torrent.fileIdx,
        seasonEpisode,
        addedAt: Date.now(),
      };
    }
    // kind: "null" (DMCA/error) or kind: "stream" (cached — rare) — try next
  }

  return null;
}

/**
 * Main stream handler function
 *
 * @param isPreFetch When true, skips the pre-fetch of subsequent episodes to prevent
 *                   infinite cascades when called from preFetchNextEpisodes.
 * @param localContext When set, prepends local files (exact always; fuzzy when Cinemeta is loaded — not on RD cache hits).
 */
export function handleStreamRequest(
  params: { type: string; id: string; baseUrl?: string },
  rdClient: RealDebridClient,
  cacheManager: CacheManager,
  config: ServerConfig,
  isPreFetch: boolean = false,
  localContext?: { manager: LocalLibraryManager; playbackBase: string }
): Promise<StreamResponse> {
  const { type, id } = params;
  const requestCacheKey = streamAggregateCacheKey(type, id, config);

  if (!isPreFetch) {
    const existing = inFlightStreams.get(requestCacheKey);
    if (existing) {
      console.log(`[single-flight] Joining in-flight request for ${type}/${id}`);
      return existing;
    }
  }

  const flight = _executeStreamRequest(params, rdClient, cacheManager, config, isPreFetch, localContext);

  if (!isPreFetch) {
    inFlightStreams.set(requestCacheKey, flight);
    void flight.finally(() => inFlightStreams.delete(requestCacheKey));
    // Next-episode prefetch only after the original request finishes successfully
    // (playable streams). Failures, empty results, and pending placeholders skip it.
    void flight
      .then((response) => {
        scheduleNextEpisodePreFetchIfSuccessful(
          type,
          id,
          response,
          rdClient,
          cacheManager,
          config,
          localContext
        );
      })
      .catch(() => {
        /* errors already handled inside _executeStreamRequest */
      });
  }

  return flight;
}

async function _executeStreamRequest(
  params: { type: string; id: string; baseUrl?: string },
  rdClient: RealDebridClient,
  cacheManager: CacheManager,
  config: ServerConfig,
  isPreFetch: boolean = false,
  localContext?: { manager: LocalLibraryManager; playbackBase: string }
): Promise<StreamResponse> {
  const { type, id, baseUrl } = params;
  if (!isPreFetch) console.log(`Stream request: ${type} ${id}`);
  else console.log(`[pre-fetch] Processing: ${type} ${id}`);

  const requestCacheKey = streamAggregateCacheKey(type, id, config);
  const pendingKey = `${type}/${id}`;

  try {
    const providerOrder = config.streamProviderOrder;
    const providerMode = config.streamProviderMode;
    const hasTorBox = config.torboxApiToken.trim().length > 0 && providerOrder.includes("torbox");

    const localBase = localContext?.manager?.enabled && localContext.playbackBase ? localContext.playbackBase : null;
    const localExactOnly = (): Stream[] =>
      localBase && localContext?.manager
        ? localContext.manager.buildStreamsForStremioRequest(type, id, localBase, { enableFuzzy: false })
        : [];

    // Aggregate stream cache (RD + TorBox when merged). Key includes provider fingerprint (see streamAggregateCacheKey).
    // Local matches are always merged fresh on read.
    const cachedResponse = cacheManager.getStream(requestCacheKey);
    if (cachedResponse) {
      const cached = cachedResponse as StreamResponse;
      if (cached.streams.length === 0) {
        console.log(`Ignoring cached empty response for ${type}/${id} — will retry`);
      } else {
        const remotePart = [...cached.streams];
        const localPart = localExactOnly();
        const merged = [...localPart, ...remotePart];
        sortStreams(merged);
        const subtitles = await fetchSubtitles(type, id, cacheManager);
        if (subtitles.length > 0) {
          merged.forEach((s) => {
            s.subtitles = subtitles;
          });
        }
        console.log(
          `✓ Returning cached response for ${type}/${id} (${remotePart.length} remote + ${localPart.length} local)`
        );
        const metaForLog = await getCinemetaMetadata(type, id, cacheManager);
        return { streams: merged, logContext: { showName: metaForLog?.name ?? null } };
      }
    }

    // Pending download check: if this content was previously queued on RD, check its status.
    // Only runs for direct user requests (not pre-fetch) when we have a baseUrl for the placeholder.
    if (!isPreFetch && baseUrl) {
      const pending = pendingDownloads.get(pendingKey);
      if (pending) {
        if (Date.now() - pending.addedAt > PENDING_TTL_MS) {
          pendingDownloads.delete(pendingKey);
        } else {
          const resolved = await checkAndResolvePending(pending, type, id, rdClient, cacheManager, baseUrl, config);
          if (resolved !== null) return resolved;
          pendingDownloads.delete(pendingKey); // error/expired — fall through to retry
        }
      }
    }

    // ─── Provider setup (continued) ────────────────────────────────────────────
    const rdApiValid =
      config.rdApiToken.length > 0 && config.rdApiToken !== "YOUR_REAL_DEBRID_TOKEN_HERE";
    const hasRD = rdApiValid && providerOrder.includes("real-debrid");

    // torboxPromise is started after the torrent list is available (below), not here.

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
      const localOnly = localExactOnly();
      if (localOnly.length === 0) {
        return { streams: [] };
      }
      const subtitles = await subtitlesPromise;
      const out = [...localOnly];
      sortStreams(out);
      if (subtitles.length > 0) {
        out.forEach((s) => {
          s.subtitles = subtitles;
        });
      }
      return { streams: out, logContext: { showName: null } };
    }

    console.log(`Found metadata: ${metadata.name} (${metadata.year})`);

    // Absolute episode index from Cinemeta (anime/batch packs use 001–N instead of SxxExx)
    const absoluteEpisode =
      seasonEpisode && Array.isArray(metadata.videos)
        ? absoluteEpisodeFromVideos(metadata.videos as CinemetaVideo[], seasonEpisode.season, seasonEpisode.episode)
        : null;
    if (absoluteEpisode != null) {
      console.log(
        `Absolute episode for S${seasonEpisode!.season}E${seasonEpisode!.episode}: ${absoluteEpisode}`
      );
    }

    // Step 4: Search for torrents from all sources (public Torrentio, quality+seeder sorted).
    // RD token is NOT passed to any discovery source — all RD API calls are made directly
    // from this server so Real-Debrid only ever sees one public IP.
    const torrents = await searchTorrents(id, type, cacheManager);

    if (torrents.length === 0) {
      console.log("No torrents found for:", id);
      const localOnly =
        localBase && localContext?.manager
          ? localContext.manager.buildStreamsForStremioRequest(type, id, localBase, {
              enableFuzzy: true,
              cinemetaMeta: metadata,
            })
          : [];
      if (localOnly.length === 0) {
        return { streams: [], logContext: { showName: metadata.name } };
      }
      const subtitles = await subtitlesPromise;
      const out = [...localOnly];
      sortStreams(out);
      if (subtitles.length > 0) {
        out.forEach((s) => {
          s.subtitles = subtitles;
        });
      }
      return { streams: out, logContext: { showName: metadata.name } };
    }

    console.log(`Found ${torrents.length} torrents from Torrentio`);

    // Next-episode prefetch is scheduled in handleStreamRequest only after this
    // request completes successfully (see scheduleNextEpisodePreFetchIfSuccessful).

    // Step 5: Filter and prioritize torrents for series
    // Torrent list order is already Q-then-S from searchTorrents (quality sort first,
    // then seeder-only hashes). Do not re-sort globally — that would bury the seeder
    // tier and defeat the "more options" merge.
    let filteredTorrents: TorrentInfo[] = torrents;
    if (seasonEpisode) {
      const scoredTorrents: ScoredTorrent[] = filteredTorrents.map((torrent) => {
        const seasonEpMatch = matchesEpisode(torrent.title, seasonEpisode.season, seasonEpisode.episode);
        const batchMatch =
          !seasonEpMatch && absoluteEpisode != null && isSeriesBatchPack(torrent.title);
        return {
          ...torrent,
          matchScore: getEpisodeMatchScore(
            torrent.title,
            seasonEpisode.season,
            seasonEpisode.episode,
            absoluteEpisode
          ),
          matches: seasonEpMatch || batchMatch,
        };
      });

      // Matching keep discovery order (Q then S). Non-matching: prefer batch packs / higher scores.
      const matchingTorrents = scoredTorrents.filter((t) => t.matches);
      const nonMatchingTorrents = scoredTorrents
        .filter((t) => !t.matches)
        .sort((a, b) => b.matchScore - a.matchScore);

      filteredTorrents = [...matchingTorrents, ...nonMatchingTorrents.slice(0, config.seriesNonMatchFallbackLimit)];

      console.log(
        `Filtered to ${matchingTorrents.length} matching torrents (${nonMatchingTorrents.length} non-matching available as fallback)`
      );

      if (matchingTorrents.length === 0) {
        console.log(
          `⚠️  WARNING: No torrents found that clearly match S${seasonEpisode.season}E${seasonEpisode.episode}. Using best available torrents.`
        );
      }
    }

    // TorBox: now that we have the filtered torrent list, start the TorBox pipeline
    // concurrently with the RD availability check + processing loop.
    const torboxPromise: Promise<Stream[]> = hasTorBox
      ? fetchTorBoxStreams(
          config.torboxApiToken,
          filteredTorrents,
          seasonEpisode,
          25000,
          {
            type,
            stremioId: id,
            config,
            seriesName: metadata.name,
            skipLog: isPreFetch,
          },
          absoluteEpisode
        )
      : Promise.resolve([]);

    // Ordered TorBox-first: await TorBox before starting the RD loop.
    // If TorBox has results, return immediately; otherwise fall through to RD.
    if (providerMode === "ordered" && providerOrder[0] === "torbox" && hasTorBox) {
      const earlyTbStreams = await torboxPromise;
      if (earlyTbStreams.length > 0) {
        console.log(`[torbox] Ordered TorBox-first: ${earlyTbStreams.length} streams — skipping RD`);
        const localStreams =
          localBase && localContext?.manager
            ? localContext.manager.buildStreamsForStremioRequest(type, id, localBase, {
                enableFuzzy: true,
                cinemetaMeta: metadata,
              })
            : [];
        const subtitles = await subtitlesPromise;
        const merged = [...localStreams, ...earlyTbStreams];
        sortStreams(merged);
        if (subtitles.length > 0) merged.forEach((s) => { s.subtitles = subtitles; });
        cacheManager.setStream(requestCacheKey, { streams: earlyTbStreams }, TORBOX_STREAM_CACHE_TTL_SEC);
        return { streams: merged, logContext: { showName: metadata.name } };
      }
      console.log(`[torbox] Ordered TorBox-first: no streams from TorBox — falling back to RD`);
    }

    // TorBox-only: skip the entire RD pipeline (availability check + addMagnet loop).
    if (!hasRD) {
      const tbOnly = await torboxPromise;
      const localStreams =
        localBase && localContext?.manager
          ? localContext.manager.buildStreamsForStremioRequest(type, id, localBase, {
              enableFuzzy: true,
              cinemetaMeta: metadata,
            })
          : [];
      const subtitles = await subtitlesPromise;
      const merged = [...localStreams, ...tbOnly];
      sortStreams(merged);
      if (subtitles.length > 0) merged.forEach((s) => { s.subtitles = subtitles; });
      if (tbOnly.length > 0) cacheManager.setStream(requestCacheKey, { streams: tbOnly }, TORBOX_STREAM_CACHE_TTL_SEC);
      return { streams: merged, logContext: { showName: metadata.name } };
    }

    // RD pipeline as a promise so parallel mode can race it against TorBox and early-return.
    type RdPipelineResult = {
      streams: Stream[];
      abortedDueToDmca: boolean;
      /** Prefetch aborted due to RD 403 on availability — skip further work outside parallel race. */
      prefetchAbortedOn403: boolean;
    };

    const runRdPipeline = async (): Promise<RdPipelineResult> => {
      // Step 5: Check instant availability for prioritized torrents (faster processing)
      let concurrencyOverride: number | undefined;
      const limitedTorrents = filteredTorrents.slice(0, config.availabilityCheckLimit);
      const infoHashes = limitedTorrents.map((t) => t.infoHash).filter((h): h is string => Boolean(h));

      // Preserve scored torrent information (for episode matching display)
      const scoredTorrentMap = new Map<string, ScoredTorrent>();
      if (seasonEpisode) {
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

          const cachedHashes = new Set<string>();
          const availabilityByHash = new Map<string, unknown>();
          if (availability && typeof availability === "object") {
            for (const hash of Object.keys(availability as Record<string, unknown>)) {
              const hashData = (availability as Record<string, unknown>)[hash];
              if (hashData && typeof hashData === "object" && Object.keys(hashData).length > 0) {
                const key = hash.toLowerCase();
                cachedHashes.add(key);
                availabilityByHash.set(key, hashData);
              }
            }
          }

          const cachedRaw = limitedTorrents.filter((t) => cachedHashes.has(t.infoHash.toLowerCase()));
          const nonCached = limitedTorrents.filter((t) => !cachedHashes.has(t.infoHash.toLowerCase()));

          const cachedWithScores = cachedRaw.map((t) => {
            const rdCacheScore = scoreRdInstantAvailability(availabilityByHash.get(t.infoHash.toLowerCase()));
            return { ...t, rdCacheScore };
          });
          cachedWithScores.sort((a, b) => {
            const sa = a.rdCacheScore ?? 0;
            const sb = b.rdCacheScore ?? 0;
            if (sb !== sa) return sb - sa;
            const qa = a.source === "Torrentio/Q" ? 0 : 1;
            const qb = b.source === "Torrentio/Q" ? 0 : 1;
            if (qa !== qb) return qa - qb;
            return scoreTorrent(b) - scoreTorrent(a);
          });

          // ONLY process RD-confirmed cached torrents (addMagnet from this server only — no RD token on Torrentio).
          cachedTorrents = cachedWithScores;
          console.log(`Found ${cachedWithScores.length} RD-cached torrents (skipping ${nonCached.length} non-cached)`);
        } catch (error) {
          const rdStatus = (error as { rdStatus?: number }).rdStatus;
          if (rdStatus === 403) {
            if (isPreFetch) {
              // Skip further RD work when availability filtering is unavailable — save API calls.
              return { streams: [], abortedDueToDmca: false, prefetchAbortedOn403: true };
            }
            // For direct requests: fall back to add-and-check with tight concurrency.
            console.warn("RD availability endpoint disabled (403) — using add-and-check (top 30, serialized)");
            concurrencyOverride = 1;
            const rdBlockedPattern = /\bWEB[-.]?DL\b|\bWEBRip\b|\bAMZN\b|\bDSNP\b|\bNF\b|\bCR\b/i;
            const top30 = filteredTorrents.slice(0, 30);
            const unblocked = top30.filter((t) => !rdBlockedPattern.test(t.title));
            const skipped = top30.length - unblocked.length;
            if (skipped > 0) {
              console.log(`[rd-filter] Skipped ${skipped} WEB-DL/streaming torrents (RD blocking); ${unblocked.length} candidates remaining`);
            }
            cachedTorrents = unblocked;
          } else {
            console.error("Instant availability check failed, using all torrents:", error);
            cachedTorrents = limitedTorrents;
          }
        }
      } else {
        cachedTorrents = limitedTorrents;
      }

      // Step 7: Process torrents in parallel (with concurrency limit) for faster response
      const streams: Stream[] = [];
      const maxConcurrency = concurrencyOverride ?? config.maxConcurrency;
      const maxStreams = config.maxStreams;
      const torrentsToProcess = cachedTorrents;

      const processTorrent = async (torrent: TorrentInfo | ScoredTorrent): Promise<Stream | "dmca" | null> => {
        if (!torrent.infoHash) return null;

        const magnetLink = torrent.magnetLink || `magnet:?xt=urn:btih:${torrent.infoHash}`;

        try {
          const scoredTorrent = scoredTorrentMap.get(torrent.infoHash);
          const matchInfo =
            seasonEpisode && scoredTorrent && scoredTorrent.matches
              ? ` [MATCHES S${seasonEpisode.season}E${seasonEpisode.episode}]`
              : "";

          const hasHebrew = /\bheb\b|hebrew|עברית/i.test(torrent.title);
          const hebrewInfo = hasHebrew ? " [🇮🇱 HEBREW AUDIO]" : "";

          const sourceTag = torrent.source ? ` [${torrent.source}]` : "";
          const fileIdxTag = torrent.fileIdx !== undefined ? ` fileIdx=${torrent.fileIdx}` : "";
          console.log(
            `Processing torrent: ${torrent.title.substring(0, 50)}...${matchInfo}${hebrewInfo}${sourceTag}${fileIdxTag}`
          );

          const fileIdx = torrent.fileIdx;
          const rdResult = await processRealDebridStream(
            magnetLink,
            rdClient,
            cacheManager,
            fileIdx,
            seasonEpisode,
            false,
            absoluteEpisode
          );

          if (rdResult.kind === "stream") {
            const { name, title } = buildStreamName(torrent);
            const discoveryTier =
              torrent.source === "Torrentio/Q"
                ? ("quality" as const)
                : torrent.source === "Torrentio/S"
                ? ("seeders" as const)
                : undefined;
            const stream: Stream = {
              name,
              title,
              url: rdResult.url,
              infoHash: torrent.infoHash,
              discoveryTier,
              rdCacheScore: torrent.rdCacheScore,
              behaviorHints: {
                bingeGroup: "real-debrid",
                notWebReady: false,
              },
            };
            return stream;
          }
          if (rdResult.kind === "dmca") return "dmca";
        } catch (error) {
          console.error(`✗ Failed to process ${torrent.infoHash}:`, error);
          return null;
        }
        return null;
      };

      const DMCA_ABORT_THRESHOLD = 10;
      let consecutiveDmca = 0;
      let processedCount = 0;
      let abortedDueToDmca = false;

      outerLoop: for (let i = 0; i < torrentsToProcess.length && streams.length < maxStreams; i += maxConcurrency) {
        if (concurrencyOverride !== undefined && i > 0) {
          await new Promise<void>((resolve) => setTimeout(resolve, 700));
        }
        const batch = torrentsToProcess.slice(i, i + maxConcurrency);
        const results = await Promise.allSettled(batch.map(processTorrent));
        processedCount += batch.length;

        for (const result of results) {
          if (result.status === "fulfilled" && result.value && typeof result.value === "object") {
            streams.push(result.value);
            consecutiveDmca = 0;
            console.log(`✓ Added stream: ${result.value.title.substring(0, 40)}`);

            if (streams.length >= maxStreams) {
              console.log(`Reached target of ${maxStreams} streams, stopping processing`);
              break outerLoop;
            }
          } else if (result.status === "fulfilled" && result.value === "dmca") {
            consecutiveDmca++;
            if (consecutiveDmca >= DMCA_ABORT_THRESHOLD && streams.length === 0) {
              console.log(`[abort] ${consecutiveDmca} consecutive DMCA blocks — content fully blocked on RD, stopping early`);
              abortedDueToDmca = true;
              break outerLoop;
            }
          } else {
            consecutiveDmca = 0;
          }
        }

        if (streams.length >= maxStreams) {
          break;
        }
      }

      console.log(`Returning ${streams.length} RD streams (processed ${processedCount} torrents)`);
      return { streams, abortedDueToDmca, prefetchAbortedOn403: false };
    };

    const buildLocalStreams = (): Stream[] =>
      localBase && localContext?.manager
        ? localContext.manager.buildStreamsForStremioRequest(type, id, localBase, {
            enableFuzzy: true,
            cinemetaMeta: metadata,
          })
        : [];

    const finalizeRemoteResponse = async (
      remoteStreams: Stream[],
      torboxCount: number
    ): Promise<StreamResponse> => {
      const localStreams = buildLocalStreams();
      const subtitles = await subtitlesPromise;
      if (subtitles.length > 0) {
        console.log(`✓ Adding ${subtitles.length} subtitle languages to streams`);
        remoteStreams.forEach((stream) => {
          stream.subtitles = subtitles;
        });
        localStreams.forEach((stream) => {
          stream.subtitles = subtitles;
        });
      }

      const merged = [...localStreams, ...remoteStreams];
      sortStreams(merged);

      if (remoteStreams.length > 0) {
        const cacheTtl = torboxCount > 0 ? TORBOX_STREAM_CACHE_TTL_SEC : undefined;
        cacheManager.setStream(requestCacheKey, { streams: remoteStreams }, cacheTtl);
        console.log(
          `✓ Cached ${remoteStreams.length} streams for ${type}/${id} (${remoteStreams.length - torboxCount} RD + ${torboxCount} TorBox)${cacheTtl ? ` [TTL: ${cacheTtl}s]` : ""}`
        );
      } else {
        console.warn(`No streams resolved for ${type}/${id} — not caching empty result`);
      }

      return { streams: merged, logContext: { showName: metadata.name } };
    };

    // ─── Parallel mode: race first usable provider, merge the rest into cache ───
    // Return as soon as RD or TorBox has streams; do not cancel the slower provider.
    // Late results only enrich the aggregate cache for subsequent requests.
    if (providerMode === "parallel" && hasTorBox) {
      const rdPipelinePromise = runRdPipeline();
      const { early, late } = await raceFirstUsableProvider(
        rdPipelinePromise.then((r) => r.streams),
        torboxPromise
      );

      if (early.streams.length === 0) {
        const rdResult = await rdPipelinePromise;
        // Ordered-style empty handling: pending download when both providers failed.
        if (!isPreFetch && baseUrl && !rdResult.abortedDueToDmca) {
          const queued = await tryQueuePendingDownload(
            filteredTorrents,
            rdClient,
            cacheManager,
            seasonEpisode,
            absoluteEpisode
          );
          if (queued) {
            pendingDownloads.set(pendingKey, queued);
            console.log(`[pending] Queued RD download for ${type}/${id}, torrentId=${queued.torrentId}`);
            return {
              streams: [buildPlaceholderStream(type, id, queued, baseUrl)],
              logContext: { showName: metadata?.name ?? null },
            };
          }
        }
        return finalizeRemoteResponse([], 0);
      }

      const earlyTorboxCount = early.source === "torbox" ? early.streams.length : 0;
      console.log(
        `[parallel-race] Early return from ${early.source} with ${early.streams.length} streams (other provider continues)`
      );

      const response = await finalizeRemoteResponse(early.streams, earlyTorboxCount);

      void late
        .then((lateResult) => {
          if (lateResult.streams.length === 0) {
            console.log(
              `[parallel-race] Late ${lateResult.source} returned empty — keeping early cache for ${type}/${id}`
            );
            return;
          }
          const mergedRemote = mergeLateStreamsIntoCache(
            cacheManager,
            requestCacheKey,
            early.streams,
            lateResult.streams,
            TORBOX_STREAM_CACHE_TTL_SEC
          );
          if (mergedRemote) {
            console.log(
              `[parallel-race] Merged late ${lateResult.source} (+${lateResult.streams.length}) into cache for ${type}/${id} → ${mergedRemote.length} remote streams`
            );
          }
        })
        .catch((error: unknown) => {
          console.error(`[parallel-race] Late merge failed for ${type}/${id}:`, error);
        });

      return response;
    }

    // ─── Ordered mode (and parallel without TorBox): await RD, then TorBox fallback ───
    const rdResult = await runRdPipeline();
    if (rdResult.prefetchAbortedOn403) {
      return { streams: [] };
    }

    const streams = rdResult.streams;
    const abortedDueToDmca = rdResult.abortedDueToDmca;

    // Ordered RD-first: only use TorBox if RD returned 0 streams.
    // Ordered TorBox-first already returned early above.
    let torboxStreams: Stream[] = [];
    const isOrderedTorBoxFirst = providerMode === "ordered" && providerOrder[0] === "torbox";
    if (hasTorBox && !isOrderedTorBoxFirst) {
      const resolved = await torboxPromise;
      if (streams.length === 0) {
        torboxStreams = resolved;
        if (torboxStreams.length > 0) {
          console.log(`[torbox] Got ${torboxStreams.length} streams (RD fallback)`);
        }
      }
    }

    if (streams.length === 0 && torboxStreams.length === 0 && !isPreFetch && baseUrl && !abortedDueToDmca) {
      const queued = await tryQueuePendingDownload(
        filteredTorrents,
        rdClient,
        cacheManager,
        seasonEpisode,
        absoluteEpisode
      );
      if (queued) {
        pendingDownloads.set(pendingKey, queued);
        console.log(`[pending] Queued RD download for ${type}/${id}, torrentId=${queued.torrentId}`);
        return {
          streams: [buildPlaceholderStream(type, id, queued, baseUrl)],
          logContext: { showName: metadata?.name ?? null },
        };
      }
    }

    const remoteStreams = [...streams, ...torboxStreams];
    return finalizeRemoteResponse(remoteStreams, torboxStreams.length);
  } catch (error) {
    console.error("Stream handler error:", error);
    // Do NOT cache errors — the next request should retry fresh
    return { streams: [] };
  }
}
