/**
 * Custom-script installer: dual artifact staging, embed scripts in ADMIN tree,
 * bash deploy run, and publicUrl health/manifest verification.
 */

import { createHash } from "node:crypto";
import fs from "fs-extra";
import os from "node:os";
import path from "node:path";
import axios from "axios";
import { logger } from "../utils/logger.js";
import { joinBaseUrl, normalizeBaseUrl, preferHttpForLoopback } from "../utils/url.js";
import {
  DEFAULT_CUSTOM_SCRIPT_CONFIG,
  type CustomScriptConfig,
  type CustomScriptDeployMode,
} from "../config/types.js";
import type { AddonProduct } from "../config/product.js";
import { normalizeAddonProduct, productPackageDir } from "../config/product.js";
import { SSHManager } from "../ssh/manager.js";
import { resolveBundledProductPath } from "./bundled-paths.js";
import { preflightBash, runBashScript, type BashPreflightResult } from "./script-runner.js";
import type { InstallationProgress, ProgressCallback } from "./types.js";
import { InstallationStep, StepStatus } from "./types.js";

export interface ParsedManagerSsh {
  username: string;
  host: string;
  port: number;
  /** Canonical `user@host` (port omitted when 22) for MANAGER_SSH env */
  target: string;
}

/**
 * Parse `user@host` or `user@host:port` for Gateway Manager SSH uploads.
 */
export function parseManagerSsh(value: string): ParsedManagerSsh {
  const trimmed = value.trim();
  const at = trimmed.lastIndexOf("@");
  if (at <= 0 || at === trimmed.length - 1) {
    throw new Error(
      `Invalid managerSsh "${value}". Expected user@host (optional :port), e.g. yuvalpi@192.168.0.50`
    );
  }
  const username = trimmed.slice(0, at).trim();
  const hostPart = trimmed.slice(at + 1).trim();
  if (!username || !hostPart) {
    throw new Error(
      `Invalid managerSsh "${value}". Expected user@host (optional :port), e.g. yuvalpi@192.168.0.50`
    );
  }

  let host = hostPart;
  let port = 22;

  if (hostPart.startsWith("[") && hostPart.includes("]:")) {
    // IPv6 literal: [2001:db8::1]:2222
    const endBracket = hostPart.indexOf("]");
    host = hostPart.slice(1, endBracket);
    const portStr = hostPart.slice(endBracket + 2);
    const parsed = Number.parseInt(portStr, 10);
    if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 65535) {
      throw new Error(`Invalid managerSsh port in "${value}"`);
    }
    port = parsed;
  } else if (/^\d+\.\d+\.\d+\.\d+:\d+$/.test(hostPart) || /^[^:]+:\d+$/.test(hostPart)) {
    // host:port (IPv4 or hostname). Avoid splitting bare IPv6.
    const colon = hostPart.lastIndexOf(":");
    host = hostPart.slice(0, colon);
    const parsed = Number.parseInt(hostPart.slice(colon + 1), 10);
    if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 65535) {
      throw new Error(`Invalid managerSsh port in "${value}"`);
    }
    port = parsed;
  }

  if (!host) {
    throw new Error(`Invalid managerSsh "${value}". Host is empty.`);
  }

  const target = port === 22 ? `${username}@${host}` : `${username}@${host}:${port}`;
  return { username, host, port, target };
}

export interface RemoteStagingPaths {
  addonRemotePath: string;
  adminRemotePath: string;
  managerSsh: string;
}

export interface CustomScriptAddonIdentity {
  id: string;
  name: string;
  password: string;
}

export interface CustomScriptRunOptions {
  customScript: CustomScriptConfig;
  addon: CustomScriptAddonIdentity;
  /** Script body used for install, or for update when updateScriptMode is same / primary content */
  scriptContent: string;
  /** Required when updateScriptMode is separate and deployMode is update (also embedded at install) */
  updateScriptContent?: string;
  deployMode: CustomScriptDeployMode;
  /** Extra env vars to pass (filtered by injectedVars when set; always includes core deploy vars) */
  extraEnv?: Record<string, string>;
  /** Full ADDON_ENV map written to a temp file; path exported as ADDON_ENV (public stack) */
  addonEnv?: Record<string, string>;
  /** Full ADMIN_ENV map for private admin stack; path exported as ADMIN_ENV */
  adminEnv?: Record<string, string>;
  progressCallback?: ProgressCallback;
  /** Max time to wait for publicUrl to become healthy after exit 0 (default 120s) */
  verifyTimeoutMs?: number;
  pollIntervalMs?: number;
  stagingRootDir?: string;
  /** Skip artifact staging (config mode). When false/undefined, install/update always stage. */
  skipStaging?: boolean;
  /** Skip publicUrl verify (default: skip only for config) */
  skipVerify?: boolean;
  allowWsl?: boolean;
  /** Product package to stage (default streaming / addon-server) */
  product?: AddonProduct;
}

export interface StagedArtifacts {
  addonPath: string;
  adminPath: string;
  /** Env var name used for the public artifact (ADDON_BUILD | ADDON_SOURCE) */
  addonEnvKey: "ADDON_BUILD" | "ADDON_SOURCE";
  /** Env var name used for the admin artifact (ADMIN_BUILD | ADMIN_SOURCE) */
  adminEnvKey: "ADMIN_BUILD" | "ADMIN_SOURCE";
  stagingRoot: string;
  /** Remote paths when Electron uploaded trees via Manager SSH */
  remote?: RemoteStagingPaths;
}

export interface CustomScriptRunResult {
  success: boolean;
  deployMode: CustomScriptDeployMode;
  scriptHash: string;
  exitCode?: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  staged?: StagedArtifacts;
  publicUrl?: string;
  managementUrl?: string;
  verifyError?: string;
  /** Non-blocking notice when publicUrl is healthy but managementUrl scripts GET failed */
  warning?: string;
  error?: Error;
  steps: InstallationProgress[];
}

/**
 * SHA-256 hex digest of script content (for confirm-on-change).
 */
export function hashScriptContent(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/**
 * Orchestrates custom-script install / update / config runs.
 */
export class CustomScriptInstaller {
  /**
   * Bash + Python + ssh preflight (Windows Git Bash preferred). Call before staging.
   * rsync is never hard-required. Soft-warn about missing rsync only when Manager SSH is unset.
   */
  public preflight(options?: {
    allowWsl?: boolean;
    /** When set, Electron uploads via SSHManager — skip rsync soft-warn */
    managerSsh?: string;
  }): BashPreflightResult {
    const hasManagerSsh = Boolean(options?.managerSsh?.trim());
    return preflightBash({
      allowWsl: options?.allowWsl,
      checkSsh: true,
      checkRsync: !hasManagerSsh,
      warnIfRsyncMissing: !hasManagerSsh,
      checkPython: true,
    });
  }

  /**
   * Run deploy script for install | update | config.
   */
  public async run(options: CustomScriptRunOptions): Promise<CustomScriptRunResult> {
    const start = Date.now();
    const steps: InstallationProgress[] = [];
    const report = (step: InstallationStep, status: StepStatus, message: string, progress: number, error?: Error): void => {
      const update: InstallationProgress = {
        step,
        status,
        message,
        progress,
        error,
        timestamp: new Date(),
      };
      steps.push(update);
      options.progressCallback?.(update);
    };

    const customScript = this.normalizeConfig(options.customScript);
    const managerSshRaw = customScript.managerSsh?.trim() || "";
    const scriptHash = hashScriptContent(options.scriptContent);
    let staged: StagedArtifacts | undefined;
    let stdout = "";
    let stderr = "";
    let exitCode: number | undefined;
    let stagingRoot: string | undefined;

    try {
      // 1. Preflight bash + Python 3 + ssh (same bash PATH as script spawn)
      report(
        InstallationStep.CHECK_PREREQUISITES,
        StepStatus.IN_PROGRESS,
        managerSshRaw
          ? "Checking for bash, Python 3, and ssh (Electron will upload via Manager SSH)..."
          : "Checking for bash, Python 3, and ssh...",
        5
      );
      const preflight = this.preflight({
        allowWsl: options.allowWsl,
        managerSsh: managerSshRaw || undefined,
      });
      if (!preflight.ok || !preflight.bashPath) {
        throw new Error(
          `${preflight.error ?? "Bash preflight failed"}\n${preflight.hints.join("\n")}`
        );
      }
      for (const warning of preflight.warnings) {
        logger.warn("Custom-script preflight warning", { warning });
      }
      const pythonLabel = preflight.python.resolvedAs ?? "python3";
      report(
        InstallationStep.CHECK_PREREQUISITES,
        StepStatus.COMPLETED,
        `Bash ready: ${preflight.bashPath}; Python: ${pythonLabel}` +
          (preflight.python.needsPython3Shim ? " (python3 shim will be injected)" : "") +
          "; ssh OK",
        10
      );

      const shouldStage =
        options.skipStaging !== true &&
        (options.deployMode === "install" || options.deployMode === "update");

      // 2. Stage dual artifacts
      if (shouldStage) {
        report(
          InstallationStep.STAGE_ARTIFACTS,
          StepStatus.IN_PROGRESS,
          `Staging ADDON + ADMIN artifacts (${customScript.artifactMode})...`,
          20
        );
        staged = await this.stageArtifacts(
          customScript,
          options.stagingRootDir,
          options.product
        );
        stagingRoot = staged.stagingRoot;
        report(
          InstallationStep.STAGE_ARTIFACTS,
          StepStatus.COMPLETED,
          `Staged public=${staged.addonPath} admin=${staged.adminPath}`,
          40
        );

        // 3. Embed scripts into ADMIN only
        report(
          InstallationStep.EMBED_SCRIPTS,
          StepStatus.IN_PROGRESS,
          "Embedding deploy scripts into ADMIN artifact...",
          45
        );
        await this.embedScripts(staged.adminPath, customScript, options);
        report(
          InstallationStep.EMBED_SCRIPTS,
          StepStatus.COMPLETED,
          `Scripts embedded at ${customScript.installScriptRelPath}` +
            (customScript.updateScriptMode === "separate"
              ? ` and ${customScript.updateScriptRelPath}`
              : ""),
          50
        );

        // 3b. Upload staged trees to Gateway Manager when managerSsh is set
        if (managerSshRaw) {
          report(
            InstallationStep.UPLOAD_REMOTE_STAGING,
            StepStatus.IN_PROGRESS,
            `Uploading ADDON + ADMIN to Manager via SSH (${managerSshRaw})...`,
            52
          );
          const managerPassword = customScript.managerSshPassword?.trim() || undefined;
          staged.remote = await this.uploadRemoteStaging(
            staged,
            managerSshRaw,
            options.addon.id,
            managerPassword ? { password: managerPassword } : undefined
          );
          report(
            InstallationStep.UPLOAD_REMOTE_STAGING,
            StepStatus.COMPLETED,
            `Remote staging ready: addon=${staged.remote.addonRemotePath} admin=${staged.remote.adminRemotePath}`,
            58
          );
        } else {
          report(
            InstallationStep.UPLOAD_REMOTE_STAGING,
            StepStatus.SKIPPED,
            "Manager SSH unset — script must upload ADDON/ADMIN itself",
            58
          );
        }
      } else {
        report(
          InstallationStep.STAGE_ARTIFACTS,
          StepStatus.SKIPPED,
          "Artifact staging skipped",
          40
        );
        report(
          InstallationStep.EMBED_SCRIPTS,
          StepStatus.SKIPPED,
          "Script embed skipped",
          50
        );
        report(
          InstallationStep.UPLOAD_REMOTE_STAGING,
          StepStatus.SKIPPED,
          "Remote staging upload skipped",
          58
        );
      }

      // 4. Write temp script + ADDON_ENV file, spawn bash
      report(
        InstallationStep.RUN_DEPLOY_SCRIPT,
        StepStatus.IN_PROGRESS,
        `Running deploy script (DEPLOY_MODE=${options.deployMode})...`,
        60
      );

      const runDir = await fs.mkdtemp(path.join(os.tmpdir(), "stremio-custom-script-run-"));
      if (!stagingRoot) {
        stagingRoot = runDir;
      }

      const scriptToRun =
        options.deployMode === "update" &&
        customScript.updateScriptMode === "separate" &&
        options.updateScriptContent
          ? options.updateScriptContent
          : options.scriptContent;

      const tempScriptPath = path.join(runDir, `${options.deployMode}.sh`);
      await fs.writeFile(tempScriptPath, ensureUnixNewlines(scriptToRun), "utf8");

      // ADDON_ENV / ADMIN_ENV are caller-supplied (Electron). Public must use
      // ENABLE_MANAGEMENT_API=false; admin must use true — do not reuse classic bake for public.
      let addonEnvPath: string | undefined;
      if (options.addonEnv && Object.keys(options.addonEnv).length > 0) {
        addonEnvPath = path.join(runDir, "ADDON_ENV");
        await fs.writeFile(addonEnvPath, formatEnvFile(options.addonEnv), "utf8");
      }
      let adminEnvPath: string | undefined;
      if (options.adminEnv && Object.keys(options.adminEnv).length > 0) {
        adminEnvPath = path.join(runDir, "ADMIN_ENV");
        await fs.writeFile(adminEnvPath, formatEnvFile(options.adminEnv), "utf8");
      }

      const env = this.buildScriptEnv({
        customScript,
        addon: options.addon,
        deployMode: options.deployMode,
        staged,
        addonEnvPath,
        adminEnvPath,
        extraEnv: options.extraEnv,
        product: options.product,
      });

      const shimTarget =
        preflight.python.needsPython3Shim &&
        preflight.python.resolvedAs &&
        preflight.python.resolvedAs !== "python3"
          ? preflight.python.resolvedAs
          : undefined;

      const runResult = await runBashScript({
        bashPath: preflight.bashPath,
        scriptPath: tempScriptPath,
        env,
        cwd: runDir,
        ensurePython3Shim: Boolean(shimTarget),
        pythonShimTarget: shimTarget,
        onOutput: (stream, chunk) => {
          if (stream === "stdout") {
            stdout += chunk;
          } else {
            stderr += chunk;
          }
          options.progressCallback?.({
            step: InstallationStep.RUN_DEPLOY_SCRIPT,
            status: StepStatus.IN_PROGRESS,
            message: chunk.trimEnd().slice(-200) || `Running (${stream})...`,
            progress: 70,
            timestamp: new Date(),
          });
        },
      });

      exitCode = runResult.exitCode;
      stdout = runResult.stdout || stdout;
      stderr = runResult.stderr || stderr;

      if (runResult.exitCode !== 0) {
        throw new Error(
          `Deploy script exited with code ${runResult.exitCode}` +
            (stderr.trim() ? `\n${stderr.trim().slice(-2000)}` : "")
        );
      }

      report(
        InstallationStep.RUN_DEPLOY_SCRIPT,
        StepStatus.COMPLETED,
        "Deploy script completed successfully",
        80
      );

      // 5. Verify publicUrl (install/update): exit 0 but unhealthy → fail
      const skipVerify =
        options.skipVerify === true ||
        (options.skipVerify !== false && options.deployMode === "config");

      if (!skipVerify) {
        report(
          InstallationStep.VERIFY_INSTALLATION,
          StepStatus.IN_PROGRESS,
          `Verifying publicUrl: ${customScript.publicUrl}`,
          85
        );
        const verifyError = await this.verifyPublicUrl(customScript, options.addon.password, {
          timeoutMs: options.verifyTimeoutMs ?? 120_000,
          pollIntervalMs: options.pollIntervalMs ?? 3_000,
        });
        if (verifyError) {
          report(
            InstallationStep.VERIFY_INSTALLATION,
            StepStatus.FAILED,
            `URL not healthy: ${verifyError}`,
            90,
            new Error(verifyError)
          );
          return {
            success: false,
            deployMode: options.deployMode,
            scriptHash,
            exitCode,
            stdout,
            stderr,
            durationMs: Date.now() - start,
            staged,
            publicUrl: normalizeBaseUrl(customScript.publicUrl),
            managementUrl: normalizeBaseUrl(customScript.managementUrl),
            verifyError,
            error: new Error(
              `Deploy script exited 0 but publicUrl is not healthy: ${verifyError}`
            ),
            steps,
          };
        }
        report(
          InstallationStep.VERIFY_INSTALLATION,
          StepStatus.COMPLETED,
          "publicUrl health/manifest OK",
          95
        );
      } else {
        report(
          InstallationStep.VERIFY_INSTALLATION,
          StepStatus.SKIPPED,
          "publicUrl verify skipped",
          95
        );
      }

      report(InstallationStep.COMPLETE, StepStatus.COMPLETED, "Custom script deploy complete", 100);

      return {
        success: true,
        deployMode: options.deployMode,
        scriptHash,
        exitCode,
        stdout,
        stderr,
        durationMs: Date.now() - start,
        staged,
        publicUrl: normalizeBaseUrl(customScript.publicUrl),
        managementUrl: normalizeBaseUrl(customScript.managementUrl),
        steps,
      };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error("Custom script deploy failed", err);
      report(InstallationStep.COMPLETE, StepStatus.FAILED, err.message, 100, err);
      return {
        success: false,
        deployMode: options.deployMode,
        scriptHash,
        exitCode,
        stdout,
        stderr,
        durationMs: Date.now() - start,
        staged,
        publicUrl: customScript.publicUrl
          ? normalizeBaseUrlSafe(customScript.publicUrl)
          : undefined,
        managementUrl: customScript.managementUrl
          ? normalizeBaseUrlSafe(customScript.managementUrl)
          : undefined,
        error: err,
        steps,
      };
    }
  }

  /**
   * Stage ADDON_* and ADMIN_* trees from the bundled product package.
   */
  public async stageArtifacts(
    customScript: CustomScriptConfig,
    stagingRootDir?: string,
    product?: AddonProduct
  ): Promise<StagedArtifacts> {
    const mode = customScript.artifactMode ?? DEFAULT_CUSTOM_SCRIPT_CONFIG.artifactMode;
    const resolvedProduct = normalizeAddonProduct(product);
    const packageDir = productPackageDir(resolvedProduct);
    const sourcePath = await resolveBundledProductPath(resolvedProduct, mode);
    if (!sourcePath) {
      throw new Error(
        mode === "source"
          ? `${packageDir} source tree not found (expected package.json + src). Build the monorepo or switch artifact mode to built.`
          : `Bundled ${packageDir} not found (expected package.json + dist). Run npm run build so resources include ${packageDir}.`
      );
    }

    const stagingRoot =
      stagingRootDir ??
      (await fs.mkdtemp(path.join(os.tmpdir(), "stremio-custom-script-stage-")));
    const addonPath = path.join(stagingRoot, "addon");
    const adminPath = path.join(stagingRoot, "admin");

    await fs.emptyDir(addonPath);
    await fs.emptyDir(adminPath);
    await copyArtifactTree(sourcePath, addonPath);
    await copyArtifactTree(sourcePath, adminPath);

    const addonEnvKey = mode === "built" ? "ADDON_BUILD" : "ADDON_SOURCE";
    const adminEnvKey = mode === "built" ? "ADMIN_BUILD" : "ADMIN_SOURCE";

    return { addonPath, adminPath, addonEnvKey, adminEnvKey, stagingRoot };
  }

  /**
   * Embed install/update scripts into the ADMIN artifact only.
   */
  public async embedScripts(
    adminPath: string,
    customScript: CustomScriptConfig,
    options: Pick<CustomScriptRunOptions, "scriptContent" | "updateScriptContent">
  ): Promise<{ installPath: string; updatePath: string }> {
    const installRel =
      customScript.installScriptRelPath || DEFAULT_CUSTOM_SCRIPT_CONFIG.installScriptRelPath;
    const updateRel =
      customScript.updateScriptRelPath || DEFAULT_CUSTOM_SCRIPT_CONFIG.updateScriptRelPath;

    const installPath = path.join(adminPath, ...installRel.split("/"));
    await fs.ensureDir(path.dirname(installPath));
    await fs.writeFile(installPath, ensureUnixNewlines(options.scriptContent), "utf8");

    let updatePath = installPath;
    if (customScript.updateScriptMode === "separate") {
      const updateContent = options.updateScriptContent ?? options.scriptContent;
      updatePath = path.join(adminPath, ...updateRel.split("/"));
      await fs.ensureDir(path.dirname(updatePath));
      await fs.writeFile(updatePath, ensureUnixNewlines(updateContent), "utf8");
    } else if (updateRel !== installRel) {
      // same mode but different rel path: mirror install script for convenience
      updatePath = path.join(adminPath, ...updateRel.split("/"));
      await fs.ensureDir(path.dirname(updatePath));
      await fs.writeFile(updatePath, ensureUnixNewlines(options.scriptContent), "utf8");
    }

    return { installPath, updatePath };
  }

  /**
   * Poll publicUrl health and/or password manifest until healthy or timeout.
   * Returns error message if unhealthy; undefined if OK.
   */
  public async verifyPublicUrl(
    customScript: CustomScriptConfig,
    password: string,
    timing?: { timeoutMs?: number; pollIntervalMs?: number }
  ): Promise<string | undefined> {
    const timeoutMs = timing?.timeoutMs ?? 120_000;
    const pollIntervalMs = timing?.pollIntervalMs ?? 3_000;
    const healthPath = customScript.healthPath || DEFAULT_CUSTOM_SCRIPT_CONFIG.healthPath || "/health";
    const publicBase = preferHttpForLoopback(customScript.publicUrl);
    const healthUrl = joinBaseUrl(publicBase, healthPath);
    const manifestUrl = joinBaseUrl(publicBase, password, "manifest.json");

    const deadline = Date.now() + timeoutMs;
    let lastError = "No response yet";

    while (Date.now() < deadline) {
      const healthOk = await probeUrl(healthUrl, (data) => data !== undefined);
      if (healthOk.ok) {
        return undefined;
      }

      const manifestOk = await probeUrl(manifestUrl, (data) => {
        return typeof data === "object" && data !== null && "id" in (data as object);
      });
      if (manifestOk.ok) {
        return undefined;
      }

      lastError = manifestOk.error || healthOk.error || lastError;
      await sleep(pollIntervalMs);
    }

    return `Timed out after ${timeoutMs}ms. Last error: ${lastError}. Tried ${healthUrl} and ${manifestUrl}`;
  }

  /**
   * Upload local staged ADDON/ADMIN trees to the Gateway Manager host via SSHManager.
   * Optional password enables password auth when empty keys fail; never log the password.
   */
  public async uploadRemoteStaging(
    staged: StagedArtifacts,
    managerSsh: string,
    addonId: string,
    options?: { password?: string }
  ): Promise<RemoteStagingPaths> {
    const parsed = parseManagerSsh(managerSsh);
    const ts = Date.now();
    const safeId = addonId.replace(/[^a-zA-Z0-9._-]/g, "_") || "addon";
    const addonRemotePath = `/tmp/stremio-cs-addon-${safeId}-${ts}`;
    const adminRemotePath = `/tmp/stremio-cs-admin-${safeId}-${ts}`;
    const password = options?.password?.trim() || undefined;

    const ssh = new SSHManager({
      host: parsed.host,
      port: parsed.port,
      username: parsed.username,
      ...(password ? { password } : {}),
    });

    try {
      await ssh.connect();
      const mkdir = await ssh.execCommand(
        `rm -rf '${addonRemotePath}' '${adminRemotePath}' && mkdir -p '${addonRemotePath}' '${adminRemotePath}'`
      );
      if (mkdir.code !== 0) {
        throw new Error(
          `Failed to create remote staging dirs: ${mkdir.stderr || mkdir.stdout || `exit ${mkdir.code}`}`
        );
      }

      logger.info("Uploading ADDON tree to Manager SSH", {
        local: staged.addonPath,
        remote: addonRemotePath,
        target: parsed.target,
        auth: password ? "key-or-password" : "key",
      });
      await ssh.transferDirectory(staged.addonPath, addonRemotePath);

      logger.info("Uploading ADMIN tree to Manager SSH", {
        local: staged.adminPath,
        remote: adminRemotePath,
        target: parsed.target,
      });
      await ssh.transferDirectory(staged.adminPath, adminRemotePath);

      return {
        addonRemotePath,
        adminRemotePath,
        managerSsh: parsed.target,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Manager SSH upload failed (${parsed.target}): ${message}. ` +
          "Ensure SSH key auth works for this host (default ~/.ssh keys), set an optional Manager SSH password, or clear Manager SSH and upload from your script."
      );
    } finally {
      try {
        await ssh.disconnect();
      } catch {
        // ignore disconnect errors
      }
    }
  }

  private normalizeConfig(config: CustomScriptConfig): CustomScriptConfig {
    return {
      ...DEFAULT_CUSTOM_SCRIPT_CONFIG,
      ...config,
      installScriptRelPath:
        config.installScriptRelPath || DEFAULT_CUSTOM_SCRIPT_CONFIG.installScriptRelPath,
      updateScriptRelPath:
        config.updateScriptRelPath || DEFAULT_CUSTOM_SCRIPT_CONFIG.updateScriptRelPath,
      injectedVars: config.injectedVars ?? [],
      healthPath: config.healthPath || DEFAULT_CUSTOM_SCRIPT_CONFIG.healthPath,
      managerSsh: config.managerSsh?.trim() || undefined,
      // Keep password for update re-runs; do not log it anywhere
      managerSshPassword: config.managerSshPassword?.trim() || undefined,
    };
  }

  private buildScriptEnv(args: {
    customScript: CustomScriptConfig;
    addon: CustomScriptAddonIdentity;
    deployMode: CustomScriptDeployMode;
    staged?: StagedArtifacts;
    addonEnvPath?: string;
    adminEnvPath?: string;
    extraEnv?: Record<string, string>;
    product?: AddonProduct;
  }): Record<string, string> {
    const { customScript, addon, deployMode, staged, addonEnvPath, adminEnvPath, extraEnv, product } = args;

    const core: Record<string, string> = {
      ADDON_ID: addon.id,
      ADDON_NAME: addon.name,
      ADDON_PASSWORD: addon.password,
      PUBLIC_URL: normalizeBaseUrl(customScript.publicUrl),
      MANAGEMENT_URL: normalizeBaseUrl(customScript.managementUrl),
      DEPLOY_MODE: deployMode,
      INSTALL_SCRIPT_REL_PATH: customScript.installScriptRelPath,
      UPDATE_SCRIPT_REL_PATH: customScript.updateScriptRelPath,
      PRODUCT: normalizeAddonProduct(product),
    };

    if (staged) {
      core[staged.addonEnvKey] = staged.addonPath;
      core[staged.adminEnvKey] = staged.adminPath;
    }

    if (staged?.remote) {
      core.ADDON_REMOTE_STAGING = staged.remote.addonRemotePath;
      core.ADMIN_REMOTE_STAGING = staged.remote.adminRemotePath;
      core.MANAGER_SSH = staged.remote.managerSsh;
    } else if (customScript.managerSsh?.trim()) {
      // Config present but upload skipped (e.g. config mode) — still pass target for script SSH
      try {
        core.MANAGER_SSH = parseManagerSsh(customScript.managerSsh).target;
      } catch {
        core.MANAGER_SSH = customScript.managerSsh.trim();
      }
    }

    if (addonEnvPath) {
      core.ADDON_ENV = addonEnvPath;
    }
    if (adminEnvPath) {
      core.ADMIN_ENV = adminEnvPath;
    }

    const allowed = new Set(customScript.injectedVars.map((v) => v.toUpperCase()));
    const includeAll = allowed.size === 0;

    const merged: Record<string, string> = { ...core };
    if (extraEnv) {
      for (const [key, value] of Object.entries(extraEnv)) {
        if (includeAll || allowed.has(key.toUpperCase()) || key in core) {
          merged[key] = value;
        }
      }
    }

    // Always pass core deploy variables regardless of injectedVars filter
    for (const [key, value] of Object.entries(core)) {
      merged[key] = value;
    }

    return merged;
  }
}

async function copyArtifactTree(sourcePath: string, destPath: string): Promise<void> {
  await fs.copy(sourcePath, destPath, {
    filter: (src: string): boolean => {
      const base = path.basename(src);
      if (base === "node_modules" || base === ".git" || base === "coverage") {
        return false;
      }
      return true;
    },
  });
}

function ensureUnixNewlines(content: string): string {
  return content.replace(/\r\n/g, "\n");
}

function formatEnvFile(env: Record<string, string>): string {
  return Object.entries(env)
    .map(([key, value]) => {
      const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
      return `${key}="${escaped}"`;
    })
    .join("\n")
    .concat("\n");
}

function normalizeBaseUrlSafe(url: string): string | undefined {
  try {
    return normalizeBaseUrl(url);
  } catch {
    return url;
  }
}

async function probeUrl(
  url: string,
  accept: (data: unknown) => boolean
): Promise<{ ok: boolean; error?: string }> {
  try {
    const response = await axios.get(url, {
      timeout: 8_000,
      validateStatus: () => true,
      // Gateway may present private CA; Electron layer can tighten later
      transitional: { clarifyTimeoutError: true },
    });
    if (response.status >= 200 && response.status < 300 && accept(response.data)) {
      return { ok: true };
    }
    return { ok: false, error: `${url} → HTTP ${response.status}` };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `${url} → ${message}` };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
