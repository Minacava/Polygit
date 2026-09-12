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
 * Stable segment ID from document path, order, and content at first import.
 * Same inputs always produce the same ID.
 */
export function createSegmentId(
  documentPath: string,
  orderIndex: number,
  sourceText: string,
): string {
  const payload = `${documentPath}\0${orderIndex}\0${normalizeText(sourceText)}`;
  return crypto.createHash("sha256").update(payload, "utf8").digest("hex").slice(0, 32);
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

function splitSentences(text: string): string[] {
  // Simple splitter: end punctuation followed by whitespace and an uppercase / quote.
  const parts = text.split(/(?<=[.!?…])\s+(?=["'“‘(\[]*[A-ZÀ-ÖØ-Þ])/u);
  return parts.length > 0 ? parts : [text];
}
