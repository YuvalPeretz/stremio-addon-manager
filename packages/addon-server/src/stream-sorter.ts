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
  "uhd": 100,
  "1080p": 80,
  "1080i": 75,
  "720p": 60,
  "480p": 35,
  "360p": 20,
  "sd": 15,
};

// Bonus points added on top of resolution score
const CODEC_BONUS: Record<string, number> = {
  "hevc": 5, "x265": 5, "h265": 5,
  "av1": 4,
  "hdr": 8, "hdr10": 9, "hdr10+": 10, "dv": 10, "dolby vision": 10,
  "remux": 12,
  "bluray": 6, "blu-ray": 6, "bdrip": 5,
  "web-dl": 3, "webdl": 3, "webrip": 2,
  "hdtv": 1,
  "heb": 3, "hebrew": 3, // user preference
};

const SOURCE_SCORE: Record<string, number> = {
  "Torrentio+RD": 15, // pre-verified available on RD
  "Torrentio": 5,
  "Knightcrawler": 3,
};

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
    if (title.includes(key)) { score += val; break; }
  }

  // Codec / source bonuses
  for (const [key, val] of Object.entries(CODEC_BONUS)) {
    if (title.includes(key)) score += val;
  }

  // Search source bonus
  score += SOURCE_SCORE[torrent.source ?? ""] ?? 0;

  // Seeds: diminishing returns, capped at +20
  const seeds = parseSeedCount(torrent.title);
  score += Math.min(seeds * 0.5, 20);

  // Size penalty for suspiciously small files (< 100 MB likely wrong file / sample)
  const sizeGb = parseSizeGb(torrent.title);
  if (sizeGb > 0 && sizeGb < 0.1) score -= 30;

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
 * Example output:
 *   name:  "RD | 1080p | HEVC"
 *   title: "Naruto.S02E42.1080p.BluRay.x265\n👤 12  💾 400 MB"
 */
export function buildStreamName(torrent: TorrentInfo): { name: string; title: string } {
  const raw = torrent.title ?? "";
  const resolution = parseResolution(raw);
  const lower = raw.toLowerCase();

  const tags: string[] = [];

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

  const name = tags.length > 0 ? `RD | ${tags.join(" | ")}` : "RD";

  // Build a compact title line: filename (first line) + seeds/size
  const lines = raw.split(/\n/);
  const filename = lines[0]?.trim() ?? raw.trim();
  const seedsSize = lines.slice(1).join(" ").trim();
  const title = seedsSize ? `${filename}\n${seedsSize}` : filename;

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
    if (lower.includes(key)) { score += val; break; }
  }
  for (const [key, val] of Object.entries(CODEC_BONUS)) {
    if (lower.includes(key)) score += val;
  }

  const seeds = parseSeedCount(stream.title);
  score += Math.min(seeds * 0.5, 20);

  const sizeGb = parseSizeGb(stream.title);
  if (sizeGb > 0 && sizeGb < 0.1) score -= 30;

  return score;
}

/**
 * Sort resolved Stream[] for display in Stremio (best quality first).
 */
export function sortStreams(streams: Stream[]): Stream[] {
  return streams.sort((a, b) => scoreStream(b) - scoreStream(a));
}
