/**
 * Normalize text for fuzzy matching (Unicode NFC, case-fold, punctuation stripped).
 */

/** Strip bidi marks and collapse punctuation to spaces for token / string compare */
export function normalizeForMatch(input: string): string {
  return input
    .normalize("NFC")
    .replace(/[\u200e\u200f\u202a-\u202e]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenizeNormalized(normalized: string): Set<string> {
  const set = new Set<string>();
  for (const t of normalized.split(" ")) {
    if (t.length >= 2) set.add(t);
  }
  return set;
}

export function tokenize(input: string): Set<string> {
  return tokenizeNormalized(normalizeForMatch(input));
}

/** Jaccard similarity on token sets, in [0, 1] */
export function jaccardTokens(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) {
    if (b.has(x)) inter += 1;
  }
  const union = a.size + b.size - inter;
  return union > 0 ? inter / union : 0;
}
