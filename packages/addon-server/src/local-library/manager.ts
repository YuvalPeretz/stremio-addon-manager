/**
 * Orchestrates persisted library state, filesystem scan, matching, and Stremio stream rows.
 */

import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import type { ServerConfig } from "../config.js";
import type { CinemetaMetadata, Stream } from "../types.js";
import type { IndexedFileRecord, LibraryRoot, LocalFileMetadata, LocalLibraryPersisted } from "./types.js";
import { loadPersisted, savePersisted } from "./store.js";
import { scanLibrary } from "./scanner.js";
import { findExactMatches, findFuzzyMatches } from "./match.js";

function newRootId(): string {
  return randomBytes(8).toString("hex");
}

function safeRealPath(p: string): string | null {
  try {
    return fs.realpathSync(p);
  } catch {
    return null;
  }
}

function buildLocalStreamName(m: LocalFileMetadata, fuzzyGuess: boolean): string {
  const parts: string[] = ["Local"];
  if (fuzzyGuess) parts.push("~title");
  if (m.language) parts.push(m.language);
  if (m.resolution) parts.push(m.resolution);
  return parts.join(" | ");
}

function buildLocalStreamTitle(rec: IndexedFileRecord, fuzzyGuess: boolean): string {
  const m = rec.effective;
  const primary = m.displayName?.trim() || rec.basename;
  const detail: string[] = [];
  if (m.year) detail.push(String(m.year));
  if (typeof m.season === "number" && typeof m.episode === "number") {
    detail.push(`S${m.season}E${m.episode}`);
  }
  const body = detail.length ? `${primary}\n${detail.join(" · ")}` : primary;
  return fuzzyGuess ? `${body}\nSimilar title match (not imdb-linked)` : body;
}

export class LocalLibraryManager {
  private persisted: LocalLibraryPersisted;
  private indexed: IndexedFileRecord[] = [];
  private byFileId = new Map<string, IndexedFileRecord>();

  constructor(private readonly config: ServerConfig) {
    if (!config.localLibraryDataDir) {
      this.persisted = { version: 1, roots: [], fileOverrides: {} };
      return;
    }
    this.persisted = loadPersisted(config.localLibraryDataDir);
    this.reindex();
  }

  get enabled(): boolean {
    return Boolean(this.config.localLibraryDataDir);
  }

  getPersisted(): LocalLibraryPersisted {
    return this.persisted;
  }

  save(): void {
    if (!this.enabled) return;
    savePersisted(this.config.localLibraryDataDir, this.persisted);
  }

  /** Re-scan configured roots into memory. Call after mutating roots or overrides. */
  reindex(): void {
    if (!this.enabled) {
      this.indexed = [];
      this.byFileId.clear();
      return;
    }
    const scanned = scanLibrary(this.persisted.roots, this.persisted.fileOverrides, {
      maxDepth: this.config.localLibraryScanMaxDepth,
      maxFiles: this.config.localLibraryScanMaxFiles,
    });
    const seen = new Set<string>();
    const deduped: IndexedFileRecord[] = [];
    for (const rec of scanned) {
      if (seen.has(rec.canonicalPath)) continue;
      seen.add(rec.canonicalPath);
      deduped.push(rec);
    }
    this.indexed = deduped;
    this.byFileId.clear();
    for (const rec of this.indexed) {
      this.byFileId.set(rec.fileId, rec);
    }
    console.log(`[local-library] Index: ${this.indexed.length} file(s) from ${this.persisted.roots.length} root(s)`);
  }

  getIndexed(): IndexedFileRecord[] {
    return this.indexed;
  }

  getByFileId(fileId: string): IndexedFileRecord | undefined {
    return this.byFileId.get(fileId);
  }

  /**
   * True if `canonicalPath` is the configured path of a root or under a folder root.
   */
  isPathAllowed(canonicalPath: string): boolean {
    for (const root of this.persisted.roots) {
      const rootCanon = safeRealPath(root.path);
      if (!rootCanon) continue;
      if (canonicalPath === rootCanon) return true;
      if (root.kind === "folder") {
        const rel = path.relative(rootCanon, canonicalPath);
        if (rel && !rel.startsWith("..") && !path.isAbsolute(rel)) return true;
      }
    }
    return false;
  }

  /**
   * Paths allowed for GET /browse. When there are no roots yet, any absolute path under `/` may be listed
   * so the admin UI can navigate the Pi and add the first root (still requires addon auth).
   * Once roots exist, browsing is limited to those trees (same as {@link isPathAllowed}).
   */
  isPathAllowedForBrowse(canonicalPath: string): boolean {
    if (!canonicalPath || canonicalPath.includes("\0")) return false;
    if (this.persisted.roots.length === 0) {
      return canonicalPath.startsWith("/");
    }
    return this.isPathAllowed(canonicalPath);
  }

  addRoot(kind: "file" | "folder", absPath: string, defaultMetadata?: LocalFileMetadata): LibraryRoot {
    const root: LibraryRoot = {
      id: newRootId(),
      kind,
      path: absPath,
      defaultMetadata,
      addedAt: new Date().toISOString(),
    };
    this.persisted.roots.push(root);
    this.save();
    this.reindex();
    return root;
  }

  removeRoot(rootId: string): boolean {
    const i = this.persisted.roots.findIndex((r) => r.id === rootId);
    if (i < 0) return false;
    this.persisted.roots.splice(i, 1);
    this.save();
    this.reindex();
    return true;
  }

  updateRoot(rootId: string, patch: { path?: string; defaultMetadata?: LocalFileMetadata | null }): LibraryRoot | null {
    const root = this.persisted.roots.find((r) => r.id === rootId);
    if (!root) return null;
    if (patch.path !== undefined) root.path = patch.path;
    if (patch.defaultMetadata !== undefined) {
      root.defaultMetadata = patch.defaultMetadata ?? undefined;
    }
    this.save();
    this.reindex();
    return root;
  }

  setFileOverride(canonicalPath: string, override: LocalFileMetadata | null): void {
    if (override === null || Object.keys(override).length === 0) {
      delete this.persisted.fileOverrides[canonicalPath];
    } else {
      this.persisted.fileOverrides[canonicalPath] = {
        ...this.persisted.fileOverrides[canonicalPath],
        ...override,
      };
    }
    this.save();
    this.reindex();
  }

  /**
   * `playbackBase` must be `https://host/password` (no trailing slash) so stream URLs match authenticated routes.
   * @param options.enableFuzzy When true and `cinemetaMeta` is set, adds title-scored matches (see env thresholds).
   */
  buildStreamsForStremioRequest(
    type: string,
    id: string,
    playbackBase: string,
    options?: { enableFuzzy?: boolean; cinemetaMeta?: CinemetaMetadata | null }
  ): Stream[] {
    if (!this.enabled) return [];

    const exact = findExactMatches(type, id, this.indexed);
    const exactIds = new Set(exact.map((r) => r.fileId));

    const fuzzy =
      options?.enableFuzzy &&
      options.cinemetaMeta &&
      this.config.localLibraryMaxFuzzyResults > 0
        ? findFuzzyMatches(type, id, this.indexed, options.cinemetaMeta, {
            excludeFileIds: exactIds,
            maxResults: this.config.localLibraryMaxFuzzyResults,
            threshold: this.config.localLibraryFuzzyThreshold,
          })
        : [];

    const streams: Stream[] = [];
    for (const rec of exact) {
      streams.push({
        name: buildLocalStreamName(rec.effective, false),
        title: buildLocalStreamTitle(rec, false),
        url: `${playbackBase}/local/${encodeURIComponent(rec.fileId)}`,
        discoveryTier: "local" as const,
        behaviorHints: {
          bingeGroup: "local-library",
          notWebReady: false,
        },
      });
    }
    for (const rec of fuzzy) {
      streams.push({
        name: buildLocalStreamName(rec.effective, true),
        title: buildLocalStreamTitle(rec, true),
        url: `${playbackBase}/local/${encodeURIComponent(rec.fileId)}`,
        discoveryTier: "local" as const,
        behaviorHints: {
          bingeGroup: "local-library",
          notWebReady: false,
        },
      });
    }
    return streams;
  }
}
