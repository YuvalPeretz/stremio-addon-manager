/**
 * Subtitle Proxy
 * Fetches subtitles from Wyzie Subs API for party viewing sessions.
 * Standalone implementation so the party-server doesn't depend on addon-server code.
 */

import axios from "axios";
import NodeCache from "node-cache";
import type { Subtitle } from "./types.js";

const subtitleCache = new NodeCache({ stdTTL: 86400 }); // 24 hours

const WYZIE_API_BASE = "https://sub.wyzie.ru/api";

const PREFERRED_LANGUAGES = [
  "en", "he", "es", "fr", "de", "it", "pt", "ru", "ar",
  "ja", "ko", "zh", "tr", "nl", "pl", "sv", "da", "fi",
  "no", "cs", "el", "hu", "ro", "th", "vi", "id", "ms",
  "fa", "uk", "bg", "hr", "sr", "sk", "sl",
];

const LANG_CODE_MAP: Record<string, string> = {
  en: "eng", he: "heb", es: "spa", fr: "fra", de: "deu",
  it: "ita", pt: "por", ru: "rus", ar: "ara", ja: "jpn",
  ko: "kor", zh: "zho", tr: "tur", nl: "nld", pl: "pol",
  sv: "swe", da: "dan", fi: "fin", no: "nor", cs: "ces",
  el: "ell", hu: "hun", ro: "ron", th: "tha", vi: "vie",
  id: "ind", ms: "msa", fa: "fas", uk: "ukr", bg: "bul",
  hr: "hrv", sr: "srp", sk: "slk", sl: "slv",
};

interface WyzieSubtitle {
  lang?: string;
  language?: string;
  url?: string;
  download_url?: string;
}

/**
 * Fetch subtitles for a movie or series episode
 */
export async function fetchSubtitles(
  type: "movie" | "series",
  imdbId: string,
  season?: number,
  episode?: number
): Promise<Subtitle[]> {
  const cacheKey = type === "series"
    ? `subs_${imdbId}_${season}_${episode}`
    : `subs_${imdbId}`;

  const cached = subtitleCache.get<Subtitle[]>(cacheKey);
  if (cached) {
    console.log(`✓ Returning cached subtitles for ${imdbId}`);
    return cached;
  }

  try {
    let apiUrl: string;
    if (type === "series" && season !== undefined && episode !== undefined) {
      apiUrl = `${WYZIE_API_BASE}/imdb/${imdbId}/${season}/${episode}`;
    } else {
      apiUrl = `${WYZIE_API_BASE}/imdb/${imdbId}`;
    }

    const response = await axios.get(apiUrl, {
      timeout: 5000,
      headers: { "User-Agent": "Stremio-Party/1.0" },
    });

    if (!response.data || !Array.isArray(response.data)) {
      return [];
    }

    const subtitles: Subtitle[] = [];
    const seenLangs = new Set<string>();

    for (const sub of response.data as WyzieSubtitle[]) {
      const lang = (sub.lang || sub.language || "").toLowerCase().substring(0, 2);
      const url = sub.url || sub.download_url;
      if (!lang || !url) continue;
      if (seenLangs.has(lang)) continue;
      seenLangs.add(lang);
      if (!PREFERRED_LANGUAGES.includes(lang)) continue;

      subtitles.push({
        id: lang,
        url,
        lang: LANG_CODE_MAP[lang] || lang,
      });
    }

    // English and Hebrew first
    subtitles.sort((a, b) => {
      const aPriority = a.id === "en" ? 0 : a.id === "he" ? 1 : 2;
      const bPriority = b.id === "en" ? 0 : b.id === "he" ? 1 : 2;
      return aPriority - bPriority;
    });

    subtitleCache.set(cacheKey, subtitles);
    console.log(`✓ Fetched ${subtitles.length} subtitles for ${imdbId}`);
    return subtitles;
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 404) {
      console.log(`No subtitles available for ${imdbId}`);
    } else {
      console.error(`Subtitle fetch error:`, error instanceof Error ? error.message : error);
    }
    return [];
  }
}
