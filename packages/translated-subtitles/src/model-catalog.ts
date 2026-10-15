/**
 * On-disk model catalog (GGUF URLs, sizes, SHA-256, wizard HW copy).
 * Weights are never bundled — this JSON is the only catalog we ship.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ModelCatalogEntry, ModelCatalogFile } from "./types.js";

const catalogFileUrl = new URL("../models/catalog.json", import.meta.url);

let cachedCatalog: ModelCatalogFile | undefined;

function isCatalogFile(value: unknown): value is ModelCatalogFile {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as { defaultModelId?: unknown; models?: unknown };
  return typeof record.defaultModelId === "string" && Array.isArray(record.models);
}

function readCatalogFile(): ModelCatalogFile {
  if (cachedCatalog) {
    return cachedCatalog;
  }
  const filePath = fileURLToPath(catalogFileUrl);
  const raw = fs.readFileSync(filePath, "utf8");
  const parsed: unknown = JSON.parse(raw);
  if (!isCatalogFile(parsed) || parsed.models.length === 0) {
    throw new Error(`Invalid model catalog at ${filePath}`);
  }
  cachedCatalog = parsed;
  return parsed;
}

/** Default catalog id: bartowski Qwen3-1.7B Q4_K_M. */
export const DEFAULT_MODEL_ID = "qwen3-1.7b-q4_k_m";

export function loadModelCatalog(): ModelCatalogFile {
  return readCatalogFile();
}

export function getModelCatalog(): readonly ModelCatalogEntry[] {
  return readCatalogFile().models;
}

export function getDefaultModelId(): string {
  return readCatalogFile().defaultModelId || DEFAULT_MODEL_ID;
}

export function getModelById(id: string): ModelCatalogEntry | undefined {
  const needle = id.trim();
  return readCatalogFile().models.find((m) => m.id === needle);
}

export function catalogEngine(entry: ModelCatalogEntry): "llm" | "mt" {
  return entry.engine === "mt" ? "mt" : "llm";
}

export function requireModelById(id: string): ModelCatalogEntry {
  const found = getModelById(id);
  if (!found) {
    const known = getModelCatalog()
      .map((m) => m.id)
      .join(", ");
    throw new Error(`Unknown LLM_MODEL_ID "${id}". Known: ${known}`);
  }
  return found;
}

/** Absolute path to the shipped catalog JSON (for installers / Electron). */
export function getCatalogJsonPath(): string {
  return path.normalize(fileURLToPath(catalogFileUrl));
}

export type { ModelCatalogEntry, ModelCatalogFile };
