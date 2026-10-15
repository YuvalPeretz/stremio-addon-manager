import { describe, expect, it } from "vitest";
import {
  cueTexts,
  parseSubtitle,
  rebundleSubtitle,
  SubtitleParseError,
} from "../subtitle-parse.js";

const SRT = `1
00:00:01,000 --> 00:00:04,000
Hello there.

2
00:00:05,250 --> 00:00:08,750
How are you
today?

3
00:01:00,000 --> 00:01:02,000
Bye.
`;

const VTT = `WEBVTT

00:00:01.000 --> 00:00:04.000 align:start
Hello there.

00:00:05.250 --> 00:00:08.750
How are you
today?
`;

describe("parseSubtitle — SRT", () => {
  it("keeps original timestamps and cue text", () => {
    const parsed = parseSubtitle(SRT);
    expect(parsed.format).toBe("srt");
    expect(parsed.cues).toHaveLength(3);
    expect(parsed.cues[0]?.start).toBe("00:00:01,000");
    expect(parsed.cues[0]?.end).toBe("00:00:04,000");
    expect(parsed.cues[0]?.text).toBe("Hello there.");
    expect(parsed.cues[1]?.text).toBe("How are you\ntoday?");
    expect(parsed.cues[2]?.start).toBe("00:01:00,000");
  });

  it("does not put timestamps in cue texts", () => {
    const texts = cueTexts(parseSubtitle(SRT));
    for (const text of texts) {
      expect(text).not.toMatch(/-->/);
      expect(text).not.toMatch(/\d{2}:\d{2}:\d{2}/);
    }
  });
});

describe("parseSubtitle — VTT", () => {
  it("preserves header, timestamps, and cue settings", () => {
    const parsed = parseSubtitle(VTT);
    expect(parsed.format).toBe("vtt");
    expect(parsed.header).toContain("WEBVTT");
    expect(parsed.cues).toHaveLength(2);
    expect(parsed.cues[0]?.start).toBe("00:00:01.000");
    expect(parsed.cues[0]?.settings).toBe("align:start");
    expect(parsed.cues[0]?.text).toBe("Hello there.");
  });

  it("detects VTT from WEBVTT header even with srt hint", () => {
    expect(parseSubtitle(VTT, "srt").format).toBe("vtt");
  });
});

describe("rebundleSubtitle", () => {
  it("replaces SRT text 1:1 and leaves timestamps untouched", () => {
    const parsed = parseSubtitle(SRT);
    const out = rebundleSubtitle(parsed, ["שלום.", "מה שלומך\nהיום?", "ביי."]);
    expect(out).toContain("00:00:01,000 --> 00:00:04,000");
    expect(out).toContain("00:00:05,250 --> 00:00:08,750");
    expect(out).toContain("00:01:00,000 --> 00:01:02,000");
    expect(out).toContain("שלום.");
    expect(out).toContain("מה שלומך\nהיום?");
    expect(out).not.toContain("Hello there.");
    expect(out).toMatch(/^1\n/);
  });

  it("rebundles VTT with settings intact", () => {
    const parsed = parseSubtitle(VTT);
    const out = rebundleSubtitle(parsed, ["A", "B"]);
    expect(out.startsWith("WEBVTT")).toBe(true);
    expect(out).toContain("00:00:01.000 --> 00:00:04.000 align:start");
    expect(out).toContain("\nA\n");
    expect(out).not.toContain("Hello there.");
  });

  it("throws when translated count does not match cues", () => {
    const parsed = parseSubtitle(SRT);
    expect(() => rebundleSubtitle(parsed, ["only one"])).toThrow(SubtitleParseError);
  });

  it("round-trips cue count after parse → replace → parse", () => {
    const parsed = parseSubtitle(SRT);
    const translated = parsed.cues.map((_, i) => `T${i + 1}`);
    const out = rebundleSubtitle(parsed, translated);
    const again = parseSubtitle(out, "srt");
    expect(again.cues).toHaveLength(parsed.cues.length);
    expect(again.cues.map((c) => c.start)).toEqual(parsed.cues.map((c) => c.start));
    expect(again.cues.map((c) => c.text)).toEqual(translated);
  });
});
