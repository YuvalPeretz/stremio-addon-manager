/**
 * Expand folder roots into indexed video files with effective metadata.
 */

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import type { IndexedFileRecord, LibraryRoot, LocalFileMetadata } from "./types.js";
import { mergeMetadata } from "./store.js";
import { isLocalLibraryVideoFile } from "./video-extensions.js";

export interface ScanOptions {
  maxDepth: number;
  maxFiles: number;
}

export function stableFileId(canonicalPath: string): string {
  const h = createHash("sha256").update(canonicalPath, "utf8").digest("hex").slice(0, 22);
  return `l${h}`;
}


function safeRealPath(p: string): string | null {
  try {
    return fs.realpathSync(p);
  } catch {
    return null;
  }
}

function isWithinRoot(canonicalFile: string, canonicalRoot: string): boolean {
  const rel = path.relative(canonicalRoot, canonicalFile);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

/**
 * Recursively collect video files under `dir` (canonical). Stops at maxDepth / maxFiles.
 */
function walkDir(
  dir: string,
  rootCanonical: string,
  rootId: string,
  defaultMetadata: LocalFileMetadata | undefined,
  overrides: Record<string, LocalFileMetadata>,
  depth: number,
  options: ScanOptions,
  out: IndexedFileRecord[],
  counts: { files: number }
): void {
  if (depth > options.maxDepth || counts.files >= options.maxFiles) return;

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const ent of entries) {
    if (counts.files >= options.maxFiles) break;
    const full = path.join(dir, ent.name);
    if (ent.isSymbolicLink()) continue;

    if (ent.isDirectory()) {
      walkDir(full, rootCanonical, rootId, defaultMetadata, overrides, depth + 1, options, out, counts);
      continue;
    }

    if (!ent.isFile() || !isLocalLibraryVideoFile(full)) continue;

    const canonical = safeRealPath(full);
    if (!canonical || !isWithinRoot(canonical, rootCanonical)) continue;

    const effective = mergeMetadata(defaultMetadata, overrides[canonical]);
    out.push({
      fileId: stableFileId(canonical),
      canonicalPath: canonical,
      basename: path.basename(canonical),
      effective,
      rootId,
    });
    counts.files += 1;
  }
}

/**
 * Build index from configured roots and overrides.
 */
export function scanLibrary(
  roots: LibraryRoot[],
  fileOverrides: Record<string, LocalFileMetadata>,
  options: ScanOptions
): IndexedFileRecord[] {
  const out: IndexedFileRecord[] = [];
  const counts = { files: 0 };

  for (const root of roots) {
    if (counts.files >= options.maxFiles) break;

    const canonicalRoot = safeRealPath(root.path);
    if (!canonicalRoot) {
      console.warn(`[local-library] Skipping missing root: ${root.path}`);
      continue;
    }

    if (root.kind === "file") {
      if (!isLocalLibraryVideoFile(canonicalRoot)) continue;
      const effective = mergeMetadata(root.defaultMetadata, fileOverrides[canonicalRoot]);
      out.push({
        fileId: stableFileId(canonicalRoot),
        canonicalPath: canonicalRoot,
        basename: path.basename(canonicalRoot),
        effective,
        rootId: root.id,
      });
      counts.files += 1;
      continue;
    }

    walkDir(
      canonicalRoot,
      canonicalRoot,
      root.id,
      root.defaultMetadata,
      fileOverrides,
      0,
      options,
      out,
      counts
    );
  }

  return out;
}
