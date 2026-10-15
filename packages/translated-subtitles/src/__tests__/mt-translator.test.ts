import { describe, expect, it, vi } from "vitest";
import { MtTranslator } from "../mt-translator.js";
import { TranslationError } from "../translator.js";
import { toFloresCode } from "../flores-lang.js";
import type { FetchLike } from "../types.js";

describe("FLORES mapping", () => {
  it("maps Configuration languages", () => {
    expect(toFloresCode("heb")).toBe("heb_Hebr");
    expect(toFloresCode("eng")).toBe("eng_Latn");
    expect(toFloresCode("ara")).toBe("arb_Arab");
    expect(toFloresCode("zho")).toBe("zho_Hans");
    expect(toFloresCode("und")).toBeUndefined();
  });
});

describe("MtTranslator", () => {
  it("returns 1:1 cue count", async () => {
    const fetchFn: FetchLike = vi.fn(async () => {
      return new Response(JSON.stringify({ translations: ["שלום", "עולם"] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    const translator = new MtTranslator("http://127.0.0.1:18082", "heb", fetchFn);
    const out = await translator.translateTexts(["Hello", "World"], "eng");
    expect(out).toEqual(["שלום", "עולם"]);
    expect(fetchFn).toHaveBeenCalled();
    const [, init] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    const body = JSON.parse(String(init.body)) as { source: string; target: string };
    expect(body.source).toBe("eng_Latn");
    expect(body.target).toBe("heb_Hebr");
  });

  it("fails closed when source language is missing", async () => {
    const fetchFn: FetchLike = vi.fn(async () => new Response("{}", { status: 200 }));
    const translator = new MtTranslator("http://127.0.0.1:18082", "heb", fetchFn);
    await expect(translator.translateTexts(["Hello"])).rejects.toBeInstanceOf(TranslationError);
    await expect(translator.translateTexts(["Hello"], "und")).rejects.toBeInstanceOf(TranslationError);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("fails closed on cue count mismatch", async () => {
    const fetchFn: FetchLike = vi.fn(async () => {
      return new Response(JSON.stringify({ translations: ["only-one"] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    const translator = new MtTranslator("http://127.0.0.1:18082", "heb", fetchFn);
    await expect(translator.translateTexts(["Hello", "World"], "eng")).rejects.toBeInstanceOf(
      TranslationError
    );
  });
});
