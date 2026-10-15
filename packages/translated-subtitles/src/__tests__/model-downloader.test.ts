import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ensureModelFile,
  GGUF_MAGIC,
  ModelDownloadError,
  removeInactiveGgufs,
  sha256File,
  validateGgufFile,
} from "../model-downloader.js";
import type { FetchLike } from "../types.js";

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "tsub-model-"));
}

function fakeGguf(size = 64): Buffer {
  const buf = Buffer.alloc(size, 0x61);
  buf.write(GGUF_MAGIC, 0, "ascii");
  return buf;
}

function sha(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

function fetchOf(body: Buffer, status = 200): FetchLike {
  return vi.fn(async (): Promise<Response> => {
    return new Response(body, { status });
  });
}

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  dirs.length = 0;
});

describe("validateGgufFile", () => {
  it("accepts matching size, magic, and sha256", () => {
    const dir = tmpDir();
    dirs.push(dir);
    const file = path.join(dir, "m.gguf");
    const buf = fakeGguf(80);
    fs.writeFileSync(file, buf);
    expect(validateGgufFile(file, 80, sha(buf))).toEqual({ ok: true });
  });

  it("rejects wrong magic", () => {
    const dir = tmpDir();
    dirs.push(dir);
    const file = path.join(dir, "m.gguf");
    fs.writeFileSync(file, Buffer.from("XXXX"));
    const result = validateGgufFile(file, 4, "");
    expect(result.ok).toBe(false);
  });
});

describe("ensureModelFile", () => {
  it("skips download when a valid file is already present", async () => {
    const dir = tmpDir();
    dirs.push(dir);
    const buf = fakeGguf(96);
    const filename = "already.gguf";
    fs.writeFileSync(path.join(dir, filename), buf);
    const fetchFn = fetchOf(fakeGguf(96));
    const dest = await ensureModelFile(
      {
        destDir: dir,
        filename,
        url: "https://example.test/model.gguf",
        expectedBytes: 96,
        sha256: sha(buf),
      },
      fetchFn
    );
    expect(dest).toBe(path.join(dir, filename));
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("downloads, verifies checksum, and writes dest", async () => {
    const dir = tmpDir();
    dirs.push(dir);
    const buf = fakeGguf(72);
    const dest = await ensureModelFile(
      {
        destDir: dir,
        filename: "new.gguf",
        url: "https://example.test/model.gguf",
        expectedBytes: 72,
        sha256: sha(buf),
      },
      fetchOf(buf)
    );
    expect(fs.existsSync(dest)).toBe(true);
    expect(sha256File(dest)).toBe(sha(buf));
    expect(fs.readFileSync(dest).subarray(0, 4).toString("ascii")).toBe(GGUF_MAGIC);
  });

  it("refuses a checksum mismatch and does not leave dest", async () => {
    const dir = tmpDir();
    dirs.push(dir);
    const buf = fakeGguf(72);
    await expect(
      ensureModelFile(
        {
          destDir: dir,
          filename: "bad.gguf",
          url: "https://example.test/model.gguf",
          expectedBytes: 72,
          sha256: "00".repeat(32),
        },
        fetchOf(buf)
      )
    ).rejects.toBeInstanceOf(ModelDownloadError);
    expect(fs.existsSync(path.join(dir, "bad.gguf"))).toBe(false);
  });

  it("uses LLM_MODEL_PATH drop-in when valid", async () => {
    const dir = tmpDir();
    dirs.push(dir);
    const buf = fakeGguf(48);
    const dropIn = path.join(dir, "dropin.gguf");
    fs.writeFileSync(dropIn, buf);
    const fetchFn = fetchOf(buf);
    const dest = await ensureModelFile(
      {
        destDir: path.join(dir, "unused"),
        filename: "ignored.gguf",
        url: "https://example.test/model.gguf",
        expectedBytes: 48,
        sha256: sha(buf),
        existingPath: dropIn,
      },
      fetchFn
    );
    expect(dest).toBe(dropIn);
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe("removeInactiveGgufs", () => {
  it("keeps the new filename and deletes other GGUFs and leftover .part files", () => {
    const dir = tmpDir();
    dirs.push(dir);
    const keep = path.join(dir, "keep.gguf");
    const oldFile = path.join(dir, "old.gguf");
    const part = path.join(dir, "old.gguf.part");
    fs.writeFileSync(keep, fakeGguf(32));
    fs.writeFileSync(oldFile, fakeGguf(32));
    fs.writeFileSync(part, fakeGguf(16));
    fs.writeFileSync(path.join(dir, "notes.txt"), "leave me");

    const result = removeInactiveGgufs(dir, "keep.gguf");
    expect(result.deleted.sort()).toEqual([oldFile, part].sort());
    expect(fs.existsSync(keep)).toBe(true);
    expect(fs.existsSync(oldFile)).toBe(false);
    expect(fs.existsSync(part)).toBe(false);
    expect(fs.existsSync(path.join(dir, "notes.txt"))).toBe(true);
  });

  it("does not delete LLM_MODEL_PATH drop-in even when it lives in the models dir", () => {
    const dir = tmpDir();
    dirs.push(dir);
    const keep = path.join(dir, "keep.gguf");
    const dropIn = path.join(dir, "dropin.gguf");
    fs.writeFileSync(keep, fakeGguf(32));
    fs.writeFileSync(dropIn, fakeGguf(32));

    const result = removeInactiveGgufs(dir, "keep.gguf", [dropIn]);
    expect(result.deleted).toEqual([]);
    expect(fs.existsSync(dropIn)).toBe(true);
    expect(fs.existsSync(keep)).toBe(true);
  });
});
