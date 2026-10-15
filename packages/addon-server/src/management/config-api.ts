/**
 * Management GET helpers: redacted config, env schema, runtime status.
 * No write/mutate endpoints — config apply goes through deploy scripts.
 */

import type { ServerConfig } from "../config.js";
import type { CacheManager } from "../cache.js";

const RD_TOKEN_SENTINEL = "YOUR_REAL_DEBRID_TOKEN_HERE";
const PASSWORD_SENTINEL = "YOUR_ADDON_PASSWORD_HERE";
const REDACTED = "[REDACTED]";

export interface ConfigSchemaEntry {
  key: string;
  type: "string" | "number" | "boolean";
  description: string;
  default?: string | number | boolean;
  sensitive: boolean;
  required: boolean;
  min?: number;
  max?: number;
}

/** Minimal env schema for Electron Env UI (addon-server has no dependency on core). */
export function getConfigSchema(): ConfigSchemaEntry[] {
  return [
    {
      key: "NODE_ENV",
      type: "string",
      description: "Node.js environment",
      default: "production",
      sensitive: false,
      required: true,
    },
    {
      key: "PORT",
      type: "number",
      description: "Addon server port",
      default: 7000,
      sensitive: false,
      required: true,
      min: 1024,
      max: 65535,
    },
    {
      key: "RD_API_TOKEN",
      type: "string",
      description: "Real-Debrid API token",
      sensitive: true,
      required: true,
    },
    {
      key: "ADDON_PASSWORD",
      type: "string",
      description: "Addon authentication password",
      sensitive: true,
      required: true,
    },
    {
      key: "ADDON_DOMAIN",
      type: "string",
      description: "Addon domain for manifest base URL",
      sensitive: false,
      required: false,
    },
    {
      key: "TORRENT_LIMIT",
      type: "number",
      description: "Maximum number of torrents to process",
      default: 100,
      sensitive: false,
      required: true,
      min: 1,
      max: 200,
    },
    {
      key: "AVAILABILITY_CHECK_LIMIT",
      type: "number",
      description: "Number of torrents to check for instant availability",
      default: 100,
      sensitive: false,
      required: false,
      min: 5,
      max: 200,
    },
    {
      key: "MAX_STREAMS",
      type: "number",
      description: "Maximum number of streams to return",
      default: 25,
      sensitive: false,
      required: false,
      min: 1,
      max: 50,
    },
    {
      key: "MAX_CONCURRENCY",
      type: "number",
      description: "Number of torrents to process in parallel",
      default: 5,
      sensitive: false,
      required: false,
      min: 1,
      max: 10,
    },
    {
      key: "TORBOX_API_TOKEN",
      type: "string",
      description: "TorBox API token (optional)",
      sensitive: true,
      required: false,
    },
    {
      key: "STREAM_PROVIDER_MODE",
      type: "string",
      description: "How to query providers: parallel or ordered",
      default: "parallel",
      sensitive: false,
      required: false,
    },
    {
      key: "STREAM_PROVIDER_ORDER",
      type: "string",
      description: "Comma-separated provider IDs in priority order",
      default: "real-debrid",
      sensitive: false,
      required: false,
    },
    {
      key: "PROXY_RD_STREAMS",
      type: "boolean",
      description: "Route RD video bytes through this addon",
      default: true,
      sensitive: false,
      required: false,
    },
    {
      key: "MAX_CONCURRENT_VIEWERS",
      type: "number",
      description: "Max concurrent viewers (unique IPs); 0 = unlimited",
      default: 10,
      sensitive: false,
      required: false,
      min: 0,
      max: 1000,
    },
    {
      key: "LOCAL_LIBRARY_DATA_DIR",
      type: "string",
      description: "Local library data directory (empty string disables)",
      sensitive: false,
      required: false,
    },
    {
      key: "ENABLE_MANAGEMENT_API",
      type: "boolean",
      description: "Expose /management UI and GET APIs (admin instance only)",
      default: false,
      sensitive: false,
      required: false,
    },
    {
      key: "DEPLOY_INSTALL_SCRIPT_REL_PATH",
      type: "string",
      description: "Relative path to install deploy script under cwd",
      default: "deploy/install.sh",
      sensitive: false,
      required: false,
    },
    {
      key: "DEPLOY_UPDATE_SCRIPT_REL_PATH",
      type: "string",
      description: "Relative path to update deploy script under cwd",
      default: "deploy/update.sh",
      sensitive: false,
      required: false,
    },
  ];
}

function hasConfiguredSecret(value: string, sentinel?: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (sentinel && trimmed === sentinel) return false;
  return true;
}

/**
 * Effective server config with secrets redacted (RD_*, tokens, ADDON_PASSWORD).
 */
export function getRedactedConfig(config: ServerConfig): Record<string, unknown> {
  const rdConfigured = hasConfiguredSecret(config.rdApiToken, RD_TOKEN_SENTINEL);
  const passwordConfigured = hasConfiguredSecret(config.addonPassword, PASSWORD_SENTINEL);
  const torboxConfigured = hasConfiguredSecret(config.torboxApiToken);

  return {
    port: config.port,
    nodeEnv: config.nodeEnv,
    domain: config.domain ?? null,
    authEnabled: config.authEnabled,
    torrentLimit: config.torrentLimit,
    availabilityCheckLimit: config.availabilityCheckLimit,
    maxStreams: config.maxStreams,
    maxConcurrency: config.maxConcurrency,
    seriesNonMatchFallbackLimit: config.seriesNonMatchFallbackLimit,
    cacheTtl: { ...config.cacheTtl },
    rateLimits: { ...config.rateLimits },
    localLibraryDataDir: config.localLibraryDataDir,
    localLibraryScanMaxDepth: config.localLibraryScanMaxDepth,
    localLibraryScanMaxFiles: config.localLibraryScanMaxFiles,
    localLibraryMaxFuzzyResults: config.localLibraryMaxFuzzyResults,
    localLibraryFuzzyThreshold: config.localLibraryFuzzyThreshold,
    streamProviderMode: config.streamProviderMode,
    streamProviderOrder: [...config.streamProviderOrder],
    proxyRdStreams: config.proxyRdStreams,
    proxyStallTimeoutMs: config.proxyStallTimeoutMs,
    proxyMaxReconnects: config.proxyMaxReconnects,
    requestLogPath: config.requestLogPath,
    requestLogMaxBytes: config.requestLogMaxBytes,
    serverLogPath: config.serverLogPath,
    serverLogMaxBytes: config.serverLogMaxBytes,
    clientActivityTtlSec: config.clientActivityTtlSec,
    clientActivityMaxEntries: config.clientActivityMaxEntries,
    maxConcurrentViewers: config.maxConcurrentViewers,
    enableManagementApi: config.enableManagementApi,
    deployInstallScriptRelPath: config.deployInstallScriptRelPath,
    deployUpdateScriptRelPath: config.deployUpdateScriptRelPath,
    // Secrets: never return raw values
    rdApiToken: rdConfigured ? REDACTED : null,
    rdApiConfigured: rdConfigured,
    addonPassword: passwordConfigured ? REDACTED : null,
    addonPasswordConfigured: passwordConfigured,
    torboxApiToken: torboxConfigured ? REDACTED : null,
    torboxApiConfigured: torboxConfigured,
    rdApiBase: config.rdApiBase,
  };
}

export interface RuntimeStatus {
  serverTime: string;
  uptimeSec: number;
  nodeEnv: string;
  port: number;
  enableManagementApi: boolean;
  authEnabled: boolean;
  streamProviderMode: ServerConfig["streamProviderMode"];
  streamProviderOrder: string[];
  proxyRdStreams: boolean;
  maxConcurrentViewers: number;
  localLibraryEnabled: boolean;
  rdApiConfigured: boolean;
  torboxApiConfigured: boolean;
  cache: {
    stats: ReturnType<CacheManager["getStats"]>;
    sizes: ReturnType<CacheManager["getSizes"]>;
    ttlSec: ServerConfig["cacheTtl"];
  };
}

export function getRuntimeStatus(config: ServerConfig, cache: CacheManager): RuntimeStatus {
  return {
    serverTime: new Date().toISOString(),
    uptimeSec: Math.floor(process.uptime()),
    nodeEnv: config.nodeEnv,
    port: config.port,
    enableManagementApi: config.enableManagementApi,
    authEnabled: config.authEnabled,
    streamProviderMode: config.streamProviderMode,
    streamProviderOrder: [...config.streamProviderOrder],
    proxyRdStreams: config.proxyRdStreams,
    maxConcurrentViewers: config.maxConcurrentViewers,
    localLibraryEnabled: Boolean(config.localLibraryDataDir),
    rdApiConfigured: hasConfiguredSecret(config.rdApiToken, RD_TOKEN_SENTINEL),
    torboxApiConfigured: hasConfiguredSecret(config.torboxApiToken),
    cache: {
      stats: cache.getStats(),
      sizes: cache.getSizes(),
      ttlSec: { ...config.cacheTtl },
    },
  };
}
