import fs from "node:fs";
import type { DocumentFormat } from "../core/db.js";
import {
  openProjectDb,
  requireProjectRoot,
  resolveInsideProject,
  toPosixRelative,
} from "../core/project.js";
import {
  rebuildGlossaryUsage,
  replaceDocumentSegments,
  upsertDocument,
} from "../core/repository.js";
import { getParser, inferFormat } from "../parsers/index.js";

export interface ImportOptions {
  format?: DocumentFormat;
}

export function runImport(filePath: string, options: ImportOptions = {}): void {
  const root = requireProjectRoot();
  const abs = resolveInsideProject(root, filePath);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
    throw new Error(`File not found: ${filePath}`);
  }

  const relative = toPosixRelative(root, abs);
  if (!relative.startsWith("sources/")) {
    throw new Error(`Import path must be under sources/ (got ${relative})`);
  }

  const format = options.format ?? inferFormat(relative);
  if (!format) {
    throw new Error(
      `Could not infer format for ${relative}. Pass --format=markdown or --format=json-i18n.`,
    );
  }

  const content = fs.readFileSync(abs, "utf8");
  const parsed = getParser(format).parse(content);

  const db = openProjectDb(root);
  try {
    const document = upsertDocument(db, relative, format);
    const result = replaceDocumentSegments(db, document, parsed.segments);
    rebuildGlossaryUsage(db);
    console.log(`Imported ${relative} as ${format}`);
    console.log(
      `  segments: ${parsed.segments.length} (inserted/updated ${result.inserted}, unchanged ${result.unchanged}, removed ${result.removed})`,
    );
  } finally {
    db.close();
  }
}
