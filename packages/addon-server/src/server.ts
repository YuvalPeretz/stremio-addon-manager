/**
 * Express Server Setup
 */

import express, { type Request, type Response, type NextFunction, type RequestHandler } from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ServerConfig } from "./config.js";
import type { RealDebridClient } from "./real-debrid.js";
import type { CacheManager } from "./cache.js";
import { manifest } from "./manifest.js";
import { handleStreamRequest } from "./stream-handler.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Create and configure Express app
 */
export function createServer(
  config: ServerConfig,
  rdClient: RealDebridClient,
  cacheManager: CacheManager
): express.Application {
  const app = express();

  // Enable CORS for Stremio
  app.use(
    cors({
      origin: "*",
      credentials: true,
      methods: ["GET", "POST", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization"],
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
        message: `You've exceeded the rate limit of ${config.rateLimits.streamMax} requests per ${config.rateLimits.streamWindow / 60000} minutes. Please try again later.`,
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

  // Stats API endpoint (with rate limiting)
  app.get("/stats", statsRateLimiter, (_req: Request, res: Response) => {
    const memoryUsage = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2);

    res.json({
      addonStatus: "online",
      rdConnected: config.rdApiToken && config.rdApiToken !== "YOUR_REAL_DEBRID_TOKEN_HERE",
      cacheStats: cacheManager.getStats(),
      cacheSizes: cacheManager.getSizes(),
      memoryUsage: `${memoryUsage} MB`,
      version: manifest.version,
      uptime: process.uptime(),
      torrentLimit: config.torrentLimit,
    });
  });

  // Protected routes with password in path (/:password/...)

  // Manifest endpoint
  app.get("/:password/manifest.json", authenticateToken, (req: Request, res: Response) => {
    const password = req.params.password;
    const protocol = req.headers["x-forwarded-proto"] || req.protocol;
    const host = req.headers["x-forwarded-host"] || req.get("host");
    const baseUrl = `${protocol}://${host}/${password}`;

    const manifestWithBase = {
      ...manifest,
      behaviorHints: {
        configurable: false,
        configurationRequired: false,
      },
    };

    console.log(`Serving manifest with base URL: ${baseUrl}`);
    res.json(manifestWithBase);
  });

  // Stream endpoint (with rate limiting)
  app.get("/:password/stream/:type/:id.json", authenticateToken, streamRateLimiter, async (req: Request, res: Response) => {
    try {
      const { type, id } = req.params;
      const result = await handleStreamRequest({ type, id }, rdClient, cacheManager, config);
      res.json(result);
    } catch (error) {
      console.error("Stream endpoint error:", error);
      res.status(500).json({ streams: [] });
    }
  });

  return app;
}

