import { describe, it, expect } from "vitest";
import {
  isSuccessfulEpisodeLoad,
  shouldPreFetchNextEpisode,
} from "../stream-handler.js";
import type { StreamResponse } from "../types.js";

function responseWith(...urls: string[]): StreamResponse {
  return {
    streams: urls.map((url, i) => ({
      name: `Stream ${i}`,
      title: `Title ${i}`,
      url,
    })),
  };
}

describe("isSuccessfulEpisodeLoad", () => {
  it("is true when at least one playable stream URL is present", () => {
    expect(isSuccessfulEpisodeLoad(responseWith("https://rd.example/file.mp4"))).toBe(true);
  });

  it("is true for local playback URLs", () => {
    expect(isSuccessfulEpisodeLoad(responseWith("http://127.0.0.1:7000/local/abc"))).toBe(true);
  });

  it("is false for empty streams", () => {
    expect(isSuccessfulEpisodeLoad({ streams: [] })).toBe(false);
  });

  it("is false when only a pending-download placeholder is returned", () => {
    expect(
      isSuccessfulEpisodeLoad(
        responseWith("https://addon.example/pending-status/series/tt123:1:1")
      )
    ).toBe(false);
  });

  it("is true when a playable stream is mixed with a placeholder", () => {
    expect(
      isSuccessfulEpisodeLoad(
        responseWith(
          "https://addon.example/pending-status/series/tt123:1:1",
          "https://rd.example/file.mp4"
        )
      )
    ).toBe(true);
  });
});

describe("shouldPreFetchNextEpisode", () => {
  const ok = responseWith("https://rd.example/file.mp4");
  const empty: StreamResponse = { streams: [] };
  const pending = responseWith("https://addon.example/pending-status/series/tt0434665:6:3");

  it("allows prefetch for a successful series episode load", () => {
    expect(shouldPreFetchNextEpisode("series", "tt0434665:6:3", ok)).toBe(true);
  });

  it("blocks prefetch for movies even with streams", () => {
    expect(shouldPreFetchNextEpisode("movie", "tt0111161", ok)).toBe(false);
  });

  it("blocks prefetch when the series id has no season/episode", () => {
    expect(shouldPreFetchNextEpisode("series", "tt0434665", ok)).toBe(false);
  });

  it("blocks prefetch on empty / failed loads", () => {
    expect(shouldPreFetchNextEpisode("series", "tt0434665:6:3", empty)).toBe(false);
  });

  it("blocks prefetch on pending-download placeholders (partial/unsuccessful)", () => {
    expect(shouldPreFetchNextEpisode("series", "tt0434665:6:3", pending)).toBe(false);
  });
});
