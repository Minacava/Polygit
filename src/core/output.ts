import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import {
  getDocumentByPath,
  getSegmentsForDocument,
  getTranslationMap,
} from "./repository.js";
import { getParser } from "../parsers/index.js";
import { resolveInsideProject } from "./project.js";

/** Rebuild translated files under outputs/<lang>/ mirroring sources/. */
export function writeOutputDocuments(
  db: Database.Database,
  projectRoot: string,
  lang: string,
  documentPaths?: string[],
): string[] {
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

    const parser = getParser(document.format);
    const parsed = parser.parse(fs.readFileSync(absSource, "utf8"));
    const segments = getSegmentsForDocument(db, document.id);
    const translations = getTranslationMap(db, document.id, lang);

    const byOrder = new Map<number, string>();
    for (const segment of segments) {
      const tr = translations.get(segment.id);
      byOrder.set(segment.order_index, tr?.target_text ?? segment.source_text);
    }

    const map = new Map<number, string>();
    for (const seg of parsed.segments) {
      map.set(seg.orderIndex, byOrder.get(seg.orderIndex) ?? seg.sourceText);
    }

    const outputRel = path.posix.join(
      "outputs",
      lang,
      relativePath.startsWith("sources/")
        ? relativePath.slice("sources/".length)
        : relativePath,
    );
    const absOut = resolveInsideProject(projectRoot, outputRel);
    fs.mkdirSync(path.dirname(absOut), { recursive: true });
    fs.writeFileSync(absOut, parser.serialize(parsed.skeleton, map), "utf8");
    written.push(outputRel);
  }

  return written;
}
