/**
 * TranslatedSubtitles configuration from environment variables.
 */

import os from "node:os";
import path from "node:path";
import type { GlossaryEntry } from "./types.js";
import {
  DEFAULT_CACHE_TTL_SEC,
  DEFAULT_LLM_SERVER_URL,
  DEFAULT_OPENSUBTITLES_BASE_URL,
  DEFAULT_PORT,
  DEFAULT_TARGET_LANG,
  DEFAULT_TRANSLATE_BATCH_SIZE,
  MAX_TRANSLATE_BATCH_SIZE,
  MIN_TRANSLATE_BATCH_SIZE,
} from "./env-keys.js";
import { DEFAULT_MODEL_ID, getModelById, requireModelById } from "./model-catalog.js";
import type { ModelCatalogEntry } from "./types.js";

export interface ServerConfig {
  port: number;
  nodeEnv: string;
  addonPassword: string;
  authEnabled: boolean;
  domain?: string;
  enableManagementApi: boolean;
  targetLang: string;
  llmModelId: string;
  llmModelUrl: string;
  llmModelFilename: string;
  llmModelSha256: string;
  llmModelBytes: number;
  llmModelsDir: string;
  llmModelPath: string;
  llmServerUrl: string;
  llmThreads?: number;
  llmLlamaBin: string;
  openSubtitlesBaseUrl: string;
  subtitleCacheDir: string;
  subtitleCacheTtlSec: number;
  translationGlossary: GlossaryEntry[];
  translateBatchSize: number;
  requestLogPath: string;
  serverLogPath: string;
}

function parseEnvInt(
  envVar: string | undefined,
  defaultValue: number,
  min: number,
  max: number,
  name: string
): number {
  if (envVar === undefined || envVar.trim() === "") {
    return defaultValue;
  }
  const value = parseInt(envVar, 10);
  if (Number.isNaN(value) || value < min || value > max) {
    console.warn(
      `⚠️  Invalid ${name} value: ${envVar}. Must be between ${min} and ${max}. Using default: ${defaultValue}`
    );
    return defaultValue;
  }
  return value;
}

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
  console.warn(`⚠️  Invalid ${name} value: ${raw}. Expected boolean. Using default: ${defaultValue}`);
  return defaultValue;
}

function resolvePathEnv(envVar: string | undefined, fallback: string): string {
  const raw = envVar?.trim();
  if (!raw) {
    return fallback;
  }
  return path.isAbsolute(raw) ? raw : path.join(process.cwd(), raw);
}

export function parseGlossary(raw: string | undefined): GlossaryEntry[] {
  if (!raw || raw.trim() === "") {
    return [];
  }
  const entries: GlossaryEntry[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const eq = trimmed.indexOf("=");
    if (eq <= 0) {
      continue;
    }
    const source = trimmed.slice(0, eq).trim();
    const target = trimmed.slice(eq + 1).trim();
    if (source.length > 0 && target.length > 0) {
      entries.push({ source, target });
    }
  }
  return entries;
}

export function loadConfig(): ServerConfig {
  const addonPassword = process.env.ADDON_PASSWORD || "YOUR_ADDON_PASSWORD_HERE";
  const authEnabled = Boolean(addonPassword && addonPassword !== "YOUR_ADDON_PASSWORD_HERE");

  const modelId = (process.env.LLM_MODEL_ID ?? "").trim() || DEFAULT_MODEL_ID;
  const catalog = getModelById(modelId);

  const llmModelUrl = (process.env.LLM_MODEL_URL ?? "").trim() || catalog?.url || "";
  const llmModelFilename =
    (process.env.LLM_MODEL_FILENAME ?? "").trim() || catalog?.filename || "";
  const llmModelSha256 = (process.env.LLM_MODEL_SHA256 ?? "").trim() || catalog?.sha256 || "";
  const bytesRaw = (process.env.LLM_MODEL_BYTES ?? "").trim();
  const llmModelBytes = bytesRaw
    ? parseEnvInt(bytesRaw, catalog?.expectedBytes ?? 0, 0, Number.MAX_SAFE_INTEGER, "LLM_MODEL_BYTES")
    : catalog?.expectedBytes ?? 0;

  const defaultModelsDir = path.join(os.homedir(), ".stremio-addon-manager", "models");
  const defaultCacheDir = path.join(os.homedir(), ".stremio-addon-manager", "subtitle-cache");

  const threadsRaw = process.env.LLM_THREADS?.trim();
  const llmThreads =
    threadsRaw && threadsRaw.length > 0
      ? parseEnvInt(threadsRaw, 0, 1, 256, "LLM_THREADS")
      : undefined;

  const targetLangRaw = (process.env.TARGET_LANG ?? "").trim().toLowerCase();
  const targetLang = targetLangRaw || DEFAULT_TARGET_LANG;

  const batchSize = parseEnvInt(
    process.env.TRANSLATE_BATCH_SIZE,
    DEFAULT_TRANSLATE_BATCH_SIZE,
    MIN_TRANSLATE_BATCH_SIZE,
    MAX_TRANSLATE_BATCH_SIZE,
    "TRANSLATE_BATCH_SIZE"
  );

  const requestLogPathRaw = process.env.ADDON_REQUEST_LOG?.trim();
  const requestLogPath = requestLogPathRaw
    ? resolvePathEnv(requestLogPathRaw, path.join(os.homedir(), ".stremio-addon", "request-log.jsonl"))
    : path.join(os.homedir(), ".stremio-addon", "request-log.jsonl");
  const serverLogPathRaw = process.env.ADDON_SERVER_LOG?.trim();
  const serverLogPath = serverLogPathRaw
    ? resolvePathEnv(serverLogPathRaw, path.join(os.homedir(), ".stremio-addon", "server.log"))
    : path.join(os.homedir(), ".stremio-addon", "server.log");

  const config: ServerConfig = {
    port: parseEnvInt(process.env.PORT, DEFAULT_PORT, 1, 65535, "PORT"),
    nodeEnv: process.env.NODE_ENV || "development",
    addonPassword,
    authEnabled,
    domain: process.env.ADDON_DOMAIN?.trim() || undefined,
    enableManagementApi: parseEnvBool(process.env.ENABLE_MANAGEMENT_API, false, "ENABLE_MANAGEMENT_API"),
    targetLang,
    llmModelId: modelId,
    llmModelUrl,
    llmModelFilename,
    llmModelSha256,
    llmModelBytes,
    llmModelsDir: resolvePathEnv(process.env.LLM_MODELS_DIR, defaultModelsDir),
    llmModelPath: (process.env.LLM_MODEL_PATH ?? "").trim(),
    llmServerUrl: (process.env.LLM_SERVER_URL ?? "").trim() || DEFAULT_LLM_SERVER_URL,
    llmThreads: llmThreads === 0 ? undefined : llmThreads,
    llmLlamaBin: (process.env.LLM_LLAMA_BIN ?? "").trim(),
    openSubtitlesBaseUrl:
      (process.env.OPENSUBTITLES_BASE_URL ?? "").trim().replace(/\/+$/, "") ||
      DEFAULT_OPENSUBTITLES_BASE_URL,
    subtitleCacheDir: resolvePathEnv(process.env.SUBTITLE_CACHE_DIR, defaultCacheDir),
    subtitleCacheTtlSec: parseEnvInt(
      process.env.SUBTITLE_CACHE_TTL_SEC,
      DEFAULT_CACHE_TTL_SEC,
      60,
      365 * 24 * 3600,
      "SUBTITLE_CACHE_TTL_SEC"
    ),
    translationGlossary: parseGlossary(process.env.TRANSLATION_GLOSSARY),
    translateBatchSize: batchSize,
    requestLogPath,
    serverLogPath,
  };

  console.log("\n📋 TranslatedSubtitles Configuration:");
  console.log(`  - Port: ${config.port}`);
  console.log(`  - Environment: ${config.nodeEnv}`);
  console.log(`  - Target language: ${config.targetLang}`);
  console.log(`  - Model: ${config.llmModelId}`);
  console.log(`  - LLM server: ${config.llmServerUrl}`);
  console.log(`  - Models dir: ${config.llmModelsDir}`);
  console.log(`  - Cache dir: ${config.subtitleCacheDir}`);
  console.log(`  - OpenSubtitles: ${config.openSubtitlesBaseUrl}`);
  console.log(`  - Authentication: ${config.authEnabled ? "Enabled 🔒" : "Disabled ⚠️"}`);
  console.log(`  - Glossary entries: ${config.translationGlossary.length}`);
  console.log(`  - Batch size: ${config.translateBatchSize}\n`);

  return config;
}

/** Mutate in-memory config to a catalog model (clears LLM_MODEL_PATH drop-in). */
export function applyCatalogModel(config: ServerConfig, modelId: string): ModelCatalogEntry {
  const entry = requireModelById(modelId);
  config.llmModelId = entry.id;
  config.llmModelUrl = entry.url;
  config.llmModelFilename = entry.filename;
  config.llmModelSha256 = entry.sha256;
  config.llmModelBytes = entry.expectedBytes;
  config.llmModelPath = "";
  return entry;
}
