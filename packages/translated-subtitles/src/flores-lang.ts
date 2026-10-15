/**
 * ISO 639 → FLORES-200 codes for NLLB-200.
 */

const FLORES_BY_ISO: Record<string, string> = {
  afr: "afr_Latn",
  ara: "arb_Arab",
  ar: "arb_Arab",
  bul: "bul_Cyrl",
  cat: "cat_Latn",
  ces: "ces_Latn",
  cs: "ces_Latn",
  cze: "ces_Latn",
  dan: "dan_Latn",
  da: "dan_Latn",
  deu: "deu_Latn",
  de: "deu_Latn",
  ger: "deu_Latn",
  ell: "ell_Grek",
  el: "ell_Grek",
  eng: "eng_Latn",
  en: "eng_Latn",
  spa: "spa_Latn",
  es: "spa_Latn",
  est: "est_Latn",
  eus: "eus_Latn",
  fas: "pes_Arab",
  fa: "pes_Arab",
  fin: "fin_Latn",
  fi: "fin_Latn",
  fra: "fra_Latn",
  fr: "fra_Latn",
  fre: "fra_Latn",
  heb: "heb_Hebr",
  he: "heb_Hebr",
  hin: "hin_Deva",
  hi: "hin_Deva",
  hrv: "hrv_Latn",
  hun: "hun_Latn",
  hu: "hun_Latn",
  ind: "ind_Latn",
  id: "ind_Latn",
  isl: "isl_Latn",
  ita: "ita_Latn",
  it: "ita_Latn",
  jpn: "jpn_Jpan",
  ja: "jpn_Jpan",
  kor: "kor_Hang",
  ko: "kor_Hang",
  lav: "lvs_Latn",
  lit: "lit_Latn",
  nld: "nld_Latn",
  nl: "nld_Latn",
  dut: "nld_Latn",
  nor: "nob_Latn",
  no: "nob_Latn",
  pol: "pol_Latn",
  pl: "pol_Latn",
  por: "por_Latn",
  pt: "por_Latn",
  ron: "ron_Latn",
  ro: "ron_Latn",
  rus: "rus_Cyrl",
  ru: "rus_Cyrl",
  slk: "slk_Latn",
  slv: "slv_Latn",
  srp: "srp_Cyrl",
  swe: "swe_Latn",
  sv: "swe_Latn",
  tha: "tha_Thai",
  th: "tha_Thai",
  tur: "tur_Latn",
  tr: "tur_Latn",
  ukr: "ukr_Cyrl",
  uk: "ukr_Cyrl",
  vie: "vie_Latn",
  vi: "vie_Latn",
  zho: "zho_Hans",
  zh: "zho_Hans",
  chi: "zho_Hans",
};

export function toFloresCode(iso: string | undefined): string | undefined {
  const key = (iso ?? "").trim().toLowerCase();
  if (key === "" || key === "und") {
    return undefined;
  }
  return FLORES_BY_ISO[key];
}

export function requireFloresCode(iso: string | undefined, role: "source" | "target"): string {
  const code = toFloresCode(iso);
  if (!code) {
    throw new Error(`No FLORES-200 mapping for ${role} language "${iso ?? ""}"`);
  }
  return code;
}
