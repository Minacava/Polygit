import { normalizeText } from "./segmenter.js";

export interface TmEntry {
  id: string;
  source_text: string;
  target_text: string;
  lang: string;
  usage_count: number;
}

export interface MatchResult {
  entry: TmEntry;
  score: number;
  kind: "exact" | "fuzzy";
}

/** Default minimum similarity for fuzzy TM hits (0–1). */
export const DEFAULT_FUZZY_THRESHOLD = 0.85;

/**
 * Exact match first, then best fuzzy candidate above the threshold.
 */
export function matchTranslationMemory(
  sourceText: string,
  entries: TmEntry[],
  threshold = DEFAULT_FUZZY_THRESHOLD,
): MatchResult | null {
  const needle = normalizeText(sourceText);
  if (!needle || entries.length === 0) return null;

  for (const entry of entries) {
    if (normalizeText(entry.source_text) === needle) {
      return { entry, score: 1, kind: "exact" };
    }
  }

  let best: MatchResult | null = null;
  for (const entry of entries) {
    const score = similarity(needle, normalizeText(entry.source_text));
    if (score < threshold) continue;
    if (!best || score > best.score) {
      best = { entry, score, kind: "fuzzy" };
    }
  }

  return best;
}

/** Normalized Levenshtein similarity in [0, 1]. */
export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  const distance = levenshtein(a, b);
  const maxLen = Math.max(a.length, b.length);
  return 1 - distance / maxLen;
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  // Use two-row DP for memory.
  let prev = new Array<number>(n + 1);
  let curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= n; j++) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(
        (prev[j] ?? 0) + 1,
        (curr[j - 1] ?? 0) + 1,
        (prev[j - 1] ?? 0) + cost,
      );
    }
    [prev, curr] = [curr, prev];
  }

  return prev[n] ?? 0;
}
