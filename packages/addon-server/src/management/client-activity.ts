/**
 * In-memory per-IP client activity for the management UI.
 * Stremio has no sessions — we approximate "connected" with active proxy / stream fetches
 * and last-seen + User-Agent.
 */

import type { ServerConfig } from "../config.js";
import type { StreamResponse } from "../types.js";
import type { Request } from "express";
import { clientIpFromReq } from "./request-log.js";

function userAgentFromReq(req: Request): string | null {
  const ua = req.get("user-agent");
  if (ua == null || typeof ua !== "string") return null;
  const t = ua.trim();
  return t.length > 0 ? t : null;
}

function clientKey(req: Request): string {
  return clientIpFromReq(req) ?? "unknown";
}

const TORBOX_LEASE_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

export interface ClientLiveEntry {
  /** clientIp or "unknown" */
  key: string;
  lastSeen: string;
  userAgent: string | null;
  activeProxy: number;
  activeStreamFetch: number;
  manifestCount: number;
  streamRequestCount: number;
  lastStreamTitle: string | null;
  lastSeriesName: string | null;
  torboxLeaseExpiresAt: string | null;
}

interface MutableRow {
  key: string;
  lastSeenMs: number;
  lastSeen: string;
  userAgent: string | null;
  activeProxy: number;
  activeStreamFetch: number;
  manifestCount: number;
  streamRequestCount: number;
  lastStreamTitle: string | null;
  lastSeriesName: string | null;
  torboxLeaseExpiresMs: number;
}

function emptyRow(key: string): MutableRow {
  return {
    key,
    lastSeenMs: 0,
    lastSeen: new Date(0).toISOString(),
    userAgent: null,
    activeProxy: 0,
    activeStreamFetch: 0,
    manifestCount: 0,
    streamRequestCount: 0,
    lastStreamTitle: null,
    lastSeriesName: null,
    torboxLeaseExpiresMs: 0,
  };
}

export class ClientActivityManager {
  private readonly config: ServerConfig;
  private readonly byKey = new Map<string, MutableRow>();

  constructor(config: ServerConfig) {
    this.config = config;
  }

  private ensure(key: string): MutableRow {
    const existing = this.byKey.get(key);
    if (existing) return existing;
    const row = { ...emptyRow(key) };
    this.byKey.set(key, row);
    this.enforceMaxEntries();
    return row;
  }

  private touchKey(key: string, ua: string | null): MutableRow {
    const row = this.ensure(key);
    const now = Date.now();
    row.lastSeenMs = now;
    row.lastSeen = new Date(now).toISOString();
    if (ua != null) {
      row.userAgent = ua;
    }
    return row;
  }

  private rowFromReq(req: Request): { key: string; row: MutableRow; ua: string | null } {
    const key = clientKey(req);
    const ua = userAgentFromReq(req);
    const row = this.touchKey(key, ua);
    return { key, row, ua };
  }

  /** manifest.json and similar quick hits */
  recordManifest(req: Request): void {
    const { row } = this.rowFromReq(req);
    row.manifestCount += 1;
  }

  beginStreamFetch(req: Request): void {
    const { row } = this.rowFromReq(req);
    row.activeStreamFetch += 1;
  }

  endStreamFetch(req: Request): void {
    const key = clientKey(req);
    const row = this.byKey.get(key);
    if (row) {
      row.activeStreamFetch = Math.max(0, row.activeStreamFetch - 1);
    }
  }

  beginProxy(req: Request): void {
    const { row } = this.rowFromReq(req);
    row.activeProxy += 1;
  }

  endProxy(req: Request): void {
    const key = clientKey(req);
    const row = this.byKey.get(key);
    if (row) {
      row.activeProxy = Math.max(0, row.activeProxy - 1);
    }
  }

  recordStreamResult(req: Request, result: StreamResponse): void {
    const { row } = this.rowFromReq(req);
    row.streamRequestCount += 1;
    if (result.streams[0]) {
      row.lastStreamTitle = result.streams[0].name ?? null;
    } else {
      row.lastStreamTitle = null;
    }
    const sn = result.logContext?.showName;
    row.lastSeriesName = sn != null && sn !== "" ? String(sn) : null;
  }

  /** Light touch for short proxy probe (HEAD) */
  recordProxyProbe(req: Request): void {
    void this.rowFromReq(req);
  }

  /** Record or refresh a TorBox viewing lease for an IP (2-hour TTL). */
  beginTorBoxLease(ip: string): void {
    const row = this.touchKey(ip, null);
    row.torboxLeaseExpiresMs = Date.now() + TORBOX_LEASE_TTL_MS;
  }

  /** Number of unique IPs currently active (RD proxy connection OR unexpired TorBox lease). */
  getTotalActiveViewerCount(): number {
    const now = Date.now();
    let count = 0;
    for (const row of this.byKey.values()) {
      if (row.activeProxy > 0 || row.torboxLeaseExpiresMs > now) count++;
    }
    return count;
  }

  /**
   * Returns true when a *new* viewer (ip not yet active) would push the count over the limit.
   * Always returns false for IPs that already have an active proxy or lease — existing viewers
   * are never blocked.
   */
  isAtCapacity(limit: number, ip: string): boolean {
    if (limit <= 0) return false;
    const now = Date.now();
    const row = this.byKey.get(ip);
    if (row && (row.activeProxy > 0 || row.torboxLeaseExpiresMs > now)) return false;
    return this.getTotalActiveViewerCount() >= limit;
  }

  private enforceMaxEntries(): void {
    const max = this.config.clientActivityMaxEntries;
    if (this.byKey.size <= max) return;
    const sorted = [...this.byKey.entries()]
      .filter(([, r]) => r.activeProxy === 0 && r.activeStreamFetch === 0)
      .sort((a, b) => a[1].lastSeenMs - b[1].lastSeenMs);
    while (this.byKey.size > max && sorted.length > 0) {
      const [k] = sorted.shift()!;
      this.byKey.delete(k);
    }
  }

  private pruneStale(): void {
    const ttlMs = this.config.clientActivityTtlSec * 1000;
    const now = Date.now();
    for (const [k, row] of this.byKey) {
      if (row.activeProxy > 0 || row.activeStreamFetch > 0) continue;
      if (now - row.lastSeenMs > ttlMs) {
        this.byKey.delete(k);
      }
    }
  }

  getLiveRows(): { ttlSec: number; maxEntries: number; clients: ClientLiveEntry[] } {
    this.pruneStale();
    const out: ClientLiveEntry[] = [];
    for (const row of this.byKey.values()) {
      const now = Date.now();
      out.push({
        key: row.key,
        lastSeen: row.lastSeen,
        userAgent: row.userAgent,
        activeProxy: row.activeProxy,
        activeStreamFetch: row.activeStreamFetch,
        manifestCount: row.manifestCount,
        streamRequestCount: row.streamRequestCount,
        lastStreamTitle: row.lastStreamTitle,
        lastSeriesName: row.lastSeriesName,
        torboxLeaseExpiresAt: row.torboxLeaseExpiresMs > now
          ? new Date(row.torboxLeaseExpiresMs).toISOString()
          : null,
      });
    }
    out.sort((a, b) => b.lastSeen.localeCompare(a.lastSeen));
    return {
      ttlSec: this.config.clientActivityTtlSec,
      maxEntries: this.config.clientActivityMaxEntries,
      clients: out,
    };
  }
}
