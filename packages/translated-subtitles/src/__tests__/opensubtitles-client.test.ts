import { describe, expect, it, vi } from "vitest";
import {
  formatFromUrl,
  OpenSubtitlesClient,
  pickSourceTrack,
} from "../opensubtitles-client.js";
import type { FetchLike, OpenSubtitlesItem } from "../types.js";

describe("pickSourceTrack", () => {
  it("prefers English when present", () => {
    const items: OpenSubtitlesItem[] = [
      { url: "https://x/he.srt", lang: "heb" },
      { url: "https://x/en.srt", lang: "eng" },
      { url: "https://x/es.srt", lang: "spa" },
    ];
    expect(pickSourceTrack(items)?.url).toBe("https://x/en.srt");
  });

  it("falls back to the first usable track", () => {
    const items: OpenSubtitlesItem[] = [
      { url: "", lang: "eng" },
      { url: "https://x/he.srt", lang: "heb" },
    ];
    expect(pickSourceTrack(items)?.lang).toBe("heb");
  });

  it("returns undefined when nothing is usable", () => {
    expect(pickSourceTrack([{ url: "", lang: "eng" }])).toBeUndefined();
  });
});

describe("formatFromUrl", () => {
  it("detects vtt vs srt", () => {
    expect(formatFromUrl("https://x/a.vtt")).toBe("vtt");
    expect(formatFromUrl("https://x/a.srt")).toBe("srt");
  });
});

describe("OpenSubtitlesClient", () => {
  it("lists and picks English from the v3 JSON payload", async () => {
    const fetchFn: FetchLike = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          subtitles: [
            { url: "https://os/he.srt", lang: "heb" },
            { url: "https://os/en.srt", lang: "en" },
          ],
        }),
        { status: 200 }
      );
    });
    const client = new OpenSubtitlesClient("https://opensubtitles-v3.strem.io", fetchFn);
    const picked = await client.pickBestSource("series", "tt0903747:1:1");
    expect(picked?.url).toBe("https://os/en.srt");
    expect(fetchFn).toHaveBeenCalled();
  });
});
