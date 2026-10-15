import { describe, it, expect, beforeEach, afterEach } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ServerConfig } from "../config.js";
import { getConfigSchema, getRedactedConfig } from "../management/config-api.js";
import { loadDeployScripts } from "../management/deploy-scripts.js";

function baseConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  return {
    rdApiToken: "secret-rd-token",
    rdApiBase: "https://api.real-debrid.com/rest/1.0",
    addonPassword: "super-secret-password",
    authEnabled: true,
    port: 7000,
    nodeEnv: "test",
    torrentLimit: 100,
    availabilityCheckLimit: 100,
    maxStreams: 25,
    maxConcurrency: 5,
    seriesNonMatchFallbackLimit: 30,
    cacheTtl: { metadata: 1, torrentSearch: 1, streams: 1 },
    rateLimits: {
      streamWindow: 1000,
      streamMax: 10,
      statsWindow: 1000,
      statsMax: 10,
    },
    localLibraryDataDir: "",
    localLibraryScanMaxDepth: 12,
    localLibraryScanMaxFiles: 5000,
    localLibraryMaxFuzzyResults: 3,
    localLibraryFuzzyThreshold: 0.38,
    torboxApiToken: "torbox-secret",
    streamProviderMode: "parallel",
    streamProviderOrder: ["real-debrid"],
    proxyRdStreams: true,
    proxyStallTimeoutMs: 30000,
    proxyMaxReconnects: 3,
    requestLogPath: "/tmp/req.jsonl",
    requestLogMaxBytes: 1_000_000,
    serverLogPath: "/tmp/server.log",
    serverLogMaxBytes: 1_000_000,
    clientActivityTtlSec: 3600,
    clientActivityMaxEntries: 500,
    maxConcurrentViewers: 10,
    enableManagementApi: true,
    deployInstallScriptRelPath: "deploy/install.sh",
    deployUpdateScriptRelPath: "deploy/update.sh",
    ...overrides,
  };
}

describe("getRedactedConfig", () => {
  it("never returns raw RD / password / TorBox secrets", () => {
    const out = getRedactedConfig(baseConfig());
    expect(out.rdApiToken).toBe("[REDACTED]");
    expect(out.addonPassword).toBe("[REDACTED]");
    expect(out.torboxApiToken).toBe("[REDACTED]");
    expect(out.rdApiConfigured).toBe(true);
    expect(out.addonPasswordConfigured).toBe(true);
    expect(out.torboxApiConfigured).toBe(true);
    expect(JSON.stringify(out)).not.toContain("secret-rd-token");
    expect(JSON.stringify(out)).not.toContain("super-secret-password");
    expect(JSON.stringify(out)).not.toContain("torbox-secret");
  });

  it("marks sentinel / empty secrets as not configured", () => {
    const out = getRedactedConfig(
      baseConfig({
        rdApiToken: "YOUR_REAL_DEBRID_TOKEN_HERE",
        addonPassword: "YOUR_ADDON_PASSWORD_HERE",
        torboxApiToken: "",
        authEnabled: false,
      })
    );
    expect(out.rdApiToken).toBeNull();
    expect(out.addonPassword).toBeNull();
    expect(out.torboxApiToken).toBeNull();
    expect(out.rdApiConfigured).toBe(false);
    expect(out.addonPasswordConfigured).toBe(false);
    expect(out.torboxApiConfigured).toBe(false);
  });
});

describe("getConfigSchema", () => {
  it("includes management and deploy path keys", () => {
    const keys = getConfigSchema().map((e) => e.key);
    expect(keys).toContain("ENABLE_MANAGEMENT_API");
    expect(keys).toContain("DEPLOY_INSTALL_SCRIPT_REL_PATH");
    expect(keys).toContain("RD_API_TOKEN");
    const rd = getConfigSchema().find((e) => e.key === "RD_API_TOKEN");
    expect(rd?.sensitive).toBe(true);
  });
});

describe("loadDeployScripts", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "deploy-scripts-"));
    fs.mkdirSync(path.join(tmp, "deploy"), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("returns content and sha256 for existing scripts", () => {
    const installBody = "#!/bin/bash\necho install\n";
    const updateBody = "#!/bin/bash\necho update\n";
    fs.writeFileSync(path.join(tmp, "deploy", "install.sh"), installBody, "utf8");
    fs.writeFileSync(path.join(tmp, "deploy", "update.sh"), updateBody, "utf8");

    const out = loadDeployScripts(baseConfig(), tmp);
    expect(out.scripts).toHaveLength(2);
    const install = out.scripts.find((s) => s.role === "install");
    const update = out.scripts.find((s) => s.role === "update");
    expect(install?.exists).toBe(true);
    expect(install?.content).toBe(installBody);
    expect(install?.hash).toBe(crypto.createHash("sha256").update(installBody, "utf8").digest("hex"));
    expect(update?.exists).toBe(true);
    expect(update?.hash).toBe(crypto.createHash("sha256").update(updateBody, "utf8").digest("hex"));
  });

  it("reports missing scripts without throwing", () => {
    const out = loadDeployScripts(baseConfig(), tmp);
    expect(out.scripts.every((s) => s.exists === false)).toBe(true);
    expect(out.scripts.every((s) => s.content === null && s.hash === null)).toBe(true);
  });
});
