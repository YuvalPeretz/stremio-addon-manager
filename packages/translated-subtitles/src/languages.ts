/**
 * ISO 639 helpers for TARGET_LANG and OpenSubtitles preference.
 */

const LANG_NAMES: Record<string, string> = {
  afr: "Afrikaans",
  ara: "Arabic",
  ar: "Arabic",
  bul: "Bulgarian",
  cat: "Catalan",
  ces: "Czech",
  cs: "Czech",
  cze: "Czech",
  dan: "Danish",
  da: "Danish",
  deu: "German",
  de: "German",
  ger: "German",
  ell: "Greek",
  el: "Greek",
  eng: "English",
  en: "English",
  spa: "Spanish",
  es: "Spanish",
  est: "Estonian",
  eus: "Basque",
  fas: "Persian",
  fa: "Persian",
  fin: "Finnish",
  fi: "Finnish",
  fra: "French",
  fr: "French",
  fre: "French",
  heb: "Hebrew",
  he: "Hebrew",
  hin: "Hindi",
  hi: "Hindi",
  hrv: "Croatian",
  hun: "Hungarian",
  hu: "Hungarian",
  ind: "Indonesian",
  id: "Indonesian",
  isl: "Icelandic",
  ita: "Italian",
  it: "Italian",
  jpn: "Japanese",
  ja: "Japanese",
  kor: "Korean",
  ko: "Korean",
  lav: "Latvian",
  lit: "Lithuanian",
  nld: "Dutch",
  nl: "Dutch",
  dut: "Dutch",
  nor: "Norwegian",
  no: "Norwegian",
  pol: "Polish",
  pl: "Polish",
  por: "Portuguese",
  pt: "Portuguese",
  ron: "Romanian",
  ro: "Romanian",
  rus: "Russian",
  ru: "Russian",
  slk: "Slovak",
  slv: "Slovenian",
  srp: "Serbian",
  swe: "Swedish",
  sv: "Swedish",
  tha: "Thai",
  th: "Thai",
  tur: "Turkish",
  tr: "Turkish",
  ukr: "Ukrainian",
  uk: "Ukrainian",
  vie: "Vietnamese",
  vi: "Vietnamese",
  zho: "Chinese",
  zh: "Chinese",
  chi: "Chinese",
};

const ENGLISH_CODES = new Set(["eng", "en", "english"]);

export function languageName(iso: string): string {
  const key = iso.trim().toLowerCase();
  return LANG_NAMES[key] ?? iso.trim();
}

export function normalizeLang(iso: string | undefined): string {
  return (iso ?? "").trim().toLowerCase();
}

export function isEnglishLang(iso: string | undefined): boolean {
  return ENGLISH_CODES.has(normalizeLang(iso));
}
