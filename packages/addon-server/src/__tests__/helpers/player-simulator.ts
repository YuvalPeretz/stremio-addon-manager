/**
 * Video player simulator for proxy integration tests.
 *
 * Simulates how real media players (Stremio, VLC, MPV, Expo) make sequential
 * HTTP Range requests to a streaming proxy.  Each profile encodes the player's
 * characteristic buffering size, seek behaviour, and parallel connection count.
 *
 * The simulator loops until `durationMs` expires:
 *   1. Issue a GET with Range: bytes=<position>-<position+chunkSize-1>
 *   2. Read the full response body
 *   3. Advance `position` by bytes actually received
 *   4. If `seekProbability` fires, jump to a random position (simulates user seek)
 *   5. Record timing; detect "stall" when a single request takes > stallThresholdMs
 *
 * Returns `PlayerMetrics` for assertion.
 */

import http from "node:http";

// ─── Player profiles ──────────────────────────────────────────────────────────

export interface PlayerProfile {
  /** Human-readable name shown in test output */
  label: string;
  /** Bytes to request per Range chunk */
  chunkSizeBytes: number;
  /** Probability of seeking per request [0–1] */
  seekProbability: number;
  /** How far ahead to seek (multiple of chunkSize) when a seek fires */
  seekAheadChunks: number;
  /** Minimum inter-request pause in ms (simulate player decode + buffer) */
  pauseBetweenRequestsMs: number;
  /**
   * Parallel connections to keep open simultaneously (Stremio uses 2-4,
   * VLC/MPV use 1, Expo uses 1-2).
   * For simplicity the simulator serialises parallel slots within one coroutine.
   */
  parallelSlots: number;
}

export const PLAYER_PROFILES: Record<string, PlayerProfile> = {
  stremio: {
    label: "Stremio (Electron/Chromium)",
    chunkSizeBytes: 512 * 1024, // 512 KB — aggressive prefetch
    seekProbability: 0.03,       // ~3% chance of seek per request
    seekAheadChunks: 30,
    pauseBetweenRequestsMs: 0,   // Stremio hammers the proxy
    parallelSlots: 1,            // serialised in this simulator; concurrency comes from test-level parallelism
  },
  vlc: {
    label: "VLC",
    chunkSizeBytes: 1024 * 1024, // 1 MB chunks
    seekProbability: 0.005,
    seekAheadChunks: 10,
    pauseBetweenRequestsMs: 20, // slight pause between reads
    parallelSlots: 1,
  },
  mpv: {
    label: "MPV",
    chunkSizeBytes: 512 * 1024, // 512 KB
    seekProbability: 0.01,
    seekAheadChunks: 20,
    pauseBetweenRequestsMs: 10,
    parallelSlots: 1,
  },
  expo: {
    label: "Expo / React Native",
    chunkSizeBytes: 256 * 1024, // 256 KB — smaller buffer on mobile
    seekProbability: 0.05,       // users seek more on mobile
    seekAheadChunks: 15,
    pauseBetweenRequestsMs: 5,
    parallelSlots: 1,
  },
};

// ─── Metrics ──────────────────────────────────────────────────────────────────

export interface PlayerMetrics {
  totalBytesReceived: number;
  /** Number of requests that took longer than stallThresholdMs */
  stallCount: number;
  /** Time from first byte of first request to last byte of last request (ms) */
  durationMs: number;
  /** Average bytes/sec over the entire session */
  avgThroughputBps: number;
  /** Time from start of first request to first byte received (ms) */
  ttfbMs: number;
  /** Total Range requests issued */
  requestCount: number;
  /** HTTP error responses (non-2xx) */
  errorCount: number;
  /** Number of times the simulator wrapped around the virtual file */
  wrapAroundCount: number;
}

// ─── HTTP helper ──────────────────────────────────────────────────────────────

/** Issue a single GET request with a Range header and collect all response bytes. */
function rangeGet(
  url: string,
  start: number,
  end: number
): Promise<{ statusCode: number; bytes: Buffer; ttfbMs: number }> {
  return new Promise((resolve, reject) => {
    const reqStart = Date.now();
    let ttfbMs = -1;
    const chunks: Buffer[] = [];

    const parsedUrl = new URL(url);
    const options: http.RequestOptions = {
      hostname: parsedUrl.hostname,
      port: parseInt(parsedUrl.port, 10),
      path: parsedUrl.pathname + parsedUrl.search,
      method: "GET",
      headers: {
        Range: `bytes=${start}-${end}`,
        "User-Agent": "Stremio/4.4.0",
      },
    };

    const req = http.request(options, (res) => {
      res.on("data", (chunk: Buffer) => {
        if (ttfbMs === -1) ttfbMs = Date.now() - reqStart;
        chunks.push(chunk);
      });
      res.on("end", () => {
        const bytes = Buffer.concat(chunks);
        resolve({ statusCode: res.statusCode ?? 0, bytes, ttfbMs: ttfbMs === -1 ? Date.now() - reqStart : ttfbMs });
      });
      res.on("error", reject);
    });

    req.on("error", reject);
    req.setTimeout(60_000, () => {
      req.destroy(new Error("Request timed out after 60s"));
    });
    req.end();
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Main simulator ───────────────────────────────────────────────────────────

/**
 * Simulate a video player making sequential Range requests for `durationMs`.
 *
 * @param proxyUrl  Full URL to the proxy, e.g. http://localhost:PORT/pass/proxy?url=<encoded>
 * @param virtualFileSize  Total size of the fake CDN file (for wrap-around logic)
 * @param profile   One of PLAYER_PROFILES
 * @param durationMs  How long to run (default 5 minutes)
 * @param stallThresholdMs  Request taking longer than this counts as a stall (default 5s)
 */
export async function simulatePlayer(
  proxyUrl: string,
  virtualFileSize: number,
  profile: PlayerProfile,
  durationMs: number = 5 * 60 * 1000,
  stallThresholdMs: number = 5_000
): Promise<PlayerMetrics> {
  const deadline = Date.now() + durationMs;

  let position = 0;
  let totalBytesReceived = 0;
  let stallCount = 0;
  let errorCount = 0;
  let requestCount = 0;
  let wrapAroundCount = 0;
  let firstTtfbMs = -1;
  const sessionStart = Date.now();

  while (Date.now() < deadline) {
    const chunkEnd = Math.min(position + profile.chunkSizeBytes - 1, virtualFileSize - 1);

    // Wrap-around when we reach the end of the virtual file
    if (position >= virtualFileSize) {
      position = 0;
      wrapAroundCount++;
      continue;
    }

    const reqStart = Date.now();
    try {
      const { statusCode, bytes, ttfbMs } = await rangeGet(proxyUrl, position, chunkEnd);

      const elapsed = Date.now() - reqStart;
      requestCount++;

      if (firstTtfbMs === -1) firstTtfbMs = ttfbMs;

      if (statusCode < 200 || statusCode >= 300) {
        errorCount++;
      } else {
        totalBytesReceived += bytes.length;
        position += bytes.length;

        if (elapsed > stallThresholdMs) {
          stallCount++;
        }

        // Seek: jump ahead to simulate user scrubbing
        if (Math.random() < profile.seekProbability) {
          const jump = profile.seekAheadChunks * profile.chunkSizeBytes;
          position = Math.min(position + jump, virtualFileSize - profile.chunkSizeBytes);
        }
      }
    } catch {
      errorCount++;
      // On error, wait briefly before retrying
      await sleep(500);
    }

    if (profile.pauseBetweenRequestsMs > 0) {
      await sleep(profile.pauseBetweenRequestsMs);
    }
  }

  const sessionDurationMs = Date.now() - sessionStart;
  const avgThroughputBps = sessionDurationMs > 0
    ? Math.round((totalBytesReceived / sessionDurationMs) * 1000)
    : 0;

  return {
    totalBytesReceived,
    stallCount,
    durationMs: sessionDurationMs,
    avgThroughputBps,
    ttfbMs: firstTtfbMs === -1 ? 0 : firstTtfbMs,
    requestCount,
    errorCount,
    wrapAroundCount,
  };
}
