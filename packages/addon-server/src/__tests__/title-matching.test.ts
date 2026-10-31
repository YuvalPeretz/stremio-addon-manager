import { describe, it, expect } from "vitest";
import { significantTitleTokens, torrentTitleMatchesMovie } from "../title-matching.js";

describe("significantTitleTokens", () => {
  it("drops stopwords from The Age of Adaline", () => {
    expect(significantTitleTokens("The Age of Adaline").sort()).toEqual(["adaline", "age"]);
  });

  it("returns empty for blank input", () => {
    expect(significantTitleTokens("")).toEqual([]);
    expect(significantTitleTokens(null)).toEqual([]);
  });
});

describe("torrentTitleMatchesMovie", () => {
  const movie = "The Age of Adaline";
  const year = 2015;

  it("rejects The Age of Hubble for Adaline", () => {
    expect(
      torrentTitleMatchesMovie("The.Age.Of.Hubble.2015.4K.S... 3.16 GB", movie, year)
    ).toBe(false);
  });

  it("accepts a correct Adaline release", () => {
    expect(
      torrentTitleMatchesMovie("The Age of Adaline 2015 1080p BluRay", movie, year)
    ).toBe(true);
  });

  it("accepts a dual-language title that includes the English name", () => {
    expect(
      torrentTitleMatchesMovie("Век Адалин / The Age of Adaline (2015) 1080p", movie, year)
    ).toBe(true);
  });

  it("accepts dotted release names", () => {
    expect(
      torrentTitleMatchesMovie("The.Age.of.Adaline.2015.1080p.BluRay.HEVC", movie, year)
    ).toBe(true);
  });

  it("rejects a same-year wrong title that only shares stopwords/age", () => {
    expect(torrentTitleMatchesMovie("Age of Empires 2015 Documentary", movie, year)).toBe(
      false
    );
  });

  it("rejects when the torrent year clearly conflicts", () => {
    expect(
      torrentTitleMatchesMovie("The Age of Adaline 1999 1080p", movie, year)
    ).toBe(false);
  });

  it("accepts when no year is present in the torrent title", () => {
    expect(torrentTitleMatchesMovie("The Age of Adaline BluRay 1080p", movie, year)).toBe(
      true
    );
  });

  it("accepts everything when the movie name is empty", () => {
    expect(torrentTitleMatchesMovie("Anything.2015", "", year)).toBe(true);
  });

  it("rejects an empty torrent title when a movie name is set", () => {
    expect(torrentTitleMatchesMovie("", movie, year)).toBe(false);
  });

  it("accepts a release that keeps the distinctive word but drops Age", () => {
    expect(torrentTitleMatchesMovie("Adaline 2015 1080p BluRay", movie, year)).toBe(true);
  });

  it("rejects a title that only has the short shared word", () => {
    expect(torrentTitleMatchesMovie("The Age 2015 4K Documentary", movie, year)).toBe(false);
  });
});
