import fs from "node:fs";
import type { DocumentFormat } from "../core/db.js";
import { sha256Text } from "../core/hash.js";
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
  updated: number;
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
      `Could not infer format for ${relative}. Pass --format=markdown|json-i18n|po|yaml|xliff.`,
    );
  }

  const content = fs.readFileSync(abs, "utf8");
  const contentHash = sha256Text(content);
  const parsed = getParser(format).parse(content);
  if (parsed.warnings?.length) {
    for (const w of parsed.warnings) console.warn(`  warning: ${w}`);
  }
  const document = upsertDocument(db, relative, format, contentHash);
  const result = replaceDocumentSegments(db, document, parsed.segments);

  return {
    path: relative,
    format,
    segments: parsed.segments.length,
    inserted: result.inserted,
    unchanged: result.unchanged,
    removed: result.removed,
    updated: result.updated,
  };
}

/**
 * Import one file, a glob, multiple paths, or all known files under --root.
 */
export function runImport(
  filePath: string | string[] | undefined,
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

  const paths = Array.isArray(filePath)
    ? filePath
    : filePath
      ? [filePath]
      : [];

  if (paths.length === 0 && !options.root) {
    throw new Error("Provide a file/glob path or --root=<dir>.");
  }

  const expandOpts = {
    ...(options.root ? { root: options.root } : {}),
    layout: {
      contentRoots,
      outputMode: config.outputMode,
      outputRoot: config.outputRoot,
    },
    targetLangs: config.targetLangs,
  };

  const targets = [
    ...new Set(
      paths.length === 0
        ? expandImportTargets(projectRoot, ".", expandOpts)
        : paths.flatMap((p) => expandImportTargets(projectRoot, p, expandOpts)),
    ),
  ].sort();

  if (targets.length === 0) {
    throw new Error(
      options.root
        ? `No importable files found under ${options.root}`
        : `No files matched: ${paths.join(", ")}`,
    );
  }

  const supported: string[] = [];
  for (const relative of targets) {
    const format = options.format ?? inferFormat(relative);
    if (!format) {
      console.warn(`skipped (unknown format): ${relative}`);
      continue;
    }
    supported.push(relative);
  }

  if (supported.length === 0) {
    throw new Error("No importable files with a known format.");
  }

  const db = openProjectDb(projectRoot);
  const results: ImportFileResult[] = [];
  try {
    db.transaction(() => {
      for (const relative of supported) {
        const result = importOneFile(
          db,
          projectRoot,
          relative,
          options.format,
          contentRoots,
        );
        results.push(result);
        console.log(`Imported ${result.path} as ${result.format}`);
        console.log(
          `  segments: ${result.segments} (inserted ${result.inserted}, updated ${result.updated}, unchanged ${result.unchanged}, removed ${result.removed})`,
        );
      }
      rebuildGlossaryUsage(db);
    })();
  } finally {
    db.close();
  }

  if (results.length > 1) {
    const totalSegs = results.reduce((n, r) => n + r.segments, 0);
    console.log(`\nImported ${results.length} files (${totalSegs} segments total)`);
  }

  return results;
}
