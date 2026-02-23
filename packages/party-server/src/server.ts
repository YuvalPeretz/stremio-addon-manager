/**
 * Express HTTP Server - REST API for party viewing
 */

import express, { type Request, type Response } from "express";
import cors from "cors";
import axios from "axios";
import type { PartyConfig } from "./config.js";
import type { SessionManager } from "./session-manager.js";
import type { SyncEngine } from "./sync-engine.js";
import { validateAddon } from "./auth.js";
import { searchContent, getSeriesEpisodes, resolveStream, getAvailableStreams } from "./search.js";
import { fetchSubtitles } from "./subtitle-proxy.js";
import type {
  CreateSessionRequest,
  ResolveStreamRequest,
  SessionContent,
  Subtitle,
} from "./types.js";

export function createServer(
  config: PartyConfig,
  sessionManager: SessionManager,
  syncEngine: SyncEngine
): express.Application {
  const app = express();

  app.use(cors({ origin: "*", credentials: true }));
  app.use(express.json());

  // Request logging
  app.use((req: Request, _res: Response, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
    next();
  });

  // ─── Public Endpoints ────────────────────────────────────

  app.get("/", (_req: Request, res: Response) => {
    res.json({ status: "on" });
  });

  // ─── Video Proxy ──────────────────────────────────────────
  // Real-Debrid (and similar CDNs) don't set CORS headers, so the browser
  // cannot play those URLs directly from addon-party.web.app.
  // This endpoint proxies the video bytes server-side and adds CORS headers.

  app.options("/api/proxy", (_req: Request, res: Response) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Range");
    res.setHeader("Access-Control-Expose-Headers", "Content-Length, Content-Range, Accept-Ranges");
    res.status(204).send();
  });

  app.get("/api/proxy", async (req: Request, res: Response) => {
    const urlParam = req.query.url as string | undefined;
    if (!urlParam) {
      res.status(400).json({ error: "url parameter required" });
      return;
    }

    try {
      // req.query.url is already URL-decoded by Express's query parser.
      // Do NOT call decodeURIComponent again — double-decoding turns %20 into
      // literal spaces, making the URL invalid (axios throws → Nginx 502).
      const targetUrl = urlParam;
      const range = req.headers.range;

      const upstream = await axios.get(targetUrl, {
        responseType: "stream",
        headers: {
          ...(range ? { Range: range } : {}),
          "User-Agent": "Mozilla/5.0 (compatible; StremioParty/1.0)",
        },
        timeout: 30000,
        maxRedirects: 10,
      });

      res.status(upstream.status);
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Expose-Headers", "Content-Length, Content-Range, Accept-Ranges");

      const forwardHeaders = [
        "content-type",
        "content-length",
        "content-range",
        "accept-ranges",
        "cache-control",
      ];
      for (const header of forwardHeaders) {
        const value = upstream.headers[header];
        if (value) res.setHeader(header, value as string);
      }

      const stream = upstream.data as NodeJS.ReadableStream;

      // If the upstream stream errors after we've already started sending headers,
      // we can't send a new HTTP response — just destroy the socket.
      stream.on("error", (err: Error) => {
        console.error("Upstream stream error:", err.message);
        if (!res.headersSent) {
          res.status(502).json({ error: "Stream error" });
        } else {
          res.destroy();
        }
      });

      stream.pipe(res);

      // Stop fetching from Real-Debrid if the client disconnects
      req.on("close", () => {
        (stream as NodeJS.ReadableStream & { destroy?: () => void }).destroy?.();
      });
    } catch (error) {
      if (!res.headersSent) {
        console.error("Proxy error:", error instanceof Error ? error.message : error);
        res.status(502).json({ error: "Failed to proxy stream" });
      }
    }
  });

  app.get("/health", (_req: Request, res: Response) => {
    res.json({
      status: "ok",
      uptime: process.uptime(),
      sessions: sessionManager.getSessionCount(),
      timestamp: new Date().toISOString(),
      memory: {
        heapUsed: `${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)} MB`,
      },
    });
  });

  app.get("/api/sessions", (_req: Request, res: Response) => {
    const sessions = sessionManager.listSessions();
    res.json({ sessions });
  });

  // ─── Addon Validation ────────────────────────────────────

  app.post("/api/validate-addon", async (req: Request, res: Response) => {
    try {
      const { addonUrl, password } = req.body as { addonUrl?: string; password?: string };

      if (!addonUrl) {
        res.status(400).json({ error: "addonUrl is required" });
        return;
      }

      const result = await validateAddon(addonUrl, password, config.addonPort);
      res.json(result);
    } catch (error) {
      console.error("Validate addon error:", error);
      res.status(500).json({ error: "Validation failed" });
    }
  });

  // ─── Session Management ──────────────────────────────────

  app.post("/api/sessions", async (req: Request, res: Response) => {
    try {
      const { addonUrl, addonPassword, sessionName } = req.body as CreateSessionRequest;

      if (!addonUrl || addonPassword === undefined || addonPassword === null || !sessionName) {
        res.status(400).json({ error: "addonUrl, addonPassword, and sessionName are required" });
        return;
      }

      // Validate the addon first
      const validation = await validateAddon(addonUrl, addonPassword, config.addonPort);
      if (!validation.valid) {
        res.status(401).json({ error: validation.error || "Invalid addon credentials" });
        return;
      }

      const { session, adminToken } = sessionManager.createSession(
        addonUrl,
        addonPassword,
        sessionName
      );

      // Determine base URL for join/ws URLs
      const protocol = (req.headers["x-forwarded-proto"] as string) || req.protocol;
      const host = (req.headers["x-forwarded-host"] as string) || req.get("host");
      const wsProtocol = protocol === "https" ? "wss" : "ws";

      res.status(201).json({
        sessionId: session.id,
        adminToken,
        joinUrl: `${protocol}://${host}/api/sessions/${session.id}`,
        wsUrl: `${wsProtocol}://${host}/ws/${session.id}`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to create session";
      console.error("Create session error:", message);
      res.status(500).json({ error: message });
    }
  });

  app.get("/api/sessions/:id", (req: Request, res: Response) => {
    const session = sessionManager.getSession(req.params.id);
    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    // Require password to view session details
    const password = req.query.password as string | undefined;
    if (session.addonPassword && password !== session.addonPassword) {
      // Allow admin token as alternative
      const adminToken = req.headers["x-admin-token"] as string | undefined;
      if (adminToken !== session.adminToken) {
        res.status(401).json({ error: "Password required" });
        return;
      }
    }

    const publicInfo = sessionManager.toPublicInfo(session);
    const playback = sessionManager.getPlaybackSnapshot(session.id);

    res.json({
      ...publicInfo,
      playback,
      viewers: Array.from(session.viewers.values()).map((v) => ({
        id: v.id,
        displayName: v.displayName,
        role: v.role,
        isConnected: v.isConnected,
      })),
    });
  });

  app.delete("/api/sessions/:id", (req: Request, res: Response) => {
    const adminToken = req.headers["x-admin-token"] as string;
    if (!adminToken) {
      res.status(401).json({ error: "Admin token required" });
      return;
    }

    const session = sessionManager.getSession(req.params.id);
    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    if (session.adminToken !== adminToken) {
      res.status(403).json({ error: "Invalid admin token" });
      return;
    }

    sessionManager.endSession(req.params.id);
    syncEngine.broadcastToSession(req.params.id, {
      type: "SESSION_ENDED",
      payload: { reason: "Host ended the session" },
      timestamp: Date.now(),
    });

    res.json({ success: true });
  });

  // ─── Session Join ────────────────────────────────────────

  app.post("/api/sessions/:id/join", (req: Request, res: Response) => {
    try {
      const { addonPassword, displayName } = req.body as {
        addonPassword: string;
        displayName: string;
      };

      const session = sessionManager.getSession(req.params.id);
      if (!session) {
        res.status(404).json({ error: "Session not found" });
        return;
      }

      if (session.addonPassword && addonPassword !== session.addonPassword) {
        res.status(401).json({ error: "Invalid password" });
        return;
      }

      const { viewer, viewerToken } = sessionManager.addViewer(
        req.params.id,
        displayName || "Guest",
        "guest"
      );

      const protocol = (req.headers["x-forwarded-proto"] as string) || req.protocol;
      const host = (req.headers["x-forwarded-host"] as string) || req.get("host");
      const wsProtocol = protocol === "https" ? "wss" : "ws";

      res.json({
        viewerId: viewer.id,
        viewerToken,
        session: sessionManager.toPublicInfo(session),
        wsUrl: `${wsProtocol}://${host}/ws/${session.id}`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to join session";
      console.error("Join session error:", message);
      res.status(500).json({ error: message });
    }
  });

  // ─── Content Search ──────────────────────────────────────

  app.get("/api/sessions/:id/search", async (req: Request, res: Response) => {
    try {
      const session = sessionManager.getSession(req.params.id);
      if (!session) {
        res.status(404).json({ error: "Session not found" });
        return;
      }

      const query = req.query.q as string;
      const type = req.query.type as "movie" | "series" | undefined;

      if (!query) {
        res.status(400).json({ error: "Query parameter 'q' is required" });
        return;
      }

      const results = await searchContent(query, type);
      res.json({ results });
    } catch (error) {
      console.error("Search error:", error);
      res.status(500).json({ error: "Search failed" });
    }
  });

  app.get("/api/sessions/:id/episodes/:imdbId", async (req: Request, res: Response) => {
    try {
      const session = sessionManager.getSession(req.params.id);
      if (!session) {
        res.status(404).json({ error: "Session not found" });
        return;
      }

      const seasons = await getSeriesEpisodes(req.params.imdbId);
      res.json({ seasons });
    } catch (error) {
      console.error("Episodes error:", error);
      res.status(500).json({ error: "Failed to fetch episodes" });
    }
  });

  // ─── Stream Listing (host picks before committing) ───────

  app.get("/api/sessions/:id/streams", async (req: Request, res: Response) => {
    try {
      const adminToken = req.headers["x-admin-token"] as string;
      const session = sessionManager.getSession(req.params.id);

      if (!session) {
        res.status(404).json({ error: "Session not found" });
        return;
      }

      if (session.adminToken !== adminToken) {
        res.status(403).json({ error: "Only the host can list streams" });
        return;
      }

      const type = req.query.type as "movie" | "series";
      const imdbId = req.query.imdbId as string;
      const season = req.query.season ? parseInt(req.query.season as string, 10) : undefined;
      const episode = req.query.episode ? parseInt(req.query.episode as string, 10) : undefined;

      if (!type || !imdbId) {
        res.status(400).json({ error: "type and imdbId are required" });
        return;
      }

      const streams = await getAvailableStreams(
        session.addonUrl,
        session.addonPassword,
        type,
        imdbId,
        season,
        episode,
        config.addonPort,
      );

      res.json({ streams });
    } catch (error) {
      console.error("Streams error:", error);
      res.status(500).json({ error: "Failed to list streams" });
    }
  });

  // ─── Stream Resolution ───────────────────────────────────

  /** Build a proxy URL so the browser fetches video bytes through this server
   *  (bypasses CDN CORS restrictions like Real-Debrid). */
  function buildProxyUrl(req: Request, rawUrl: string): string {
    const proto = (req.get("x-forwarded-proto") as string | undefined) ?? req.protocol;
    const host = req.get("host") ?? `localhost:${config.port}`;
    // When behind nginx (x-forwarded-proto is set), party server is at /party/
    const partyPrefix = req.get("x-forwarded-proto") ? "/party" : "";
    return `${proto}://${host}${partyPrefix}/api/proxy?url=${encodeURIComponent(rawUrl)}`;
  }

  app.post("/api/sessions/:id/resolve", async (req: Request, res: Response) => {
    try {
      const adminToken = req.headers["x-admin-token"] as string;
      const session = sessionManager.getSession(req.params.id);

      if (!session) {
        res.status(404).json({ error: "Session not found" });
        return;
      }

      if (session.adminToken !== adminToken) {
        res.status(403).json({ error: "Only the host can select content" });
        return;
      }

      const {
        type,
        imdbId,
        title,
        year,
        poster,
        season: seasonNum,
        episode,
        episodeTitle,
        streamUrl: pickedStreamUrl,
      } = req.body as ResolveStreamRequest;

      if (!type || !imdbId) {
        res.status(400).json({ error: "type and imdbId are required" });
        return;
      }

      let rawStreamUrl: string;
      let subtitles: Subtitle[] = [];

      if (pickedStreamUrl) {
        // Host pre-selected a specific stream from the picker
        rawStreamUrl = pickedStreamUrl;
      } else {
        // Auto-select the first available stream
        const streamResult = await resolveStream(
          session.addonUrl,
          session.addonPassword,
          type,
          imdbId,
          seasonNum,
          episode,
          config.addonPort,
        );

        if (!streamResult) {
          res.status(404).json({ error: "No streams available for this content" });
          return;
        }

        rawStreamUrl = streamResult.streamUrl;
        subtitles = streamResult.subtitles;
      }

      // Fetch subtitles if none were returned by the addon
      if (subtitles.length === 0) {
        subtitles = await fetchSubtitles(type, imdbId, seasonNum, episode);
      }

      // Wrap the CDN URL in our proxy to fix CORS
      const proxiedUrl = buildProxyUrl(req, rawStreamUrl);

      const content: SessionContent = {
        type,
        imdbId,
        title: title ?? "",
        year: year ?? 0,
        poster: poster ?? "",
        streamUrl: proxiedUrl,
        subtitles,
        duration: 0,
        season: seasonNum,
        episode,
        episodeTitle,
        resolvedAt: Date.now(),
      };

      sessionManager.setContent(session.id, content);

      const publicInfo = sessionManager.toPublicInfo(session);
      syncEngine.notifyContentChanged(session.id, publicInfo);

      res.json({
        streamUrl: proxiedUrl,
        subtitles,
        metadata: {
          title: content.title,
          year: content.year,
          poster: content.poster,
        },
      });
    } catch (error) {
      console.error("Resolve error:", error);
      res.status(500).json({ error: "Failed to resolve stream" });
    }
  });

  // ─── Subtitles ───────────────────────────────────────────

  app.get("/api/sessions/:id/subtitles", (req: Request, res: Response) => {
    const session = sessionManager.getSession(req.params.id);
    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    if (!session.content) {
      res.json({ subtitles: [] });
      return;
    }

    res.json({ subtitles: session.content.subtitles });
  });

  return app;
}
