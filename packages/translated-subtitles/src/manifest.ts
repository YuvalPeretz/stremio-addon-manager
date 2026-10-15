/**
 * Stremio addon manifest — subtitles only, movie + series.
 */

export const MANIFEST_ID = "community.stremio.translated.subtitles";

export const manifest = {
  id: MANIFEST_ID,
  version: "1.0.0",
  name: "Translated Subtitles",
  description: "OpenSubtitles tracks translated into a single configured language by a local LLM",
  resources: ["subtitles"] as const,
  types: ["movie", "series"] as const,
  idPrefixes: ["tt"],
  catalogs: [] as const,
};

export type AddonManifest = typeof manifest;
