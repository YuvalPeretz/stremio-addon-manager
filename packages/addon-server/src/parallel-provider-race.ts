/**
 * Parallel STREAM_PROVIDER_MODE: race RD + TorBox for the first usable result,
 * then merge the slower provider into the stream cache in the background.
 */

import type { Stream } from "./types.js";
import type { CacheManager } from "./cache.js";
import { sortStreams } from "./stream-sorter.js";

export type ProviderSource = "real-debrid" | "torbox";

export type ProviderStreamsResult = {
  source: ProviderSource;
  streams: Stream[];
};

export type RaceFirstUsableResult = {
  /** First non-empty provider result, or empty when both finished with no streams. */
  early: ProviderStreamsResult;
  /** The other provider (always settles; may already be resolved). */
  late: Promise<ProviderStreamsResult>;
};

function streamDedupeKey(stream: Stream): string {
  if (typeof stream.url === "string" && stream.url.length > 0) {
    return `u:${stream.url}`;
  }
  const hash = stream.infoHash?.trim().toLowerCase() ?? "";
  const group = stream.behaviorHints?.bingeGroup ?? "";
  return `h:${hash}:${group}`;
}

/**
 * Drop exact duplicates (same URL, or same infoHash+bingeGroup when URL missing).
 * First occurrence wins so early-provider order is preserved before sortStreams.
 */
export function dedupeRemoteStreams(streams: Stream[]): Stream[] {
  const seen = new Set<string>();
  const out: Stream[] = [];
  for (const stream of streams) {
    const key = streamDedupeKey(stream);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(stream);
  }
  return out;
}

function hasTorBoxStream(streams: Stream[]): boolean {
  return streams.some((s) => s.behaviorHints?.bingeGroup === "torbox");
}

/**
 * Merge late provider streams into the aggregate remote cache.
 * Empty/failed late results leave any existing good cache entry untouched.
 * Re-runs sortStreams on the combined set before writing.
 *
 * @returns Merged remote streams written to cache, or null when cache was left unchanged.
 */
export function mergeLateStreamsIntoCache(
  cacheManager: CacheManager,
  cacheKey: string,
  earlyStreams: Stream[],
  lateStreams: Stream[],
  torboxCacheTtlSec: number
): Stream[] | null {
  if (lateStreams.length === 0) {
    return null;
  }

  const combined = dedupeRemoteStreams([...earlyStreams, ...lateStreams]);
  sortStreams(combined);

  const useTorboxTtl = hasTorBoxStream(combined);
  const ttl = useTorboxTtl ? torboxCacheTtlSec : undefined;
  cacheManager.setStream(cacheKey, { streams: combined }, ttl);
  return combined;
}

function tagProvider(
  source: ProviderSource,
  promise: Promise<Stream[]>
): Promise<ProviderStreamsResult> {
  return promise.then(
    (streams) => ({ source, streams }),
    (error: unknown) => {
      console.error(`[parallel-race] ${source} failed:`, error);
      return { source, streams: [] };
    }
  );
}

/**
 * Resolve as soon as one provider yields usable (non-empty) streams.
 * Does not cancel the other provider — its result is available via `late`.
 * If both finish empty, `early.streams` is [] and `late` resolves empty too.
 */
export function raceFirstUsableProvider(
  rdPromise: Promise<Stream[]>,
  torboxPromise: Promise<Stream[]>
): Promise<RaceFirstUsableResult> {
  const rdTagged = tagProvider("real-debrid", rdPromise);
  const tbTagged = tagProvider("torbox", torboxPromise);

  return new Promise<RaceFirstUsableResult>((resolve) => {
    let finished = false;
    const settled: Partial<Record<ProviderSource, ProviderStreamsResult>> = {};

    const finish = (early: ProviderStreamsResult, late: Promise<ProviderStreamsResult>): void => {
      if (finished) return;
      finished = true;
      resolve({ early, late });
    };

    const onSettled = (result: ProviderStreamsResult): void => {
      settled[result.source] = result;
      if (finished) return;

      const rd = settled["real-debrid"];
      const tb = settled.torbox;

      if (result.streams.length > 0) {
        const otherSource: ProviderSource =
          result.source === "real-debrid" ? "torbox" : "real-debrid";
        const otherSettled = settled[otherSource];
        const otherPromise =
          otherSource === "real-debrid"
            ? rdTagged
            : tbTagged;
        finish(
          { source: result.source, streams: result.streams },
          otherSettled
            ? Promise.resolve(otherSettled)
            : otherPromise
        );
        return;
      }

      // Both done and empty (or the non-empty path already finished above)
      if (rd && tb) {
        finish(
          { source: "real-debrid", streams: [] },
          Promise.resolve({ source: "torbox", streams: tb.streams })
        );
      }
    };

    void rdTagged.then(onSettled);
    void tbTagged.then(onSettled);
  });
}
