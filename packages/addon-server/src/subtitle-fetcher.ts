/**
 * Subtitle Fetcher
 * Fetches subtitles from Wyzie Subs API for movies and TV shows
 */

import axios from "axios";
import type { Subtitle } from "./types.js";
import type { CacheManager } from "./cache.js";

// Wyzie Subs API base URL (free, no rate limits, no API key needed)
const WYZIE_API_BASE = "https://sub.wyzie.ru/api";

// Language codes we want to fetch (prioritizing English and Hebrew, but including many others)
const PREFERRED_LANGUAGES = [
  "en", // English (primary)
  "he", // Hebrew (primary)
  "es", // Spanish
  "fr", // French
  "de", // German
  "it", // Italian
  "pt", // Portuguese
  "ru", // Russian
  "ar", // Arabic
  "ja", // Japanese
  "ko", // Korean
  "zh", // Chinese
  "tr", // Turkish
  "nl", // Dutch
  "pl", // Polish
  "sv", // Swedish
  "da", // Danish
  "fi", // Finnish
  "no", // Norwegian
  "cs", // Czech
  "el", // Greek
  "hu", // Hungarian
  "ro", // Romanian
  "th", // Thai
  "vi", // Vietnamese
  "id", // Indonesian
  "ms", // Malay
  "fa", // Persian
  "uk", // Ukrainian
  "bg", // Bulgarian
  "hr", // Croatian
  "sr", // Serbian
  "sk", // Slovak
  "sl", // Slovenian
];

// Map of ISO 639-2/3 language codes to Stremio's expected format
const LANG_CODE_MAP: Record<string, string> = {
  en: "eng",
  he: "heb",
  es: "spa",
  fr: "fra",
  de: "deu",
  it: "ita",
  pt: "por",
  ru: "rus",
  ar: "ara",
  ja: "jpn",
  ko: "kor",
  zh: "zho",
  tr: "tur",
  nl: "nld",
  pl: "pol",
  sv: "swe",
  da: "dan",
  fi: "fin",
  no: "nor",
  cs: "ces",
  el: "ell",
  hu: "hun",
  ro: "ron",
  th: "tha",
  vi: "vie",
  id: "ind",
  ms: "msa",
  fa: "fas",
  uk: "ukr",
  bg: "bul",
  hr: "hrv",
  sr: "srp",
  sk: "slk",
  sl: "slv",
};

interface WyzieSubtitle {
  lang?: string;
  language?: string;
  url?: string;
  download_url?: string;
  [key: string]: unknown;
}

/**
 * Extract IMDB ID from Stremio ID format (tt0133093:2:37 -> tt0133093)
 */
function extractImdbId(id: string): string {
  return id.split(":")[0];
}

/**
 * Fetch subtitles for a movie or TV show
 */
export async function fetchSubtitles(
  type: string,
  id: string,
  cacheManager: CacheManager
): Promise<Subtitle[]> {
  const imdbId = extractImdbId(id);
  const cacheKey = `subtitles_${id}`;

  // Check cache first
  const cached = cacheManager.getMetadata(cacheKey);
  if (cached) {
    console.log(`✓ Returning cached subtitles for ${imdbId}`);
    return cached as Subtitle[];
  }

  try {
    let apiUrl: string;
    
    if (type === "series") {
      // For series: extract season and episode
      const parts = id.split(":");
      if (parts.length >= 3) {
        const season = parts[1];
        const episode = parts[2];
        apiUrl = `${WYZIE_API_BASE}/imdb/${imdbId}/${season}/${episode}`;
      } else {
        console.log(`⚠️  Invalid series ID format: ${id}`);
        return [];
      }
    } else {
      // For movies
      apiUrl = `${WYZIE_API_BASE}/imdb/${imdbId}`;
    }

    console.log(`Fetching subtitles from Wyzie API: ${apiUrl}`);
    const response = await axios.get(apiUrl, {
      timeout: 5000,
      headers: {
        "User-Agent": "Stremio-Addon/1.0",
      },
    });

    if (!response.data || !Array.isArray(response.data)) {
      console.log(`No subtitles found for ${imdbId}`);
      return [];
    }

    // Parse subtitle data
    const subtitles: Subtitle[] = [];
    const seenLangs = new Set<string>();

    for (const sub of response.data as WyzieSubtitle[]) {
      const lang = (sub.lang || sub.language || "").toLowerCase().substring(0, 2);
      const url = sub.url || sub.download_url;

      if (!lang || !url) continue;

      // Skip duplicates
      if (seenLangs.has(lang)) continue;
      seenLangs.add(lang);

      // Only include languages from our preferred list
      if (!PREFERRED_LANGUAGES.includes(lang)) continue;

      const stremioLang = LANG_CODE_MAP[lang] || lang;

      subtitles.push({
        id: lang,
        url: url,
        lang: stremioLang,
      });
    }

    // Sort by priority (English and Hebrew first)
    subtitles.sort((a, b) => {
      const aPriority = a.id === "en" ? 0 : a.id === "he" ? 1 : 2;
      const bPriority = b.id === "en" ? 0 : b.id === "he" ? 1 : 2;
      return aPriority - bPriority;
    });

    console.log(`✓ Found ${subtitles.length} subtitles for ${imdbId} (${subtitles.map(s => s.id).join(", ")})`);

    // Cache the results for 24 hours
    cacheManager.setMetadata(cacheKey, subtitles);

    return subtitles;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      if (error.response?.status === 404) {
        console.log(`No subtitles available for ${imdbId}`);
      } else {
        console.error(`Subtitle API error for ${imdbId}:`, error.message);
      }
    } else {
      console.error(`Subtitle fetch error for ${imdbId}:`, error);
    }
    return [];
  }
}
