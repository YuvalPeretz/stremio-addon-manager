/**
 * Express Stremio addon: password-gated manifest + subtitles, public translated files, health.
 */

import type { NextFunction, Request, RequestHandler, Response } from "express";
import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import type { ServerConfig } from "./config.js";
import { resolveExternalBaseUrl } from "./external-base.js";
import { manifest } from "./manifest.js";
import { LlmSidecarError } from "./llm-process.js";
import { MtSidecarError } from "./mt-process.js";
import { EngineManagerError, type EngineManager, type EngineReplaceResult } from "./engine-manager.js";
import { PipelineError, type TranslatePipeline } from "./pipeline.js";
import { OpenSubtitlesError } from "./opensubtitles-client.js";
import { TranslationError } from "./translator.js";
import { ModelDownloadError } from "./model-downloader.js";
import type { ContentType, SubtitleFormat } from "./types.js";

export interface ServerDeps {
  config: ServerConfig;
  pipeline: TranslatePipeline;
  engines: Pick<EngineManager, "replace" | "probeActive">;
}

function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>
): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    void fn(req, res, next).catch(next);
  };
}

function isContentType(value: string): value is ContentType {
  return value === "movie" || value === "series";
}

function isSubtitleFormat(value: string): value is SubtitleFormat {
  return value === "srt" || value === "vtt";
}

function contentTypeFor(format: SubtitleFormat): string {
  return format === "vtt" ? "text/vtt; charset=utf-8" : "application/x-subrip; charset=utf-8";
}

export function createServer(deps: ServerDeps): express.Express {
  const { config, pipeline, engines } = deps;
  const app = express();

  app.disable("x-powered-by");
  app.use(cors());
  app.use(express.json({ limit: "32kb" }));

  const subtitleLimiter = rateLimit({
    windowMs: 60_000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
  });

  function authenticateToken(req: Request, res: Response, next: NextFunction): void {
    if (!config.authEnabled) {
      next();
      return;
    }
    const urlPassword = req.params.password;
    if (urlPassword === config.addonPassword) {
      next();
      return;
    }
    res.status(401).json({
      error: "Authentication required",
      message: "Invalid or missing authentication token in URL",
    });
  }

  app.get("/", (_req: Request, res: Response) => {
    res.type("html").send(`<!DOCTYPE html>
<html><head><title>Translated Subtitles</title></head>
<body style="font-family: sans-serif; padding: 48px; text-align: center;">
  <h1>Translated Subtitles</h1>
  <p>Status: Online</p>
  <p>Target language: <code>${config.targetLang}</code></p>
  <p><a href="/health">/health</a></p>
</body></html>`);
  });

  app.get(
    "/health",
    asyncHandler(async (_req: Request, res: Response) => {
      const health = await engines.probeActive();
      res.json({
        status: "ok",
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        targetLang: config.targetLang,
        modelId: config.llmModelId,
        engine: health.engine,
        llm: health.llm,
        mt: health.mt,
        memory: {
          heapUsed: `${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)} MB`,
          heapTotal: `${(process.memoryUsage().heapTotal / 1024 / 1024).toFixed(2)} MB`,
        },
      });
    })
  );

  app.options("/:password/manifest.json", (_req: Request, res: Response) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.status(204).send();
  });

  app.get("/:password/manifest.json", authenticateToken, (_req: Request, res: Response) => {
    res.json(manifest);
  });

  async function handleEngineSwitch(req: Request, res: Response): Promise<void> {
    const body = req.body as { modelId?: unknown };
    const modelId = typeof body.modelId === "string" ? body.modelId.trim() : "";
    if (!modelId) {
      res.status(400).json({ ok: false, error: "modelId is required" });
      return;
    }
    try {
      const result: EngineReplaceResult = await engines.replace(modelId);
      res.json({
        ok: true,
        modelId: result.modelId,
        engine: result.engine,
        filename: result.filename,
        attachedSibling: result.attachedSibling,
        pruned: result.pruned,
        llm: result.llm,
        mt: result.mt,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("Unknown LLM_MODEL_ID")) {
        res.status(400).json({ ok: false, error: message });
        return;
      }
      if (
        err instanceof LlmSidecarError ||
        err instanceof MtSidecarError ||
        err instanceof EngineManagerError ||
        err instanceof ModelDownloadError
      ) {
        res.status(503).json({ ok: false, error: message });
        return;
      }
      console.error("Engine switch failed:", err);
      res.status(500).json({ ok: false, error: message });
    }
  }

  app.post("/:password/engine/switch", authenticateToken, asyncHandler(handleEngineSwitch));
  app.post("/:password/llm/switch", authenticateToken, asyncHandler(handleEngineSwitch));

  app.options("/:password/subtitles/:type/:id.json", (_req: Request, res: Response) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.status(204).send();
  });

  app.get(
    "/:password/subtitles/:type/:id.json",
    authenticateToken,
    subtitleLimiter,
    asyncHandler(async (req: Request, res: Response) => {
      const type = req.params.type;
      const id = req.params.id;
      if (!isContentType(type) || !id) {
        res.status(400).json({ subtitles: [], error: "Invalid type or id" });
        return;
      }
      const fileBase = resolveExternalBaseUrl(req, config.domain);
      try {
        const subtitles = await pipeline.listOneTrack(type, id, fileBase);
        res.json({ subtitles });
      } catch (err) {
        console.error("Subtitle list failed:", err);
        res.json({ subtitles: [] });
      }
    })
  );

  app.get(
    "/translated/:cacheKey.:ext",
    subtitleLimiter,
    asyncHandler(async (req: Request, res: Response) => {
      const cacheKey = req.params.cacheKey;
      const ext = req.params.ext;
      if (!cacheKey || !/^[a-f0-9]{16,64}$/i.test(cacheKey)) {
        res.status(400).send("Invalid cache key");
        return;
      }
      if (!isSubtitleFormat(ext)) {
        res.status(400).send("Extension must be srt or vtt");
        return;
      }
      try {
        const body = await pipeline.getTranslated(cacheKey, ext);
        res.setHeader("Content-Type", contentTypeFor(ext));
        res.setHeader("Cache-Control", "public, max-age=86400");
        res.send(body);
      } catch (err) {
        if (err instanceof PipelineError) {
          res.status(err.statusCode).send(err.message);
          return;
        }
        if (err instanceof OpenSubtitlesError) {
          res.status(502).send(err.message);
          return;
        }
        if (
          err instanceof TranslationError ||
          err instanceof LlmSidecarError ||
          err instanceof MtSidecarError ||
          err instanceof EngineManagerError ||
          err instanceof ModelDownloadError
        ) {
          res.status(503).send(err.message);
          return;
        }
        console.error("Translate failed:", err);
        res.status(500).send("Translation failed");
      }
    })
  );

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error("Unhandled error:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  return app;
}
