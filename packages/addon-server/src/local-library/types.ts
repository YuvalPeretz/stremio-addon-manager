/**
 * Local library — persisted roots, per-file overrides, and indexed file records.
 */

export interface LocalFileMetadata {
  imdbId?: string;
  type?: "movie" | "series";
  season?: number;
  episode?: number;
  displayName?: string;
  language?: string;
  resolution?: string;
  year?: number;
  aliases?: string[];
  notes?: string;
}

export interface LibraryRoot {
  id: string;
  kind: "file" | "folder";
  /** Absolute path on the addon host */
  path: string;
  defaultMetadata?: LocalFileMetadata;
  addedAt: string;
}

/** On-disk JSON shape (v1) */
export interface LocalLibraryPersisted {
  version: 1;
  roots: LibraryRoot[];
  /** Canonical absolute path → partial override merged on top of folder defaults */
  fileOverrides: Record<string, LocalFileMetadata>;
}

export interface IndexedFileRecord {
  /** Stable opaque id derived from canonical path (not reversible without guessing paths) */
  fileId: string;
  canonicalPath: string;
  basename: string;
  effective: LocalFileMetadata;
  rootId: string;
}
