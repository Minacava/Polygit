import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import { sha256Text } from "./hash.js";
import {
  getDocumentByPath,
  getSegmentsForDocument,
  getTranslationMap,
} from "./repository.js";
import { getParser } from "../parsers/index.js";
import { toOutputPath } from "./layout.js";
import { readConfig, resolveInsideProject } from "./project.js";
import { normalizeText } from "./segmenter.js";
import type { DocumentRow, SegmentRow, TranslationRow } from "./db.js";

function assertSourceMatchesImport(
  relativePath: string,
  document: DocumentRow,
  raw: string,
): void {
  if (document.content_hash == null) return;
  if (sha256Text(raw) === document.content_hash) return;
  throw new Error(
    `${relativePath} changed since import. Run "polygit import ${relativePath}" first.`,
  );
}

/**
 * Build order_index → target text, preferring source-text match over position
 * so a drifted parse cannot silently shift translations.
 * Translations marked `needs_fix` keep the source text on disk.
 */
function buildTranslationMap(
  segments: SegmentRow[],
  translations: Map<string, TranslationRow>,
  parsedSegments: Array<{ orderIndex: number; sourceText: string }>,
): Map<number, string> {
  const bySource = new Map<string, string>();
  const byOrder = new Map<number, string>();
  for (const segment of segments) {
    const tr = translations.get(segment.id);
    const useSource = !tr || tr.status === "needs_fix";
    const text = useSource ? segment.source_text : tr!.target_text;
    byOrder.set(segment.order_index, text);
    bySource.set(normalizeText(segment.source_text), text);
  }

  const map = new Map<number, string>();
  for (const seg of parsedSegments) {
    const key = normalizeText(seg.sourceText);
    map.set(
      seg.orderIndex,
      bySource.get(key) ?? byOrder.get(seg.orderIndex) ?? seg.sourceText,
    );
  }
  return map;
}

/** Rebuild translated files according to layout (mirror / sidecar / in-place-locale). */
export function writeOutputDocuments(
  db: Database.Database,
  projectRoot: string,
  lang: string,
  documentPaths?: string[],
): string[] {
  const config = readConfig(projectRoot);
  const paths =
    documentPaths ??
    (
      db.prepare(`SELECT path FROM documents ORDER BY path`).all() as Array<{ path: string }>
    ).map((r) => r.path);

  const written: string[] = [];

  for (const relativePath of paths) {
    const document = getDocumentByPath(db, relativePath);
    if (!document) continue;

    const absSource = resolveInsideProject(projectRoot, relativePath);
    if (!fs.existsSync(absSource)) {
      throw new Error(`Source file missing: ${relativePath}`);
    }

    const raw = fs.readFileSync(absSource, "utf8");
    assertSourceMatchesImport(relativePath, document, raw);

    const parser = getParser(document.format);
    const parsed = parser.parse(raw);
    const segments = getSegmentsForDocument(db, document.id);
    const translations = getTranslationMap(db, document.id, lang);
    const map = buildTranslationMap(segments, translations, parsed.segments);

    const outputRel = toOutputPath(relativePath, lang, config);
    const absOut = resolveInsideProject(projectRoot, outputRel);
    fs.mkdirSync(path.dirname(absOut), { recursive: true });
    fs.writeFileSync(absOut, parser.serialize(parsed.skeleton, map), "utf8");
    written.push(outputRel);
  }

  return written;
}

/**
 * Ensure on-disk outputs for `lang` match a fresh serialize of approved
 * translations (plus source text for any still-untranslated segments).
 */
export function assertApprovedOutputsOnDisk(
  db: Database.Database,
  projectRoot: string,
  lang: string,
): void {
  const config = readConfig(projectRoot);
  const docs = db
    .prepare(`SELECT path FROM documents ORDER BY path`)
    .all() as Array<{ path: string }>;

  for (const { path: relativePath } of docs) {
    const document = getDocumentByPath(db, relativePath);
    if (!document) continue;

    const absSource = resolveInsideProject(projectRoot, relativePath);
    if (!fs.existsSync(absSource)) {
      throw new Error(`Source file missing before publish: ${relativePath}`);
    }

    const raw = fs.readFileSync(absSource, "utf8");
    assertSourceMatchesImport(relativePath, document, raw);

    const parser = getParser(document.format);
    const parsed = parser.parse(raw);
    const segments = getSegmentsForDocument(db, document.id);
    const translations = getTranslationMap(db, document.id, lang);
    const map = buildTranslationMap(segments, translations, parsed.segments);

    const expected = parser.serialize(parsed.skeleton, map);
    const outputRel = toOutputPath(relativePath, lang, config);
    const absOut = resolveInsideProject(projectRoot, outputRel);
    if (!fs.existsSync(absOut)) {
      throw new Error(
        `Approved translation output missing on disk: ${outputRel}. ` +
          `Re-run translate/review before publish.`,
      );
    }
    const actual = fs.readFileSync(absOut, "utf8");
    if (actual !== expected) {
      throw new Error(
        `Output file does not match approved translations: ${outputRel}. ` +
          `Re-run translate or restore the file before publish.`,
      );
    }
  }
}
