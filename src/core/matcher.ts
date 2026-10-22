import { normalizeText } from "./segmenter.js";

export interface TmEntry {
  id: string;
  source_text: string;
  target_text: string;
  lang: string;
  usage_count: number;
  /** Style fingerprint; exact reuse requires a match with the current style. */
  style_hash?: string | null;
}

export interface MatchResult {
  entry: TmEntry;
  score: number;
  kind: "exact" | "fuzzy";
}

/** Default minimum similarity for fuzzy TM hits (0–1). */
export const DEFAULT_FUZZY_THRESHOLD = 0.85;

/**
 * In-memory TM index: O(1) exact lookup + length-bucketed fuzzy candidates.
 */
export class TranslationMemoryIndex {
  private readonly exact = new Map<string, TmEntry>();
  private readonly byLength = new Map<number, Array<{ entry: TmEntry; normalized: string }>>();

  constructor(entries: TmEntry[] = []) {
    for (const entry of entries) this.add(entry);
  }

  add(entry: TmEntry): void {
    const normalized = normalizeText(entry.source_text);
    if (!normalized) return;
    if (!this.exact.has(normalized)) this.exact.set(normalized, entry);
    const bucket = this.byLength.get(normalized.length) ?? [];
    bucket.push({ entry, normalized });
    this.byLength.set(normalized.length, bucket);
  }

  match(sourceText: string, threshold = DEFAULT_FUZZY_THRESHOLD): MatchResult | null {
    const needle = normalizeText(sourceText);
    if (!needle) return null;

    const exact = this.exact.get(needle);
    if (exact) return { entry: exact, score: 1, kind: "exact" };

    const minLen = Math.max(1, Math.floor(needle.length * threshold));
    const maxLen = Math.ceil(needle.length / threshold);
    let best: MatchResult | null = null;

    for (let len = minLen; len <= maxLen; len++) {
      const bucket = this.byLength.get(len);
      if (!bucket) continue;
      for (const cand of bucket) {
        const score = similarity(needle, cand.normalized);
        if (score < threshold) continue;
        if (!best || score > best.score) {
          best = { entry: cand.entry, score, kind: "fuzzy" };
        }
      }
    }
    return best;
  }
}

/**
 * Exact match first, then best fuzzy candidate above the threshold.
 */
export function matchTranslationMemory(
  sourceText: string,
  entries: TmEntry[],
  threshold = DEFAULT_FUZZY_THRESHOLD,
): MatchResult | null {
  return new TranslationMemoryIndex(entries).match(sourceText, threshold);
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

/** Run async work over items with a fixed concurrency limit. */
export async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const limit = Math.max(1, Math.min(concurrency, items.length || 1));
  const results = new Array<R>(items.length);
  let next = 0;

  async function run(): Promise<void> {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index]!, index);
    }
  }

  await Promise.all(Array.from({ length: limit }, () => run()));
  return results;
}
