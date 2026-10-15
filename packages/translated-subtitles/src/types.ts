/**
 * Shared types for the TranslatedSubtitles addon.
 */

export type ContentType = "movie" | "series";
export type SubtitleFormat = "srt" | "vtt";
export type ModelTier = "ultra-light" | "light" | "light-alt" | "balanced";

export interface StremioSubtitle {
  id: string;
  url: string;
  lang: string;
}

export interface StremioSubtitlesResponse {
  subtitles: StremioSubtitle[];
}

export interface OpenSubtitlesItem {
  id?: string;
  url: string;
  lang?: string;
}

export interface SubtitleCue {
  /** Original cue index when present (SRT number or VTT identifier). */
  index: number;
  /** Original start timestamp string (preserved 1:1). */
  start: string;
  /** Original end timestamp string (preserved 1:1). */
  end: string;
  /** VTT cue settings after the arrow (e.g. `align:start`). Empty for SRT. */
  settings: string;
  /** Cue payload only — never includes timestamps. */
  text: string;
}

export interface ParsedSubtitle {
  format: SubtitleFormat;
  /** Preamble before the first cue (WEBVTT header, STYLE, NOTE, …). */
  header: string;
  cues: SubtitleCue[];
}

export interface GlossaryEntry {
  source: string;
  target: string;
}

export interface CacheMeta {
  sourceUrl: string;
  targetLang: string;
  modelId: string;
  format: SubtitleFormat;
  createdAt: number;
}

export interface ModelCatalogEntry {
  id: string;
  displayName: string;
  tier: ModelTier;
  recommended: boolean;
  experimental: boolean;
  filename: string;
  url: string;
  expectedBytes: number;
  sha256: string;
  ramBlurb: string;
  hwBlurb: string;
  qualityBlurb: string;
}

export interface ModelCatalogFile {
  defaultModelId: string;
  models: ModelCatalogEntry[];
}

export interface LlmHealth {
  healthy: boolean;
  url: string;
  reason?: string;
}

export interface EnvVarDefinition {
  key: string;
  description: string;
  default?: string | number | boolean;
  type: "string" | "number" | "boolean";
  required: boolean;
  sensitive: boolean;
  productOnly: boolean;
}

export type FetchLike = (
  input: string | URL,
  init?: RequestInit
) => Promise<Response>;
