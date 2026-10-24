import type { DocumentFormat } from "../core/db.js";
import type { RawSegment } from "../core/segmenter.js";

export interface ParsedDocument {
  format: DocumentFormat;
  segments: RawSegment[];
  /** Opaque structure needed to re-serialize after translation (JSON paths, markdown blocks, …). */
  skeleton: unknown;
  /** Non-fatal parse notes (e.g. unterminated front matter). */
  warnings?: string[];
}

export interface Parser {
  readonly format: DocumentFormat;
  parse(content: string): ParsedDocument;
  serialize(skeleton: unknown, translations: Map<number, string>): string;
}
