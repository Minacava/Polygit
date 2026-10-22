import fs from "node:fs";
import type Database from "better-sqlite3";
import { sha256Text } from "../core/hash.js";
import { assertLangCode } from "../core/lang.js";
import {
  isManagedOutputPath,
  listContentFiles,
  toOutputPath,
  type LayoutFields,
} from "../core/layout.js";
import {
  computeStyleHash,
  loadStyleGuideText,
  openProjectDb,
  readConfig,
  requireProjectRoot,
  resolveInsideProject,
  resolveStyle,
  type TmConfig,
} from "../core/project.js";
import { getStatusCounts, markStyleHashStale } from "../core/repository.js";

export interface CheckOptions {
  /** When omitted, checks every language in config.targetLangs. */
  lang?: string;
  /** When true, only report; caller sets exit code. Default behavior prints and throws. */
  quiet?: boolean;
  /** Print machine-readable JSON to stdout (for CI). */
  json?: boolean;
}

export interface LangDocumentIssue {
  path: string;
  pending: number;
  stale: number;
  missingOutput: boolean;
  /** Stale translations whose style_hash differs from the current style. */
  styleChanged?: number;
}

export interface LangCheckResult {
  lang: string;
  pending: number;
  stale: number;
  /** Segments marked/found stale due to style fingerprint mismatch. */
  styleChanged: number;
  documents: LangDocumentIssue[];
}

export interface CheckResult {
  ok: boolean;
  langs: string[];
  newFiles: string[];
  changedFiles: string[];
  byLang: LangCheckResult[];
  /** @deprecated Prefer byLang; kept for older callers aggregating one language. */
  lang?: string;
  pending?: number;
  stale?: number;
  documents?: LangDocumentIssue[];
}

export interface ContentDrift {
  newFiles: string[];
  changedFiles: string[];
}

/**
 * Scan contentRoots for files not yet imported (NEW) or whose bytes changed
 * since the last import (CHANGED). Excludes managed translation outputs.
 * Exported for `polygit sync` (piece 3).
 */
export function scanContentDrift(
  db: Database.Database,
  projectRoot: string,
  config: Pick<TmConfig, "contentRoots" | "outputMode" | "outputRoot" | "targetLangs">,
  /** Extra langs to treat as outputs (e.g. `--lang` when targetLangs is empty). */
  extraLangs: readonly string[] = [],
): ContentDrift {
  const layout: LayoutFields = {
    contentRoots: config.contentRoots,
    outputMode: config.outputMode,
    outputRoot: config.outputRoot,
  };
  const excludeLangs = [...new Set([...config.targetLangs, ...extraLangs])];

  const onDisk = listContentFiles(projectRoot, config.contentRoots).filter(
    (rel) => !isManagedOutputPath(rel, layout, excludeLangs),
  );

  const docs = db
    .prepare(`SELECT path, content_hash FROM documents ORDER BY path`)
    .all() as Array<{ path: string; content_hash: string | null }>;
  const byPath = new Map(docs.map((d) => [d.path, d.content_hash]));

  const newFiles: string[] = [];
  for (const rel of onDisk) {
    if (!byPath.has(rel)) newFiles.push(rel);
  }

  const changedFiles: string[] = [];
  for (const doc of docs) {
    let abs: string | null = null;
    try {
      abs = resolveInsideProject(projectRoot, doc.path);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/symlink/i.test(message)) {
        console.warn(`skipped symlink: ${doc.path}`);
        continue;
      }
      abs = null;
    }
    if (!abs || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
      changedFiles.push(doc.path);
      continue;
    }
    const hash = sha256Text(fs.readFileSync(abs, "utf8"));
    if (doc.content_hash == null || doc.content_hash !== hash) {
      changedFiles.push(doc.path);
    }
  }

  return { newFiles, changedFiles };
}

function resolveCheckLangs(config: TmConfig, langOption?: string): string[] {
  if (langOption !== undefined) {
    return [assertLangCode(langOption)];
  }
  if (config.targetLangs.length === 0) {
    throw new Error(
      'No languages to check. Pass --lang=<code> or set targetLangs in .tmconfig.json.',
    );
  }
  return config.targetLangs.map((l) => assertLangCode(l));
}

function countStyleChangedStale(
  db: Database.Database,
  lang: string,
  currentHash: string | null,
): Map<string, number> {
  const byPath = new Map<string, number>();
  if (currentHash === null) return byPath;
  const rows = db
    .prepare(
      `SELECT d.path AS path, COUNT(*) AS n
       FROM translations t
       JOIN segments s ON s.id = t.segment_id
       JOIN documents d ON d.id = s.document_id
       WHERE t.lang = ?
         AND t.status = 'stale'
         AND (t.style_hash IS NULL OR t.style_hash != ?)
       GROUP BY d.path`,
    )
    .all(lang, currentHash) as Array<{ path: string; n: number }>;
  for (const row of rows) byPath.set(row.path, row.n);
  return byPath;
}

function collectLangIssues(
  db: Database.Database,
  projectRoot: string,
  config: TmConfig,
  lang: string,
  currentStyleHash: string | null,
): LangCheckResult {
  const layout: LayoutFields = {
    contentRoots: config.contentRoots,
    outputMode: config.outputMode,
    outputRoot: config.outputRoot,
  };
  const rows = getStatusCounts(db, lang);
  const styleChangedByPath = countStyleChangedStale(db, lang, currentStyleHash);
  const documents: LangDocumentIssue[] = [];

  for (const row of rows) {
    let missingOutput = false;
    try {
      const outputRel = toOutputPath(row.path, lang, layout);
      const absOut = resolveInsideProject(projectRoot, outputRel);
      missingOutput = !fs.existsSync(absOut) || !fs.statSync(absOut).isFile();
    } catch {
      missingOutput = true;
    }

    const styleChanged = styleChangedByPath.get(row.path) ?? 0;
    if (row.pending > 0 || row.stale > 0 || missingOutput) {
      documents.push({
        path: row.path,
        pending: row.pending,
        stale: row.stale,
        missingOutput,
        ...(styleChanged > 0 ? { styleChanged } : {}),
      });
    }
  }

  return {
    lang,
    pending: rows.reduce((n, r) => n + r.pending, 0),
    stale: rows.reduce((n, r) => n + r.stale, 0),
    styleChanged: [...styleChangedByPath.values()].reduce((n, v) => n + v, 0),
    documents,
  };
}

function formatHumanFailure(result: CheckResult): string {
  const lines: string[] = ["check failed"];
  if (result.newFiles.length > 0) {
    lines.push(`  NEW (not imported):   ${result.newFiles.join(", ")}`);
  }
  if (result.changedFiles.length > 0) {
    lines.push(`  CHANGED since import: ${result.changedFiles.join(", ")}`);
  }
  for (const langResult of result.byLang) {
    for (const doc of langResult.documents) {
      const parts: string[] = [];
      if (doc.pending > 0) parts.push(`pending=${doc.pending}`);
      if (doc.stale > 0) {
        const styleNote =
          doc.styleChanged && doc.styleChanged > 0
            ? ` (style changed=${doc.styleChanged})`
            : "";
        parts.push(`stale=${doc.stale}${styleNote}`);
      }
      if (doc.missingOutput) parts.push("missing output file");
      lines.push(`  ${langResult.lang}: ${doc.path}  ${parts.join(" ")}`);
    }
  }
  return lines.join("\n");
}

/**
 * CI-friendly gate: fail on NEW/CHANGED sources, pending/stale segments,
 * or missing output files for the selected language(s).
 */
export function runCheck(options: CheckOptions = {}): CheckResult {
  const root = requireProjectRoot();
  const config = readConfig(root);
  const langs = resolveCheckLangs(config, options.lang);
  const db = openProjectDb(root);
  try {
    const styleGuide = loadStyleGuideText(root, config.style);
    const styleHash = computeStyleHash(resolveStyle(config.style), styleGuide);
    // Editing .tmconfig.json style (or config set) is reflected here before counting.
    if (styleHash !== null) {
      for (const lang of langs) {
        markStyleHashStale(db, styleHash, lang);
      }
    }

    const drift = scanContentDrift(db, root, config, langs);
    const byLang = langs.map((lang) =>
      collectLangIssues(db, root, config, lang, styleHash),
    );
    const ok =
      drift.newFiles.length === 0 &&
      drift.changedFiles.length === 0 &&
      byLang.every((l) => l.documents.length === 0);

    const primary = byLang[0];
    const result: CheckResult = {
      ok,
      langs,
      newFiles: drift.newFiles,
      changedFiles: drift.changedFiles,
      byLang,
      ...(primary
        ? {
            lang: primary.lang,
            pending: primary.pending,
            stale: primary.stale,
            documents: primary.documents,
          }
        : {}),
    };

    if (!options.quiet || options.json) {
      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
      } else if (ok) {
        console.log(
          `check ok: langs=${langs.join(",")} (no NEW/CHANGED, pending, stale, or missing outputs)`,
        );
      } else {
        console.error(formatHumanFailure(result));
      }
    }

    if (!ok) {
      const err = new Error(formatHumanFailure(result));
      (err as Error & { checkResult?: CheckResult; alreadyPrinted?: boolean }).checkResult =
        result;
      // Avoid "Error: …" duplicating the same summary on stderr (CLI respects this).
      (err as Error & { alreadyPrinted?: boolean }).alreadyPrinted = !options.quiet;
      throw err;
    }

    return result;
  } finally {
    db.close();
  }
}
