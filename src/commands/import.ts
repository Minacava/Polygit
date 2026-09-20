import fs from "node:fs";
import type { DocumentFormat } from "../core/db.js";
import {
  assertInContentRoots,
  expandImportTargets,
  matchContentRoot,
  normalizeRootPath,
} from "../core/layout.js";
import {
  openProjectDb,
  readConfig,
  requireProjectRoot,
  resolveInsideProject,
  writeConfig,
} from "../core/project.js";
import {
  rebuildGlossaryUsage,
  replaceDocumentSegments,
  upsertDocument,
} from "../core/repository.js";
import { getParser, inferFormat } from "../parsers/index.js";
import type Database from "better-sqlite3";

export interface ImportOptions {
  format?: DocumentFormat;
  /** Walk this directory for known content files. */
  root?: string;
}

export interface ImportFileResult {
  path: string;
  format: DocumentFormat;
  segments: number;
  inserted: number;
  unchanged: number;
  removed: number;
}

function importOneFile(
  db: Database.Database,
  projectRoot: string,
  relative: string,
  formatOverride: DocumentFormat | undefined,
  contentRoots: string[],
): ImportFileResult {
  assertInContentRoots(relative, contentRoots, { allowRootHint: true });

  const abs = resolveInsideProject(projectRoot, relative);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
    throw new Error(`File not found: ${relative}`);
  }

  const format = formatOverride ?? inferFormat(relative);
  if (!format) {
    throw new Error(
      `Could not infer format for ${relative}. Pass --format=markdown or --format=json-i18n.`,
    );
  }

  const content = fs.readFileSync(abs, "utf8");
  const parsed = getParser(format).parse(content);
  const document = upsertDocument(db, relative, format);
  const result = replaceDocumentSegments(db, document, parsed.segments);

  return {
    path: relative,
    format,
    segments: parsed.segments.length,
    inserted: result.inserted,
    unchanged: result.unchanged,
    removed: result.removed,
  };
}

/**
 * Import one file, a glob, or all known files under --root into the TM database.
 */
export function runImport(
  filePath: string | undefined,
  options: ImportOptions = {},
): ImportFileResult[] {
  const projectRoot = requireProjectRoot();
  const config = readConfig(projectRoot);
  let contentRoots = [...config.contentRoots];

  if (options.root) {
    const rootRel = normalizeRootPath(options.root);
    if (!matchContentRoot(rootRel, contentRoots)) {
      contentRoots = [...contentRoots, rootRel];
      writeConfig(projectRoot, { ...config, contentRoots });
      console.log(`Added "${rootRel}" to contentRoots in .tmconfig.json`);
    }
  }

  if (!filePath && !options.root) {
    throw new Error("Provide a file/glob path or --root=<dir>.");
  }

  const targets = expandImportTargets(projectRoot, filePath ?? ".", {
    ...(options.root ? { root: options.root } : {}),
  });

  if (targets.length === 0) {
    throw new Error(
      options.root
        ? `No importable files found under ${options.root}`
        : `No files matched: ${filePath}`,
    );
  }

  const db = openProjectDb(projectRoot);
  const results: ImportFileResult[] = [];
  try {
    for (const relative of targets) {
      const result = importOneFile(db, projectRoot, relative, options.format, contentRoots);
      results.push(result);
      console.log(`Imported ${result.path} as ${result.format}`);
      console.log(
        `  segments: ${result.segments} (inserted/updated ${result.inserted}, unchanged ${result.unchanged}, removed ${result.removed})`,
      );
    }
    rebuildGlossaryUsage(db);
  } finally {
    db.close();
  }

  if (results.length > 1) {
    const totalSegs = results.reduce((n, r) => n + r.segments, 0);
    console.log(`\nImported ${results.length} files (${totalSegs} segments total)`);
  }

  return results;
}
