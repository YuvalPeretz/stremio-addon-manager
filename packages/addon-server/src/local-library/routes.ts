/**
 * REST + static file streaming for the local library feature.
 */

import fs from "node:fs";
import path from "node:path";
import type { Request, Response, Application, RequestHandler } from "express";
import type { ServerConfig } from "../config.js";
import type { LocalFileMetadata } from "./types.js";
import { LocalLibraryManager } from "./manager.js";
import { isLocalLibraryVideoFile, LOCAL_LIBRARY_VIDEO_EXTENSIONS_READABLE } from "./video-extensions.js";

const MIME_BY_EXT: Record<string, string> = {
  ".mkv": "video/x-matroska",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".avi": "video/x-msvideo",
  ".m4v": "video/x-m4v",
  ".mov": "video/quicktime",
  ".wmv": "video/x-ms-wmv",
};

function mimeForPath(filePath: string): string {
  return MIME_BY_EXT[path.extname(filePath).toLowerCase()] || "application/octet-stream";
}

function ensureSupportedVideoFileRoot(res: Response, canon: string): boolean {
  if (isLocalLibraryVideoFile(canon)) return true;
  res.status(400).json({
    error: `unsupported video extension (allowed: ${LOCAL_LIBRARY_VIDEO_EXTENSIONS_READABLE})`,
  });
  return false;
}

function safeRealPath(p: string): string | null {
  try {
    return fs.realpathSync(p);
  } catch {
    return null;
  }
}

function parseRangeHeader(range: string | undefined, size: number): { start: number; end: number } | null {
  if (!range || !range.startsWith("bytes=")) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  if (!m) return null;
  let start = m[1] ? parseInt(m[1], 10) : NaN;
  let end = m[2] ? parseInt(m[2], 10) : NaN;
  if (m[1] === "" && m[2] !== "") {
    const suffix = parseInt(m[2], 10);
    if (isNaN(suffix)) return null;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else if (m[1] !== "" && m[2] === "") {
    if (isNaN(start) || start < 0 || start >= size) return null;
    end = size - 1;
  } else if (m[1] !== "" && m[2] !== "") {
    if (isNaN(start) || isNaN(end) || start > end || start < 0 || end >= size) return null;
  } else {
    return null;
  }
  return { start, end };
}

function serveLocalFile(manager: LocalLibraryManager, req: Request, res: Response, headOnly: boolean): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Expose-Headers", "Content-Length, Content-Range, Accept-Ranges");

  const fileId = req.params.fileId as string;
  const rec = manager.getByFileId(fileId);
  if (!rec) {
    res.status(404).json({ error: "Unknown file id" });
    return;
  }

  const filePath = rec.canonicalPath;
  let stat: fs.Stats;
  try {
    stat = fs.statSync(filePath);
  } catch {
    res.status(404).json({ error: "File not found on disk" });
    return;
  }
  if (!stat.isFile()) {
    res.status(400).json({ error: "Not a file" });
    return;
  }

  const size = stat.size;
  const contentType = mimeForPath(filePath);
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Content-Type", contentType);

  const range = parseRangeHeader(req.headers.range as string | undefined, size);

  if (headOnly) {
    if (range) {
      res.status(206);
      res.setHeader("Content-Range", `bytes ${range.start}-${range.end}/${size}`);
      res.setHeader("Content-Length", String(range.end - range.start + 1));
    } else {
      res.setHeader("Content-Length", String(size));
    }
    res.end();
    return;
  }

  if (range) {
    res.status(206);
    res.setHeader("Content-Range", `bytes ${range.start}-${range.end}/${size}`);
    res.setHeader("Content-Length", String(range.end - range.start + 1));
    const stream = fs.createReadStream(filePath, { start: range.start, end: range.end });
    stream.on("error", () => {
      if (!res.headersSent) res.status(500).end();
      else res.end();
    });
    req.on("close", () => stream.destroy());
    stream.pipe(res);
    return;
  }

  res.setHeader("Content-Length", String(size));
  const stream = fs.createReadStream(filePath);
  stream.on("error", () => {
    if (!res.headersSent) res.status(500).end();
    else res.end();
  });
  req.on("close", () => stream.destroy());
  stream.pipe(res);
}

/**
 * When the path has no :password segment (e.g. GET /local-library), authenticate using the same
 * secret as the URL token so Electron can call https://domain/local-library without embedding the
 * password in the path (avoids some reverse-proxy / dev-server confusion).
 */
function createHeaderPasswordMiddleware(config: ServerConfig): RequestHandler {
  return (req, res, next) => {
    if (typeof req.params.password === "string" && req.params.password.length > 0) {
      return next();
    }
    const headerPwd = req.get("X-Stremio-Addon-Password")?.trim();
    if (config.authEnabled) {
      if (!headerPwd || headerPwd !== config.addonPassword) {
        res.status(401).json({
          error: "Authentication required",
          message: "Invalid or missing X-Stremio-Addon-Password header",
        });
        return;
      }
    }
    (req.params as Record<string, string>).password = headerPwd ?? "";
    next();
  };
}

export function registerLocalLibraryRoutes(
  app: Application,
  config: ServerConfig,
  authenticateToken: RequestHandler,
  manager: LocalLibraryManager
): void {
  const headerPwd = createHeaderPasswordMiddleware(config);

  const gate: RequestHandler = (_req, res, next) => {
    if (!manager.enabled) {
      res.status(503).json({
        error: "Local library is disabled (LOCAL_LIBRARY_DATA_DIR is set empty in the environment)",
      });
      return;
    }
    next();
  };

  // ── Stream playback (same :password auth as the rest of the addon) ────────
  app.options("/:password/local/:fileId", (_req: Request, res: Response) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Range");
    res.setHeader("Access-Control-Expose-Headers", "Content-Length, Content-Range, Accept-Ranges");
    res.status(204).send();
  });

  app.head("/:password/local/:fileId", authenticateToken, gate, (req: Request, res: Response) => {
    serveLocalFile(manager, req, res, true);
  });

  app.get("/:password/local/:fileId", authenticateToken, gate, (req: Request, res: Response) => {
    serveLocalFile(manager, req, res, false);
  });

  // ── Management API (Stremio-style /:password/... + header-auth /local-library/... for Electron) ──
  const getLibrarySummary: RequestHandler = (_req: Request, res: Response) => {
    const p = manager.getPersisted();
    res.json({
      enabled: true,
      dataDir: config.localLibraryDataDir,
      roots: p.roots,
      indexedCount: manager.getIndexed().length,
      scan: {
        maxDepth: config.localLibraryScanMaxDepth,
        maxFiles: config.localLibraryScanMaxFiles,
        fuzzyMaxResults: config.localLibraryMaxFuzzyResults,
        fuzzyThreshold: config.localLibraryFuzzyThreshold,
      },
    });
  };

  app.get("/:password/local-library", authenticateToken, gate, getLibrarySummary);
  app.get("/local-library", headerPwd, authenticateToken, gate, getLibrarySummary);

  const getLibraryFiles: RequestHandler = (req: Request, res: Response) => {
    const rootId = req.query.rootId as string | undefined;
    let list = manager.getIndexed();
    if (rootId) {
      list = list.filter((r) => r.rootId === rootId);
    }
    res.json({ files: list });
  };

  app.get("/:password/local-library/files", authenticateToken, gate, getLibraryFiles);
  app.get("/local-library/files", headerPwd, authenticateToken, gate, getLibraryFiles);

  const postReindex: RequestHandler = (_req: Request, res: Response) => {
    manager.reindex();
    res.json({ ok: true, indexedCount: manager.getIndexed().length });
  };

  app.post("/:password/local-library/reindex", authenticateToken, gate, postReindex);
  app.post("/local-library/reindex", headerPwd, authenticateToken, gate, postReindex);

  app.post("/:password/local-library/roots", authenticateToken, gate, (req: Request, res: Response) => {
    const body = req.body as { kind?: string; path?: string; defaultMetadata?: LocalFileMetadata };
    if (body.kind !== "file" && body.kind !== "folder") {
      res.status(400).json({ error: "kind must be 'file' or 'folder'" });
      return;
    }
    if (!body.path || typeof body.path !== "string") {
      res.status(400).json({ error: "path is required" });
      return;
    }
    const canon = safeRealPath(body.path);
    if (!canon) {
      res.status(400).json({ error: "path does not exist" });
      return;
    }
    if (body.kind === "file" && !fs.statSync(canon).isFile()) {
      res.status(400).json({ error: "kind=file but path is not a file" });
      return;
    }
    if (body.kind === "file" && !ensureSupportedVideoFileRoot(res, canon)) {
      return;
    }
    if (body.kind === "folder" && !fs.statSync(canon).isDirectory()) {
      res.status(400).json({ error: "kind=folder but path is not a directory" });
      return;
    }
    const root = manager.addRoot(body.kind, canon, body.defaultMetadata);
    res.status(201).json({ root });
  });

  app.post("/local-library/roots", headerPwd, authenticateToken, gate, (req: Request, res: Response) => {
    const body = req.body as { kind?: string; path?: string; defaultMetadata?: LocalFileMetadata };
    if (body.kind !== "file" && body.kind !== "folder") {
      res.status(400).json({ error: "kind must be 'file' or 'folder'" });
      return;
    }
    if (!body.path || typeof body.path !== "string") {
      res.status(400).json({ error: "path is required" });
      return;
    }
    const canon = safeRealPath(body.path);
    if (!canon) {
      res.status(400).json({ error: "path does not exist" });
      return;
    }
    if (body.kind === "file" && !fs.statSync(canon).isFile()) {
      res.status(400).json({ error: "kind=file but path is not a file" });
      return;
    }
    if (body.kind === "file" && !ensureSupportedVideoFileRoot(res, canon)) {
      return;
    }
    if (body.kind === "folder" && !fs.statSync(canon).isDirectory()) {
      res.status(400).json({ error: "kind=folder but path is not a directory" });
      return;
    }
    const root = manager.addRoot(body.kind, canon, body.defaultMetadata);
    res.status(201).json({ root });
  });

  app.patch("/:password/local-library/roots/:rootId", authenticateToken, gate, (req: Request, res: Response) => {
    const patch = req.body as { path?: string; defaultMetadata?: LocalFileMetadata | null };
    let newPath: string | undefined;
    if (patch.path !== undefined) {
      const canon = safeRealPath(patch.path);
      if (!canon) {
        res.status(400).json({ error: "path does not exist" });
        return;
      }
      const rootForPatch = manager.getPersisted().roots.find((r) => r.id === req.params.rootId);
      if (rootForPatch?.kind === "file" && !ensureSupportedVideoFileRoot(res, canon)) {
        return;
      }
      newPath = canon;
    }
    const updated = manager.updateRoot(req.params.rootId, {
      path: newPath,
      defaultMetadata: patch.defaultMetadata,
    });
    if (!updated) {
      res.status(404).json({ error: "root not found" });
      return;
    }
    res.json({ root: updated });
  });

  app.patch("/local-library/roots/:rootId", headerPwd, authenticateToken, gate, (req: Request, res: Response) => {
    const patch = req.body as { path?: string; defaultMetadata?: LocalFileMetadata | null };
    let newPath: string | undefined;
    if (patch.path !== undefined) {
      const canon = safeRealPath(patch.path);
      if (!canon) {
        res.status(400).json({ error: "path does not exist" });
        return;
      }
      const rootForPatch = manager.getPersisted().roots.find((r) => r.id === req.params.rootId);
      if (rootForPatch?.kind === "file" && !ensureSupportedVideoFileRoot(res, canon)) {
        return;
      }
      newPath = canon;
    }
    const updated = manager.updateRoot(req.params.rootId, {
      path: newPath,
      defaultMetadata: patch.defaultMetadata,
    });
    if (!updated) {
      res.status(404).json({ error: "root not found" });
      return;
    }
    res.json({ root: updated });
  });

  app.delete("/:password/local-library/roots/:rootId", authenticateToken, gate, (req: Request, res: Response) => {
    const ok = manager.removeRoot(req.params.rootId);
    if (!ok) {
      res.status(404).json({ error: "root not found" });
      return;
    }
    res.status(204).send();
  });

  app.delete("/local-library/roots/:rootId", headerPwd, authenticateToken, gate, (req: Request, res: Response) => {
    const ok = manager.removeRoot(req.params.rootId);
    if (!ok) {
      res.status(404).json({ error: "root not found" });
      return;
    }
    res.status(204).send();
  });

  app.patch("/:password/local-library/files", authenticateToken, gate, (req: Request, res: Response) => {
    const body = req.body as { canonicalPath?: string; metadata?: LocalFileMetadata; clear?: boolean };
    if (!body.canonicalPath || typeof body.canonicalPath !== "string") {
      res.status(400).json({ error: "canonicalPath is required" });
      return;
    }
    const canon = safeRealPath(body.canonicalPath);
    if (!canon || !manager.isPathAllowed(canon)) {
      res.status(400).json({ error: "path not under any library root" });
      return;
    }
    if (body.clear) {
      manager.setFileOverride(canon, null);
    } else if (body.metadata && typeof body.metadata === "object") {
      manager.setFileOverride(canon, body.metadata);
    } else {
      res.status(400).json({ error: "metadata object or clear:true required" });
      return;
    }
    res.json({ ok: true });
  });

  app.patch("/local-library/files", headerPwd, authenticateToken, gate, (req: Request, res: Response) => {
    const body = req.body as { canonicalPath?: string; metadata?: LocalFileMetadata; clear?: boolean };
    if (!body.canonicalPath || typeof body.canonicalPath !== "string") {
      res.status(400).json({ error: "canonicalPath is required" });
      return;
    }
    const canon = safeRealPath(body.canonicalPath);
    if (!canon || !manager.isPathAllowed(canon)) {
      res.status(400).json({ error: "path not under any library root" });
      return;
    }
    if (body.clear) {
      manager.setFileOverride(canon, null);
    } else if (body.metadata && typeof body.metadata === "object") {
      manager.setFileOverride(canon, body.metadata);
    } else {
      res.status(400).json({ error: "metadata object or clear:true required" });
      return;
    }
    res.json({ ok: true });
  });

  const getBrowse: RequestHandler = (req, res) => {
    void (async () => {
      try {
        let q = req.query.path as string | undefined;
        if (!q || q === "") {
          const roots = manager.getPersisted().roots;
          if (roots.length === 0) {
            // Start at filesystem root so the UI can navigate like a normal file browser.
            q = "/";
          } else {
            const entries = roots.map((r) => {
              const st = safeStat(r.path);
              return {
                name: path.basename(r.path),
                path: r.path,
                kind: r.kind,
                exists: Boolean(st),
                isDirectory: st?.isDirectory() ?? false,
                isFile: st?.isFile() ?? false,
                rootId: r.id,
              };
            });
            res.json({ path: "", entries });
            return;
          }
        }

        const canon = safeRealPath(q);
        if (!canon || !manager.isPathAllowedForBrowse(canon)) {
          res.status(403).json({ error: "path not allowed" });
          return;
        }

        let stat: fs.Stats;
        try {
          stat = await fs.promises.stat(canon);
        } catch {
          res.status(404).json({ error: "not found" });
          return;
        }

        if (!stat.isDirectory()) {
          res.json({
            path: canon,
            entries: [
              {
                name: path.basename(canon),
                path: canon,
                isDirectory: false,
                isFile: true,
              },
            ],
          });
          return;
        }

        let dirents: fs.Dirent[];
        try {
          dirents = await fs.promises.readdir(canon, { withFileTypes: true });
        } catch {
          res.status(500).json({ error: "cannot read directory" });
          return;
        }

        const entries = dirents
          .filter((d) => !d.isSymbolicLink())
          .map((d) => {
            const full = path.join(canon, d.name);
            return {
              name: d.name,
              path: full,
              isDirectory: d.isDirectory(),
              isFile: d.isFile(),
            };
          })
          .sort((a, b) => {
            if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
            return a.name.localeCompare(b.name);
          });

        res.json({ path: canon, entries });
      } catch (err) {
        console.error("[local-library] browse failed:", err);
        if (!res.headersSent) {
          res.status(500).json({ error: "browse failed" });
        }
      }
    })();
  };

  app.get("/:password/local-library/browse", authenticateToken, gate, getBrowse);
  app.get("/local-library/browse", headerPwd, authenticateToken, gate, getBrowse);
}

function safeStat(p: string): fs.Stats | null {
  try {
    return fs.statSync(p);
  } catch {
    return null;
  }
}
