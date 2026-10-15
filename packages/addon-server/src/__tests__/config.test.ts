import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import path from "node:path";
import os from "node:os";

// Suppress startup console.log noise from loadConfig()
beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

// Import loadConfig dynamically so each test gets a fresh read of process.env.
// Static import would cache the module; dynamic import + vi.resetModules ensures
// each call re-evaluates the env vars from scratch.
async function freshLoadConfig() {
  vi.resetModules();
  const { loadConfig } = await import("../config.js");
  return loadConfig();
}

// ─── Integer env vars ─────────────────────────────────────────────────────────

describe("loadConfig — integer env vars", () => {
  it("parses valid TORRENT_LIMIT", async () => {
    vi.stubEnv("TORRENT_LIMIT", "50");
    const config = await freshLoadConfig();
    expect(config.torrentLimit).toBe(50);
  });

  it("clamps TORRENT_LIMIT to default when above max (200)", async () => {
    vi.stubEnv("TORRENT_LIMIT", "999");
    const config = await freshLoadConfig();
    expect(config.torrentLimit).toBe(100); // default
  });

  it("clamps TORRENT_LIMIT to default when below min (1)", async () => {
    vi.stubEnv("TORRENT_LIMIT", "0");
    const config = await freshLoadConfig();
    expect(config.torrentLimit).toBe(100); // default
  });

  it("falls back to default when TORRENT_LIMIT is NaN", async () => {
    vi.stubEnv("TORRENT_LIMIT", "abc");
    const config = await freshLoadConfig();
    expect(config.torrentLimit).toBe(100); // default
  });

  it("parses valid MAX_STREAMS", async () => {
    vi.stubEnv("MAX_STREAMS", "10");
    const config = await freshLoadConfig();
    expect(config.maxStreams).toBe(10);
  });

  it("clamps MAX_CONCURRENCY to default on out-of-range value", async () => {
    vi.stubEnv("MAX_CONCURRENCY", "99");
    const config = await freshLoadConfig();
    expect(config.maxConcurrency).toBe(5); // default
  });
});

// ─── RD token / auth ──────────────────────────────────────────────────────────

describe("loadConfig — RD token and auth", () => {
  it("empty RD_API_TOKEN becomes sentinel string", async () => {
    vi.stubEnv("RD_API_TOKEN", "");
    const config = await freshLoadConfig();
    expect(config.rdApiToken).toBe("YOUR_REAL_DEBRID_TOKEN_HERE");
  });

  it("whitespace-only RD_API_TOKEN treated as missing", async () => {
    vi.stubEnv("RD_API_TOKEN", "   ");
    const config = await freshLoadConfig();
    expect(config.rdApiToken).toBe("YOUR_REAL_DEBRID_TOKEN_HERE");
  });

  it("valid RD_API_TOKEN is stored as-is", async () => {
    vi.stubEnv("RD_API_TOKEN", "MYTOKEN123");
    const config = await freshLoadConfig();
    expect(config.rdApiToken).toBe("MYTOKEN123");
  });

  it("authEnabled is false when ADDON_PASSWORD is the sentinel", async () => {
    vi.stubEnv("ADDON_PASSWORD", "YOUR_ADDON_PASSWORD_HERE");
    const config = await freshLoadConfig();
    expect(config.authEnabled).toBe(false);
  });

  it("authEnabled is true when a real password is set", async () => {
    vi.stubEnv("ADDON_PASSWORD", "s3cr3tP@ss");
    const config = await freshLoadConfig();
    expect(config.authEnabled).toBe(true);
  });
});

// ─── Stream provider configuration ────────────────────────────────────────────

describe("loadConfig — stream provider config", () => {
  it("parses STREAM_PROVIDER_ORDER as comma-separated list", async () => {
    vi.stubEnv("STREAM_PROVIDER_ORDER", "torbox,real-debrid");
    const config = await freshLoadConfig();
    expect(config.streamProviderOrder).toEqual(["torbox", "real-debrid"]);
  });

  it("trims whitespace from each provider in STREAM_PROVIDER_ORDER", async () => {
    vi.stubEnv("STREAM_PROVIDER_ORDER", "  torbox , real-debrid  ");
    const config = await freshLoadConfig();
    expect(config.streamProviderOrder).toEqual(["torbox", "real-debrid"]);
  });

  it("filters empty segments from STREAM_PROVIDER_ORDER", async () => {
    vi.stubEnv("STREAM_PROVIDER_ORDER", "torbox,,real-debrid");
    const config = await freshLoadConfig();
    expect(config.streamProviderOrder).toEqual(["torbox", "real-debrid"]);
  });

  it("defaults STREAM_PROVIDER_ORDER to ['real-debrid'] when unset", async () => {
    const config = await freshLoadConfig();
    expect(config.streamProviderOrder).toEqual(["real-debrid"]);
  });

  it("STREAM_PROVIDER_MODE=ordered sets ordered mode", async () => {
    vi.stubEnv("STREAM_PROVIDER_MODE", "ordered");
    const config = await freshLoadConfig();
    expect(config.streamProviderMode).toBe("ordered");
  });

  it("unknown STREAM_PROVIDER_MODE defaults to parallel", async () => {
    vi.stubEnv("STREAM_PROVIDER_MODE", "invalid");
    const config = await freshLoadConfig();
    expect(config.streamProviderMode).toBe("parallel");
  });
});

// ─── Local library ────────────────────────────────────────────────────────────

describe("loadConfig — local library", () => {
  it("defaults localLibraryDataDir to <cwd>/local-library when env unset", async () => {
    const config = await freshLoadConfig();
    expect(config.localLibraryDataDir).toBe(path.join(process.cwd(), "local-library"));
  });

  it("empty LOCAL_LIBRARY_DATA_DIR disables local library", async () => {
    vi.stubEnv("LOCAL_LIBRARY_DATA_DIR", "");
    const config = await freshLoadConfig();
    expect(config.localLibraryDataDir).toBe("");
  });

  it("set LOCAL_LIBRARY_DATA_DIR is used as-is", async () => {
    vi.stubEnv("LOCAL_LIBRARY_DATA_DIR", "/mnt/media/library");
    const config = await freshLoadConfig();
    expect(config.localLibraryDataDir).toBe("/mnt/media/library");
  });
});

// ─── Proxy ────────────────────────────────────────────────────────────────────

describe("loadConfig — proxy config", () => {
  it("PROXY_RD_STREAMS defaults to true when env not set", async () => {
    const config = await freshLoadConfig();
    expect(config.proxyRdStreams).toBe(true);
  });

  it("PROXY_RD_STREAMS=false disables proxy", async () => {
    vi.stubEnv("PROXY_RD_STREAMS", "false");
    const config = await freshLoadConfig();
    expect(config.proxyRdStreams).toBe(false);
  });

  it("PROXY_RD_STREAMS=true keeps proxy enabled", async () => {
    vi.stubEnv("PROXY_RD_STREAMS", "true");
    const config = await freshLoadConfig();
    expect(config.proxyRdStreams).toBe(true);
  });
});

// ─── Request log path ────────────────────────────────────────────────────────

describe("loadConfig — request log path", () => {
  it("defaults to ~/.stremio-addon/request-log.jsonl", async () => {
    const config = await freshLoadConfig();
    expect(config.requestLogPath).toBe(
      path.join(os.homedir(), ".stremio-addon", "request-log.jsonl")
    );
  });

  it("uses absolute ADDON_REQUEST_LOG directly", async () => {
    const absPath = "/var/log/addon/requests.jsonl";
    vi.stubEnv("ADDON_REQUEST_LOG", absPath);
    const config = await freshLoadConfig();
    expect(config.requestLogPath).toBe(absPath);
  });
});

// ─── Management API / deploy scripts ──────────────────────────────────────────

describe("loadConfig — management API and deploy scripts", () => {
  it("defaults ENABLE_MANAGEMENT_API to false", async () => {
    const config = await freshLoadConfig();
    expect(config.enableManagementApi).toBe(false);
  });

  it("ENABLE_MANAGEMENT_API=true enables management", async () => {
    vi.stubEnv("ENABLE_MANAGEMENT_API", "true");
    const config = await freshLoadConfig();
    expect(config.enableManagementApi).toBe(true);
  });

  it("ENABLE_MANAGEMENT_API=0 disables management", async () => {
    vi.stubEnv("ENABLE_MANAGEMENT_API", "0");
    const config = await freshLoadConfig();
    expect(config.enableManagementApi).toBe(false);
  });

  it("defaults deploy script rel paths under deploy/", async () => {
    const config = await freshLoadConfig();
    expect(config.deployInstallScriptRelPath).toBe("deploy/install.sh");
    expect(config.deployUpdateScriptRelPath).toBe("deploy/update.sh");
  });

  it("accepts custom relative deploy script paths", async () => {
    vi.stubEnv("DEPLOY_INSTALL_SCRIPT_REL_PATH", "scripts/install.sh");
    vi.stubEnv("DEPLOY_UPDATE_SCRIPT_REL_PATH", "./scripts/update.sh");
    const config = await freshLoadConfig();
    expect(config.deployInstallScriptRelPath).toBe("scripts/install.sh");
    expect(config.deployUpdateScriptRelPath).toBe("scripts/update.sh");
  });

  it("rejects deploy script paths with .. and falls back to defaults", async () => {
    vi.stubEnv("DEPLOY_INSTALL_SCRIPT_REL_PATH", "../escape.sh");
    const config = await freshLoadConfig();
    expect(config.deployInstallScriptRelPath).toBe("deploy/install.sh");
  });
});
