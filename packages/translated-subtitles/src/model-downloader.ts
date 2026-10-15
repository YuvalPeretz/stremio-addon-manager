/**
 * On-demand GGUF download with size / SHA-256 / magic validation.
 * Never starts llama.cpp on a mismatched file.
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { finished } from "node:stream/promises";
import type { FetchLike } from "./types.js";

export const GGUF_MAGIC = "GGUF";

export class ModelDownloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelDownloadError";
  }
}

export interface EnsureModelOptions {
  destDir: string;
  filename: string;
  url: string;
  expectedBytes: number;
  sha256: string;
  /** Offline drop-in; when set, download is skipped and this path is validated. */
  existingPath?: string;
}

export function readMagic(filePath: string): string {
  const fd = fs.openSync(filePath, "r");
  try {
    const buf = Buffer.alloc(4);
    const n = fs.readSync(fd, buf, 0, 4, 0);
    return buf.subarray(0, n).toString("ascii");
  } finally {
    fs.closeSync(fd);
  }
}

export function sha256File(filePath: string): string {
  const hash = createHash("sha256");
  const fd = fs.openSync(filePath, "r");
  try {
    const buf = Buffer.alloc(64 * 1024);
    let bytesRead = 0;
    while ((bytesRead = fs.readSync(fd, buf, 0, buf.length, null)) > 0) {
      hash.update(buf.subarray(0, bytesRead));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest("hex");
}

export function validateGgufFile(
  filePath: string,
  expectedBytes: number,
  sha256: string
): { ok: true } | { ok: false; reason: string } {
  if (!fs.existsSync(filePath)) {
    return { ok: false, reason: `missing file: ${filePath}` };
  }
  const stat = fs.statSync(filePath);
  if (expectedBytes > 0 && stat.size !== expectedBytes) {
    return { ok: false, reason: `size ${stat.size} != expected ${expectedBytes}` };
  }
  const magic = readMagic(filePath);
  if (magic !== GGUF_MAGIC) {
    return { ok: false, reason: `magic ${JSON.stringify(magic)} != ${GGUF_MAGIC}` };
  }
  if (sha256) {
    const actual = sha256File(filePath);
    if (actual.toLowerCase() !== sha256.toLowerCase()) {
      return { ok: false, reason: `sha256 ${actual} != expected ${sha256}` };
    }
  }
  return { ok: true };
}

export interface RemoveInactiveGgufsResult {
  deleted: string[];
  kept: string[];
}

/**
 * Delete other catalog GGUFs (and leftover `.part` downloads) in `destDir`.
 * Never deletes `keepFilename` or any path in `extraKeepPaths` (e.g. LLM_MODEL_PATH).
 */
export function removeInactiveGgufs(
  destDir: string,
  keepFilename: string,
  extraKeepPaths: string[] = []
): RemoveInactiveGgufsResult {
  const deleted: string[] = [];
  const kept: string[] = [];
  if (!destDir || !fs.existsSync(destDir)) {
    return { deleted, kept };
  }

  const keepNames = new Set<string>();
  const keepResolved = new Set<string>();
  const trimmedKeep = keepFilename.trim();
  if (trimmedKeep) {
    keepNames.add(trimmedKeep);
    keepResolved.add(path.resolve(destDir, trimmedKeep));
  }
  for (const extra of extraKeepPaths) {
    const raw = extra.trim();
    if (!raw) {
      continue;
    }
    keepResolved.add(path.resolve(raw));
    keepNames.add(path.basename(raw));
  }

  const entries = fs.readdirSync(destDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }
    const name = entry.name;
    const isGguf = name.endsWith(".gguf");
    const isPart = name.endsWith(".gguf.part") || name.endsWith(".part");
    if (!isGguf && !isPart) {
      continue;
    }
    const full = path.resolve(destDir, name);
    if (keepResolved.has(full) || keepNames.has(name)) {
      kept.push(full);
      continue;
    }
    try {
      fs.unlinkSync(full);
      deleted.push(full);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`Could not delete inactive model file ${full}: ${message}`);
    }
  }
  return { deleted, kept };
}

export interface EnsureMtModelOptions {
  destDir: string;
  dirName: string;
  url: string;
  expectedBytes: number;
  sha256: string;
  files: readonly string[];
}

export function snapshotBaseUrl(fileUrl: string): string {
  const trimmed = fileUrl.replace(/\/+$/, "");
  const slash = trimmed.lastIndexOf("/");
  return slash > 0 ? trimmed.slice(0, slash) : trimmed;
}

export function validateMtModelBin(
  filePath: string,
  expectedBytes: number,
  sha256: string
): { ok: true } | { ok: false; reason: string } {
  if (!fs.existsSync(filePath)) {
    return { ok: false, reason: `missing file: ${filePath}` };
  }
  const stat = fs.statSync(filePath);
  if (expectedBytes > 0 && stat.size !== expectedBytes) {
    return { ok: false, reason: `size ${stat.size} != expected ${expectedBytes}` };
  }
  if (sha256) {
    const actual = sha256File(filePath);
    if (actual.toLowerCase() !== sha256.toLowerCase()) {
      return { ok: false, reason: `sha256 ${actual} != expected ${sha256}` };
    }
  }
  return { ok: true };
}

export interface RemoveInactiveMtDirsResult {
  deleted: string[];
  kept: string[];
}

/**
 * Remove other NLLB extract directories under `destDir`.
 * Empty `keepDirName` deletes every subdirectory (used when switching to LLM).
 */
export function removeInactiveMtDirs(
  destDir: string,
  keepDirName: string
): RemoveInactiveMtDirsResult {
  const deleted: string[] = [];
  const kept: string[] = [];
  if (!destDir || !fs.existsSync(destDir)) {
    return { deleted, kept };
  }
  const keep = keepDirName.trim();
  const entries = fs.readdirSync(destDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const full = path.resolve(destDir, entry.name);
    if (keep && entry.name === keep) {
      kept.push(full);
      continue;
    }
    try {
      fs.rmSync(full, { recursive: true, force: true });
      deleted.push(full);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`Could not delete inactive MT dir ${full}: ${message}`);
    }
  }
  return { deleted, kept };
}

export async function ensureMtModelDir(
  opts: EnsureMtModelOptions,
  fetchFn: FetchLike = fetch
): Promise<string> {
  if (!opts.dirName) {
    throw new ModelDownloadError("MT_MODEL_DIR is required when downloading NLLB");
  }
  if (!opts.url) {
    throw new ModelDownloadError("MT_MODEL_URL is required when downloading NLLB");
  }
  const files = opts.files.length > 0 ? opts.files : ["model.bin"];
  fs.mkdirSync(opts.destDir, { recursive: true });
  const dest = path.join(opts.destDir, opts.dirName);
  fs.mkdirSync(dest, { recursive: true });
  const base = snapshotBaseUrl(opts.url);

  for (const file of files) {
    const fileDest = path.join(dest, file);
    const fileUrl = `${base}/${file}`;
    const isWeights = file === "model.bin";
    if (fs.existsSync(fileDest)) {
      if (isWeights) {
        const check = validateMtModelBin(fileDest, opts.expectedBytes, opts.sha256);
        if (check.ok) {
          continue;
        }
        console.warn(`Existing NLLB model.bin failed validation (${check.reason}); re-downloading`);
        fs.unlinkSync(fileDest);
      } else {
        continue;
      }
    }
    const tmp = `${fileDest}.part`;
    if (fs.existsSync(tmp)) {
      fs.unlinkSync(tmp);
    }
    const response = await fetchFn(fileUrl, { redirect: "follow" });
    if (!response.ok || !response.body) {
      throw new ModelDownloadError(`NLLB download failed: HTTP ${response.status} for ${fileUrl}`);
    }
    try {
      await writeResponseBody(response.body, tmp);
    } catch (err) {
      if (fs.existsSync(tmp)) {
        fs.unlinkSync(tmp);
      }
      throw err;
    }
    if (isWeights) {
      const check = validateMtModelBin(tmp, opts.expectedBytes, opts.sha256);
      if (!check.ok) {
        fs.unlinkSync(tmp);
        throw new ModelDownloadError(`Downloaded NLLB model.bin failed validation: ${check.reason}`);
      }
    }
    fs.renameSync(tmp, fileDest);
  }

  const weights = path.join(dest, "model.bin");
  const check = validateMtModelBin(weights, opts.expectedBytes, opts.sha256);
  if (!check.ok) {
    throw new ModelDownloadError(`NLLB model.bin failed validation: ${check.reason}`);
  }
  return dest;
}

export async function ensureModelFile(
  opts: EnsureModelOptions,
  fetchFn: FetchLike = fetch
): Promise<string> {
  if (opts.existingPath && opts.existingPath.trim() !== "") {
    const dropIn = path.resolve(opts.existingPath);
    const check = validateGgufFile(dropIn, opts.expectedBytes, opts.sha256);
    if (!check.ok) {
      throw new ModelDownloadError(`LLM_MODEL_PATH rejected: ${check.reason}`);
    }
    return dropIn;
  }

  if (!opts.filename) {
    throw new ModelDownloadError("LLM_MODEL_FILENAME is required when downloading a model");
  }
  if (!opts.url) {
    throw new ModelDownloadError("LLM_MODEL_URL is required when downloading a model");
  }

  fs.mkdirSync(opts.destDir, { recursive: true });
  const dest = path.join(opts.destDir, opts.filename);
  if (fs.existsSync(dest)) {
    const check = validateGgufFile(dest, opts.expectedBytes, opts.sha256);
    if (check.ok) {
      return dest;
    }
    console.warn(`Existing model failed validation (${check.reason}); re-downloading`);
    fs.unlinkSync(dest);
  }

  const tmp = `${dest}.part`;
  if (fs.existsSync(tmp)) {
    fs.unlinkSync(tmp);
  }

  const response = await fetchFn(opts.url, { redirect: "follow" });
  if (!response.ok || !response.body) {
    throw new ModelDownloadError(`Model download failed: HTTP ${response.status} for ${opts.url}`);
  }

  try {
    await writeResponseBody(response.body, tmp);
  } catch (err) {
    if (fs.existsSync(tmp)) {
      fs.unlinkSync(tmp);
    }
    throw err;
  }

  const check = validateGgufFile(tmp, opts.expectedBytes, opts.sha256);
  if (!check.ok) {
    fs.unlinkSync(tmp);
    throw new ModelDownloadError(`Downloaded model failed validation: ${check.reason}`);
  }

  fs.renameSync(tmp, dest);
  return dest;
}

async function writeResponseBody(body: ReadableStream<Uint8Array>, dest: string): Promise<void> {
  const file = fs.createWriteStream(dest);
  const reader = body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (!value) {
        continue;
      }
      const buf = Buffer.from(value);
      if (!file.write(buf)) {
        await new Promise<void>((resolve) => {
          file.once("drain", resolve);
        });
      }
    }
    file.end();
    await finished(file);
  } catch (err) {
    file.destroy();
    throw err;
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // already released after a completed read
    }
  }
}
