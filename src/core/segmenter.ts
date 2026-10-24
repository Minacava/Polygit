import crypto from "node:crypto";

export interface RawSegment {
  orderIndex: number;
  sourceText: string;
}

/** One prose slice plus the exact whitespace that followed it in the source. */
export interface ProsePart {
  sourceText: string;
  /** Original gap after this part (`" "`, `"\n"`, `"  \n"`, …). Empty on the last part. */
  gapAfter: string;
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
 * Split plain prose into sentence-like parts, preserving original gaps
 * (spaces / newlines / hard breaks) between them so callers can re-join
 * without flattening multi-line Markdown structure.
 */
export function segmentProse(text: string): ProsePart[] {
  const normalized = text.replace(/\r\n/g, "\n");
  if (!normalized.trim()) return [];

  const paragraphs = normalized.split(/(\n{2,})/);
  const parts: ProsePart[] = [];

  for (let i = 0; i < paragraphs.length; i++) {
    const chunk = paragraphs[i] ?? "";
    if (/^\n{2,}$/.test(chunk)) {
      if (parts.length > 0) {
        parts[parts.length - 1]!.gapAfter += chunk;
      }
      continue;
    }

    const trimmed = chunk.trim();
    if (!trimmed) continue;

    // Keep fenced code / indented blocks atomic when present as a whole paragraph.
    if (trimmed.startsWith("```") || /^\s{4,}\S/m.test(trimmed)) {
      parts.push({ sourceText: trimmed, gapAfter: "" });
      continue;
    }

    const sentences = splitSentencesWithGaps(trimmed);
    for (const sentence of sentences) {
      if (sentence.sourceText) parts.push(sentence);
    }
  }

  return parts;
}

/** Back-compat helper used by tests that expect RawSegment[]. */
export function segmentProseAsRaw(text: string): RawSegment[] {
  return segmentProse(text).map((part, orderIndex) => ({
    orderIndex,
    sourceText: part.sourceText,
  }));
}

const ABBR =
  /\b(?:e\.g|i\.e|etc|vs|Mr|Mrs|Ms|Dr|Prof|Inc|Ltd|No|Fig|cf|approx)\.$/i;

function splitSentencesWithGaps(text: string, lang = "en"): ProsePart[] {
  try {
    const segmenter = new Intl.Segmenter(lang, { granularity: "sentence" });
    const raw: string[] = [];
    for (const { segment } of segmenter.segment(text)) {
      if (raw.length && ABBR.test(raw[raw.length - 1]!.trimEnd())) {
        raw[raw.length - 1] += segment;
      } else {
        raw.push(segment);
      }
    }
    if (raw.length === 0) return [{ sourceText: text, gapAfter: "" }];

    const parts: ProsePart[] = [];
    for (let i = 0; i < raw.length; i++) {
      const seg = raw[i]!;
      const lead = seg.match(/^\s*/)?.[0] ?? "";
      const core = seg.slice(lead.length).trimEnd();
      const trail = seg.slice(lead.length + core.length);
      if (lead && parts.length > 0) {
        parts[parts.length - 1]!.gapAfter += lead;
      }
      if (!core.trim()) {
        if (parts.length > 0) parts[parts.length - 1]!.gapAfter += core + trail;
        continue;
      }
      parts.push({ sourceText: core.trim(), gapAfter: trail });
    }
    return parts.length > 0 ? parts : [{ sourceText: text, gapAfter: "" }];
  } catch {
    const parts = text.split(/(?<=[.!?…])(\s+)(?=["'“‘(\[]*[A-ZÀ-ÖØ-Þ])/u);
    // split with capturing groups: [sentence, gap, sentence, gap, ...]
    const out: ProsePart[] = [];
    for (let i = 0; i < parts.length; i += 2) {
      const sourceText = (parts[i] ?? "").trim();
      const gapAfter = parts[i + 1] ?? "";
      if (sourceText) out.push({ sourceText, gapAfter });
    }
    return out.length > 0 ? out : [{ sourceText: text, gapAfter: "" }];
  }
}
