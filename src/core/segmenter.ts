import crypto from "node:crypto";

export interface RawSegment {
  orderIndex: number;
  sourceText: string;
}

/** Normalize whitespace for hashing and TM exact match. */
export function normalizeText(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n").trim();
}

/**
 * Stable segment ID from document path, content, and occurrence of that content.
 *
 * Order/position is intentionally excluded so inserting a paragraph does not
 * rewrite IDs (and drop translations) for unchanged segments. Duplicate strings
 * in the same document are disambiguated with `occurrenceIndex` (0-based among
 * equal normalized texts in document order).
 */
export function createSegmentId(
  documentPath: string,
  sourceText: string,
  occurrenceIndex = 0,
): string {
  const payload = `${documentPath}\0${occurrenceIndex}\0${normalizeText(sourceText)}`;
  return crypto.createHash("sha256").update(payload, "utf8").digest("hex").slice(0, 32);
}

/**
 * Assign content-stable IDs to raw segments (document order → occurrence counts).
 */
export function assignStableSegmentIds(
  documentPath: string,
  rawSegments: RawSegment[],
): Array<RawSegment & { id: string; occurrenceIndex: number }> {
  const occurrenceCounts = new Map<string, number>();
  return rawSegments.map((raw) => {
    const key = normalizeText(raw.sourceText);
    const occurrenceIndex = occurrenceCounts.get(key) ?? 0;
    occurrenceCounts.set(key, occurrenceIndex + 1);
    return {
      ...raw,
      occurrenceIndex,
      id: createSegmentId(documentPath, raw.sourceText, occurrenceIndex),
    };
  });
}

export function createId(prefix = ""): string {
  const id = crypto.randomUUID().replace(/-/g, "");
  return prefix ? `${prefix}_${id}` : id;
}

/**
 * Split plain prose into sentence-like segments.
 * Keeps intentional blank-line paragraph boundaries as separate units.
 */
export function segmentProse(text: string): RawSegment[] {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];

  const paragraphs = normalized.split(/\n{2,}/);
  const segments: RawSegment[] = [];
  let orderIndex = 0;

  for (const paragraph of paragraphs) {
    const trimmed = paragraph.trim();
    if (!trimmed) continue;

    // Keep fenced code / indented blocks atomic when present as a whole paragraph.
    if (trimmed.startsWith("```") || /^\s{4,}\S/m.test(trimmed)) {
      segments.push({ orderIndex: orderIndex++, sourceText: trimmed });
      continue;
    }

    const sentences = splitSentences(trimmed);
    for (const sentence of sentences) {
      const sourceText = sentence.trim();
      if (sourceText) {
        segments.push({ orderIndex: orderIndex++, sourceText });
      }
    }
  }

  return segments;
}

const ABBR =
  /\b(?:e\.g|i\.e|etc|vs|Mr|Mrs|Ms|Dr|Prof|Inc|Ltd|No|Fig|cf|approx)\.$/i;

function splitSentences(text: string, lang = "en"): string[] {
  try {
    const segmenter = new Intl.Segmenter(lang, { granularity: "sentence" });
    const out: string[] = [];
    for (const { segment } of segmenter.segment(text)) {
      if (out.length && ABBR.test(out[out.length - 1]!.trimEnd())) {
        out[out.length - 1] += segment;
      } else {
        out.push(segment);
      }
    }
    const trimmed = out.map((s) => s.trim()).filter(Boolean);
    return trimmed.length > 0 ? trimmed : [text];
  } catch {
    const parts = text.split(/(?<=[.!?…])\s+(?=["'“‘(\[]*[A-ZÀ-ÖØ-Þ])/u);
    return parts.length > 0 ? parts : [text];
  }
}
