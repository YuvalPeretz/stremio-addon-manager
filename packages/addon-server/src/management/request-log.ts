/**
 * Append-only JSONL request log for the management UI (stream requests, remakes).
 */

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { ServerConfig } from "../config.js";

export type RequestLogKind = "stream" | "remake" | "torbox";

/** Outbound provider API steps (e.g. TorBox checkcached / createtorrent / requestdl). */
export interface ProviderApiCall {
  step: string;
  durationMs: number;
  ok: boolean;
  detail?: string | null;
}

/** JSONL / API values may be unknown at runtime. */
export function normalizeSeriesName(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") return value;
  return null;
}

export interface RequestLogEntry {
  id: string;
  at: string;
  kind: RequestLogKind;
  type: string;
  stremioId: string;
  cacheHit: boolean;
  durationMs: number;
  streamCount: number;
  title: string | null;
  /** Cinemeta name (e.g. series title); absent on older log lines. */
  seriesName?: string | null;
  clientIp: string | null;
  error: string | null;
  infoHashes: string[];
  /** When kind === "remake", the source log entry id */
  remadeFromId?: string;
  /** Outbound API call trace (TorBox pipeline steps). */
  providerApiCalls?: ProviderApiCall[];
}

const PRUNE_KEEP_LINES = 8_000;

let ensureDirCache = new Set<string>();

async function ensureDirForFile(filePath: string): Promise<void> {
  const dir = path.dirname(filePath);
  if (ensureDirCache.has(dir)) return;
  await fsp.mkdir(dir, { recursive: true });
  ensureDirCache.add(dir);
}

function parseLine(line: string): RequestLogEntry | null {
  const t = line.trim();
  if (!t) return null;
  try {
    return JSON.parse(t) as RequestLogEntry;
  } catch {
    return null;
  }
}

/**
 * If file is too large, keep the last PRUNE_KEEP_LINES lines.
 */
export async function appendRequestLog(config: ServerConfig, entry: Omit<RequestLogEntry, "id" | "at"> & { id?: string; at?: string }): Promise<RequestLogEntry> {
  const full: RequestLogEntry = {
    id: entry.id ?? randomUUID(),
    at: entry.at ?? new Date().toISOString(),
    kind: entry.kind,
    type: entry.type,
    stremioId: entry.stremioId,
    cacheHit: entry.cacheHit,
    durationMs: entry.durationMs,
    streamCount: entry.streamCount,
    title: entry.title,
    seriesName: entry.seriesName ?? null,
    clientIp: entry.clientIp,
    error: entry.error,
    infoHashes: entry.infoHashes,
    remadeFromId: entry.remadeFromId,
    providerApiCalls: entry.providerApiCalls,
  };

  await ensureDirForFile(config.requestLogPath);
  const line = JSON.stringify(full) + "\n";
  await fsp.appendFile(config.requestLogPath, line, "utf8");

  try {
    const st = await fsp.stat(config.requestLogPath);
    if (st.size > config.requestLogMaxBytes) {
      await pruneRequestLogFile(config.requestLogPath, PRUNE_KEEP_LINES);
    }
  } catch {
    // ignore stat/prune errors
  }

  return full;
}

async function pruneRequestLogFile(filePath: string, keepLastLines: number): Promise<void> {
  const raw = await fsp.readFile(filePath, "utf8");
  const lines = raw.split("\n");
  const nonEmpty = lines.filter((l) => l.trim().length > 0);
  if (nonEmpty.length <= keepLastLines) return;
  const tail = nonEmpty.slice(-keepLastLines);
  const tmp = filePath + ".tmp";
  await fsp.writeFile(tmp, tail.map((l) => l + "\n").join(""), "utf8");
  await fsp.rename(tmp, filePath);
}

export interface ListRequestQuery {
  q?: string;
  kind?: RequestLogKind;
  sort?: "at" | "durationMs" | "streamCount";
  order?: "asc" | "desc";
  from?: number;
  limit?: number;
}

export function clientIpFromReq(req: {
  ip?: string;
  headers: Record<string, string | string[] | undefined>;
}): string | null {
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff.length > 0) {
    return xff.split(",")[0]?.trim() ?? null;
  }
  if (Array.isArray(xff) && xff[0]) {
    return String(xff[0]).split(",")[0]?.trim() ?? null;
  }
  if (req.ip) return String(req.ip);
  return null;
}

/**
 * Read all valid entries (for moderate log sizes; pruned on append).
 */
export async function readAllRequestLogs(config: ServerConfig): Promise<RequestLogEntry[]> {
  if (!fs.existsSync(config.requestLogPath)) return [];
  const raw = await fsp.readFile(config.requestLogPath, "utf8");
  const out: RequestLogEntry[] = [];
  for (const line of raw.split("\n")) {
    const p = parseLine(line);
    if (p) out.push(p);
  }
  return out;
}

export async function listRequestLogs(
  config: ServerConfig,
  query: ListRequestQuery
): Promise<{ items: RequestLogEntry[]; total: number }> {
  const all = await readAllRequestLogs(config);
  let filtered = all;

  const q = (query.q ?? "").trim().toLowerCase();
  if (q) {
    filtered = filtered.filter(
      (e) =>
        e.stremioId.toLowerCase().includes(q) ||
        e.type.toLowerCase().includes(q) ||
        (e.title && e.title.toLowerCase().includes(q)) ||
        (e.seriesName && e.seriesName.toLowerCase().includes(q)) ||
        e.kind.toLowerCase().includes(q) ||
        (e.providerApiCalls &&
          e.providerApiCalls.some(
            (c) =>
              c.step.toLowerCase().includes(q) ||
              (c.detail && c.detail.toLowerCase().includes(q))
          )) ||
        e.id.toLowerCase().includes(q)
    );
  }
  if (query.kind) {
    filtered = filtered.filter((e) => e.kind === query.kind);
  }

  const sort = query.sort ?? "at";
  const order = query.order ?? "desc";
  const dir = order === "asc" ? 1 : -1;
  filtered = [...filtered].sort((a, b) => {
    let av: string | number = 0;
    let bv: string | number = 0;
    if (sort === "at") {
      av = a.at;
      bv = b.at;
    } else if (sort === "durationMs") {
      av = a.durationMs;
      bv = b.durationMs;
    } else {
      av = a.streamCount;
      bv = b.streamCount;
    }
    if (typeof av === "string" && typeof bv === "string") {
      return av < bv ? -dir : av > bv ? dir : 0;
    }
    return (Number(av) - Number(bv)) * dir;
  });

  const total = filtered.length;
  const from = Math.max(0, query.from ?? 0);
  const limit = Math.min(500, Math.max(1, query.limit ?? 200));
  const items = filtered.slice(from, from + limit);
  return { items, total };
}

export async function getRequestById(config: ServerConfig, id: string): Promise<RequestLogEntry | null> {
  const all = await readAllRequestLogs(config);
  return all.find((e) => e.id === id) ?? null;
}

export function uniqueInfoHashes(streams: { infoHash?: string }[]): string[] {
  const s = new Set<string>();
  for (const st of streams) {
    if (st.infoHash) s.add(st.infoHash.toLowerCase());
  }
  return [...s];
}

/** Per-IP stats from the pruned request log (historical, not "live"). */
export interface RequestLogClientAggregate {
  key: string;
  requestCount: number;
  lastAt: string;
  lastTitle: string | null;
  lastSeriesName: string | null;
}

export async function aggregateRequestLogByClient(
  config: ServerConfig,
  limit: number = 200
): Promise<RequestLogClientAggregate[]> {
  const all = await readAllRequestLogs(config);
  const byKey = new Map<string, { count: number; last: RequestLogEntry }>();
  for (const e of all) {
    const key = e.clientIp != null && e.clientIp !== "" ? e.clientIp : "unknown";
    const cur = byKey.get(key);
    if (!cur) {
      byKey.set(key, { count: 1, last: e });
    } else {
      const count = cur.count + 1;
      const last = e.at > cur.last.at ? e : cur.last;
      byKey.set(key, { count, last });
    }
  }
  const out: RequestLogClientAggregate[] = [];
  for (const [k, v] of byKey) {
    out.push({
      key: k,
      requestCount: v.count,
      lastAt: v.last.at,
      lastTitle: v.last.title,
      lastSeriesName: v.last.seriesName ?? null,
    });
  }
  out.sort((a, b) => b.lastAt.localeCompare(a.lastAt));
  return out.slice(0, Math.max(0, limit));
}
