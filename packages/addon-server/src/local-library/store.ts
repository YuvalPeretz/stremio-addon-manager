/**
 * Load / save local library JSON and merge folder defaults with per-file overrides.
 */

import fs from "node:fs";
import path from "node:path";
import type { LocalFileMetadata, LocalLibraryPersisted, LibraryRoot } from "./types.js";

const STORE_VERSION = 1 as const;
const FILE_NAME = "library.json";

export function emptyPersisted(): LocalLibraryPersisted {
  return { version: STORE_VERSION, roots: [], fileOverrides: {} };
}

export function mergeMetadata(
  defaults: LocalFileMetadata | undefined,
  override: LocalFileMetadata | undefined
): LocalFileMetadata {
  return { ...defaults, ...override };
}

export function getLibraryJsonPath(dataDir: string): string {
  return path.join(dataDir, FILE_NAME);
}

export function ensureDataDir(dataDir: string): void {
  fs.mkdirSync(dataDir, { recursive: true });
}

export function loadPersisted(dataDir: string): LocalLibraryPersisted {
  const fp = getLibraryJsonPath(dataDir);
  if (!fs.existsSync(fp)) {
    return emptyPersisted();
  }
  try {
    const raw = fs.readFileSync(fp, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return emptyPersisted();
    const o = parsed as Record<string, unknown>;
    if (o.version !== STORE_VERSION) return emptyPersisted();
    const roots = Array.isArray(o.roots) ? (o.roots as LibraryRoot[]) : [];
    const fileOverrides =
      o.fileOverrides && typeof o.fileOverrides === "object"
        ? (o.fileOverrides as Record<string, LocalFileMetadata>)
        : {};
    return { version: STORE_VERSION, roots, fileOverrides };
  } catch {
    console.warn("[local-library] Failed to read library.json — starting empty");
    return emptyPersisted();
  }
}

export function savePersisted(dataDir: string, data: LocalLibraryPersisted): void {
  ensureDataDir(dataDir);
  const fp = getLibraryJsonPath(dataDir);
  fs.writeFileSync(fp, JSON.stringify(data, null, 2), "utf8");
}
