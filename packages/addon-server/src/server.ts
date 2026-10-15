/**
 * Express Server Setup
 */

import express, { type Request, type Response, type NextFunction, type RequestHandler } from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import axios from "axios";
import http from "node:http";
import https from "node:https";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ServerConfig } from "./config.js";
import type { RealDebridClient } from "./real-debrid.js";
import type { CacheManager } from "./cache.js";
import { manifest, getManifestWithLocalLibrary } from "./manifest.js";
import { getCinemetaMetadata } from "./torrent-search.js";
import { buildLocalCatalogMetas, buildLocalMeta, parseCatalogExtraArgs } from "./local-library/stremio-catalog.js";
import { handleStreamRequest } from "./stream-handler.js";
import { LocalLibraryManager } from "./local-library/manager.js";
import { registerLocalLibraryRoutes } from "./local-library/routes.js";
import { registerManagementRoutes } from "./management/routes.js";
import { appendRequestLog, clientIpFromReq, uniqueInfoHashes } from "./management/request-log.js";
import { ClientActivityManager } from "./management/client-activity.js";
import { resolvePlaybackBaseUrl } from "./external-base.js";
import type { StreamResponse } from "./types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Only Pi-origin RD CDN links (api + download hosts use *.real-debrid.com). */
function isRealDebridCdnUrl(url: string): boolean {
  return /^https?:\/\/[^/]*\.real-debrid\.com\//i.test(url);
}

/**
 * Map file extension to a proper video MIME type.
 * RD CDN always returns "application/force-download" which is useless
 * for Stremio — it needs a real video content-type to decode properly.
 */
const VIDEO_MIME: Record<string, string> = {
  ".mkv": "video/x-matroska",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".avi": "video/x-msvideo",
  ".m4v": "video/x-m4v",
  ".mov": "video/quicktime",
  ".wmv": "video/x-ms-wmv",
  ".ts": "video/mp2t",
  ".flv": "video/x-flv",
};

function videoMimeFromUrl(url: string): string | null {
  try {
    const pathname = new URL(url).pathname;
    const ext = path.extname(pathname).toLowerCase();
    return VIDEO_MIME[ext] ?? null;
  } catch {
    return null;
  }
}

/**
 * HTTP/HTTPS agents with TCP keepalive for upstream RD CDN connections.
 * Keepalive probes detect silently dead TCP connections that would otherwise
 * cause the proxy pipe to hang indefinitely.
 */
const rdStreamAgent = new http.Agent({ keepAlive: true, keepAliveMsecs: 30_000 });
const rdStreamAgentHttps = new https.Agent({ keepAlive: true, keepAliveMsecs: 30_000 });

/**
 * Parse the byte offset from a Content-Range header (e.g. "bytes 500-999/1000" -> 500).
 * Returns 0 when the header is missing or unparseable.
 */
function parseContentRangeStart(header: string | undefined): number {
  if (!header) return 0;
  const match = /bytes\s+(\d+)-/i.exec(header);
  return match ? parseInt(match[1], 10) : 0;
}

/** Parse total file size from Content-Range (e.g. "bytes 0-999/5000" -> 5000). */
function parseContentRangeTotal(header: string | undefined): number {
  if (!header) return 0;
  const m = /\/(\d+)/i.exec(header);
  return m ? parseInt(m[1], 10) : 0;
}

// ── Proxy upstream session cache ────────────────────────────────────────────
// When a streaming client disconnects, the upstream RD CDN connection is kept
// alive for a grace period with data buffered in memory.  Stremio's Android
// player makes multiple short-lived Range requests (~60 s each); without
// caching each reconnection would need a fresh TLS handshake to RD (~2 s).
// With the cache the reconnection is instant (data already in memory).

const PARK_TTL_MS = 15_000; // 15 s grace — enough for Stremio's quick reconnects
const ROLLING_BUF_MAX = 12 * 1024 * 1024; // 12 MB rolling window per session
const MAX_PARKED_SESSIONS = 6; // total across all URLs

interface ParkedUpstream {
  url: string;
  stream: NodeJS.ReadableStream;
  /** Next byte the upstream will deliver (= end of rolling buffer) */
  headByte: number;
  /** Total file size (from Content-Range) */
  totalSize: number;
  /** Rolling buffer of recently-streamed bytes (populated during active streaming) */
  buf: Buffer[];
  bufBytes: number;
  /** Absolute byte pos of buf[0][0] */
  bufStart: number;
  ended: boolean;
  timer: ReturnType<typeof setTimeout>;
}

let parkSeq = 0;
const parkedUpstreams = new Map<string, ParkedUpstream>();

function parkKey(url: string): string {
  return `${url}\0${++parkSeq}`;
}

/**
 * Park an upstream connection for later reuse.  Multiple sessions per URL
 * are allowed — probes at byte 0 coexist with main-stream parks at high
 * offsets.  If ranges overlap, the smaller one is discarded.
 */
function parkStream(
  url: string,
  stream: NodeJS.ReadableStream,
  headByte: number,
  totalSize: number,
  buf: Buffer[],
  bufBytes: number,
  bufStart: number,
  ttlMs: number = PARK_TTL_MS
): boolean {
  // Check existing parks for the SAME URL with overlapping byte ranges.
  // If an existing park fully covers this new range and is larger, discard the new one.
  for (const [key, old] of parkedUpstreams) {
    if (old.url !== url) continue;
    const overlap = bufStart < old.headByte && headByte > old.bufStart;
    if (overlap) {
      if (old.bufBytes >= bufBytes) {
        destroy(stream);
        return false;
      }
      clearTimeout(old.timer);
      destroy(old.stream);
      parkedUpstreams.delete(key);
      break;
    }
  }

  // Evict the oldest session if we've hit the global cap
  if (parkedUpstreams.size >= MAX_PARKED_SESSIONS) {
    const oldest = parkedUpstreams.keys().next().value!;
    const victim = parkedUpstreams.get(oldest)!;
    clearTimeout(victim.timer);
    destroy(victim.stream);
    parkedUpstreams.delete(oldest);
  }

  stream.removeAllListeners("data");
  stream.removeAllListeners("end");
  stream.removeAllListeners("error");

  const key = parkKey(url);
  const s: ParkedUpstream = {
    url,
    stream,
    headByte,
    totalSize,
    buf,
    bufBytes,
    bufStart,
    ended: false,
    timer: setTimeout(() => {
      s.buf = [];
      s.bufBytes = 0;
      destroy(s.stream);
      parkedUpstreams.delete(key);
    }, ttlMs),
  };

  stream.on("end", () => {
    s.ended = true;
  });
  stream.on("error", () => {
    s.ended = true;
    clearTimeout(s.timer);
    parkedUpstreams.delete(key);
  });

  (stream as NodeJS.ReadableStream & { pause?: () => void }).pause?.();
  parkedUpstreams.set(key, s);
  return true;
}

/**
 * Find and reclaim a parked session whose buffer covers `fromByte`.
 * Prefers the session with the most buffered bytes (best chance of
 * covering the client's needs without a fresh upstream connection).
 */
function reclaimParked(url: string, fromByte: number): ParkedUpstream | null {
  let bestKey: string | null = null;
  let best: ParkedUpstream | null = null;

  for (const [key, s] of parkedUpstreams) {
    if (s.url !== url) continue;
    if (s.ended) {
      clearTimeout(s.timer);
      parkedUpstreams.delete(key);
      continue;
    }
    if (fromByte >= s.bufStart && fromByte <= s.headByte) {
      if (!best || s.bufBytes > best.bufBytes) {
        bestKey = key;
        best = s;
      }
    }
  }

  if (best && bestKey) {
    clearTimeout(best.timer);
    parkedUpstreams.delete(bestKey);
  }
  return best;
}

function destroy(stream: NodeJS.ReadableStream) {
  (stream as NodeJS.ReadableStream & { destroy?: () => void }).destroy?.();
}

// ── Pre-warm upstream connections ──────────────────────────────────────────
// When the stream handler returns RD CDN URLs, we immediately start a
// background GET bytes=0- to the CDN.  By the time Stremio's first probe
// arrives (~200ms later), the TLS handshake is done and initial data is
// already buffered.  The pre-warmed session is parked in the normal
// parkedUpstreams map, so reclaimParked picks it up automatically.
//
// Bonus: the keepAlive HTTPS agent reuses the TCP socket for subsequent
// requests to the same CDN host, so the moov-atom probe (different byte
// range, same host) also benefits without a dedicated pre-warm.

const PRE_WARM_COLLECT_MS = 800; // buffer data for this long before parking
const PRE_WARM_MAX_BYTES = 512 * 1024; // stop collecting after 512 KB
const PRE_WARM_TTL_MS = 90_000; // keep pre-warmed sessions alive much longer (user may browse before playing)
const preWarmInFlight = new Set<string>();

function preWarmUpstream(url: string): void {
  if (preWarmInFlight.has(url)) return;
  // Skip if there's already a parked session covering byte 0 for this URL
  for (const [, s] of parkedUpstreams) {
    if (s.url === url && s.bufStart === 0 && !s.ended) return;
  }

  preWarmInFlight.add(url);
  axios
    .get(url, {
      responseType: "stream",
      httpAgent: rdStreamAgent,
      httpsAgent: rdStreamAgentHttps,
      headers: {
        Range: "bytes=0-",
        "User-Agent": "Mozilla/5.0 (compatible; Stremio/1.0)",
      },
      timeout: 10_000,
      maxRedirects: 10,
    })
    .then((upstream) => {
      const crHeader = upstream.headers["content-range"] as string | undefined;
      const totalSize = parseContentRangeTotal(crHeader);
      const stream = upstream.data as NodeJS.ReadableStream;

      if (!totalSize) {
        destroy(stream);
        preWarmInFlight.delete(url);
        return;
      }

      const buf: Buffer[] = [];
      let bufBytes = 0;
      let done = false;

      function finish() {
        if (done) return;
        done = true;
        preWarmInFlight.delete(url);
        if (bufBytes > 0) {
          const ok = parkStream(url, stream, bufBytes, totalSize, buf, bufBytes, 0, PRE_WARM_TTL_MS);
          if (ok) {
            console.log(`[pre-warm] Buffered ${bufBytes} bytes for ${url.substring(0, 80)}...`);
          }
        } else {
          const ok = parkStream(url, stream, 0, totalSize, [], 0, 0, PRE_WARM_TTL_MS);
          if (ok) {
            console.log(`[pre-warm] Parked connection (0 bytes buffered) for ${url.substring(0, 80)}...`);
          }
        }
      }

      stream.on("data", (chunk: Buffer) => {
        if (done) return;
        buf.push(chunk);
        bufBytes += chunk.length;
        if (bufBytes >= PRE_WARM_MAX_BYTES) finish();
      });
      stream.on("end", () => {
        if (!done) {
          done = true;
          preWarmInFlight.delete(url);
        }
      });
      stream.on("error", () => {
        if (!done) {
          done = true;
          destroy(stream);
          preWarmInFlight.delete(url);
        }
      });

      setTimeout(finish, PRE_WARM_COLLECT_MS);
    })
    .catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[pre-warm] Failed for ${url.substring(0, 80)}: ${msg}`);
      preWarmInFlight.delete(url);
    });
}

/**
 * Create and configure Express app
 */
export function createServer(
  config: ServerConfig,
  rdClient: RealDebridClient,
  cacheManager: CacheManager,
  localLibrary: LocalLibraryManager,
  options?: { urlValidator?: (url: string) => boolean }
): express.Application {
  const isUrlAllowedForProxy = options?.urlValidator ?? isRealDebridCdnUrl;
  const app = express();
  // Trust one proxy hop (nginx reverse proxy sets X-Forwarded-For)
  app.set("trust proxy", 1);
  const clientActivity = new ClientActivityManager(config);

  app.use(express.json({ limit: "2mb" }));

  // Enable CORS for Stremio + local-library admin from Electron
  app.use(
    cors({
      origin: "*",
      credentials: true,
      methods: ["GET", "POST", "OPTIONS", "PATCH", "DELETE", "HEAD"],
      allowedHeaders: ["Content-Type", "Authorization", "X-Stremio-Addon-Password"],
    })
  );

  // Request logging middleware
  app.use((req: Request, _res: Response, next: NextFunction) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url} from ${req.ip}`);
    next();
  });

  // Rate limiting configuration
  const streamRateLimiter = rateLimit({
    windowMs: config.rateLimits.streamWindow,
    max: config.rateLimits.streamMax,
    message: {
      error: "Too many stream requests",
      message: `You've exceeded the rate limit. Please try again in a few minutes.`,
      retryAfter: "15 minutes",
    },
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req: Request, res: Response) => {
      console.log(`⚠️  Rate limit exceeded for IP: ${req.ip} on stream endpoint`);
      res.status(429).json({
        error: "Too many stream requests",
        message: `You've exceeded the rate limit of ${config.rateLimits.streamMax} requests per ${
          config.rateLimits.streamWindow / 60000
        } minutes. Please try again later.`,
        retryAfter: "15 minutes",
      });
    },
  }) as RequestHandler;

  const statsRateLimiter = rateLimit({
    windowMs: config.rateLimits.statsWindow,
    max: config.rateLimits.statsMax,
    message: {
      error: "Too many stats requests",
      message: "You've exceeded the rate limit. Please slow down.",
    },
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req: Request, res: Response) => {
      console.log(`⚠️  Rate limit exceeded for IP: ${req.ip} on stats endpoint`);
      res.status(429).json({
        error: "Too many stats requests",
        message: `You've exceeded the rate limit of ${config.rateLimits.statsMax} requests per minute. Please slow down.`,
      });
    },
  }) as RequestHandler;

  function stripInfoHashForStremioJson(result: StreamResponse): StreamResponse {
    return {
      streams: result.streams.map((s) => {
        const { infoHash: _h, ...rest } = s;
        return rest;
      }),
    };
  }

  function applyProxyToStreamResultForClient(result: StreamResponse, req: Request, password: string): StreamResponse {
    if (!config.proxyRdStreams) return result;
    const playbackBase = resolvePlaybackBaseUrl(req, password, config.domain);
    const proxyBase = `${playbackBase}/proxy`;
    return {
      ...result,
      streams: result.streams.map((stream) => ({
        ...stream,
        url:
          stream.url && isRealDebridCdnUrl(stream.url)
            ? `${proxyBase}?url=${encodeURIComponent(stream.url)}`
            : stream.url,
      })),
    };
  }

  function preWarmIfNeededFromStreamResult(result: StreamResponse): void {
    if (config.proxyRdStreams) {
      const topCdnUrl = result.streams.find((s) => s.url && isRealDebridCdnUrl(s.url))?.url;
      if (topCdnUrl) {
        preWarmUpstream(topCdnUrl);
      }
    }
  }

  // Authentication middleware - checks password in URL path
  function authenticateToken(req: Request, res: Response, next: NextFunction): void {
    if (!config.authEnabled) {
      return next();
    }

    const urlPassword = req.params.password;

    if (urlPassword === config.addonPassword) {
      console.log(`Authentication successful (URL token) from IP: ${req.ip}`);
      return next();
    }

    console.log(`Authentication failed from IP: ${req.ip} - Invalid token`);
    res.status(401).json({
      error: "Authentication required",
      message: "Invalid or missing authentication token in URL",
    });
  }

  // Routes

  // Landing page (public - no auth required)
  app.get("/", (_req: Request, res: Response) => {
    try {
      const landingPath = path.join(path.dirname(__dirname), "landing.html");
      if (fs.existsSync(landingPath)) {
        const landingHTML = fs.readFileSync(landingPath, "utf8");
        res.send(landingHTML);
      } else {
        res.send(`
          <html>
            <head><title>Real-Debrid Passthrough Addon</title></head>
            <body style="font-family: Arial; padding: 50px; text-align: center;">
              <h1>Real-Debrid Passthrough Addon</h1>
              <p>Status: Online ✓</p>
              <p>Visit /stats for statistics</p>
            </body>
          </html>
        `);
      }
    } catch (error) {
      console.error("Error loading landing page:", error);
      res.status(500).send("Error loading landing page");
    }
  });

  // Health check endpoint (public - no auth or rate limiting)
  app.get("/health", (_req: Request, res: Response) => {
    res.json({
      status: "ok",
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      memory: {
        heapUsed: `${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)} MB`,
        heapTotal: `${(process.memoryUsage().heapTotal / 1024 / 1024).toFixed(2)} MB`,
      },
    });
  });

  // Stats API endpoint (with rate limiting)
  app.get("/stats", statsRateLimiter, (_req: Request, res: Response) => {
    const memoryUsage = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2);

    // Check if Real-Debrid token is configured (not empty, not placeholder)
    const hasValidToken =
      config.rdApiToken && config.rdApiToken.trim().length > 0 && config.rdApiToken !== "YOUR_REAL_DEBRID_TOKEN_HERE";

    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.json({
      addonStatus: "online",
      rdConnected: hasValidToken,
      cacheStats: cacheManager.getStats(),
      cacheSizes: cacheManager.getSizes(),
      memoryUsage: `${memoryUsage} MB`,
      version: manifest.version,
      uptime: process.uptime(),
      torrentLimit: config.torrentLimit,
    });
  });

  // Protected routes with password in path (/:password/...)

  // Handle OPTIONS preflight for manifest endpoint
  app.options("/:password/manifest.json", (_req: Request, res: Response) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.setHeader("Access-Control-Max-Age", "86400");
    res.status(204).send();
  });

  // Manifest endpoint
  app.get("/:password/manifest.json", authenticateToken, (req: Request, res: Response) => {
    clientActivity.recordManifest(req);
    const password = req.params.password;

    // Path-aware external base (ADDON_DOMAIN may include Gateway /svc-xxx/ prefix)
    const baseUrl = resolvePlaybackBaseUrl(req, password, config.domain);

    const manifestCore = localLibrary.enabled ? getManifestWithLocalLibrary() : manifest;

    // Return manifest with behaviorHints - match legacy code exactly
    const manifestWithBase = {
      ...manifestCore,
      behaviorHints: {
        configurable: false,
        configurationRequired: false,
      },
    };

    console.log(`Serving manifest with base URL: ${baseUrl}`);

    // Ensure proper Content-Type and CORS headers are set explicitly
    // Use charset for maximum compatibility across platforms (TV, desktop, mobile)
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

    res.json(manifestWithBase);
  });

  function sendStremioCorsJson(res: Response): void {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  }

  // ── Local library catalog / meta (Stremio Discover) ───────────────────────
  app.options("/:password/catalog/:type/:catalogId/:extraArgs.json", (_req: Request, res: Response) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.setHeader("Access-Control-Max-Age", "86400");
    res.status(204).send();
  });

  app.options("/:password/catalog/:type/:catalogId.json", (_req: Request, res: Response) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.setHeader("Access-Control-Max-Age", "86400");
    res.status(204).send();
  });

  app.options("/:password/meta/:type/:id.json", (_req: Request, res: Response) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.setHeader("Access-Control-Max-Age", "86400");
    res.status(204).send();
  });

  app.get(
    "/:password/catalog/:type/:catalogId/:extraArgs.json",
    authenticateToken,
    statsRateLimiter,
    (req: Request, res: Response) => {
      const extra = parseCatalogExtraArgs(req.params.extraArgs);
      const metas = localLibrary.enabled
        ? buildLocalCatalogMetas(localLibrary.getIndexed(), req.params.type, req.params.catalogId, extra)
        : [];
      sendStremioCorsJson(res);
      res.json({ metas });
    }
  );

  app.get(
    "/:password/catalog/:type/:catalogId.json",
    authenticateToken,
    statsRateLimiter,
    (req: Request, res: Response) => {
      const metas = localLibrary.enabled
        ? buildLocalCatalogMetas(localLibrary.getIndexed(), req.params.type, req.params.catalogId, {
            skip: 0,
          })
        : [];
      sendStremioCorsJson(res);
      res.json({ metas });
    }
  );

  app.get(
    "/:password/meta/:type/:id.json",
    authenticateToken,
    statsRateLimiter,
    async (req: Request, res: Response) => {
      sendStremioCorsJson(res);
      if (!localLibrary.enabled) {
        res.status(404).json({ error: "Local library disabled" });
        return;
      }
      const { type, id } = req.params;
      const meta = await buildLocalMeta(localLibrary.getIndexed(), type, id, (t, i) =>
        getCinemetaMetadata(t, i, cacheManager)
      );
      if (!meta) {
        res.status(404).json({ error: "Not in local library" });
        return;
      }
      res.json({ meta });
    }
  );

  // Handle OPTIONS preflight for stream endpoint
  app.options("/:password/stream/:type/:id.json", (_req: Request, res: Response) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.setHeader("Access-Control-Max-Age", "86400");
    res.status(204).send();
  });

  // ── Video Proxy ───────────────────────────────────────────────────────────
  // Stremio downloads video bytes through this endpoint so that the Pi's IP is
  // the only IP that ever contacts Real-Debrid (both API calls and CDN downloads).
  // Without this, Stremio's player would fetch from the RD CDN directly, exposing
  // the Stremio device's IP and triggering RD's multi-IP suspension detection.
  //
  // Supports Range requests so Stremio can seek within the file.
  // The target URL is validated to be a real-debrid.com domain to prevent this
  // endpoint from being used as an open proxy for arbitrary URLs.

  app.options("/:password/proxy", (_req: Request, res: Response) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Range");
    res.setHeader("Access-Control-Expose-Headers", "Content-Length, Content-Range, Accept-Ranges");
    res.status(204).send();
  });

  // Stremio often probes with HEAD first. Use axios.head so we do not pull the full file from RD.
  app.head("/:password/proxy", authenticateToken, async (req: Request, res: Response) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Expose-Headers", "Content-Length, Content-Range, Accept-Ranges");

    const urlParam = req.query.url as string | undefined;
    if (!urlParam) {
      res.status(400).end();
      return;
    }
    if (!isUrlAllowedForProxy(urlParam)) {
      res.status(403).end();
      return;
    }

    clientActivity.recordProxyProbe(req);

    try {
      const upstream = await axios.head(urlParam, {
        maxRedirects: 10,
        timeout: 30000,
        headers: { "User-Agent": "Mozilla/5.0 (compatible; Stremio/1.0)" },
      });
      res.status(upstream.status);
      const forwardHeaders = ["content-length", "content-range", "accept-ranges", "cache-control"];
      for (const header of forwardHeaders) {
        const value = upstream.headers[header];
        if (value) res.setHeader(header, value as string);
      }
      const upstreamCt = upstream.headers["content-type"] as string | undefined;
      res.setHeader("content-type", videoMimeFromUrl(urlParam) ?? upstreamCt ?? "application/octet-stream");
      res.end();
    } catch {
      res.status(502).end();
    }
  });

  app.get("/:password/proxy", authenticateToken, async (req: Request, res: Response) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Expose-Headers", "Content-Length, Content-Range, Accept-Ranges");

    const urlParam = req.query.url as string | undefined;
    if (!urlParam) {
      res.status(400).json({ error: "url parameter required" });
      return;
    }

    if (!isUrlAllowedForProxy(urlParam)) {
      console.warn(`[proxy] Rejected non-RD URL from ${req.ip}: ${urlParam.substring(0, 80)}`);
      res.status(403).json({ error: "Only real-debrid.com URLs may be proxied" });
      return;
    }

    clientActivity.beginProxy(req);
    let proxySessionDone = false;
    const endProxySession = (): void => {
      if (proxySessionDone) return;
      proxySessionDone = true;
      clientActivity.endProxy(req);
    };
    res.once("finish", endProxySession);
    res.once("close", endProxySession);

    const clientRange = req.headers.range;
    const stallTimeoutMs = config.proxyStallTimeoutMs;
    const maxReconnects = config.proxyMaxReconnects;
    const urlShort = urlParam.substring(0, 80);
    let bytesSent = 0;
    let reconnects = 0;
    let startByte = 0;
    let totalSize = 0;
    let clientDisconnected = false;
    let activeStream: NodeJS.ReadableStream | null = null;
    let stallTimer: ReturnType<typeof setTimeout> | null = null;

    if (clientRange) {
      const m = /bytes=(\d+)-/i.exec(clientRange);
      if (m) startByte = parseInt(m[1], 10);
    }

    // Rolling buffer of recently-streamed bytes — kept in sync during active
    // streaming so that on disconnect we can hand it to parkStream.  Covers
    // the "overshoot" window (bytes the proxy sent but the player hadn't
    // consumed yet), which is where the player will reconnect from.
    const rollingBuf: Buffer[] = [];
    let rollingBufBytes = 0;
    let rollingBufStart = startByte;

    function pushRolling(chunk: Buffer) {
      rollingBuf.push(chunk);
      rollingBufBytes += chunk.length;
      while (rollingBufBytes > ROLLING_BUF_MAX && rollingBuf.length > 1) {
        const ev = rollingBuf.shift()!;
        rollingBufBytes -= ev.length;
        rollingBufStart += ev.length;
      }
    }

    // ── Fast path: reclaim a parked upstream session ──────────────────────
    const parked = reclaimParked(urlParam, startByte);
    if (parked) {
      totalSize = parked.totalSize;
      const remaining = totalSize - startByte;
      res.status(206);
      res.setHeader("content-range", `bytes ${startByte}-${totalSize - 1}/${totalSize}`);
      res.setHeader("content-length", String(remaining));
      res.setHeader("accept-ranges", "bytes");
      res.setHeader("content-type", videoMimeFromUrl(urlParam) ?? "application/octet-stream");

      // Drain buffered data to the client
      let offset = startByte - parked.bufStart;
      for (const chunk of parked.buf) {
        if (offset >= chunk.length) {
          offset -= chunk.length;
          continue;
        }
        const slice = offset > 0 ? chunk.subarray(offset) : chunk;
        offset = 0;
        bytesSent += slice.length;
        pushRolling(slice);
        res.write(slice);
      }
      parked.buf = [];
      parked.bufBytes = 0;

      console.log(`[proxy] Cache hit — served ${bytesSent} buffered bytes at byte ${startByte} for ${urlShort}...`);

      const stream = parked.stream;
      activeStream = stream;
      stream.removeAllListeners("end");
      stream.removeAllListeners("error");

      req.on("close", () => {
        clientDisconnected = true;
        stream.removeAllListeners("data");
        stream.removeAllListeners("end");
        stream.removeAllListeners("error");
        let reparked = false;
        if (!parked.ended) {
          reparked = parkStream(
            urlParam,
            stream,
            startByte + bytesSent,
            totalSize,
            rollingBuf,
            rollingBufBytes,
            rollingBufStart
          );
        } else {
          destroy(stream);
        }
        console.log(
          `[proxy] Client disconnected after ${bytesSent} bytes (cache-resumed` +
            `${reparked ? ", re-parked" : ""}) url=${urlShort}...`
        );
      });

      stream.on("data", (chunk: Buffer) => {
        if (clientDisconnected) return;
        bytesSent += chunk.length;
        pushRolling(chunk);
        if (!res.write(chunk)) {
          stream.pause();
          res.once("drain", () => {
            if (!clientDisconnected) stream.resume();
          });
        }
      });

      stream.on("end", () => {
        activeStream = null;
        if (!clientDisconnected) {
          console.log(`[proxy] Stream complete — ${bytesSent} bytes (cache-resumed) url=${urlShort}...`);
          res.end();
        }
      });

      stream.on("error", (err: Error) => {
        activeStream = null;
        console.error(`[proxy] Upstream error (cache-resumed): ${err.message} url=${urlShort}...`);
        if (!clientDisconnected && !res.writableEnded) res.end();
      });

      (stream as NodeJS.ReadableStream & { resume?: () => void }).resume?.();
      return;
    }

    // ── Standard path: fresh upstream connection ─────────────────────────

    req.on("close", () => {
      clientDisconnected = true;
      if (stallTimer) clearTimeout(stallTimer);
      if (activeStream) {
        if (totalSize > 0) {
          const s = activeStream;
          activeStream = null;
          s.removeAllListeners("data");
          s.removeAllListeners("end");
          s.removeAllListeners("error");
          const didPark = parkStream(
            urlParam,
            s,
            startByte + bytesSent,
            totalSize,
            rollingBuf,
            rollingBufBytes,
            rollingBufStart
          );
          console.log(
            didPark
              ? `[proxy] Parked upstream at byte ${startByte + bytesSent} ` +
                  `(buf ${rollingBufBytes} bytes from ${rollingBufStart}) url=${urlShort}...`
              : `[proxy] Discarded upstream at byte ${startByte + bytesSent} ` +
                  `(buf ${rollingBufBytes} bytes, kept larger park) url=${urlShort}...`
          );
        } else {
          destroy(activeStream);
          console.log(
            `[proxy] Client disconnected after ${bytesSent} bytes (${reconnects} reconnects) url=${urlShort}...`
          );
        }
      }
    });

    async function connectAndPipe(fromByte: number, isReconnect: boolean): Promise<void> {
      if (clientDisconnected) return;

      const upstream = await axios.get(urlParam!, {
        responseType: "stream",
        httpAgent: rdStreamAgent,
        httpsAgent: rdStreamAgentHttps,
        headers: {
          Range: `bytes=${fromByte}-`,
          "User-Agent": "Mozilla/5.0 (compatible; Stremio/1.0)",
        },
        timeout: 0,
        maxRedirects: 10,
      });

      if (!isReconnect) {
        res.status(upstream.status);

        const forwardHeaders = ["content-length", "content-range", "accept-ranges", "cache-control"];
        for (const header of forwardHeaders) {
          const value = upstream.headers[header];
          if (value) res.setHeader(header, value as string);
        }

        const upstreamCt = upstream.headers["content-type"] as string | undefined;
        const correctMime = videoMimeFromUrl(urlParam!) ?? upstreamCt ?? "application/octet-stream";
        res.setHeader("content-type", correctMime);

        const crHeader = upstream.headers["content-range"] as string | undefined;
        startByte = parseContentRangeStart(crHeader);
        totalSize = parseContentRangeTotal(crHeader);

        if (!clientRange || clientRange === "bytes=0-") {
          console.log(
            `[proxy] ${upstream.status} content-type=${correctMime} (upstream=${upstreamCt ?? "?"}) url=${urlShort}...`
          );
        }
      } else {
        console.log(`[proxy] Reconnect #${reconnects} at byte ${fromByte} for ${urlShort}...`);
      }

      const stream = upstream.data as NodeJS.ReadableStream;
      activeStream = stream;

      return new Promise<void>((resolve, reject) => {
        function clearStall() {
          if (stallTimer) {
            clearTimeout(stallTimer);
            stallTimer = null;
          }
        }

        function resetStallTimer() {
          clearStall();
          if (clientDisconnected) return;
          stallTimer = setTimeout(() => {
            if (clientDisconnected) return;
            console.warn(
              `[proxy] Stall detected — no data for ${stallTimeoutMs}ms at byte ${startByte + bytesSent} ` +
                `(reconnect ${reconnects}/${maxReconnects}) url=${urlShort}...`
            );
            destroy(stream);
            resolve();
          }, stallTimeoutMs);
        }

        resetStallTimer();

        stream.on("data", (chunk: Buffer) => {
          resetStallTimer();
          bytesSent += chunk.length;
          pushRolling(chunk);
          if (!res.write(chunk)) {
            stream.pause();
            res.once("drain", () => {
              if (!clientDisconnected) stream.resume();
            });
          }
        });

        stream.on("end", () => {
          clearStall();
          activeStream = null;
          console.log(
            `[proxy] Stream complete — ${bytesSent} bytes sent (${reconnects} reconnects) url=${urlShort}...`
          );
          res.end();
          reject(new Error("__STREAM_COMPLETE__"));
        });

        stream.on("error", (err: Error) => {
          clearStall();
          activeStream = null;
          console.error(`[proxy] Upstream error at byte ${startByte + bytesSent}: ${err.message} url=${urlShort}...`);
          resolve();
        });

        req.on("close", () => {
          clearStall();
          reject(new Error("__CLIENT_CLOSED__"));
        });
      });
    }

    try {
      let initialByte = startByte;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        try {
          await connectAndPipe(initialByte, initialByte !== startByte);
        } catch (err) {
          const msg = err instanceof Error ? err.message : "";
          if (msg === "__STREAM_COMPLETE__" || msg === "__CLIENT_CLOSED__") break;
          throw err;
        }

        if (clientDisconnected) break;
        if (reconnects >= maxReconnects) {
          console.error(
            `[proxy] Giving up after ${reconnects} reconnects at byte ${startByte + bytesSent} url=${urlShort}...`
          );
          res.end();
          break;
        }

        reconnects++;
        initialByte = startByte + bytesSent;
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg !== "__CLIENT_CLOSED__") {
        console.error(`[proxy] Request failed: ${msg}`);
      }
      if (!res.headersSent) {
        res.status(502).json({ error: "Failed to fetch from upstream" });
      } else if (!res.writableEnded) {
        res.end();
      }
    }
  });

  // ── Debug: torrent-source probe ──────────────────────────────────────────
  // GET /:password/debug/search?type=series&id=tt0409591:2:42
  // Tests each torrent source independently and returns raw results so you can
  // diagnose why a particular piece of content returns 0 streams.
  //
  // NOTE: The RD token is intentionally NOT sent to Torrentio here.
  // Sending the token to third-party servers causes RD to detect multiple public IPs
  // and suspend the account. All RD filtering is done locally via getCachedAvailability.
  app.get("/:password/debug/search", authenticateToken, async (req: Request, res: Response) => {
    const type = req.query.type as string;
    const id = req.query.id as string;
    if (!type || !id) {
      res.json({ error: "Pass ?type=series&id=tt0409591:2:42 (or type=movie)" });
      return;
    }

    const configQuality = "sort=qualitysize%7Clanguage=hebrew,english";
    const configSeeders = "sort=seeders%7Clanguage=hebrew,english";

    async function probe(_label: string, url: string) {
      const start = Date.now();
      try {
        const r = await axios.get(url, { timeout: 15000, headers: { "User-Agent": "Stremio" } });
        const streams: unknown[] = r.data?.streams ?? [];
        return {
          ok: true,
          ms: Date.now() - start,
          count: streams.length,
          samples: streams.slice(0, 3),
          url,
        };
      } catch (e) {
        return {
          ok: false,
          ms: Date.now() - start,
          error: e instanceof Error ? e.message : String(e),
          url,
        };
      }
    }

    const [byQuality, bySeeders] = await Promise.all([
      probe("Torrentio/quality", `https://torrentio.strem.fun/${configQuality}/stream/${type}/${id}.json`),
      probe("Torrentio/seeders", `https://torrentio.strem.fun/${configSeeders}/stream/${type}/${id}.json`),
    ]);

    res.json({
      query: { type, id },
      sources: { torrentioByQuality: byQuality, torrentioBySeeders: bySeeders },
    });
  });

  registerLocalLibraryRoutes(app, config, authenticateToken, localLibrary);

  // Public streaming instances leave ENABLE_MANAGEMENT_API unset/false — no /management/**.
  if (config.enableManagementApi) {
    registerManagementRoutes(app, {
      config,
      rdClient,
      cacheManager,
      localLibrary,
      authenticateToken,
      statsRateLimiter,
      streamRateLimiter,
      preWarmIfNeeded: preWarmIfNeededFromStreamResult,
      clientActivity,
    });
  }

  // Pending download status page — opened when Stremio user clicks the ⏳ placeholder stream
  app.get("/:password/pending-status/:type/:encId", authenticateToken, (req: Request, res: Response): void => {
    const id = decodeURIComponent(req.params.encId);
    const type = req.params.type;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(
      `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>RD Downloading</title>` +
        `<meta name="viewport" content="width=device-width,initial-scale=1">` +
        `<style>body{font-family:sans-serif;text-align:center;padding:40px;background:#111;color:#eee}` +
        `h2{color:#f5a623}p{color:#aaa}</style></head>` +
        `<body><h2>⏳ Real-Debrid is downloading this content</h2>` +
        `<p><strong>${type}/${id}</strong></p>` +
        `<p>Torrent has been queued on Real-Debrid.<br>Come back in a few minutes and refresh streams in Stremio.</p>` +
        `</body></html>`
    );
  });

  // Stream endpoint (with rate limiting)
  app.get(
    "/:password/stream/:type/:id.json",
    authenticateToken,
    streamRateLimiter,
    async (req: Request, res: Response) => {
      const { type, id } = req.params;
      const requestCacheKey = `request_${type}_${id}`;
      const peeked = cacheManager.peekStream(requestCacheKey) as { streams?: unknown[] } | undefined;
      const hadCached = Boolean(peeked && Array.isArray(peeked.streams) && peeked.streams.length > 0);
      const t0 = Date.now();
      clientActivity.beginStreamFetch(req);
      try {
        const playbackBase = resolvePlaybackBaseUrl(req, req.params.password, config.domain);
        const clientIp = clientIpFromReq(req) ?? "unknown";

        // Viewer capacity gate — skip if cache already has streams (existing viewer re-requesting)
        if (!hadCached && clientActivity.isAtCapacity(config.maxConcurrentViewers, clientIp)) {
          const active = clientActivity.getTotalActiveViewerCount();
          console.log(`[capacity] Blocked ${clientIp} — ${active}/${config.maxConcurrentViewers} active viewers`);
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.setHeader("Access-Control-Allow-Origin", "*");
          res.json({ streams: [] });
          return;
        }

        const result = await handleStreamRequest(
          { type, id, baseUrl: playbackBase },
          rdClient,
          cacheManager,
          config,
          false,
          localLibrary.enabled ? { manager: localLibrary, playbackBase } : undefined
        );
        clientActivity.recordStreamResult(req, result);

        // Register a TorBox lease so this IP counts as an active viewer for 2 hours
        if (result.streams.some((s) => s.behaviorHints?.bingeGroup === "torbox")) {
          clientActivity.beginTorBoxLease(clientIp);
        }

        const durationMs = Date.now() - t0;
        const infoHashes = uniqueInfoHashes(result.streams);
        const title = result.streams[0]?.name ?? null;
        const seriesName = result.logContext?.showName ?? null;
        void appendRequestLog(config, {
          kind: "stream",
          type,
          stremioId: id,
          cacheHit: hadCached,
          durationMs,
          streamCount: result.streams.length,
          title,
          seriesName,
          clientIp: clientIpFromReq(req),
          error: null,
          infoHashes,
        }).catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          console.error("request log append failed:", msg);
        });

        const withoutHash = stripInfoHashForStremioJson(result);
        let finalResult = applyProxyToStreamResultForClient(withoutHash, req, req.params.password);
        preWarmIfNeededFromStreamResult(result);

        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

        res.json(finalResult);
      } catch (error) {
        console.error("Stream endpoint error:", error);
        const msg = error instanceof Error ? error.message : String(error);
        void appendRequestLog(config, {
          kind: "stream",
          type,
          stremioId: id,
          cacheHit: hadCached,
          durationMs: Date.now() - t0,
          streamCount: 0,
          title: null,
          seriesName: null,
          clientIp: clientIpFromReq(req),
          error: msg,
          infoHashes: [],
        }).catch((err: unknown) => {
          const m = err instanceof Error ? err.message : String(err);
          console.error("request log append failed:", m);
        });
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.status(500).json({ streams: [] });
      } finally {
        clientActivity.endStreamFetch(req);
      }
    }
  );

  return app;
}
