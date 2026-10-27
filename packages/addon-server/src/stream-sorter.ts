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
//
// Resolution is the top digit. Inside one resolution the order is source, then
// HDR, then codec. Seeds, audio, and the Q/S label only break ties — they cannot
// lift a WEB-DL AVC over a BluRay HEVC of the same resolution, or a 1080p over a 4K.

const RESOLUTION_WEIGHT = 1_000_000;
const SOURCE_WEIGHT = 10_000;
const HDR_WEIGHT = 1_000;
const CODEC_WEIGHT = 100;

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
  if (/\bsd\b/.test(lower)) return "SD";
  return "";
}

const RESOLUTION_RANK: Record<string, number> = {
  "4K": 100,
  "1080p": 80,
  "1080i": 75,
  "720p": 60,
  "480p": 35,
  "360p": 20,
  SD: 15,
};

/** Remux > BluRay > WEB-DL > WEBRip > HDTV > unlabeled > CAM. One bucket, no stacking. */
function sourceRank(lower: string): number {
  if (/\b(remux|bdremux)\b/.test(lower)) return 6;
  if (/\b(blu[- ]?ray|bdrip|brrip)\b/.test(lower)) return 5;
  if (/\bweb[-. ]?rip\b/.test(lower)) return 3;
  if (/\bweb[-. ]?dl\b/.test(lower) || /\bweb\b/.test(lower)) return 4;
  if (/\bhdtv\b/.test(lower)) return 2;
  if (/\b(cam|hdcam|telesync|hdts|telecine)\b/.test(lower)) return 0;
  return 1;
}

/** Dolby Vision > HDR10+ > HDR10 > HDR > none. DVD is not Dolby Vision. */
function hdrRank(lower: string): number {
  if (/\bdolby[\s.-]?vision\b/.test(lower) || /\bdovi\b/.test(lower) || /\bdv\b/.test(lower)) return 4;
  if (/\bhdr10\+/.test(lower) || /\bhdr10plus\b/.test(lower)) return 3;
  if (/\bhdr10\b/.test(lower)) return 2;
  if (/\bhdr\b/.test(lower)) return 1;
  return 0;
}

/** HEVC > AV1 > AVC > unlabeled. */
function codecRank(lower: string): number {
  if (/\b(hevc|x265|h\.?265)\b/.test(lower)) return 3;
  if (/\bav1\b/.test(lower)) return 2;
  if (/\b(avc|x264|h\.?264)\b/.test(lower)) return 1;
  return 0;
}

/**
 * Rank a title for sorting. A lower tier cannot overtake a higher one:
 * resolution, then source, then HDR, then codec, then audio / Hebrew / seeds.
 */
function qualityScore(text: string): number {
  const lower = text.toLowerCase();
  const resolution = resolutionRank(text) ?? 0;
  let score = resolution * RESOLUTION_WEIGHT;
  score += sourceRank(lower) * SOURCE_WEIGHT;
  score += hdrRank(lower) * HDR_WEIGHT;
  score += codecRank(lower) * CODEC_WEIGHT;
  score += scoreAudioPreference(text);
  if (/\b(heb|hebrew)\b/.test(lower)) score += 3;
  score += Math.min(parseSeedCount(text) * 0.5, 20);
  const sizeGb = parseSizeGb(text);
  // Below every real file of this resolution, still above the next resolution down.
  if (sizeGb > 0 && sizeGb < 0.1) score -= 100_000;
  return score;
}

/** Numeric rank for a title, or null when no resolution is present. */
export function resolutionRank(title: string): number | null {
  const label = parseResolution(title);
  if (!label) return null;
  const rank = RESOLUTION_RANK[label];
  return rank === undefined ? null : rank;
}

export function streamResolutionRank(stream: Pick<Stream, "name" | "title">): number | null {
  return resolutionRank(`${stream.name} ${stream.title}`);
}

/** True when every stream has the same known resolution. */
export function allSameResolution(streams: Array<Pick<Stream, "name" | "title">>): boolean {
  if (streams.length === 0) return false;
  const ranks = streams.map(streamResolutionRank);
  const first = ranks[0];
  if (first == null) return false;
  return ranks.every((rank) => rank === first);
}

/**
 * Best TorBox stream strictly below the baseline resolution.
 * Candidates must already have been fetched; this does not search.
 */
export function pickLowerResolutionTorBox(baseline: Stream[], candidates: Stream[]): Stream | null {
  if (!allSameResolution(baseline)) return null;
  const top = streamResolutionRank(baseline[0]);
  if (top == null) return null;
  const used = new Set(baseline.map((stream) => stream.url).filter((url) => url.length > 0));
  let best: Stream | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const candidate of candidates) {
    if (candidate.behaviorHints?.bingeGroup !== "torbox") continue;
    if (candidate.url && used.has(candidate.url)) continue;
    const rank = streamResolutionRank(candidate);
    if (rank == null || rank >= top) continue;
    const score = qualityScore(`${candidate.name} ${candidate.title}`);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

/**
 * Assign a numeric quality score to a torrent for sorting purposes.
 * Higher = better quality / more preferred.
 */
export function scoreTorrent(torrent: TorrentInfo): number {
  const text = `${torrent.title} ${torrent.quality ?? ""}`;
  return qualityScore(text) + (SOURCE_SCORE[torrent.source ?? ""] ?? 0);
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
  return qualityScore(`${stream.title} ${stream.name}`);
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
  const qa = scoreStream(a);
  const qb = scoreStream(b);
  if (qb !== qa) return qb - qa;
  const ra = a.rdCacheScore ?? 0;
  const rb = b.rdCacheScore ?? 0;
  if (rb !== ra) return rb - ra;
  return torrentioTierRank(a) - torrentioTierRank(b);
}

/**
 * Sort for Stremio:
 *  1. Direct http(s) remotes (TorBox / unrestricted RD).
 *  2. Local files.
 *  3. Magnets last.
 *  Within remotes (direct or magnet): resolution, then source / HDR / codec.
 *  RD instant availability and Torrentio Q-before-S only break a tie.
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
