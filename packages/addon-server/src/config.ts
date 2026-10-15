/**
 * Addon Server Configuration
 * Reads from environment variables with defaults
 */

import path from "node:path";
import os from "node:os";

export interface ServerConfig {
  // Real-Debrid
  rdApiToken: string;
  rdApiBase: string;

  // Authentication
  addonPassword: string;
  authEnabled: boolean;

  // Server
  port: number;
  nodeEnv: string;
  domain?: string; // Addon domain (for manifest base URL)

  // Features
  torrentLimit: number;
  availabilityCheckLimit: number;
  maxStreams: number;
  maxConcurrency: number;
  /** Max non-episode-matching torrents to keep as fallbacks after matching ones (series only) */
  seriesNonMatchFallbackLimit: number;

  // Cache TTL (in seconds)
  cacheTtl: {
    metadata: number;
    torrentSearch: number;
    streams: number;
  };

  // Rate Limiting
  rateLimits: {
    streamWindow: number; // milliseconds
    streamMax: number;
    statsWindow: number; // milliseconds
    statsMax: number;
  };

  /**
   * Absolute path for library.json and local-library state.
   * Empty string = feature disabled (set `LOCAL_LIBRARY_DATA_DIR=` in the unit to force off).
   * When the variable is omitted from the environment, defaults to `<process.cwd()>/local-library`
   * (under systemd, cwd is the service WorkingDirectory = addon install dir).
   */
  localLibraryDataDir: string;
  localLibraryScanMaxDepth: number;
  localLibraryScanMaxFiles: number;
  /** Max extra streams from title fuzzy match (0 = disable fuzzy) */
  localLibraryMaxFuzzyResults: number;
  /** Minimum fuzzy score [0, 1] to surface a local file */
  localLibraryFuzzyThreshold: number;

  torboxApiToken: string;
  /** How to query multiple providers: "parallel" merges all results; "ordered" stops at first non-empty */
  streamProviderMode: "parallel" | "ordered";
  /** Ordered provider IDs parsed from STREAM_PROVIDER_ORDER env var */
  streamProviderOrder: string[];

  /**
   * When true, stream URLs are rewritten to route video bytes through this
   * addon's proxy endpoint so that only the Pi's IP contacts Real-Debrid.
   * When false (default), Stremio fetches directly from the RD CDN —
   * lower latency and smoother playback, but the Stremio device's IP is
   * visible to RD.  Safe when the device and Pi share the same public IP
   * (i.e. same LAN).
   */
  proxyRdStreams: boolean;

  // Proxy resilience (stall detection + reconnection)
  /** Milliseconds of upstream inactivity before the proxy considers the connection stalled */
  proxyStallTimeoutMs: number;
  /** Maximum transparent reconnection attempts before giving up on a stalled stream */
  proxyMaxReconnects: number;

  /** JSONL path for management UI request log (default: `~/.stremio-addon/request-log.jsonl`). */
  requestLogPath: string;
  /** Prune log file when it exceeds this size (bytes). */
  requestLogMaxBytes: number;

  /** JSONL path for general server console log (default: `~/.stremio-addon/server.log`). */
  serverLogPath: string;
  /** Prune server log when it exceeds this size (bytes). */
  serverLogMaxBytes: number;

  /** In-memory per-IP client activity: drop clients idle longer than this (seconds). */
  clientActivityTtlSec: number;
  /** Max rows kept in the client-activity map before evicting oldest. */
  clientActivityMaxEntries: number;

  /** Maximum concurrent viewers (unique IPs). 0 = unlimited. */
  maxConcurrentViewers: number;

  /**
   * When true, register `/management/**` (UI + GET APIs for logs, config, deploy scripts).
   * Default false: public streaming instances expose no management/config dump surface.
   * Admin / classic installs set `ENABLE_MANAGEMENT_API=true`.
   */
  enableManagementApi: boolean;

  /**
   * Relative path (from process cwd) to the install deploy script in the admin artifact.
   * Default: `deploy/install.sh`.
   */
  deployInstallScriptRelPath: string;

  /**
   * Relative path (from process cwd) to the update deploy script in the admin artifact.
   * Default: `deploy/update.sh`.
   */
  deployUpdateScriptRelPath: string;
}

/**
 * Validate and clamp a numeric configuration value within specified bounds
 */
function validateConfigValue(
  value: number,
  min: number,
  max: number,
  name: string,
  defaultValue: number
): number {
  if (isNaN(value) || value < min || value > max) {
    console.warn(
      `⚠️  Invalid ${name} value: ${value}. Must be between ${min} and ${max}. Using default: ${defaultValue}`
    );
    return defaultValue;
  }
  return value;
}

/**
 * Parse integer from environment variable with validation
 */
function parseEnvInt(envVar: string | undefined, defaultValue: number, min: number, max: number, name: string): number {
  const value = envVar ? parseInt(envVar, 10) : defaultValue;
  return validateConfigValue(value, min, max, name, defaultValue);
}

function parseEnvFloat(envVar: string | undefined, defaultValue: number, min: number, max: number, name: string): number {
  const raw = envVar?.trim();
  const value = raw !== undefined && raw !== "" ? parseFloat(raw) : defaultValue;
  if (isNaN(value) || value < min || value > max) {
    console.warn(
      `⚠️  Invalid ${name} value: ${raw ?? ""}. Must be between ${min} and ${max}. Using default: ${defaultValue}`
    );
    return defaultValue;
  }
  return value;
}

/**
 * Parse boolean from environment variable (`true`/`1`/`yes`/`on` or `false`/`0`/`no`/`off`).
 */
function parseEnvBool(envVar: string | undefined, defaultValue: boolean, name: string): boolean {
  const raw = envVar?.trim();
  if (raw === undefined || raw === "") {
    return defaultValue;
  }
  const v = raw.toLowerCase();
  if (v === "true" || v === "1" || v === "yes" || v === "on") {
    return true;
  }
  if (v === "false" || v === "0" || v === "no" || v === "off") {
    return false;
  }
  console.warn(
    `⚠️  Invalid ${name} value: ${raw}. Expected boolean. Using default: ${defaultValue}`
  );
  return defaultValue;
}

/**
 * Normalize a deploy-script relative path: trim, strip leading `./`, reject empty / absolute / traversal.
 * Returns default when invalid.
 */
function parseDeployScriptRelPath(envVar: string | undefined, defaultValue: string, name: string): string {
  const raw = envVar?.trim();
  if (raw === undefined || raw === "") {
    return defaultValue;
  }
  const normalized = raw.replace(/\\/g, "/").replace(/^\.\/+/, "");
  if (
    normalized.length === 0 ||
    path.isAbsolute(raw) ||
    normalized.startsWith("/") ||
    normalized.split("/").includes("..")
  ) {
    console.warn(
      `⚠️  Invalid ${name} value: ${raw}. Must be a relative path without "..". Using default: ${defaultValue}`
    );
    return defaultValue;
  }
  return normalized;
}

/**
 * Load configuration from environment variables
 */
export function loadConfig(): ServerConfig {
  // Handle empty strings - treat them as missing tokens
  const rdApiTokenEnv = process.env.RD_API_TOKEN?.trim() || "";
  const rdApiToken = rdApiTokenEnv && rdApiTokenEnv.length > 0 ? rdApiTokenEnv : "YOUR_REAL_DEBRID_TOKEN_HERE";
  const addonPassword = process.env.ADDON_PASSWORD || "YOUR_ADDON_PASSWORD_HERE";
  const authEnabled = Boolean(addonPassword && addonPassword !== "YOUR_ADDON_PASSWORD_HERE");

  // Parse and validate torrent processing limits
  const torrentLimit = parseEnvInt(process.env.TORRENT_LIMIT, 100, 1, 200, "TORRENT_LIMIT");
  const availabilityCheckLimit = parseEnvInt(
    process.env.AVAILABILITY_CHECK_LIMIT,
    100,
    5,
    200,
    "AVAILABILITY_CHECK_LIMIT"
  );
  const maxStreams = parseEnvInt(process.env.MAX_STREAMS, 25, 1, 50, "MAX_STREAMS");
  const maxConcurrency = parseEnvInt(process.env.MAX_CONCURRENCY, 5, 1, 10, "MAX_CONCURRENCY");
  const seriesNonMatchFallbackLimit = parseEnvInt(
    process.env.SERIES_NON_MATCH_FALLBACK_LIMIT,
    30,
    0,
    80,
    "SERIES_NON_MATCH_FALLBACK_LIMIT"
  );

  const localLibraryRaw = process.env.LOCAL_LIBRARY_DATA_DIR;
  const localLibraryDataDir =
    localLibraryRaw === undefined
      ? path.join(process.cwd(), "local-library")
      : String(localLibraryRaw).trim();
  const localLibraryScanMaxDepth = parseEnvInt(process.env.LOCAL_LIBRARY_SCAN_MAX_DEPTH, 12, 0, 32, "LOCAL_LIBRARY_SCAN_MAX_DEPTH");
  const localLibraryScanMaxFiles = parseEnvInt(process.env.LOCAL_LIBRARY_SCAN_MAX_FILES, 5000, 1, 50000, "LOCAL_LIBRARY_SCAN_MAX_FILES");
  const localLibraryMaxFuzzyResults = parseEnvInt(process.env.LOCAL_LIBRARY_MAX_FUZZY_RESULTS, 3, 0, 20, "LOCAL_LIBRARY_MAX_FUZZY_RESULTS");
  const localLibraryFuzzyThreshold = parseEnvFloat(
    process.env.LOCAL_LIBRARY_FUZZY_THRESHOLD,
    0.38,
    0.15,
    0.95,
    "LOCAL_LIBRARY_FUZZY_THRESHOLD"
  );

  const torboxApiToken = (process.env.TORBOX_API_TOKEN ?? "").trim();
  const streamProviderModeRaw = (process.env.STREAM_PROVIDER_MODE ?? "parallel").trim().toLowerCase();
  const streamProviderMode: "parallel" | "ordered" = streamProviderModeRaw === "ordered" ? "ordered" : "parallel";
  const streamProviderOrder = (process.env.STREAM_PROVIDER_ORDER ?? "real-debrid")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const proxyRdStreamsRaw = (process.env.PROXY_RD_STREAMS ?? "").trim().toLowerCase();
  const proxyRdStreams = proxyRdStreamsRaw === "" || proxyRdStreamsRaw === "true";
  const proxyStallTimeoutMs = parseEnvInt(process.env.PROXY_STALL_TIMEOUT_MS, 30000, 10000, 120000, "PROXY_STALL_TIMEOUT_MS");
  const proxyMaxReconnects = parseEnvInt(process.env.PROXY_MAX_RECONNECTS, 3, 0, 10, "PROXY_MAX_RECONNECTS");

  const requestLogPathRaw = process.env.ADDON_REQUEST_LOG?.trim();
  const requestLogPath =
    requestLogPathRaw && requestLogPathRaw.length > 0
      ? path.isAbsolute(requestLogPathRaw)
        ? requestLogPathRaw
        : path.join(process.cwd(), requestLogPathRaw)
      : path.join(os.homedir(), ".stremio-addon", "request-log.jsonl");
  const requestLogMaxBytes = parseEnvInt(process.env.REQUEST_LOG_MAX_BYTES, 3_000_000, 100_000, 100_000_000, "REQUEST_LOG_MAX_BYTES");
  const serverLogPathRaw = process.env.ADDON_SERVER_LOG?.trim();
  const serverLogPath =
    serverLogPathRaw && serverLogPathRaw.length > 0
      ? path.isAbsolute(serverLogPathRaw)
        ? serverLogPathRaw
        : path.join(process.cwd(), serverLogPathRaw)
      : path.join(os.homedir(), ".stremio-addon", "server.log");
  const serverLogMaxBytes = parseEnvInt(process.env.SERVER_LOG_MAX_BYTES, 5_000_000, 100_000, 100_000_000, "SERVER_LOG_MAX_BYTES");
  const clientActivityTtlSec = parseEnvInt(
    process.env.ADDON_CLIENT_ACTIVITY_TTL_SEC,
    3_600,
    60,
    7 * 24 * 3_600,
    "ADDON_CLIENT_ACTIVITY_TTL_SEC"
  );
  const clientActivityMaxEntries = parseEnvInt(
    process.env.ADDON_CLIENT_ACTIVITY_MAX_ENTRIES,
    500,
    20,
    20_000,
    "ADDON_CLIENT_ACTIVITY_MAX_ENTRIES"
  );
  const maxConcurrentViewers = parseEnvInt(
    process.env.MAX_CONCURRENT_VIEWERS,
    10,
    0,
    1_000,
    "MAX_CONCURRENT_VIEWERS"
  );

  const enableManagementApi = parseEnvBool(process.env.ENABLE_MANAGEMENT_API, false, "ENABLE_MANAGEMENT_API");
  const deployInstallScriptRelPath = parseDeployScriptRelPath(
    process.env.DEPLOY_INSTALL_SCRIPT_REL_PATH,
    "deploy/install.sh",
    "DEPLOY_INSTALL_SCRIPT_REL_PATH"
  );
  const deployUpdateScriptRelPath = parseDeployScriptRelPath(
    process.env.DEPLOY_UPDATE_SCRIPT_REL_PATH,
    "deploy/update.sh",
    "DEPLOY_UPDATE_SCRIPT_REL_PATH"
  );

  const config: ServerConfig = {
    // Real-Debrid
    rdApiToken,
    rdApiBase: "https://api.real-debrid.com/rest/1.0",

    // Authentication
    addonPassword,
    authEnabled,

    // Server
    port: parseInt(process.env.PORT || "7000", 10),
    nodeEnv: process.env.NODE_ENV || "development",
    domain: process.env.ADDON_DOMAIN, // Optional domain for manifest base URL

    // Features
    torrentLimit,
    availabilityCheckLimit,
    maxStreams,
    maxConcurrency,
    seriesNonMatchFallbackLimit,

    // Cache TTL (in seconds)
    cacheTtl: {
      metadata: 86400, // 24 hours
      torrentSearch: 21600, // 6 hours
      streams: 86400, // 24 hours - cache entire stream responses to prevent repeated processing
    },

    // Rate Limiting
    rateLimits: {
      streamWindow: 15 * 60 * 1000, // 15 minutes
      streamMax: 50,
      statsWindow: 1 * 60 * 1000, // 1 minute
      statsMax: 120,
    },

    localLibraryDataDir,
    localLibraryScanMaxDepth,
    localLibraryScanMaxFiles,
    localLibraryMaxFuzzyResults,
    localLibraryFuzzyThreshold,

    torboxApiToken,
    streamProviderMode,
    streamProviderOrder,

    proxyRdStreams,
    proxyStallTimeoutMs,
    proxyMaxReconnects,

    requestLogPath,
    requestLogMaxBytes,
    serverLogPath,
    serverLogMaxBytes,
    clientActivityTtlSec,
    clientActivityMaxEntries,
    maxConcurrentViewers,

    enableManagementApi,
    deployInstallScriptRelPath,
    deployUpdateScriptRelPath,
  };

  // Log configuration on startup (hide sensitive values)
  console.log("\n📋 Addon Server Configuration:");
  console.log(`  - Port: ${config.port}`);
  console.log(`  - Environment: ${config.nodeEnv}`);
  console.log(`  - Torrent Limit: ${config.torrentLimit}`);
  console.log(`  - Availability Check Limit: ${config.availabilityCheckLimit}`);
  console.log(`  - Max Streams: ${config.maxStreams}`);
  console.log(`  - Max Concurrency: ${config.maxConcurrency}`);
  console.log(`  - Series non-match fallback limit: ${config.seriesNonMatchFallbackLimit}`);
  console.log(
    `  - Local library: ${
      config.localLibraryDataDir
        ? `enabled (data dir: ${config.localLibraryDataDir})`
        : "disabled (LOCAL_LIBRARY_DATA_DIR is empty)"
    }`
  );
  const hasValidToken = config.rdApiToken && 
                       config.rdApiToken.trim().length > 0 && 
                       config.rdApiToken !== "YOUR_REAL_DEBRID_TOKEN_HERE";
  console.log(`  - Real-Debrid Token: ${hasValidToken ? "Configured ✓" : "Missing ✗"}`);
  console.log(`  - Authentication: ${config.authEnabled ? "Enabled 🔒" : "Disabled ⚠️"}`);
  const hasTorBox = config.torboxApiToken.length > 0;
  console.log(`  - TorBox: ${hasTorBox ? "Configured ✓" : "Not configured"}`);
  console.log(`  - Stream providers: [${config.streamProviderOrder.join(", ")}] mode=${config.streamProviderMode}`);
  console.log(`  - Proxy RD streams: ${config.proxyRdStreams ? "On (video bytes routed through Pi)" : "Off (direct CDN)"}`);
  console.log(`  - Max concurrent viewers: ${config.maxConcurrentViewers === 0 ? "unlimited" : config.maxConcurrentViewers} (MAX_CONCURRENT_VIEWERS)`);
  console.log(`  - Management API: ${config.enableManagementApi ? "Enabled ✓" : "Disabled (public streaming)"}`);
  if (config.enableManagementApi) {
    console.log(`  - Deploy install script: ${config.deployInstallScriptRelPath}`);
    console.log(`  - Deploy update script: ${config.deployUpdateScriptRelPath}`);
  }
  console.log(`  - Request log: ${config.requestLogPath} (max ${config.requestLogMaxBytes} bytes)`);
  console.log(`  - Server log: ${config.serverLogPath} (max ${config.serverLogMaxBytes} bytes)`);
  console.log(
    `  - Client activity: TTL ${config.clientActivityTtlSec}s, max ${config.clientActivityMaxEntries} IPs (ADDON_CLIENT_ACTIVITY_*) \n`
  );

  return config;
}
