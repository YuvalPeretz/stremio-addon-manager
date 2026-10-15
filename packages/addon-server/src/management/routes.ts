/**
 * Management UI: static assets + JSON API
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Request, RequestHandler, Response, Application } from "express";
import type { ServerConfig } from "../config.js";
import type { CacheManager } from "../cache.js";
import type { RealDebridClient } from "../real-debrid.js";
import { handleStreamRequest } from "../stream-handler.js";
import type { LocalLibraryManager } from "../local-library/manager.js";
import type { StreamResponse } from "../types.js";
import {
  appendRequestLog,
  getRequestById,
  listRequestLogs,
  clientIpFromReq,
  uniqueInfoHashes,
  normalizeSeriesName,
  aggregateRequestLogByClient,
} from "./request-log.js";
import type { ClientActivityManager } from "./client-activity.js";
import { invalidateForStreamRequery, listRelatedStreamCacheKeyNames } from "./invalidate-caches.js";
import { listServerLogs } from "./server-log.js";
import { getConfigSchema, getRedactedConfig, getRuntimeStatus } from "./config-api.js";
import { loadDeployScripts } from "./deploy-scripts.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Static UI lives in `dist/management/` (copied at build from repo `management/`)
 * so deploys that only copy `dist/` still work. Fallback: package-root `management/`
 * for `tsc` without the copy step.
 */
function managementStaticDir(): string {
  const fromDist = path.join(__dirname, "management.html");
  if (fs.existsSync(fromDist)) {
    return __dirname;
  }
  return path.join(__dirname, "..", "..", "management");
}

function isRealDebridCdnUrl(url: string): boolean {
  return /^https?:\/\/[^/]*\.real-debrid\.com\//i.test(url);
}

function stripInfoHashForClient(result: StreamResponse): StreamResponse {
  return {
    streams: result.streams.map((s) => {
      // Strip optional infoHash for JSON clients (Stremio)
      // eslint-disable-next-line @typescript-eslint/no-unused-vars -- rest omit
      const { infoHash, ...rest } = s;
      return rest;
    }),
  };
}

function applyProxyToStreams(
  result: StreamResponse,
  config: ServerConfig,
  req: Request,
  password: string
): StreamResponse {
  if (!config.proxyRdStreams) return result;
  const protocol = (req.headers["x-forwarded-proto"] as string) || req.protocol;
  const host = (req.headers["x-forwarded-host"] as string) || req.get("host");
  const playbackBase = `${protocol}://${host}/${password}`;
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

export function registerManagementRoutes(
  app: Application,
  opts: {
    config: ServerConfig;
    rdClient: RealDebridClient;
    cacheManager: CacheManager;
    localLibrary: LocalLibraryManager;
    authenticateToken: RequestHandler;
    statsRateLimiter: RequestHandler;
    streamRateLimiter: RequestHandler;
    preWarmIfNeeded: (rawResult: StreamResponse) => void;
    clientActivity: ClientActivityManager;
  }
): void {
  const { config, rdClient, localLibrary, authenticateToken, statsRateLimiter, streamRateLimiter, preWarmIfNeeded } =
    opts;
  const { clientActivity } = opts;
  const cache: CacheManager = opts.cacheManager;
  const staticDir = managementStaticDir();

  function sendManagementHtml(_req: Request, res: Response): void {
    const p = path.join(staticDir, "management.html");
    if (!fs.existsSync(p)) {
      res.status(500).send("Management UI not found on server");
      return;
    }
    res.type("html").send(fs.readFileSync(p, "utf8"));
  }

  const assetTypes: Record<string, string> = {
    ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
  };

  // Pages + assets (password in path)
  app.get("/:password/management", authenticateToken, sendManagementHtml);
  app.get("/:password/management/", authenticateToken, sendManagementHtml);
  app.get("/:password/management/assets/:name", authenticateToken, (req: Request, res: Response) => {
    const name = String(req.params.name);
    if (!/^[a-zA-Z0-9._-]+$/.test(name) || name.includes("..")) {
      res.status(400).end();
      return;
    }
    const filePath = path.join(staticDir, "assets", name);
    if (!filePath.startsWith(path.join(staticDir, "assets"))) {
      res.status(400).end();
      return;
    }
    if (!fs.existsSync(filePath)) {
      res.status(404).end();
      return;
    }
    const ext = path.extname(name);
    if (ext && assetTypes[ext]) {
      res.type(ext.slice(1));
    }
    res.setHeader("Content-Type", assetTypes[ext] ?? "application/octet-stream");
    res.send(fs.readFileSync(filePath));
  });

  app.get(
    "/:password/management/api/requests",
    authenticateToken,
    statsRateLimiter,
    async (req: Request, res: Response) => {
      const q = req.query as Record<string, string | undefined>;
      const kindP = q.kind;
      const kind =
        kindP === "stream" || kindP === "remake" || kindP === "torbox" ? kindP : undefined;
      const sortP = q.sort;
      const sort = sortP === "at" || sortP === "durationMs" || sortP === "streamCount" ? sortP : undefined;
      const orderP = q.order;
      const order = orderP === "asc" || orderP === "desc" ? orderP : undefined;
      const out = await listRequestLogs(config, {
        q: q.q,
        kind,
        sort,
        order,
        from: q.from != null && q.from !== "" ? parseInt(q.from, 10) : 0,
        limit: q.limit != null && q.limit !== "" ? parseInt(q.limit, 10) : 200,
      });
      res.json(out);
    }
  );

  app.get(
    "/:password/management/api/requests/:entryId",
    authenticateToken,
    statsRateLimiter,
    async (req: Request, res: Response) => {
      const entry = await getRequestById(config, req.params.entryId);
      if (!entry) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      res.json({
        entry,
        relatedCacheKeys: listRelatedStreamCacheKeyNames(entry.type, entry.stremioId, entry.infoHashes),
      });
    }
  );

  app.post(
    "/:password/management/api/requests/:entryId/remake",
    authenticateToken,
    streamRateLimiter,
    async (req: Request, res: Response) => {
      const entry = await getRequestById(config, req.params.entryId);
      if (!entry) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      if (entry.kind !== "stream" && entry.kind !== "remake") {
        res.status(400).json({ error: "invalid_entry_kind" });
        return;
      }

      const t0 = Date.now();
      invalidateForStreamRequery(cache, entry.type, entry.stremioId, entry.infoHashes);

      const password = req.params.password;
      const protocol = (req.headers["x-forwarded-proto"] as string) || req.protocol;
      const host = (req.headers["x-forwarded-host"] as string) || req.get("host");
      const playbackBase = `${protocol}://${host}/${password}`;

      let raw: StreamResponse;
      try {
        raw = await handleStreamRequest(
          { type: entry.type, id: entry.stremioId },
          rdClient,
          cache,
          config,
          false,
          localLibrary.enabled ? { manager: localLibrary, playbackBase } : undefined
        );
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        const logEntry = await appendRequestLog(config, {
          kind: "remake",
          type: entry.type,
          stremioId: entry.stremioId,
          cacheHit: false,
          durationMs: Date.now() - t0,
          streamCount: 0,
          title: entry.title,
          seriesName: normalizeSeriesName(entry.seriesName),
          clientIp: clientIpFromReq(req),
          error: msg,
          infoHashes: [],
          remadeFromId: entry.id,
        });
        res.status(500).json({ error: "handler_failed", message: msg, logId: logEntry.id });
        return;
      }

      preWarmIfNeeded(raw);

      const forClient = applyProxyToStreams(stripInfoHashForClient(raw), config, req, password);
      const hashes = uniqueInfoHashes(raw.streams);
      const title = raw.streams[0]?.name ?? entry.title;
      const seriesName = normalizeSeriesName(raw.logContext?.showName) ?? normalizeSeriesName(entry.seriesName);
      const logEntry = await appendRequestLog(config, {
        kind: "remake",
        type: entry.type,
        stremioId: entry.stremioId,
        cacheHit: false,
        durationMs: Date.now() - t0,
        streamCount: raw.streams.length,
        title,
        seriesName,
        clientIp: clientIpFromReq(req),
        error: null,
        infoHashes: hashes,
        remadeFromId: entry.id,
      });

      res.json({
        ok: true,
        newLogId: logEntry.id,
        durationMs: logEntry.durationMs,
        streamCount: forClient.streams.length,
        remadeFromId: entry.id,
        preview: forClient,
      });
    }
  );

  app.get(
    "/:password/management/api/clients",
    authenticateToken,
    statsRateLimiter,
    async (_req: Request, res: Response) => {
      const live = clientActivity.getLiveRows();
      const fromLog = await aggregateRequestLogByClient(config, 200);
      res.json({
        serverTime: new Date().toISOString(),
        live,
        fromLog,
      });
    }
  );

  app.get(
    "/:password/management/api/logs",
    authenticateToken,
    statsRateLimiter,
    async (req: Request, res: Response) => {
      const q = req.query as Record<string, string | undefined>;
      const levelRaw = q.level?.trim().toLowerCase();
      const level =
        levelRaw === "log" ||
        levelRaw === "info" ||
        levelRaw === "warn" ||
        levelRaw === "error" ||
        levelRaw === "debug" ||
        levelRaw === "all"
          ? levelRaw
          : undefined;
      const linesRaw = q.lines != null && q.lines !== "" ? parseInt(q.lines, 10) : 400;
      const out = await listServerLogs(config, {
        lines: Number.isFinite(linesRaw) ? linesRaw : 400,
        q: q.q,
        level: level === "all" ? "all" : level,
      });
      res.json({
        ...out,
        serverTime: new Date().toISOString(),
      });
    }
  );

  app.get(
    "/:password/management/api/cache",
    authenticateToken,
    statsRateLimiter,
    (_req: Request, res: Response) => {
      res.json({
        stats: cache.getStats(),
        sizes: cache.getSizes(),
        ttlSec: {
          metadata: config.cacheTtl.metadata,
          torrentSearch: config.cacheTtl.torrentSearch,
          streams: config.cacheTtl.streams,
        },
      });
    }
  );

  type ClearLayer = "metadata" | "torrentSearch" | "stream" | "all";
  function isClearLayer(x: unknown): x is ClearLayer {
    return x === "metadata" || x === "torrentSearch" || x === "stream" || x === "all";
  }

  app.post(
    "/:password/management/api/cache/clear",
    authenticateToken,
    streamRateLimiter,
    (req: Request, res: Response) => {
      const body = req.body as { layer?: unknown };
      const layer = body.layer;
      if (!isClearLayer(layer)) {
        res.status(400).json({ error: "invalid_layer", message: "layer must be metadata, torrentSearch, stream, or all" });
        return;
      }
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call -- instance from opts
      cache.clearLayer(layer);
      res.json({ ok: true, sizesAfter: cache.getSizes() });
    }
  );

  // ── Admin GET APIs (custom-script / dual-app); no PUT/mutate for config or scripts ──

  app.get(
    "/:password/management/api/deploy/scripts",
    authenticateToken,
    statsRateLimiter,
    (_req: Request, res: Response) => {
      res.json(loadDeployScripts(config));
    }
  );

  app.get(
    "/:password/management/api/config",
    authenticateToken,
    statsRateLimiter,
    (_req: Request, res: Response) => {
      res.json({
        config: getRedactedConfig(config),
        serverTime: new Date().toISOString(),
      });
    }
  );

  app.get(
    "/:password/management/api/config/schema",
    authenticateToken,
    statsRateLimiter,
    (_req: Request, res: Response) => {
      res.json({
        schema: getConfigSchema(),
        serverTime: new Date().toISOString(),
      });
    }
  );

  app.get(
    "/:password/management/api/runtime",
    authenticateToken,
    statsRateLimiter,
    (_req: Request, res: Response) => {
      res.json(getRuntimeStatus(config, cache));
    }
  );
}
