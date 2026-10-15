import { describe, expect, it, vi } from "vitest";
import {
  buildTranslatePrompt,
  clampBatchSize,
  LlmTranslator,
  parseNumberedTranslations,
  stripThinking,
  TranslationError,
  type CompletionClient,
} from "../translator.js";

describe("clampBatchSize", () => {
  it("clamps to 4–12", () => {
    expect(clampBatchSize(1)).toBe(4);
    expect(clampBatchSize(8)).toBe(8);
    expect(clampBatchSize(20)).toBe(12);
  });
});

describe("parseNumberedTranslations", () => {
  it("extracts 1:1 numbered lines", () => {
    const parsed = parseNumberedTranslations("1. Hello\n2. World", 2);
    expect(parsed).toEqual(["Hello", "World"]);
  });

  it("strips thinking tags and accepts 1)", () => {
    const raw = `<think>plan</think>\n1) A\n2) B`;
    expect(stripThinking(raw)).not.toContain("<think>");
    expect(parseNumberedTranslations(raw, 2)).toEqual(["A", "B"]);
  });

  it("returns undefined on count mismatch", () => {
    expect(parseNumberedTranslations("1. only", 2)).toBeUndefined();
  });
});

describe("buildTranslatePrompt", () => {
  it("includes glossary and target language", () => {
    const prompt = buildTranslatePrompt(
      ["Hi Frodo"],
      "heb",
      [{ source: "Frodo", target: "פרודו" }],
      false
    );
    expect(prompt).toContain("Hebrew (heb)");
    expect(prompt).toContain("Frodo=פרודו");
    expect(prompt).toContain("1. Hi Frodo");
    expect(prompt).toContain("/no_think");
  });
});

describe("LlmTranslator", () => {
  it("batches cues and concatenates results", async () => {
    const complete = vi.fn(async (prompt: string): Promise<string> => {
      const count = [...prompt.matchAll(/^\d+\. /gm)].length;
      return Array.from({ length: count }, (_, i) => `${i + 1}. T${i + 1}`).join("\n");
    });
    const translator = new LlmTranslator({ complete }, "heb", [], 4);
    const texts = ["a", "b", "c", "d", "e"];
    const out = await translator.translateTexts(texts);
    expect(out).toHaveLength(5);
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it("retries once when cue count is wrong, then throws", async () => {
    const complete = vi.fn(async (): Promise<string> => "1. only");
    const translator = new LlmTranslator({ complete } satisfies CompletionClient, "spa", [], 8, 1);
    await expect(translator.translateTexts(["a", "b"])).rejects.toBeInstanceOf(TranslationError);
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it("accepts a valid retry after a format break", async () => {
    const complete = vi
      .fn<CompletionClient["complete"]>()
      .mockResolvedValueOnce("garbage")
      .mockResolvedValueOnce("1. uno\n2. dos");
    const translator = new LlmTranslator({ complete }, "spa", [], 8, 1);
    await expect(translator.translateTexts(["one", "two"])).resolves.toEqual(["uno", "dos"]);
  });
});
