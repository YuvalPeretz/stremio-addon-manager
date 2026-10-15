/**
 * Player simulation integration tests
 *
 * These tests spin up a real Express addon server and a fake CDN server, then
 * simulate four concurrent video players (Stremio, VLC, MPV, Expo) making
 * Range requests through the proxy for 5 minutes each.
 *
 * Goal: catch proxy-layer regressions like:
 *   - Memory leaks under sustained load
 *   - Stall detection firing incorrectly (false positives = dropped connections)
 *   - Stall recovery broken (CDN hiccup → proxy should reconnect, not crash)
 *   - Parked session / reconnect cache working correctly
 *   - Throughput degradation over time
 *
 * Run with:  npx vitest run player-simulation --reporter=verbose
 *
 * Override duration: TEST_PLAYER_DURATION_MS=30000 npx vitest run player-simulation
 */

import http from "node:http";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { startFakeCdn } from "./helpers/fake-cdn.js";
import type { FakeCdnServer } from "./helpers/fake-cdn.js";
import { PLAYER_PROFILES, simulatePlayer } from "./helpers/player-simulator.js";
import type { PlayerMetrics } from "./helpers/player-simulator.js";
import { loadConfig } from "../config.js";
import { RealDebridClient } from "../real-debrid.js";
import { CacheManager } from "../cache.js";
import { createServer } from "../server.js";
import { LocalLibraryManager } from "../local-library/manager.js";

// ─── Config ───────────────────────────────────────────────────────────────────

/** Duration each player runs.  Override via env for quick smoke tests. */
const PLAYER_DURATION_MS =
  parseInt(process.env.TEST_PLAYER_DURATION_MS ?? "0", 10) ||
  5 * 60 * 1000; // 5 minutes

/** Fake file size served by the CDN (10 GB virtual — no actual memory allocated). */
const VIRTUAL_FILE_SIZE = 10 * 1024 * 1024 * 1024;

/**
 * Stall injection: the fake CDN will pause for 4 s when the proxy downloads
 * past this byte.  The proxy's stall detector (3 s) should fire and reconnect,
 * so the player sees a brief hiccup but no error.
 */
const STALL_AT_BYTE = 30 * 1024 * 1024; // 30 MB in — hit in the first few seconds
const STALL_DURATION_MS = 4_000;        // longer than proxyStallTimeoutMs (3 s)

// Total timeout: simulation + 3 min for setup/teardown/assertion overhead
const SUITE_TIMEOUT_MS = PLAYER_DURATION_MS + 3 * 60_000;

// ─── Server helper ────────────────────────────────────────────────────────────

function startAddonServer(
  cdnBaseUrl: string,
  password: string
): Promise<{ port: number; close(): Promise<void> }> {
  const t0 = Date.now();
  const tick = (label: string): void => {
    process.stderr.write(`[addon-server init] ${label} +${Date.now() - t0}ms\n`);
  };

  tick("loadConfig");
  const config = {
    ...loadConfig(),
    addonPassword: password,
    authEnabled: false,
    proxyRdStreams: true,
    proxyStallTimeoutMs: 3_000,   // 3 s — shorter than the CDN stall (4 s)
    proxyMaxReconnects: 3,
    maxConcurrentViewers: 0,      // unlimited
    rateLimits: {
      streamWindow: 15 * 60 * 1000,
      streamMax: 9999,
      statsWindow: 60 * 1000,
      statsMax: 9999,
    },
    localLibraryDataDir: "",      // disable local library scanning
  };
  tick("config done");

  const rdClient = new RealDebridClient(config);
  const cacheManager = new CacheManager(config);
  const localLibrary = new LocalLibraryManager(config);
  tick("clients created");

  // Allow localhost CDN URLs through the proxy's URL validator
  const urlValidator = (url: string): boolean =>
    url.startsWith("http://127.0.0.1:") || url.startsWith(cdnBaseUrl);

  const app = createServer(config, rdClient, cacheManager, localLibrary, { urlValidator });
  tick("Express app created");

  return new Promise((resolve, reject) => {
    const srv = app.listen(0, "127.0.0.1", () => {
      tick("HTTP server listening");
      const addr = srv.address() as { port: number };
      resolve({
        port: addr.port,
        close: () => new Promise<void>((res, rej) => srv.close((e) => (e ? rej(e) : res()))),
      });
    });
    srv.on("error", reject);
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mbps(bytes: number, ms: number): number {
  return (bytes / (ms / 1000)) / (1024 * 1024);
}

function formatMetrics(label: string, m: PlayerMetrics): string {
  const throughput = mbps(m.totalBytesReceived, m.durationMs);
  const totalMb = (m.totalBytesReceived / (1024 * 1024)).toFixed(1);
  return (
    `[${label}] ${totalMb} MB in ${(m.durationMs / 1000).toFixed(1)}s ` +
    `= ${throughput.toFixed(1)} MB/s | ` +
    `TTFB=${m.ttfbMs}ms | stalls=${m.stallCount} | ` +
    `reqs=${m.requestCount} | errors=${m.errorCount} | wraps=${m.wrapAroundCount}`
  );
}

function assertPlayerMetrics(label: string, m: PlayerMetrics): void {
  // Print to stderr so it appears even when console.log is mocked
  process.stderr.write(formatMetrics(label, m) + "\n");

  expect(m.errorCount, `${label}: proxy returned HTTP errors`).toBe(0);
  expect(m.ttfbMs, `${label}: time-to-first-byte too high`).toBeLessThan(500);

  // One injected stall (CDN hiccup > 3 s threshold = 1 stall), plus a small buffer
  expect(m.stallCount, `${label}: too many stall events`).toBeLessThanOrEqual(2);

  // At least 1 MB downloaded — confirms the test actually ran
  expect(m.totalBytesReceived, `${label}: no data received`).toBeGreaterThan(1 * 1024 * 1024);
  expect(m.requestCount, `${label}: no requests made`).toBeGreaterThan(0);

  // Throughput over loopback should be >2 MB/s (very conservative for local loopback)
  const avgMbps = mbps(m.totalBytesReceived, m.durationMs);
  expect(avgMbps, `${label}: throughput too low`).toBeGreaterThan(2);
}

// ─── Concurrent player tests ──────────────────────────────────────────────────

// All four players run concurrently.
// Total wall-clock time ≈ PLAYER_DURATION_MS + setup overhead.
describe.concurrent("Video player simulations", { timeout: SUITE_TIMEOUT_MS }, () => {
  let cdn: FakeCdnServer;
  let addonPort: number;
  let addonClose: () => Promise<void>;

  const PASSWORD = "simtest";

  function proxyUrl(path: string): string {
    const target = encodeURIComponent(`${cdn.baseUrl}${path}`);
    return `http://127.0.0.1:${addonPort}/${PASSWORD}/proxy?url=${target}`;
  }

  beforeAll(async () => {
    const t0 = Date.now();
    const tick = (label: string): void => {
      process.stderr.write(`[player-sim setup] ${label} +${Date.now() - t0}ms\n`);
    };

    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});

    tick("starting CDN");
    cdn = await startFakeCdn({
      virtualFileSize: VIRTUAL_FILE_SIZE,
      stallAtByte: STALL_AT_BYTE,
      stallDurationMs: STALL_DURATION_MS,
    });
    tick("CDN ready");

    const addon = await startAddonServer(cdn.baseUrl, PASSWORD);
    tick("addon server ready");
    addonPort = addon.port;
    addonClose = addon.close;
  }, 120_000); // explicit timeout: overrides both hookTimeout and testTimeout

  afterAll(async () => {
    vi.restoreAllMocks();
    await addonClose?.();
    await cdn?.close();
  }, 30_000);

  it("Stremio — proxy playback", async () => {
    const metrics = await simulatePlayer(
      proxyUrl("/video"),
      VIRTUAL_FILE_SIZE,
      PLAYER_PROFILES["stremio"]!,
      PLAYER_DURATION_MS
    );
    assertPlayerMetrics("Stremio", metrics);
  });

  it("VLC — proxy playback", async () => {
    const metrics = await simulatePlayer(
      proxyUrl("/video"),
      VIRTUAL_FILE_SIZE,
      PLAYER_PROFILES["vlc"]!,
      PLAYER_DURATION_MS
    );
    assertPlayerMetrics("VLC", metrics);
  });

  it("MPV — proxy playback", async () => {
    const metrics = await simulatePlayer(
      proxyUrl("/video"),
      VIRTUAL_FILE_SIZE,
      PLAYER_PROFILES["mpv"]!,
      PLAYER_DURATION_MS
    );
    assertPlayerMetrics("MPV", metrics);
  });

  it("Expo/React Native — proxy playback", async () => {
    const metrics = await simulatePlayer(
      proxyUrl("/video"),
      VIRTUAL_FILE_SIZE,
      PLAYER_PROFILES["expo"]!,
      PLAYER_DURATION_MS
    );
    assertPlayerMetrics("Expo", metrics);
  });
});
