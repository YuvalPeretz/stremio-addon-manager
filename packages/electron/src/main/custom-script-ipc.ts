/**
 * Custom-script install/update/config helpers for Electron IPC.
 */

import { BrowserWindow, dialog, shell } from "electron";
import {
  AddonRegistryManager,
  ConfigManager,
  CustomScriptInstaller,
  EnvVarManager,
  hashScriptContent,
  joinBaseUrl,
  logger,
  normalizeBaseUrl,
  PYTHON_DOWNLOAD_URL,
  SSH_HELP_URL,
  readBundledProductVersion,
  normalizeAddonProduct,
  stripStreamingOnlyEnvKeys,
  type AddonManagerConfig,
  type BashPreflightResult,
  type CustomScriptConfig,
  type CustomScriptRunResult,
  type InstallationProgress,
  type InstallationResult,
} from "@stremio-addon-manager/core";

type PreflightGateResult =
  | { ok: true; preflight: BashPreflightResult }
  | { ok: false; error: string; cancelled?: boolean };

type MissingToolChoice = "retry" | "download" | "cancel";

/** Avoid re-prompting the soft "no Manager SSH" warning every install in one session. */
let managerSshUnsetWarnedThisSession = false;

/**
 * Run bash+Python+ssh preflight before staging. If a hard tool is missing,
 * prompt the user to install it, re-check, and continue — instead of failing with exit 127.
 * rsync is never required; soft-warn only when Manager SSH is unset.
 */
async function ensureCustomScriptPreflight(options?: {
  allowWsl?: boolean;
  managerSsh?: string;
}): Promise<PreflightGateResult> {
  const installer = new CustomScriptInstaller();
  const managerSsh = options?.managerSsh?.trim() || "";

  while (true) {
    const preflight = installer.preflight({
      allowWsl: options?.allowWsl,
      managerSsh: managerSsh || undefined,
    });

    if (preflight.ok && preflight.bashPath) {
      if (
        !managerSsh &&
        preflight.warnings.length > 0 &&
        !managerSshUnsetWarnedThisSession
      ) {
        managerSshUnsetWarnedThisSession = true;
        await promptManagerSshUnsetWarning(preflight);
      }
      return { ok: true, preflight };
    }

    if (preflight.errorCode === "bash_missing" || !preflight.bashOk) {
      return {
        ok: false,
        error: `${preflight.error ?? "Bash preflight failed"}\n${preflight.hints.join("\n")}`,
      };
    }

    if (preflight.errorCode === "python_missing") {
      const choice = await promptPythonMissing(preflight);
      if (choice === "cancel") {
        return {
          ok: false,
          cancelled: true,
          error:
            "Cancelled: Python 3 is required for this deploy script. Install Python 3, ensure Git Bash can see `python3` or `py -3`, then retry.",
        };
      }
      if (choice === "download") {
        try {
          await shell.openExternal(PYTHON_DOWNLOAD_URL);
        } catch {
          // Dialog will reappear; user can still Retry or Cancel
        }
        continue;
      }
      continue;
    }

    if (preflight.errorCode === "ssh_missing") {
      const choice = await promptSshMissing(preflight);
      if (choice === "cancel") {
        return {
          ok: false,
          cancelled: true,
          error:
            "Cancelled: ssh is required for this deploy script. Install an OpenSSH client so Git Bash can see `ssh`, then retry.",
        };
      }
      if (choice === "download") {
        try {
          await shell.openExternal(SSH_HELP_URL);
        } catch {
          // Dialog will reappear; user can still Retry or Cancel
        }
        continue;
      }
      continue;
    }

    return {
      ok: false,
      error: `${preflight.error ?? "Preflight failed"}\n${preflight.hints.join("\n")}`,
    };
  }
}

async function showMissingToolDialog(options: {
  title: string;
  message: string;
  detail: string;
  openHelpLabel: string;
}): Promise<MissingToolChoice> {
  const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed());
  const buttons = ["I've installed — Retry check", options.openHelpLabel, "Cancel"];
  const boxOptions = {
    type: "warning" as const,
    title: options.title,
    message: options.message,
    detail: options.detail,
    buttons,
    defaultId: 0,
    cancelId: 2,
    noLink: true,
  };
  const result = win
    ? await dialog.showMessageBox(win, boxOptions)
    : await dialog.showMessageBox(boxOptions);

  if (result.response === 0) return "retry";
  if (result.response === 1) return "download";
  return "cancel";
}

async function promptPythonMissing(preflight: BashPreflightResult): Promise<MissingToolChoice> {
  const isWin = process.platform === "win32";
  const detailLines = [
    preflight.error || "Python 3 was not found in the same bash environment used to run deploy scripts.",
    "",
    "Python 3 is required for this deploy script.",
    "",
    isWin
      ? [
          "On Windows:",
          '• Install from python.org and enable "Add python.exe to PATH".',
          "• After install, Git Bash must see `python3` or the Windows launcher `py -3`.",
          "• You may need to restart this app so PATH updates are picked up.",
        ].join("\n")
      : "Install Python 3 and ensure `python3` is available on PATH, then retry.",
    "",
    `Download: ${PYTHON_DOWNLOAD_URL}`,
  ];

  return showMissingToolDialog({
    title: "Python 3 required",
    message: "Python 3 is required for this deploy script",
    detail: detailLines.join("\n"),
    openHelpLabel: "Open download",
  });
}

async function promptSshMissing(preflight: BashPreflightResult): Promise<MissingToolChoice> {
  const isWin = process.platform === "win32";
  const detailLines = [
    preflight.error || "ssh was not found in the same bash environment used to run deploy scripts.",
    "",
    "ssh is required for BatchMode / Gateway deploy scripts.",
    "",
    isWin
      ? [
          "On Windows:",
          "• Install OpenSSH Client (Settings → Apps → Optional features), or",
          "• Reinstall/repair Git for Windows so `ssh` is on the Git Bash PATH.",
          "• Restart this app after installing so PATH updates are picked up.",
        ].join("\n")
      : "Install an OpenSSH client and ensure `ssh` is on PATH, then retry.",
    "",
    `Help: ${SSH_HELP_URL}`,
  ];

  return showMissingToolDialog({
    title: "ssh required",
    message: "ssh is required for this deploy script",
    detail: detailLines.join("\n"),
    openHelpLabel: "Open help",
  });
}

/**
 * Soft warn when Manager SSH is unset — Electron will not pre-upload ADDON/ADMIN trees.
 * Prefer setting Manager SSH in the wizard over installing rsync on Windows.
 */
async function promptManagerSshUnsetWarning(preflight: BashPreflightResult): Promise<void> {
  const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed());
  const detail = [
    ...(preflight.warnings.length > 0
      ? preflight.warnings
      : ["Manager SSH is not set — Electron will not upload staged trees."]),
    "",
    "Recommended: set Manager SSH (user@host) on the Access URLs step so Electron uploads",
    "ADDON/ADMIN via SSH before your script runs (no rsync needed on Windows).",
    "",
    "Without Manager SSH, your deploy script must upload itself (tar-over-ssh or rsync).",
    "The Load example prefers ADDON_REMOTE_STAGING / ADMIN_REMOTE_STAGING when present.",
  ].join("\n");
  const boxOptions = {
    type: "warning" as const,
    title: "Manager SSH not set",
    message: "Continuing without Electron remote upload",
    detail,
    buttons: ["Continue"],
    defaultId: 0,
    noLink: true,
  };
  if (win) {
    await dialog.showMessageBox(win, boxOptions);
  } else {
    await dialog.showMessageBox(boxOptions);
  }
}

async function bumpCustomScriptRegistryVersion(
  addonId: string,
  artifactMode: "built" | "source" | undefined
): Promise<void> {
  try {
    const registryManager = new AddonRegistryManager();
    await registryManager.initialize();
    const registry = registryManager.getRegistry();
    await registry.load();
    const addon = registry.get(addonId);
    if (!addon) return;
    const version = await readBundledProductVersion(
      normalizeAddonProduct(addon.product),
      artifactMode || "built"
    );
    if (!version) return;
    addon.version = version;
    addon.lastUpdated = new Date().toISOString();
    await registry.save();
  } catch {
    // Non-fatal: Updates UI may show stale version until next successful bump
  }
}

async function fetchJson<T>(url: string, password: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "X-Addon-Password": password,
        ...(init?.headers || {}),
      },
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} for ${url}`);
    }
    return (await response.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

export interface DeployScriptsApiResponse {
  cwd: string;
  scripts: Array<{
    role: "install" | "update";
    relPath: string;
    exists: boolean;
    content: string | null;
    hash: string | null;
    error?: string;
  }>;
}

function sendProgress(channel: string, payload: unknown): void {
  const window = BrowserWindow.getAllWindows()[0];
  if (window && !window.isDestroyed()) {
    window.webContents.send(channel, payload);
  }
}

function domainFromPublicUrl(publicUrl: string): string {
  try {
    const u = new URL(publicUrl.includes("://") ? publicUrl : `https://${publicUrl}`);
    return u.host + (u.pathname && u.pathname !== "/" ? u.pathname.replace(/\/+$/, "") : "");
  } catch {
    return publicUrl.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  }
}

export function ensureCustomScriptPaths(config: AddonManagerConfig): AddonManagerConfig {
  const addonId = config.addonId || "custom-script";
  const publicUrl = config.installation.customScript?.publicUrl;
  if (publicUrl && !config.addon.domain?.trim()) {
    config.addon.domain = domainFromPublicUrl(publicUrl);
  }
  config.paths = {
    ...config.paths,
    addonDirectory: config.paths?.addonDirectory || `/opt/stremio-addon-${addonId}`,
    nginxConfig: config.paths?.nginxConfig || `/etc/nginx/sites-available/stremio-addon-${addonId}`,
    serviceFile: config.paths?.serviceFile || `/etc/systemd/system/stremio-addon-${addonId}.service`,
    logs: config.paths?.logs || `/var/log/stremio-addon-${addonId}`,
    backups: config.paths?.backups || `/var/backups/stremio-addon-${addonId}`,
  };
  return config;
}

export async function fetchDeployScriptsFromManagement(
  managementUrl: string,
  password: string
): Promise<DeployScriptsApiResponse> {
  const base = normalizeBaseUrl(managementUrl);
  const url = joinBaseUrl(base, password, "management/api/deploy/scripts");
  try {
    return await fetchJson<DeployScriptsApiResponse>(url, password);
  } catch (error) {
    throw new Error(
      `Failed to fetch deploy scripts from managementUrl: ${(error as Error).message}. ` +
        `Paste/pick the script again if the private admin app is unreachable.`
    );
  }
}

type ResolvedDeployScripts =
  | {
      ok: true;
      scriptContent: string;
      updateScriptContent?: string;
      source: "provided" | "management" | "stored";
      warning?: string;
    }
  | {
      ok: false;
      requiresScript: true;
      error: string;
    };

function persistLastScriptContents(
  customScript: CustomScriptConfig,
  scriptContent: string,
  updateScriptContent?: string
): void {
  customScript.lastInstallScriptContent = scriptContent;
  if (customScript.updateScriptMode === "separate" && updateScriptContent?.trim()) {
    customScript.lastUpdateScriptContent = updateScriptContent;
  } else if (customScript.updateScriptMode !== "separate") {
    // Same-mode: clear stale separate update body so fallback stays consistent
    delete customScript.lastUpdateScriptContent;
  }
}

/**
 * Resolve deploy script bodies for update/config apply.
 * Order: caller-provided → managementUrl GET → last stored scripts in config.
 * Does not weaken TLS; LAN HTTPS failures fall through to stored / paste UX.
 */
async function resolveDeployScriptsForRun(
  customScript: CustomScriptConfig,
  password: string,
  options?: { scriptContent?: string; updateScriptContent?: string },
  purpose: "update" | "config" = "update"
): Promise<ResolvedDeployScripts> {
  if (options?.scriptContent?.trim()) {
    return {
      ok: true,
      scriptContent: options.scriptContent,
      updateScriptContent: options.updateScriptContent,
      source: "provided",
    };
  }

  let managementError: string | undefined;
  try {
    const fetched = await fetchDeployScriptsFromManagement(customScript.managementUrl, password);
    const installEntry =
      fetched.scripts.find((s) => s.role === "install" && s.content) ||
      fetched.scripts.find((s) => s.content);
    const updateEntry = fetched.scripts.find((s) => s.role === "update" && s.content);
    if (installEntry?.content) {
      return {
        ok: true,
        scriptContent: installEntry.content,
        updateScriptContent:
          customScript.updateScriptMode === "separate" && updateEntry?.content
            ? updateEntry.content
            : undefined,
        source: "management",
      };
    }
    managementError =
      "managementUrl responded but no deploy script content was found (check ADMIN embed paths / DEPLOY_*_SCRIPT_REL_PATH)";
  } catch (error) {
    managementError = (error as Error).message;
  }

  const storedInstall = customScript.lastInstallScriptContent?.trim();
  if (storedInstall) {
    const tlsHint = managementUrlTlsHint(customScript.managementUrl, managementError || "");
    const warningParts = [
      purpose === "update"
        ? "Could not fetch deploy scripts from managementUrl; using last stored script from config."
        : "Could not fetch deploy scripts from managementUrl; using last stored script for config apply.",
      managementError,
    ];
    if (tlsHint) {
      warningParts.push(tlsHint);
    }
    logger.warn("Custom-script: falling back to stored deploy scripts", {
      managementUrl: customScript.managementUrl,
      purpose,
      error: managementError,
    });
    return {
      ok: true,
      scriptContent: storedInstall,
      updateScriptContent:
        customScript.updateScriptMode === "separate"
          ? customScript.lastUpdateScriptContent
          : undefined,
      source: "stored",
      warning: warningParts.filter(Boolean).join(" "),
    };
  }

  const tlsHint = managementUrlTlsHint(customScript.managementUrl, managementError || "");
  const parts = [
    managementError || "Failed to fetch deploy scripts from managementUrl.",
    "No stored deploy script is available. Paste/pick the script again to continue.",
  ];
  if (tlsHint) {
    parts.push(tlsHint);
  }
  return {
    ok: false,
    requiresScript: true,
    error: parts.join(" "),
  };
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** True for localhost / RFC1918 / link-local IPv4 hostnames. */
function isPrivateIpHostname(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host === "::1") {
    return true;
  }
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) {
    return false;
  }
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (a === 10 || a === 127) {
    return true;
  }
  if (a === 192 && b === 168) {
    return true;
  }
  if (a === 172 && b >= 16 && b <= 31) {
    return true;
  }
  if (a === 169 && b === 254) {
    return true;
  }
  return false;
}

/**
 * Extra hint when LAN HTTPS to a private IP fails (cert usually matches DuckDNS, not the IP).
 */
function managementUrlTlsHint(managementUrl: string, errorMessage: string): string | undefined {
  try {
    const u = new URL(managementUrl.includes("://") ? managementUrl : `https://${managementUrl}`);
    if (u.protocol !== "https:" || !isPrivateIpHostname(u.hostname)) {
      return undefined;
    }
    const looksLikeTlsOrFetch =
      /fetch failed|certificate|CERT_|UNABLE_TO_VERIFY|SSL|TLS|EPROTO|ERR_TLS|self[- ]signed|hostname|altnames|ENOTFOUND|ECONNREFUSED/i.test(
        errorMessage
      );
    if (!looksLikeTlsOrFetch) {
      return undefined;
    }
    return (
      "LAN HTTPS to an IP often fails Node TLS (cert name mismatch vs DuckDNS). " +
      "Try an http:// LAN URL if Gateway serves it, a Tailscale hostname that matches the cert, or accept this warning and paste the script later."
    );
  } catch {
    return undefined;
  }
}

function buildManagementScriptsWarning(
  deployMode: "install" | "update",
  managementUrl: string,
  mgmtError: string
): string {
  const verb = deployMode === "install" ? "Deploy script" : "Update script";
  const outcome =
    deployMode === "install"
      ? "Treating install as successful — the script is stored locally for later updates if managementUrl stays unreachable."
      : "Treating update as successful — the script remains stored locally for later updates if managementUrl stays unreachable.";
  const parts = [
    `${verb} exited 0 and publicUrl is healthy, but managementUrl scripts GET failed: ${mgmtError}`,
    outcome,
  ];
  const tlsHint = managementUrlTlsHint(managementUrl, mgmtError);
  if (tlsHint) {
    parts.push(tlsHint);
  }
  return parts.join(" ");
}

/**
 * Post-deploy check: private admin should expose deploy scripts.
 * Retries briefly (admin may still be warming up). Returns error text when still unreachable / empty; undefined when OK.
 * Callers treat failure as a warning when publicUrl already verified healthy — do not fail the whole install.
 */
async function verifyManagementScriptsReachable(
  managementUrl: string,
  password: string,
  options?: { attempts?: number; backoffMs?: number }
): Promise<string | undefined> {
  const attempts = options?.attempts ?? 3;
  const backoffMs = options?.backoffMs ?? 1500;
  let lastError: string | undefined;

  for (let i = 0; i < attempts; i++) {
    try {
      const fetched = await fetchDeployScriptsFromManagement(managementUrl, password);
      const withContent = fetched.scripts.filter((s) => s.exists && s.content);
      if (withContent.length > 0) {
        return undefined;
      }
      lastError =
        "managementUrl responded but no deploy script content was found (check ADMIN embed paths / DEPLOY_*_SCRIPT_REL_PATH)";
    } catch (error) {
      lastError = (error as Error).message;
    }
    if (i < attempts - 1) {
      await sleep(backoffMs * (i + 1));
    }
  }

  return lastError;
}

export async function fetchManagementLogs(
  managementUrl: string,
  password: string,
  lines = 400
): Promise<{ lines: string[]; serverTime?: string }> {
  const base = normalizeBaseUrl(managementUrl);
  const url = `${joinBaseUrl(base, password, "management/api/logs")}?lines=${encodeURIComponent(String(lines))}`;
  const data = await fetchJson<{
    lines?: Array<string | { at?: string; level?: string; message?: string }>;
    serverTime?: string;
  }>(url, password);
  const rawLines = Array.isArray(data.lines) ? data.lines : [];
  const formatted = rawLines.map((line) => {
    if (typeof line === "string") return line;
    const at = line.at || "";
    const level = line.level || "info";
    const message = line.message || JSON.stringify(line);
    return `[${at}] [${level}] ${message}`;
  });
  return { lines: formatted, serverTime: data.serverTime };
}

export async function fetchManagementConfig(
  managementUrl: string,
  password: string
): Promise<unknown> {
  const base = normalizeBaseUrl(managementUrl);
  const url = joinBaseUrl(base, password, "management/api/config");
  return fetchJson<unknown>(url, password);
}

/** Default PORT inside Docker for custom_script (host publish ports live in deploy script). */
const CUSTOM_SCRIPT_CONTAINER_PORT = "8080";

function ensureCustomScriptContainerPort(env: Record<string, string>, config: AddonManagerConfig): void {
  // EnvVarManager classic default is 7000; dual-app Gateway containers expect 8080 unless overridden.
  env.PORT = config.addon.port ? String(config.addon.port) : CUSTOM_SCRIPT_CONTAINER_PORT;
}

function buildPublicAddonEnv(config: AddonManagerConfig): Record<string, string> {
  const product = normalizeAddonProduct(config.product);
  const merged = EnvVarManager.mergeEnvVars(config, config.addon.environmentVariables);
  // Public instance must not expose management APIs
  // (EnvVarManager classic bake sets true — override for dual-app public)
  merged.ENABLE_MANAGEMENT_API = "false";
  ensureCustomScriptContainerPort(merged, config);
  if (config.installation.customScript?.publicUrl) {
    merged.ADDON_DOMAIN = domainFromPublicUrl(config.installation.customScript.publicUrl);
  }
  // Deploy scripts live only on the admin artifact — strip from public env
  delete merged.DEPLOY_INSTALL_SCRIPT_REL_PATH;
  delete merged.DEPLOY_UPDATE_SCRIPT_REL_PATH;
  // Merge previously applied keys we preserved
  const last = config.installation.customScript?.lastAppliedEnv;
  if (last) {
    for (const [key, value] of Object.entries(last)) {
      if (
        key === "ENABLE_MANAGEMENT_API" ||
        key === "DEPLOY_INSTALL_SCRIPT_REL_PATH" ||
        key === "DEPLOY_UPDATE_SCRIPT_REL_PATH"
      ) {
        continue;
      }
      if (!(key in merged) && value !== undefined && value !== "") {
        merged[key] = value;
      }
    }
  }
  return product === "translated_subtitles" ? stripStreamingOnlyEnvKeys(merged) : merged;
}

/** Admin/private instance env: management APIs on; domain from managementUrl. */
function buildAdminAddonEnv(config: AddonManagerConfig): Record<string, string> {
  const merged = EnvVarManager.mergeEnvVars(config, config.addon.environmentVariables);
  // Classic bake already sets true; set explicitly for dual-app admin
  merged.ENABLE_MANAGEMENT_API = "true";
  ensureCustomScriptContainerPort(merged, config);
  const cs = config.installation.customScript;
  if (cs?.managementUrl) {
    merged.ADDON_DOMAIN = domainFromPublicUrl(cs.managementUrl);
  }
  // Admin must know non-default script paths for GET /deploy/scripts
  if (cs?.installScriptRelPath) {
    merged.DEPLOY_INSTALL_SCRIPT_REL_PATH = cs.installScriptRelPath;
  }
  if (cs?.updateScriptRelPath) {
    merged.DEPLOY_UPDATE_SCRIPT_REL_PATH = cs.updateScriptRelPath;
  }
  // Keep password/token keys aligned with public lastApplied where useful
  const last = cs?.lastAppliedEnv;
  const product = normalizeAddonProduct(config.product);
  const secretKeys =
    product === "translated_subtitles"
      ? ["ADDON_PASSWORD"]
      : ["ADDON_PASSWORD", "REAL_DEBRID_API_KEY", "RD_API_TOKEN", "TORBOX_API_TOKEN"];
  if (last) {
    for (const key of secretKeys) {
      if (last[key] && !merged[key]) {
        merged[key] = last[key];
      }
    }
  }
  return product === "translated_subtitles" ? stripStreamingOnlyEnvKeys(merged) : merged;
}

/**
 * Hash the script body that will run (and the sibling update script when separate),
 * so confirm-on-change covers both files.
 */
export function hashCustomScriptBundle(
  scriptContent: string,
  updateScriptContent?: string,
  updateScriptMode?: "same" | "separate"
): string {
  if (updateScriptMode === "separate" && updateScriptContent?.trim()) {
    return hashScriptContent(`${scriptContent}\n---UPDATE---\n${updateScriptContent}`);
  }
  return hashScriptContent(scriptContent);
}

function toInstallationResult(
  config: AddonManagerConfig,
  run: CustomScriptRunResult
): InstallationResult {
  const publicUrl = run.publicUrl || config.installation.customScript?.publicUrl || "";
  const password = config.addon.password;
  const addonUrl = publicUrl ? joinBaseUrl(publicUrl, password) : "";
  const installManifestUrl = publicUrl ? joinBaseUrl(publicUrl, password, "manifest.json") : "";
  return {
    success: run.success,
    config,
    addonId: config.addonId,
    addonUrl,
    installManifestUrl,
    steps: run.steps,
    error: run.error,
    duration: run.durationMs,
  };
}

export interface CustomScriptInstallIpcOptions {
  config: AddonManagerConfig;
  scriptContent: string;
  updateScriptContent?: string;
}

export async function runCustomScriptInstall(
  options: CustomScriptInstallIpcOptions
): Promise<{ success: boolean; data?: InstallationResult; error?: string; warning?: string }> {
  const config = ensureCustomScriptPaths(options.config);
  const customScript = config.installation.customScript;
  if (!customScript?.publicUrl || !customScript.managementUrl) {
    return { success: false, error: "customScript.publicUrl and managementUrl are required" };
  }
  if (!options.scriptContent?.trim()) {
    return { success: false, error: "Install script content is required" };
  }
  if (!config.addonId || !config.addon.password) {
    return { success: false, error: "addonId and addon password are required" };
  }

  const gate = await ensureCustomScriptPreflight({
    managerSsh: customScript.managerSsh,
  });
  if (!gate.ok) {
    return { success: false, error: gate.error };
  }

  const installer = new CustomScriptInstaller();
  const progressCallback = (progress: InstallationProgress): void => {
    sendProgress("install:progress", progress);
  };

  const addonEnv = buildPublicAddonEnv(config);
  const adminEnv = buildAdminAddonEnv(config);
  const bundleHash = hashCustomScriptBundle(
    options.scriptContent,
    options.updateScriptContent,
    customScript.updateScriptMode
  );
  const run = await installer.run({
    customScript,
    addon: {
      id: config.addonId,
      name: config.addon.name || config.addonId,
      password: config.addon.password,
    },
    scriptContent: options.scriptContent,
    updateScriptContent: options.updateScriptContent,
    deployMode: "install",
    addonEnv,
    adminEnv,
    product: normalizeAddonProduct(config.product),
    progressCallback,
  });

  let managementWarning: string | undefined;
  if (run.success) {
    // Soft check only: publicUrl already verified healthy by CustomScriptInstaller.
    // managementUrl (often LAN HTTPS to an IP) must not fail the whole install.
    const mgmtError = await verifyManagementScriptsReachable(
      customScript.managementUrl,
      config.addon.password
    );
    if (mgmtError) {
      managementWarning = buildManagementScriptsWarning(
        "install",
        customScript.managementUrl,
        mgmtError
      );
      logger.warn("Custom-script install: managementUrl scripts GET failed (non-fatal)", {
        managementUrl: customScript.managementUrl,
        error: mgmtError,
      });
      run.warning = managementWarning;
    }
    customScript.lastScriptHash = bundleHash;
    persistLastScriptContents(
      customScript,
      options.scriptContent,
      options.updateScriptContent
    );
    customScript.lastAppliedEnv = addonEnv;
    config.installation.customScript = customScript;
    const cm = new ConfigManager(config.addonId);
    await cm.save(config);
  }

  const result = toInstallationResult(config, run);
  if (managementWarning) {
    result.warning = managementWarning;
  }
  if (!run.success) {
    const detail =
      run.verifyError ||
      run.error?.message ||
      "Custom script installation failed";
    const tail = [run.stdout, run.stderr].filter(Boolean).join("\n").slice(-2500);
    return {
      success: false,
      data: result,
      error: tail ? `${detail}\n\n--- script output ---\n${tail}` : detail,
    };
  }

  return { success: true, data: result, warning: managementWarning };
}

export interface CustomScriptUpdateIpcOptions {
  confirmScriptHash?: string;
  force?: boolean;
  scriptContent?: string;
  updateScriptContent?: string;
}

export async function runCustomScriptUpdate(
  addonId: string,
  options: CustomScriptUpdateIpcOptions = {}
): Promise<{
  success: boolean;
  data?: CustomScriptRunResult;
  error?: string;
  warning?: string;
  requiresConfirm?: boolean;
  requiresScript?: boolean;
  scriptHash?: string;
}> {
  const configManager = new ConfigManager(addonId);
  const config = await configManager.load();
  const customScript = config.installation.customScript;
  if (!customScript?.managementUrl || !customScript.publicUrl) {
    return { success: false, error: "Addon is missing customScript URLs" };
  }

  const resolved = await resolveDeployScriptsForRun(
    customScript,
    config.addon.password,
    {
      scriptContent: options.scriptContent,
      updateScriptContent: options.updateScriptContent,
    },
    "update"
  );
  if (!resolved.ok) {
    return {
      success: false,
      requiresScript: true,
      error: resolved.error,
    };
  }

  const scriptContent = resolved.scriptContent;
  const updateScriptContent = resolved.updateScriptContent;
  let resolveWarning = resolved.warning;

  const scriptHash = hashCustomScriptBundle(
    scriptContent,
    updateScriptContent,
    customScript.updateScriptMode
  );
  // forceUpdate still requires confirm when the deploy script changed (security)
  if (
    customScript.lastScriptHash &&
    customScript.lastScriptHash !== scriptHash &&
    options.confirmScriptHash !== scriptHash
  ) {
    return {
      success: false,
      requiresConfirm: true,
      scriptHash,
      error: `Deploy script hash changed (was ${customScript.lastScriptHash.slice(0, 12)}…, now ${scriptHash.slice(0, 12)}…). Confirm to continue.`,
    };
  }

  const gate = await ensureCustomScriptPreflight({
    managerSsh: customScript.managerSsh,
  });
  if (!gate.ok) {
    return { success: false, error: gate.error };
  }

  const installer = new CustomScriptInstaller();
  const progressCallback = (progress: InstallationProgress): void => {
    sendProgress("update:progress", { addonId, progress });
  };

  const addonEnv = buildPublicAddonEnv(config);
  const adminEnv = buildAdminAddonEnv(config);
  const run = await installer.run({
    customScript,
    addon: {
      id: addonId,
      name: config.addon.name || addonId,
      password: config.addon.password,
    },
    scriptContent,
    updateScriptContent,
    deployMode: "update",
    addonEnv,
    adminEnv,
    product: normalizeAddonProduct(config.product),
    progressCallback,
  });

  // Prefer bundle hash (covers separate update script) over install-only hash from runner
  const effectiveHash = scriptHash;

  let managementWarning: string | undefined;
  if (run.success) {
    // Soft check only: publicUrl already verified healthy by CustomScriptInstaller.
    // Skip re-GET when we already know management is unreachable (used stored/provided).
    if (resolved.source === "management" || resolved.source === "provided") {
      const mgmtError = await verifyManagementScriptsReachable(
        customScript.managementUrl,
        config.addon.password
      );
      if (mgmtError) {
        managementWarning = buildManagementScriptsWarning(
          "update",
          customScript.managementUrl,
          mgmtError
        );
        logger.warn("Custom-script update: managementUrl scripts GET failed (non-fatal)", {
          managementUrl: customScript.managementUrl,
          error: mgmtError,
        });
        run.warning = managementWarning;
      }
    } else if (resolveWarning) {
      managementWarning = resolveWarning;
      run.warning = managementWarning;
    }
    customScript.lastScriptHash = effectiveHash;
    persistLastScriptContents(customScript, scriptContent, updateScriptContent);
    customScript.lastAppliedEnv = addonEnv;
    config.installation.customScript = customScript;
    await configManager.save(config);
    await bumpCustomScriptRegistryVersion(addonId, customScript.artifactMode);
  }

  if (!run.success) {
    const detail = run.verifyError || run.error?.message || "Custom script update failed";
    const tail = [run.stdout, run.stderr].filter(Boolean).join("\n").slice(-2500);
    return {
      success: false,
      data: run,
      error: tail ? `${detail}\n\n--- script output ---\n${tail}` : detail,
    };
  }

  const combinedWarning = [resolveWarning, managementWarning].filter(Boolean).join(" ") || undefined;
  return {
    success: true,
    data: { ...run, scriptHash: effectiveHash, warning: combinedWarning },
    warning: combinedWarning,
  };
}

export async function runCustomScriptConfigApply(
  addonId: string,
  options?: { scriptContent?: string; confirmScriptHash?: string; force?: boolean }
): Promise<{
  success: boolean;
  error?: string;
  warning?: string;
  requiresConfirm?: boolean;
  requiresScript?: boolean;
  scriptHash?: string;
}> {
  const configManager = new ConfigManager(addonId);
  const config = await configManager.load();
  const customScript = config.installation.customScript;
  if (!customScript?.managementUrl) {
    return { success: false, error: "Addon is missing customScript.managementUrl" };
  }

  const resolved = await resolveDeployScriptsForRun(
    customScript,
    config.addon.password,
    { scriptContent: options?.scriptContent },
    "config"
  );
  if (!resolved.ok) {
    return {
      success: false,
      requiresScript: true,
      error: resolved.error,
    };
  }

  const scriptContent = resolved.scriptContent;
  const resolveWarning = resolved.warning;

  const scriptHash = hashCustomScriptBundle(scriptContent);
  if (
    customScript.lastScriptHash &&
    customScript.lastScriptHash !== scriptHash &&
    options?.confirmScriptHash !== scriptHash
  ) {
    return {
      success: false,
      requiresConfirm: true,
      scriptHash,
      error: `Deploy script hash changed. Confirm to apply config with the new script.`,
    };
  }

  const gate = await ensureCustomScriptPreflight({
    managerSsh: customScript.managerSsh,
  });
  if (!gate.ok) {
    return { success: false, error: gate.error };
  }

  const installer = new CustomScriptInstaller();
  const addonEnv = buildPublicAddonEnv(config);
  const adminEnv = buildAdminAddonEnv(config);
  const run = await installer.run({
    customScript,
    addon: {
      id: addonId,
      name: config.addon.name || addonId,
      password: config.addon.password,
    },
    scriptContent,
    deployMode: "config",
    addonEnv,
    adminEnv,
    product: normalizeAddonProduct(config.product),
    skipStaging: true,
    skipVerify: true,
    progressCallback: (progress) => sendProgress("install:progress", progress),
  });

  if (run.success) {
    customScript.lastScriptHash = scriptHash;
    persistLastScriptContents(customScript, scriptContent);
    customScript.lastAppliedEnv = addonEnv;
    config.installation.customScript = customScript;
    await configManager.save(config);
    return { success: true, warning: resolveWarning };
  }

  const detail = run.error?.message || "Config apply via deploy script failed";
  const tail = [run.stdout, run.stderr].filter(Boolean).join("\n").slice(-2500);
  return { success: false, error: tail ? `${detail}\n\n${tail}` : detail };
}

const LLM_SWITCH_TIMEOUT_MS = 10 * 60 * 1000;

export interface LlmSwitchResult {
  success: boolean;
  error?: string;
  warning?: string;
  unreachable?: boolean;
  attachedSibling?: boolean;
  modelId?: string;
  filename?: string;
  pruned?: string[];
}

function publicBaseFromConfig(config: AddonManagerConfig): string | undefined {
  const publicUrl = config.installation.customScript?.publicUrl?.trim();
  if (publicUrl) {
    return normalizeBaseUrl(publicUrl);
  }
  const domain = config.addon.domain?.trim();
  if (!domain) {
    return undefined;
  }
  if (/^https?:\/\//i.test(domain)) {
    return normalizeBaseUrl(domain);
  }
  return normalizeBaseUrl(`https://${domain}`);
}

export async function switchTranslatedSubtitlesModel(
  addonId: string,
  modelId: string
): Promise<LlmSwitchResult> {
  const configManager = new ConfigManager(addonId);
  const config = await configManager.load();
  const password = config.addon.password?.trim();
  const base = publicBaseFromConfig(config);
  if (!base || !password) {
    return {
      success: false,
      error: "Public URL and addon password are required to switch the LLM model.",
    };
  }

  const url = joinBaseUrl(base, password, "engine/switch");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LLM_SWITCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Addon-Password": password,
      },
      body: JSON.stringify({ modelId }),
    });
    const raw = (await response.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
      attachedSibling?: boolean;
      engine?: string;
      modelId?: string;
      filename?: string;
      pruned?: string[];
    };
    if (!response.ok) {
      const unreachable = response.status === 502 || response.status === 504;
      return {
        success: false,
        unreachable,
        error: raw.error || `HTTP ${response.status} for ${url}`,
      };
    }
    const warning = raw.attachedSibling
      ? raw.engine === "mt"
        ? "NLLB files are on disk. If llama still runs as a sibling container, restart that service so mmap releases the old GGUF."
        : "New model files are on disk. If llama or NLLB run as sibling containers, restart those services so mmap releases the old files."
      : undefined;
    return {
      success: true,
      warning,
      attachedSibling: raw.attachedSibling,
      modelId: raw.modelId,
      filename: raw.filename,
      pruned: raw.pruned,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      unreachable: true,
      error: message,
    };
  } finally {
    clearTimeout(timer);
  }
}

export function isCustomScriptConfig(config: AddonManagerConfig): boolean {
  return (
    config.installation?.type === "custom_script" ||
    Boolean(config.installation?.customScript?.publicUrl)
  );
}

export type { CustomScriptConfig };
