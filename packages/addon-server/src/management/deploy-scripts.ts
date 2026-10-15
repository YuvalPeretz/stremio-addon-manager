/**
 * Read deploy scripts from configured relative paths under process cwd.
 * Used by GET /management/api/deploy/scripts on admin instances.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { ServerConfig } from "../config.js";

export type DeployScriptRole = "install" | "update";

export interface DeployScriptEntry {
  role: DeployScriptRole;
  relPath: string;
  absolutePath: string;
  exists: boolean;
  content: string | null;
  /** SHA-256 hex of content when present; null if missing/unreadable */
  hash: string | null;
  error?: string;
}

export interface DeployScriptsResponse {
  cwd: string;
  scripts: DeployScriptEntry[];
}

function resolveUnderCwd(relPath: string, cwd: string): { absolutePath: string; ok: boolean; error?: string } {
  const absolutePath = path.resolve(cwd, relPath);
  const cwdResolved = path.resolve(cwd);
  const relative = path.relative(cwdResolved, absolutePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return { absolutePath, ok: false, error: "path_outside_cwd" };
  }
  return { absolutePath, ok: true };
}

function readOneScript(role: DeployScriptRole, relPath: string, cwd: string): DeployScriptEntry {
  const resolved = resolveUnderCwd(relPath, cwd);
  if (!resolved.ok) {
    return {
      role,
      relPath,
      absolutePath: resolved.absolutePath,
      exists: false,
      content: null,
      hash: null,
      error: resolved.error,
    };
  }

  try {
    if (!fs.existsSync(resolved.absolutePath) || !fs.statSync(resolved.absolutePath).isFile()) {
      return {
        role,
        relPath,
        absolutePath: resolved.absolutePath,
        exists: false,
        content: null,
        hash: null,
      };
    }
    const content = fs.readFileSync(resolved.absolutePath, "utf8");
    const hash = crypto.createHash("sha256").update(content, "utf8").digest("hex");
    return {
      role,
      relPath,
      absolutePath: resolved.absolutePath,
      exists: true,
      content,
      hash,
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      role,
      relPath,
      absolutePath: resolved.absolutePath,
      exists: false,
      content: null,
      hash: null,
      error: msg,
    };
  }
}

/**
 * Load install + update deploy scripts from configured relative paths.
 */
export function loadDeployScripts(config: ServerConfig, cwd: string = process.cwd()): DeployScriptsResponse {
  return {
    cwd: path.resolve(cwd),
    scripts: [
      readOneScript("install", config.deployInstallScriptRelPath, cwd),
      readOneScript("update", config.deployUpdateScriptRelPath, cwd),
    ],
  };
}
