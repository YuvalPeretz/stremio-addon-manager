/**
 * Stream quality scoring and sorting utilities.
 *
 * Parses the free-text torrent title that Torrentio provides and extracts
 * structured quality signals so we can:
 *  1. Sort torrents BEFORE processing (attempt best quality first)
 *  2. Sort final streams AFTER processing (display order in Stremio)
 *  3. Build a clean, human-readable stream name instead of "RD+ unknown"
 */

import type { TorrentInfo } from "./types.js";
import type { Stream } from "./types.js";

// ─── Quality score (higher = better) ─────────────────────────────────────────

const RESOLUTION_SCORE: Record<string, number> = {
  "2160p": 100,
  "4k": 100,
  uhd: 100,
  "1080p": 80,
  "1080i": 75,
  "720p": 60,
  "480p": 35,
  "360p": 20,
  sd: 15,
};

// Bonus points added on top of resolution score
const CODEC_BONUS: Record<string, number> = {
  hevc: 5,
  x265: 5,
  h265: 5,
  av1: 4,
  hdr: 8,
  hdr10: 9,
  "hdr10+": 10,
  dv: 10,
  "dolby vision": 10,
  remux: 12,
  bluray: 6,
  "blu-ray": 6,
  bdrip: 5,
  "web-dl": 3,
  webdl: 3,
  webrip: 2,
  hdtv: 1,
  heb: 3,
  hebrew: 3, // user preference
};

const SOURCE_SCORE: Record<string, number> = {
  "Torrentio/Q": 12, // quality-sorted discovery — preferred in pre-sort
  "Torrentio/S": 8, // seeder-sorted — fills gaps
  Torrentio: 5, // legacy / unknown label
  "Torrentio+RD": 15, // legacy (no longer used)
  Knightcrawler: 3,
};

/**
 * Prefer Dual/Multi audio (original track usually available in-player) over
 * single-language dub packs. Language-agnostic — does not hardcode a source language.
 */
export function scoreAudioPreference(title: string): number {
  const lower = title.toLowerCase();
  const hasDual =
    /\bdual(?:\s*audio)?\b/.test(lower) ||
    /\bmulti(?:[-\s]?audio)?\b/.test(lower) ||
    /\bmulti(?:[-\s]?sub)/.test(lower);
  // Single-language dub tags (without dual/multi) — often replace the original track
  const dubOnly =
    !hasDual &&
    (/\b(?:ita|italian|italiano)\b/.test(lower) ||
      /\b(?:ger|german|deu|deutsch)\b/.test(lower) ||
      /\b(?:fre|french|fra|vf)\b/.test(lower) ||
      /\b(?:spa|spanish|castellano|latino)\b/.test(lower) ||
      /\b(?:por|portuguese|brazilian|pt-br)\b/.test(lower) ||
      /\b(?:rus|russian)\b/.test(lower) ||
      /\b(?:pol|polish)\b/.test(lower) ||
      (/\bdub(?:bed)?\b/.test(lower) && !/\bsub(?:bed|s)?\b/.test(lower)));

  if (hasDual) return 20;
  if (dubOnly) return -35;
  return 0;
}

/**
 * Parse the seed count out of a Torrentio title string.
 * Torrentio uses the 👤 emoji followed by the seed count.
 */
function parseSeedCount(title: string): number {
  const match = title.match(/👤\s*(\d+)/);
  return match ? parseInt(match[1], 10) : 0;
}

/**
 * Parse file size in GB from a Torrentio title string.
 * Torrentio uses 💾 N.N GB / N.N MB.
 */
function parseSizeGb(title: string): number {
  const gb = title.match(/💾\s*([\d.]+)\s*GB/i);
  if (gb) return parseFloat(gb[1]);
  const mb = title.match(/💾\s*([\d.]+)\s*MB/i);
  if (mb) return parseFloat(mb[1]) / 1024;
  return 0;
}

/**
 * Parse the resolution string from a torrent title.
 * Returns the canonical form (e.g. "1080p") or "unknown".
 */
export function parseResolution(title: string): string {
  const lower = title.toLowerCase();
  if (/\b(2160p|4k|uhd)\b/.test(lower)) return "4K";
  if (/\b1080p\b/.test(lower)) return "1080p";
  if (/\b1080i\b/.test(lower)) return "1080i";
  if (/\b720p\b/.test(lower)) return "720p";
  if (/\b480p\b/.test(lower)) return "480p";
  if (/\b360p\b/.test(lower)) return "360p";
  return "";
}

/**
 * Assign a numeric quality score to a torrent for sorting purposes.
 * Higher = better quality / more preferred.
 */
export function scoreTorrent(torrent: TorrentInfo): number {
  const title = (torrent.title + " " + (torrent.quality ?? "")).toLowerCase();
  let score = 0;

  // Resolution
  for (const [key, val] of Object.entries(RESOLUTION_SCORE)) {
    if (title.includes(key)) {
      score += val;
      break;
    }
  }

  // Codec / source bonuses
  for (const [key, val] of Object.entries(CODEC_BONUS)) {
    if (title.includes(key)) score += val;
  }

  // Search source bonus
  score += SOURCE_SCORE[torrent.source ?? ""] ?? 0;

  // Dual/multi audio preferred; single-language dub packs deprioritized
  score += scoreAudioPreference(torrent.title);

  // Seeds: diminishing returns, capped at +20
  const seeds = parseSeedCount(torrent.title);
  score += Math.min(seeds * 0.5, 20);

  // Size penalty for suspiciously small files (< 100 MB likely wrong file / sample)
  const sizeGb = parseSizeGb(torrent.title);
  if (sizeGb > 0 && sizeGb < 0.1) score -= 30;

  return score;
}

/**
 * How much RD reports as instantly available for this hash (Pi-only API).
 * Larger values sort first among RD streams.
 */
export function scoreRdInstantAvailability(data: unknown): number {
  if (data == null || typeof data !== "object") return 0;
  let score = 0;
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      score += node.length;
      for (const item of node) walk(item);
    } else if (node != null && typeof node === "object") {
      for (const v of Object.values(node as Record<string, unknown>)) walk(v);
    }
  };
  walk(data);
  return score;
}

/**
 * Sort an array of TorrentInfo by quality score, highest first.
 * Mutates and returns the same array.
 */
export function sortTorrents(torrents: TorrentInfo[]): TorrentInfo[] {
  return torrents.sort((a, b) => scoreTorrent(b) - scoreTorrent(a));
}

// ─── Stream name builder ──────────────────────────────────────────────────────

/**
 * Build a clean, informative stream name for Stremio's stream picker.
 *
 * `name` stresses Real-Debrid playback; `title` keeps the torrent line and clarifies
 * that Torrentio is only used to discover magnets, not to host the stream.
 *
 * Example output:
 *   name:  "Real-Debrid | Q | 1080p | HEVC"
 *   title: "…filename…\n👤 …\nMagnets: Torrentio (quality) · Playback: Real-Debrid"
 */
export function buildStreamName(
  torrent: TorrentInfo,
  provider: string = "Real-Debrid"
): { name: string; title: string } {
  const raw = torrent.title ?? "";
  const resolution = parseResolution(raw);
  const lower = raw.toLowerCase();

  /** Q/S = which Torrentio sort pass produced this magnet (ordering only). */
  const discoveryLabel = torrent.source === "Torrentio/Q" ? "Q" : torrent.source === "Torrentio/S" ? "S" : "";

  const tags: string[] = [];

  if (discoveryLabel) tags.push(discoveryLabel);
  if (resolution) tags.push(resolution);

  if (/\b(hevc|x265|h265)\b/.test(lower)) tags.push("HEVC");
  else if (/\b(avc|x264|h264)\b/.test(lower)) tags.push("AVC");
  else if (/\bav1\b/.test(lower)) tags.push("AV1");

  if (/\bdolby.?vision\b|\bdv\b/.test(lower)) tags.push("DV");
  else if (/\bhdr10\+/.test(lower)) tags.push("HDR10+");
  else if (/\bhdr10\b/.test(lower)) tags.push("HDR10");
  else if (/\bhdr\b/.test(lower)) tags.push("HDR");

  if (/\b(heb|hebrew)\b/.test(lower)) tags.push("🇮🇱");
  if (/\b(remux)\b/.test(lower)) tags.push("Remux");
  else if (/\b(blu.?ray|bdrip)\b/.test(lower)) tags.push("BluRay");
  else if (/\bweb.?dl\b/.test(lower)) tags.push("WEB-DL");
  else if (/\bwebrip\b/.test(lower)) tags.push("WEBRip");

  const name =
    tags.length > 0 ? `${provider} | ${tags.join(" | ")}` : provider;
  const tierNote =
    torrent.source === "Torrentio/Q"
      ? `Magnets: Torrentio (quality-ranked) · Playback: ${provider}`
      : torrent.source === "Torrentio/S"
      ? `Magnets: Torrentio (by seeders) · Playback: ${provider}`
      : "";

  // Build a compact title line: filename (first line) + seeds/size
  const lines = raw.split(/\n/);
  const filename = lines[0]?.trim() ?? raw.trim();
  const seedsSize = lines.slice(1).join(" ").trim();
  let title = seedsSize ? `${filename}\n${seedsSize}` : filename;
  if (tierNote) {
    title = `${title}\n${tierNote}`;
  }

  return { name, title };
}

// ─── Final stream sort ────────────────────────────────────────────────────────

/**
 * Score a resolved Stream for display ordering.
 * Parses the stream's title (which is the original torrent title).
 */
function scoreStream(stream: Stream): number {
  const lower = (stream.title + " " + stream.name).toLowerCase();
  let score = 0;

  for (const [key, val] of Object.entries(RESOLUTION_SCORE)) {
    if (lower.includes(key)) {
      score += val;
      break;
    }
  }
  for (const [key, val] of Object.entries(CODEC_BONUS)) {
    if (lower.includes(key)) score += val;
  }

  score += scoreAudioPreference(stream.title + " " + stream.name);

  const seeds = parseSeedCount(stream.title);
  score += Math.min(seeds * 0.5, 20);

  const sizeGb = parseSizeGb(stream.title);
  if (sizeGb > 0 && sizeGb < 0.1) score -= 30;

  return score;
}

/** Torrentio Q before S (RD streams only; locals use isLocalStream). */
function torrentioTierRank(stream: Stream): number {
  if (stream.discoveryTier === "quality") return 0;
  if (stream.discoveryTier === "seeders") return 1;
  return 2;
}

function isLocalStream(stream: Stream): boolean {
  return stream.discoveryTier === "local";
}

/**
 * TorBox (and cached RD) return http(s) playback URLs. RD sometimes returns a
 * magnet URI (or a Stremio-style infoHash stream with no http URL). Those are
 * not instantly playable and sort last.
 */
export function isMagnetStream(stream: Stream): boolean {
  if (isLocalStream(stream)) return false;
  const url = stream.url?.trim() ?? "";
  if (/^magnet:/i.test(url)) return true;
  if (stream.infoHash && url.length === 0) return true;
  if (stream.infoHash && url.length > 0 && !/^https?:\/\//i.test(url)) return true;
  return false;
}

/** 0 = direct http(s) remotes, 1 = local files, 2 = magnets. */
function streamGroupRank(stream: Stream): number {
  if (isMagnetStream(stream)) return 2;
  if (isLocalStream(stream)) return 1;
  return 0;
}

function compareRemoteSubSort(a: Stream, b: Stream): number {
  const ra = a.rdCacheScore ?? 0;
  const rb = b.rdCacheScore ?? 0;
  if (rb !== ra) return rb - ra;
  const ta = torrentioTierRank(a);
  const tb = torrentioTierRank(b);
  if (ta !== tb) return ta - tb;
  return scoreStream(b) - scoreStream(a);
}

/**
 * Sort for Stremio:
 *  1. Direct http(s) remotes (TorBox / unrestricted RD).
 *  2. Local files.
 *  3. Magnets last.
 *  Within remotes (direct or magnet): stronger RD instantAvailability, Torrentio Q before S, then title quality.
 */
export function sortStreams(streams: Stream[]): Stream[] {
  return streams.sort((a, b) => {
    const ga = streamGroupRank(a);
    const gb = streamGroupRank(b);
    if (ga !== gb) return ga - gb;

    if (ga !== 1) {
      return compareRemoteSubSort(a, b);
    }

    return scoreStream(b) - scoreStream(a);
  });
}
