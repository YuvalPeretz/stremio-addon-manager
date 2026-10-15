/**
 * Bash preflight and script execution for custom-script installs.
 */

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { logger } from "../utils/logger.js";

export type PythonResolvedAs = "python3" | "python" | "py -3";

export interface PythonPreflightInfo {
  ok: boolean;
  /** How Python 3 was found inside the same bash used to run deploy scripts */
  resolvedAs?: PythonResolvedAs;
  /** True when `python3` is missing but another Python 3 entry point works — inject a shim */
  needsPython3Shim: boolean;
  error?: string;
}

export type BashPreflightErrorCode =
  | "bash_missing"
  | "python_missing"
  | "ssh_missing";

export interface ToolPreflightInfo {
  ok: boolean;
  error?: string;
}

export interface BashPreflightResult {
  ok: boolean;
  bashOk: boolean;
  bashPath?: string;
  error?: string;
  /** Distinguishes missing bash / Python / ssh for Electron prompting */
  errorCode?: BashPreflightErrorCode;
  hints: string[];
  /** Non-blocking advisories (e.g. rsync missing when Manager SSH is unset) */
  warnings: string[];
  python: PythonPreflightInfo;
  ssh: ToolPreflightInfo;
  rsync: ToolPreflightInfo;
  /** Present when transfer-tool check ran; ok if `scp` is on bash PATH */
  scp: ToolPreflightInfo;
}

export interface ScriptRunOptions {
  /** Absolute path to bash executable */
  bashPath: string;
  /** Absolute path to the .sh script to run */
  scriptPath: string;
  /** Environment variables merged over process.env */
  env: Record<string, string>;
  /** Working directory (defaults to script directory) */
  cwd?: string;
  /** Optional stdout/stderr line callback for progress UI */
  onOutput?: (stream: "stdout" | "stderr", chunk: string) => void;
  /**
   * When Python was found as `py -3` or `python` but not `python3`, create a
   * temporary `python3` shim on PATH so deploy scripts that call `python3` succeed.
   */
  ensurePython3Shim?: boolean;
  /** Which interpreter the shim should invoke (required when ensurePython3Shim is true) */
  pythonShimTarget?: Exclude<PythonResolvedAs, "python3">;
}

export interface ScriptRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

const WINDOWS_GIT_BASH_CANDIDATES = [
  "C:\\Program Files\\Git\\bin\\bash.exe",
  "C:\\Program Files (x86)\\Git\\bin\\bash.exe",
  path.join(process.env.LOCALAPPDATA ?? "", "Programs", "Git", "bin", "bash.exe"),
  path.join(process.env.PROGRAMFILES ?? "", "Git", "bin", "bash.exe"),
];

const GIT_BASH_INSTALL_HINT =
  "Install Git for Windows (includes bash): https://git-scm.com/download/win";
const SSH_HELP_URL =
  "https://learn.microsoft.com/en-us/windows-server/administration/openssh/openssh_install_firstuse";
const OPENSSH_HINT =
  process.platform === "win32"
    ? `Install OpenSSH Client (Windows Optional Feature) or use Git for Windows ssh so Git Bash sees \`ssh\`. Help: ${SSH_HELP_URL}`
    : "Install an OpenSSH client and ensure `ssh` is on PATH.";
/** Soft advisory when Manager SSH is unset and the script must upload itself. */
const TRANSFER_FALLBACK_HINT =
  "Without Manager SSH, your deploy script must upload ADDON/ADMIN trees itself (tar-over-ssh or rsync). Prefer setting Manager SSH in the wizard so Electron uploads via SSH.";
const PYTHON_DOWNLOAD_URL = "https://www.python.org/downloads/";
const PYTHON_INSTALL_HINT =
  process.platform === "win32"
    ? `Install Python 3 from ${PYTHON_DOWNLOAD_URL} — enable "Add python.exe to PATH". Git Bash must see \`python3\` or \`py -3\`.`
    : `Install Python 3 and ensure \`python3\` is on PATH (${PYTHON_DOWNLOAD_URL}).`;

export { PYTHON_DOWNLOAD_URL, SSH_HELP_URL };

function fileIsExecutableCandidate(filePath: string): boolean {
  try {
    return fs.existsSync(filePath) && fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

/**
 * Resolve bash for custom-script runs.
 * On Windows, prefer Git Bash; do not use WSL unless explicitly opted in.
 */
export function resolveBashPath(options?: { allowWsl?: boolean }): string | null {
  const allowWsl = options?.allowWsl === true;

  if (process.platform === "win32") {
    for (const candidate of WINDOWS_GIT_BASH_CANDIDATES) {
      if (candidate && fileIsExecutableCandidate(candidate)) {
        return candidate;
      }
    }

    // PATH bash (often Git Bash shims)
    const pathBash = findOnPath("bash.exe") ?? findOnPath("bash");
    if (pathBash && !isWslBash(pathBash)) {
      return pathBash;
    }

    if (allowWsl) {
      const wsl = findOnPath("wsl.exe");
      if (wsl) {
        return wsl;
      }
    }

    return null;
  }

  return findOnPath("bash");
}

function isWslBash(bashPath: string): boolean {
  const normalized = bashPath.replace(/\\/g, "/").toLowerCase();
  return normalized.includes("/wsl/") || normalized.includes("system32/bash.exe");
}

function findOnPath(command: string): string | null {
  const pathEnv = process.env.PATH ?? process.env.Path ?? "";
  const parts = pathEnv.split(path.delimiter).filter(Boolean);
  const extensions =
    process.platform === "win32"
      ? command.includes(".")
        ? [""]
        : ["", ".exe", ".cmd", ".bat"]
      : [""];

  for (const dir of parts) {
    for (const ext of extensions) {
      const full = path.join(dir, `${command}${ext}`);
      if (fileIsExecutableCandidate(full)) {
        return full;
      }
    }
  }
  return null;
}

function bashEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (process.platform === "win32") {
    env.MSYS_NO_PATHCONV = env.MSYS_NO_PATHCONV ?? "1";
  }
  return env;
}

/**
 * Run a short command inside the same bash that will execute deploy scripts.
 */
export function runBashCommand(
  bashPath: string,
  command: string
): { status: number; stdout: string; stderr: string } {
  const result = spawnSync(bashPath, ["-c", command], {
    encoding: "utf8",
    windowsHide: true,
    env: bashEnv(),
  });
  return {
    status: result.status ?? 1,
    stdout: (result.stdout ?? "").toString(),
    stderr: (result.stderr ?? "").toString(),
  };
}

function bashHasCommand(bashPath: string, command: string): boolean {
  // command names are fixed literals from our code, not user input
  const result = runBashCommand(bashPath, `command -v ${command} >/dev/null 2>&1`);
  return result.status === 0;
}

/**
 * Detect Python 3 using the deploy-script bash environment (not Node's PATH alone).
 * Order: python3 → python (must be 3.x) → Windows `py -3`.
 */
export function detectPythonInBash(bashPath: string): PythonPreflightInfo {
  const detectScript = [
    "set +e",
    "if command -v python3 >/dev/null 2>&1; then",
    "  if python3 -c 'import sys; raise SystemExit(0 if sys.version_info[0] >= 3 else 1)' >/dev/null 2>&1; then",
    "    printf '%s\\n' 'OK:python3'",
    "    exit 0",
    "  fi",
    "fi",
    "if command -v python >/dev/null 2>&1; then",
    "  if python -c 'import sys; raise SystemExit(0 if sys.version_info[0] >= 3 else 1)' >/dev/null 2>&1; then",
    "    printf '%s\\n' 'OK:python'",
    "    exit 0",
    "  fi",
    "fi",
    "if command -v py >/dev/null 2>&1; then",
    "  if py -3 -c 'import sys; raise SystemExit(0 if sys.version_info[0] >= 3 else 1)' >/dev/null 2>&1; then",
    "    printf '%s\\n' 'OK:py-3'",
    "    exit 0",
    "  fi",
    "fi",
    "printf '%s\\n' 'MISSING'",
    "exit 1",
  ].join("\n");

  const result = runBashCommand(bashPath, detectScript);
  const token = result.stdout.trim().split(/\r?\n/).pop()?.trim() ?? "";

  if (token === "OK:python3") {
    return { ok: true, resolvedAs: "python3", needsPython3Shim: false };
  }
  if (token === "OK:python") {
    // Scripts commonly call `python3`; shim so preflight success implies run success
    return { ok: true, resolvedAs: "python", needsPython3Shim: true };
  }
  if (token === "OK:py-3") {
    return { ok: true, resolvedAs: "py -3", needsPython3Shim: true };
  }

  const error =
    process.platform === "win32"
      ? "Python 3 was not found in Git Bash. Need `python3`, `python` (3.x), or `py -3` on the bash PATH."
      : "Python 3 was not found (`python3` or `python` 3.x on PATH).";

  return { ok: false, needsPython3Shim: false, error };
}

/**
 * Create a temp dir with a `python3` shim that invokes `py -3` or `python`.
 * Returns the directory to prepend to PATH for script runs.
 */
export function createPython3ShimDir(target: Exclude<PythonResolvedAs, "python3">): string {
  const shimDir = fs.mkdtempSync(path.join(os.tmpdir(), "stremio-python3-shim-"));
  const shimPath = path.join(shimDir, "python3");
  const execLine = target === "py -3" ? 'exec py -3 "$@"' : 'exec python "$@"';
  const body = `#!/usr/bin/env bash\n${execLine}\n`;
  fs.writeFileSync(shimPath, body, { encoding: "utf8" });
  try {
    fs.chmodSync(shimPath, 0o755);
  } catch {
    // chmod may be a no-op / limited on Windows; Git Bash still runs shebang scripts from PATH
  }
  logger.info("Created python3 shim for deploy scripts", { shimPath, target });
  return shimDir;
}

/**
 * Windows/Linux bash preflight. Fails clearly before staging if bash or Python 3 is missing.
 * ssh is hard when checkSsh is true (default). rsync/scp are never hard requirements —
 * Electron uploads via SSHManager when Manager SSH is set; otherwise scripts self-upload.
 */
export function preflightBash(options?: {
  allowWsl?: boolean;
  checkSsh?: boolean;
  /**
   * When true, probe rsync/scp and optionally warn (never hard-fail).
   * Default false — Electron Manager SSH upload does not need Git Bash rsync.
   */
  checkRsync?: boolean;
  /**
   * Soft-warn when rsync is missing (only meaningful with checkRsync).
   * Use when Manager SSH is unset so the script must upload itself.
   */
  warnIfRsyncMissing?: boolean;
  checkPython?: boolean;
}): BashPreflightResult {
  const hints = [GIT_BASH_INSTALL_HINT, OPENSSH_HINT, PYTHON_INSTALL_HINT, TRANSFER_FALLBACK_HINT];
  const warnings: string[] = [];
  const checkPython = options?.checkPython !== false;
  const checkSsh = options?.checkSsh !== false;
  const checkRsync = options?.checkRsync === true;
  const warnIfRsyncMissing = options?.warnIfRsyncMissing === true;
  const skippedTool: ToolPreflightInfo = { ok: false, error: "bash missing — skipped" };

  const bashPath = resolveBashPath({ allowWsl: options?.allowWsl });

  if (!bashPath) {
    const error =
      process.platform === "win32"
        ? "Git Bash was not found. Custom script deploy requires Git for Windows (bash)."
        : "bash was not found on PATH. Custom script deploy requires a Unix-like shell.";
    logger.error("Bash preflight failed", { error });
    return {
      ok: false,
      bashOk: false,
      error,
      errorCode: "bash_missing",
      hints,
      warnings,
      python: { ok: false, needsPython3Shim: false, error: "bash missing — skipped Python check" },
      ssh: skippedTool,
      rsync: skippedTool,
      scp: skippedTool,
    };
  }

  let python: PythonPreflightInfo = { ok: true, needsPython3Shim: false };
  if (checkPython) {
    python = detectPythonInBash(bashPath);
    if (!python.ok) {
      const error = python.error ?? "Python 3 is required for custom-script deploy.";
      logger.error("Python preflight failed", { error, bashPath });
      return {
        ok: false,
        bashOk: true,
        bashPath,
        error,
        errorCode: "python_missing",
        hints: [PYTHON_INSTALL_HINT, ...hints],
        warnings,
        python,
        ssh: { ok: false, error: "skipped — fix Python first" },
        rsync: { ok: false, error: "skipped — fix Python first" },
        scp: { ok: false, error: "skipped — fix Python first" },
      };
    }
  }

  let ssh: ToolPreflightInfo = { ok: true };
  if (checkSsh) {
    const hasSsh = bashHasCommand(bashPath, "ssh");
    if (!hasSsh) {
      const error =
        process.platform === "win32"
          ? "ssh was not found in Git Bash. Deploy scripts need OpenSSH on the bash PATH (Gateway agent API over ssh)."
          : "ssh was not found on PATH. Custom-script deploy requires an OpenSSH client.";
      logger.error("ssh preflight failed", { error, bashPath });
      return {
        ok: false,
        bashOk: true,
        bashPath,
        error,
        errorCode: "ssh_missing",
        hints: [OPENSSH_HINT, ...hints],
        warnings,
        python,
        ssh: { ok: false, error },
        rsync: { ok: false, error: "skipped — fix ssh first" },
        scp: { ok: false, error: "skipped — fix ssh first" },
      };
    }
  }

  let rsync: ToolPreflightInfo = { ok: true };
  let scp: ToolPreflightInfo = { ok: true };
  if (checkRsync) {
    const hasRsync = bashHasCommand(bashPath, "rsync");
    const hasScp = bashHasCommand(bashPath, "scp");
    rsync = hasRsync
      ? { ok: true }
      : {
          ok: false,
          error:
            process.platform === "win32"
              ? "rsync was not found in Git Bash."
              : "rsync was not found on PATH.",
        };
    scp = hasScp
      ? { ok: true }
      : {
          ok: false,
          error:
            process.platform === "win32"
              ? "scp was not found in Git Bash."
              : "scp was not found on PATH.",
        };

    if (warnIfRsyncMissing && !hasRsync) {
      warnings.push(
        hasScp || ssh.ok
          ? "rsync not found and Manager SSH is unset. Electron will not pre-upload artifacts — your script must upload via tar-over-ssh (or rsync if you install it). Prefer setting Manager SSH in the wizard."
          : "rsync not found and Manager SSH is unset. Set Manager SSH so Electron uploads staged trees, or ensure tar+ssh are available for script self-upload."
      );
    }
  }

  logger.info("Bash preflight OK", {
    bashPath,
    python: python.resolvedAs,
    needsPython3Shim: python.needsPython3Shim,
    ssh: ssh.ok,
    rsync: rsync.ok,
    scp: scp.ok,
    warnings,
  });
  return {
    ok: true,
    bashOk: true,
    bashPath,
    hints,
    warnings,
    python,
    ssh,
    rsync,
    scp,
  };
}

/**
 * Spawn bash to run a script file with the given environment.
 * Uses `bash <script>` (not `bash -lc`) so Windows Git Bash receives a real file path.
 */
export async function runBashScript(options: ScriptRunOptions): Promise<ScriptRunResult> {
  const { bashPath, scriptPath, env, cwd, onOutput } = options;
  const start = Date.now();

  if (!fs.existsSync(scriptPath)) {
    throw new Error(`Deploy script not found: ${scriptPath}`);
  }

  const mergedEnv: NodeJS.ProcessEnv = {
    ...process.env,
    ...env,
  };

  // Help Git Bash resolve Windows paths consistently
  if (process.platform === "win32") {
    mergedEnv.MSYS_NO_PATHCONV = mergedEnv.MSYS_NO_PATHCONV ?? "1";
  }

  let shimDir: string | undefined;
  if (options.ensurePython3Shim && options.pythonShimTarget) {
    shimDir = createPython3ShimDir(options.pythonShimTarget);
    const pathKey = process.platform === "win32" && mergedEnv.Path && !mergedEnv.PATH ? "Path" : "PATH";
    const existing = mergedEnv[pathKey] ?? mergedEnv.PATH ?? mergedEnv.Path ?? process.env.PATH ?? "";
    mergedEnv[pathKey] = `${shimDir}${path.delimiter}${existing}`;
    if (pathKey === "Path") {
      mergedEnv.PATH = mergedEnv[pathKey];
    }
    // Help scripts that honor PYTHON
    if (!mergedEnv.PYTHON) {
      mergedEnv.PYTHON = options.pythonShimTarget === "py -3" ? "py" : "python";
    }
  }

  logger.info("Running deploy script", {
    bashPath,
    scriptPath,
    cwd: cwd ?? path.dirname(scriptPath),
    pythonShim: shimDir,
  });

  return new Promise<ScriptRunResult>((resolve, reject) => {
    const child = spawn(bashPath, [scriptPath], {
      cwd: cwd ?? path.dirname(scriptPath),
      env: mergedEnv,
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (buf: Buffer) => {
      const chunk = buf.toString("utf8");
      stdout += chunk;
      onOutput?.("stdout", chunk);
    });

    child.stderr.on("data", (buf: Buffer) => {
      const chunk = buf.toString("utf8");
      stderr += chunk;
      onOutput?.("stderr", chunk);
    });

    child.on("error", (error: Error) => {
      reject(new Error(`Failed to spawn bash: ${error.message}`));
    });

    child.on("close", (code: number | null) => {
      const exitCode = code ?? 1;
      const durationMs = Date.now() - start;
      logger.info("Deploy script finished", { exitCode, durationMs });
      resolve({ exitCode, stdout, stderr, durationMs });
    });
  });
}
