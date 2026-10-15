import { describe, expect, it } from "vitest";
import {
  DEFAULT_MODEL_ID,
  getDefaultModelId,
  getModelById,
  getModelCatalog,
  requireModelById,
} from "../model-catalog.js";

const PINNED_URL =
  "https://huggingface.co/bartowski/Qwen_Qwen3-1.7B-GGUF/resolve/main/Qwen_Qwen3-1.7B-Q4_K_M.gguf";
const PINNED_BYTES = 1_282_439_584;
const PINNED_SHA = "72c5c3cb38fa32d5256e2fe30d03e7a64c6c79e668ad84057e3bd66e250b24fb";

describe("model catalog", () => {
  it("defaults to qwen3-1.7b-q4_k_m", () => {
    expect(DEFAULT_MODEL_ID).toBe("qwen3-1.7b-q4_k_m");
    expect(getDefaultModelId()).toBe("qwen3-1.7b-q4_k_m");
  });

  it("pins bartowski Qwen3-1.7B Q4_K_M URL, size, and sha256", () => {
    const entry = requireModelById(DEFAULT_MODEL_ID);
    expect(entry.url).toBe(PINNED_URL);
    expect(entry.filename).toBe("Qwen_Qwen3-1.7B-Q4_K_M.gguf");
    expect(entry.expectedBytes).toBe(PINNED_BYTES);
    expect(entry.sha256).toBe(PINNED_SHA);
    expect(entry.recommended).toBe(true);
  });

  it("lists GGUF tiers plus NLLB", () => {
    const ids = getModelCatalog().map((m) => m.id);
    expect(ids).toEqual([
      "qwen3-0.6b-q4_k_m",
      "qwen3-1.7b-q4_k_m",
      "gemma3-1b-q4_k_m",
      "qwen3-4b-q4_k_m",
      "nllb-200-distilled-600m-int8",
    ]);
    for (const model of getModelCatalog()) {
      expect(model.hwBlurb.length).toBeGreaterThan(0);
      expect(model.ramBlurb.length).toBeGreaterThan(0);
      expect(model.url.startsWith("https://huggingface.co/")).toBe(true);
    }
  });

  it("resolves NLLB as engine=mt", () => {
    const entry = requireModelById("nllb-200-distilled-600m-int8");
    expect(entry.engine).toBe("mt");
    expect(entry.filename).toBe("nllb-200-distilled-600M-ct2-int8");
    expect(entry.files).toContain("model.bin");
    expect(entry.expectedBytes).toBe(622595991);
    expect(entry.sha256).toHaveLength(64);
    expect(entry.filename.endsWith(".gguf")).toBe(false);
  });

  it("returns undefined for unknown ids", () => {
    expect(getModelById("missing")).toBeUndefined();
  });
});

describe.skipIf(!process.env.HF_CATALOG_LIVE)("HF catalog live probe", () => {
  it("HEAD + Range for default Q4 resolves to GGUF of expected size", async () => {
    const entry = requireModelById(DEFAULT_MODEL_ID);
    const head = await fetch(entry.url, {
      method: "HEAD",
      redirect: "manual",
      headers: { "User-Agent": "stremio-translated-subtitles-catalog-test/1.0" },
    });
    expect(head.status).not.toBe(404);
    expect([200, 301, 302, 303, 307, 308]).toContain(head.status);

    const linkedSize = head.headers.get("x-linked-size");
    if (linkedSize) {
      expect(Number(linkedSize)).toBe(entry.expectedBytes);
    } else {
      const followed = await fetch(entry.url, {
        method: "HEAD",
        redirect: "follow",
        headers: { "User-Agent": "stremio-translated-subtitles-catalog-test/1.0" },
      });
      expect(Number(followed.headers.get("content-length"))).toBe(entry.expectedBytes);
    }

    const ranged = await fetch(entry.url, {
      method: "GET",
      redirect: "follow",
      headers: {
        Range: "bytes=0-3",
        "User-Agent": "stremio-translated-subtitles-catalog-test/1.0",
      },
    });
    expect(ranged.ok || ranged.status === 206).toBe(true);
    const magic = Buffer.from(await ranged.arrayBuffer()).toString("ascii");
    expect(magic).toBe("GGUF");

    const disposition =
      ranged.headers.get("content-disposition") ?? head.headers.get("content-disposition") ?? "";
    if (disposition) {
      expect(disposition).toContain(entry.filename);
    }
  }, 30_000);
});
