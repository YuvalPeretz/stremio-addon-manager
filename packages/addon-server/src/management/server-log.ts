/**
 * In-process server log capture for the management UI.
 * Hooks console.log/warn/error and appends JSONL to disk (survives restarts).
 */

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type { ServerConfig } from "../config.js";

export type ServerLogLevel = "log" | "info" | "warn" | "error" | "debug";

export interface ServerLogLine {
  at: string;
  level: ServerLogLevel;
  message: string;
}

const RING_MAX = 5_000;
const PRUNE_KEEP_LINES = 12_000;

const ring: ServerLogLine[] = [];
let logFilePath = path.join(os.homedir(), ".stremio-addon", "server.log");
let logFileMaxBytes = 5_000_000;
let captureInstalled = false;

function applyLogPathsFromEnv(): void {
  const raw = process.env.ADDON_SERVER_LOG?.trim();
  if (raw && raw.length > 0) {
    logFilePath = path.isAbsolute(raw) ? raw : path.join(process.cwd(), raw);
  }
  const maxRaw = process.env.SERVER_LOG_MAX_BYTES?.trim();
  if (maxRaw) {
    const n = parseInt(maxRaw, 10);
    if (Number.isFinite(n) && n > 0) logFileMaxBytes = n;
  }
}

let origLog: typeof console.log;
let origInfo: typeof console.info;
let origWarn: typeof console.warn;
let origError: typeof console.error;
let origDebug: typeof console.debug;

function formatArgs(args: unknown[]): string {
  return args
    .map((a) => {
      if (a == null) return String(a);
      if (typeof a === "string") return a;
      if (a instanceof Error) return a.stack ?? a.message;
      try {
        return JSON.stringify(a);
      } catch {
        return String(a);
      }
    })
    .join(" ");
}

function pushLine(level: ServerLogLevel, message: string): void {
  const line: ServerLogLine = { at: new Date().toISOString(), level, message };
  ring.push(line);
  if (ring.length > RING_MAX) {
    ring.splice(0, ring.length - RING_MAX);
  }
  void appendLineToFile(line).catch(() => {
    // avoid recursive logging on disk failure
  });
}

async function ensureDirForFile(filePath: string): Promise<void> {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
}

async function appendLineToFile(line: ServerLogLine): Promise<void> {
  await ensureDirForFile(logFilePath);
  const serialized = JSON.stringify(line) + "\n";
  await fsp.appendFile(logFilePath, serialized, "utf8");
  try {
    const st = await fsp.stat(logFilePath);
    if (st.size > logFileMaxBytes) {
      await pruneLogFile(logFilePath, PRUNE_KEEP_LINES);
    }
  } catch {
    // ignore
  }
}

async function pruneLogFile(filePath: string, keepLastLines: number): Promise<void> {
  const raw = await fsp.readFile(filePath, "utf8");
  const lines = raw.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length <= keepLastLines) return;
  const tail = lines.slice(-keepLastLines);
  const tmp = filePath + ".tmp";
  await fsp.writeFile(tmp, tail.map((l) => l + "\n").join(""), "utf8");
  await fsp.rename(tmp, filePath);
}

function wrapConsole(
  level: ServerLogLevel,
  original: (...args: unknown[]) => void
): (...args: unknown[]) => void {
  return (...args: unknown[]): void => {
    pushLine(level, formatArgs(args));
    original.apply(console, args);
  };
}

/**
 * Install console hooks. Call once at process startup (before heavy logging).
 */
export function installServerLogCapture(config?: Pick<ServerConfig, "serverLogPath" | "serverLogMaxBytes">): void {
  if (config) {
    logFilePath = config.serverLogPath;
    logFileMaxBytes = config.serverLogMaxBytes;
  } else if (!captureInstalled) {
    applyLogPathsFromEnv();
  }
  if (captureInstalled) return;
  captureInstalled = true;

  origLog = console.log.bind(console);
  origInfo = console.info.bind(console);
  origWarn = console.warn.bind(console);
  origError = console.error.bind(console);
  origDebug = console.debug.bind(console);

  console.log = wrapConsole("log", origLog as (...args: unknown[]) => void);
  console.info = wrapConsole("info", origInfo as (...args: unknown[]) => void);
  console.warn = wrapConsole("warn", origWarn as (...args: unknown[]) => void);
  console.error = wrapConsole("error", origError as (...args: unknown[]) => void);
  console.debug = wrapConsole("debug", origDebug as (...args: unknown[]) => void);
}

function parseLogLine(raw: string): ServerLogLine | null {
  const t = raw.trim();
  if (!t) return null;
  try {
    const parsed = JSON.parse(t) as ServerLogLine;
    if (typeof parsed.at === "string" && typeof parsed.message === "string") {
      return {
        at: parsed.at,
        level: parsed.level ?? "log",
        message: parsed.message,
      };
    }
  } catch {
    // legacy plain-text line
    return { at: "", level: "log", message: t };
  }
  return null;
}

export interface ListServerLogsQuery {
  lines?: number;
  q?: string;
  level?: ServerLogLevel | "all";
}

export interface ListServerLogsResult {
  lines: ServerLogLine[];
  path: string;
  source: "ring" | "file" | "mixed";
}

function matchesFilter(line: ServerLogLine, q: string, level: ServerLogLevel | "all" | undefined): boolean {
  if (level && level !== "all" && line.level !== level) return false;
  if (!q) return true;
  const needle = q.toLowerCase();
  return (
    line.message.toLowerCase().includes(needle) ||
    line.level.toLowerCase().includes(needle) ||
    line.at.toLowerCase().includes(needle)
  );
}

/**
 * Return the most recent log lines (newest last), filtered.
 */
export async function listServerLogs(
  config: ServerConfig,
  query: ListServerLogsQuery
): Promise<ListServerLogsResult> {
  const limit = Math.min(2_000, Math.max(50, query.lines ?? 400));
  const q = (query.q ?? "").trim();
  const level = query.level;

  const fromRing = [...ring];
  let fromFile: ServerLogLine[] = [];

  if (fs.existsSync(config.serverLogPath)) {
    try {
      const raw = await fsp.readFile(config.serverLogPath, "utf8");
      for (const line of raw.split("\n")) {
        const p = parseLogLine(line);
        if (p) fromFile.push(p);
      }
    } catch {
      fromFile = [];
    }
  }

  // Merge: file history + ring (ring may duplicate tail of file — dedupe by at+message)
  const seen = new Set<string>();
  const merged: ServerLogLine[] = [];
  for (const line of [...fromFile, ...fromRing]) {
    const key = `${line.at}\t${line.level}\t${line.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(line);
  }

  const filtered = merged.filter((line) => matchesFilter(line, q, level));
  const tail = filtered.slice(-limit);

  let source: ListServerLogsResult["source"] = "ring";
  if (fromFile.length > 0 && fromRing.length > 0) source = "mixed";
  else if (fromFile.length > 0) source = "file";

  return {
    lines: tail,
    path: config.serverLogPath,
    source,
  };
}
