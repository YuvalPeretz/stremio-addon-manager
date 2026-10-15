/**
 * TorBox stream provider — uses api.torbox.app directly.
 *
 * Flow (mirrors the RD pipeline):
 *   1. checkcached  — batch-check which infoHashes TorBox already has
 *   2. createtorrent — add the magnet so TorBox issues a torrent_id
 *   3. requestdl    — trade (torrent_id, file_id) for a playable CDN URL
 *
 * IP note: TorBox is the debrid provider; the server IP is already known to them.
 * The RD token is never used here.
 */

import axios from "axios";
import type { Stream, TorrentInfo } from "./types.js";
import type { ServerConfig } from "./config.js";
import { buildStreamName } from "./stream-sorter.js";
import { appendRequestLog, uniqueInfoHashes, type ProviderApiCall } from "./management/request-log.js";
import { pickBestEpisodeFileIndex } from "./episode-matching.js";

const TB_BASE = "https://api.torbox.app/v1/api";
const TB_MAX_STREAMS = 5;
const TB_MAX_HASHES = 100;

// In-memory cache mapping infoHash (lowercase) → TorBox torrent_id.
// Avoids calling createtorrent again for hashes the server has already seen,
// cutting re-fetch latency from ~6s down to ~1s (requestdl only).
// Lives for the lifetime of the server process — entries are cheap and the
// set of torrents per show is small.
const torrentIdCache = new Map<string, number>();

// ─── API response shapes ────────────────────────────────────────────────────

interface TBFile {
  id: number;
  name: string;
  size: number;
  mimetype?: string;
}

interface TBCachedEntry {
  files?: TBFile[];
}

// format=object → data is a Record<hash, entry | null>
type TBCacheData = Record<string, TBCachedEntry | null | false>;

interface TBApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  detail?: string;
}

interface TBCreateData {
  torrent_id: number;
  hash?: string;
  name?: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function authHeader(apiKey: string): Record<string, string> {
  return { Authorization: `Bearer ${apiKey}` };
}

async function tbCheckCached(
  apiKey: string,
  hashes: string[],
  timeout: number
): Promise<TBCacheData> {
  try {
    const res = await axios.get<TBApiResponse<TBCacheData>>(
      `${TB_BASE}/torrents/checkcached`,
      {
        params: { hash: hashes.join(","), format: "object", list_files: "true" },
        headers: authHeader(apiKey),
        timeout,
      }
    );
    return (res.data.success && res.data.data) ? res.data.data : {};
  } catch (err) {
    console.warn(`[torbox] checkcached error: ${axios.isAxiosError(err) ? err.message : String(err)}`);
    return {};
  }
}

async function tbCreateTorrent(
  apiKey: string,
  magnetLink: string,
  timeout: number
): Promise<number | null> {
  try {
    const body = new URLSearchParams({ magnet: magnetLink });
    const res = await axios.post<TBApiResponse<TBCreateData>>(
      `${TB_BASE}/torrents/createtorrent`,
      body.toString(),
      {
        headers: {
          ...authHeader(apiKey),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        timeout,
      }
    );
    if (res.data.success && res.data.data?.torrent_id) {
      return res.data.data.torrent_id;
    }
    // TorBox may return success=false but still include the existing torrent_id
    if (res.data.data?.torrent_id) {
      return res.data.data.torrent_id;
    }
    console.warn(`[torbox] createtorrent: success=${res.data.success} error=${res.data.error ?? res.data.detail ?? "unknown"}`);
    return null;
  } catch (err) {
    console.warn(`[torbox] createtorrent error: ${axios.isAxiosError(err) ? err.message : String(err)}`);
    return null;
  }
}

async function tbRequestDL(
  apiKey: string,
  torrentId: number,
  fileId: number,
  timeout: number
): Promise<string | null> {
  try {
    const res = await axios.get<TBApiResponse<string>>(
      `${TB_BASE}/torrents/requestdl`,
      {
        params: { token: apiKey, torrent_id: torrentId, file_id: fileId },
        headers: authHeader(apiKey),
        timeout,
      }
    );
    if (res.data.success && typeof res.data.data === "string" && res.data.data.length > 0) {
      return res.data.data;
    }
    console.warn(`[torbox] requestdl: success=${res.data.success} error=${res.data.error ?? "no url"}`);
    return null;
  } catch (err) {
    console.warn(`[torbox] requestdl error: ${axios.isAxiosError(err) ? err.message : String(err)}`);
    return null;
  }
}

/** Pick the best file from a cached torrent for the given episode (or discovery fileIdx). */
function pickFile(
  files: TBFile[],
  seasonEpisode: { season: number; episode: number } | null,
  absoluteEpisode?: number | null,
  knownFileIdx?: number
): TBFile | null {
  if (files.length === 0) return null;

  const videoFiles = files.filter((f) => /\.(mkv|mp4|avi|m4v|mov|ts|wmv)$/i.test(f.name));
  const pool = videoFiles.length > 0 ? videoFiles : files;

  if (pool.length === 1) return pool[0];

  if (seasonEpisode) {
    // Map knownFileIdx from the full torrent file list onto the video pool when possible.
    // Torrentio fileIdx is usually an index into all files (including non-video).
    let mappedKnown: number | undefined;
    if (knownFileIdx !== undefined && knownFileIdx >= 0 && knownFileIdx < files.length) {
      const knownName = files[knownFileIdx]?.name;
      const inPool = pool.findIndex((f) => f.name === knownName && f.id === files[knownFileIdx]?.id);
      mappedKnown = inPool >= 0 ? inPool : undefined;
      // If the known index itself is a video file still in pool by reference equality of name+id
      if (mappedKnown === undefined && /\.(mkv|mp4|avi|m4v|mov|ts|wmv)$/i.test(files[knownFileIdx]?.name ?? "")) {
        // Fall back: use knownFileIdx only if pool === files (all video)
        if (pool.length === files.length) mappedKnown = knownFileIdx;
      }
    }

    const bestIdx = pickBestEpisodeFileIndex(
      pool.map((f) => f.name),
      seasonEpisode.season,
      seasonEpisode.episode,
      absoluteEpisode,
      mappedKnown
    );
    if (bestIdx >= 0) {
      console.log(
        `[torbox] pickFile → ${pool[bestIdx].name.slice(0, 80)} (poolIdx=${bestIdx}, known=${knownFileIdx ?? "n/a"}, abs=${absoluteEpisode ?? "n/a"})`
      );
      return pool[bestIdx];
    }
  }

  // Last resort: largest non-movie video
  const nonMovie = pool.filter((f) => !/\b(?:the\s+)?movie\b|\bfilm\b/i.test(f.name));
  const fallbackPool = nonMovie.length > 0 ? nonMovie : pool;
  return fallbackPool.reduce((best, f) => (f.size > best.size ? f : best), fallbackPool[0]);
}

// ─── Public API ─────────────────────────────────────────────────────────────

/** When set, TorBox fetches are appended to the management request log (skipped when skipLog). */
export interface TorBoxFetchLogContext {
  type: string;
  stremioId: string;
  config: ServerConfig;
  seriesName?: string | null;
  /** Pre-fetch runs skip management logging to reduce noise. */
  skipLog?: boolean;
}

/**
 * Fetch playable stream URLs from TorBox for the given torrent candidates.
 *
 * @param torrents  Pre-filtered torrent list (same list used for RD).
 * @param seasonEpisode  Season/episode for file selection within multi-file torrents.
 */
export async function fetchTorBoxStreams(
  apiKey: string,
  torrents: TorrentInfo[],
  seasonEpisode: { season: number; episode: number } | null,
  timeout: number = 25000,
  logContext?: TorBoxFetchLogContext,
  absoluteEpisode?: number | null
): Promise<Stream[]> {
  const t0 = Date.now();
  const apiCalls: ProviderApiCall[] = [];

  async function recordStep(
    step: string,
    run: () => Promise<{ ok: boolean; detail?: string | null }>
  ): Promise<void> {
    const stepT0 = Date.now();
    const result = await run();
    apiCalls.push({
      step,
      durationMs: Date.now() - stepT0,
      ok: result.ok,
      detail: result.detail ?? null,
    });
  }

  if (!apiKey || torrents.length === 0) {
    if (logContext && !logContext.skipLog) {
      void appendTorBoxLog(logContext, apiCalls, t0, [], "No API key or torrent candidates").catch(() => {});
    }
    return [];
  }

  const candidates = torrents.filter((t) => t.infoHash);
  if (candidates.length === 0) {
    if (logContext && !logContext.skipLog) {
      void appendTorBoxLog(logContext, apiCalls, t0, [], "No torrents with infoHash").catch(() => {});
    }
    return [];
  }

  const hashes = candidates
    .slice(0, TB_MAX_HASHES)
    .map((t) => t.infoHash.toLowerCase());

  console.log(`[torbox] checkcached for ${hashes.length} hashes...`);
  let cacheData: TBCacheData = {};
  await recordStep("checkcached", async () => {
    cacheData = await tbCheckCached(apiKey, hashes, timeout);
    const cachedCount = hashes.filter((h) => {
      const entry = cacheData[h];
      return entry !== null && entry !== false && entry !== undefined;
    }).length;
    return {
      ok: cachedCount > 0,
      detail: `${hashes.length} hashes checked, ${cachedCount} cached on TorBox`,
    };
  });

  const cachedCandidates = candidates.filter((t) => {
    const entry = cacheData[t.infoHash.toLowerCase()];
    return entry !== null && entry !== false && entry !== undefined;
  });

  if (cachedCandidates.length === 0) {
    console.log("[torbox] No cached torrents found on TorBox");
    if (logContext && !logContext.skipLog) {
      void appendTorBoxLog(logContext, apiCalls, t0, [], null).catch(() => {});
    }
    return [];
  }

  console.log(`[torbox] ${cachedCandidates.length} cached — fetching stream URLs...`);

  const streams: Stream[] = [];

  for (const candidate of cachedCandidates) {
    if (streams.length >= TB_MAX_STREAMS) break;

    const entry = cacheData[candidate.infoHash.toLowerCase()];
    const files = (entry as TBCachedEntry)?.files ?? [];
    const pickedFile = pickFile(files, seasonEpisode, absoluteEpisode, candidate.fileIdx);

    const hashKey = candidate.infoHash.toLowerCase();
    let torrentId = torrentIdCache.get(hashKey);
    if (!torrentId) {
      const magnet = candidate.magnetLink || `magnet:?xt=urn:btih:${candidate.infoHash}`;
      let createdId: number | null = null;
      await recordStep(`createtorrent:${candidate.infoHash.substring(0, 8)}`, async () => {
        createdId = await tbCreateTorrent(apiKey, magnet, timeout);
        if (createdId) {
          torrentIdCache.set(hashKey, createdId);
        }
        return {
          ok: createdId != null,
          detail: createdId != null ? `torrent_id=${createdId}` : "createtorrent failed",
        };
      });
      torrentId = createdId ?? undefined;
      if (!torrentId) continue;
    }

    const fileId = pickedFile?.id ?? 0;
    let url: string | null = null;
    await recordStep(`requestdl:${candidate.infoHash.substring(0, 8)}`, async () => {
      url = await tbRequestDL(apiKey, torrentId!, fileId, timeout);
      return {
        ok: url != null,
        detail: url != null ? `file_id=${fileId}` : "requestdl failed",
      };
    });
    if (!url) continue;

    const { name, title: baseTitle } = buildStreamName(candidate, "TorBox");
    const fileLabel = pickedFile ? `\n📄 ${pickedFile.name.slice(0, 60)}` : "";
    streams.push({
      name,
      title: `${baseTitle}${fileLabel}`,
      url,
      infoHash: candidate.infoHash,
      discoveryTier: "quality",
      behaviorHints: { bingeGroup: "torbox", notWebReady: false },
    });

    console.log(`[torbox] ✓ Stream: ${candidate.infoHash.substring(0, 8)}... fileId=${fileId}`);
  }

  console.log(`[torbox] Returning ${streams.length} stream(s)`);

  if (logContext && !logContext.skipLog) {
    void appendTorBoxLog(logContext, apiCalls, t0, streams, null).catch(() => {});
  }

  return streams;
}

async function appendTorBoxLog(
  ctx: TorBoxFetchLogContext,
  apiCalls: ProviderApiCall[],
  startedAt: number,
  streams: Stream[],
  error: string | null
): Promise<void> {
  const title =
    streams.length > 0
      ? streams[0]?.name ?? "TorBox"
      : error ?? `TorBox · ${apiCalls.length} API step(s)`;
  await appendRequestLog(ctx.config, {
    kind: "torbox",
    type: ctx.type,
    stremioId: ctx.stremioId,
    cacheHit: false,
    durationMs: Date.now() - startedAt,
    streamCount: streams.length,
    title,
    seriesName: ctx.seriesName ?? null,
    clientIp: null,
    error,
    infoHashes: uniqueInfoHashes(streams),
    providerApiCalls: apiCalls,
  });
}
