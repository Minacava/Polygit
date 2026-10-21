import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { normalizeText } from "./segmenter.js";

/** Relative path of the on-disk SQLite file inside a polygit project. */
export const DB_RELATIVE_PATH = path.join(".tm", "db.sqlite");

export type DocumentFormat = "markdown" | "json-i18n" | "po" | "yaml" | "xliff";

export type SegmentStatus = "pending" | "translated" | "stale" | "approved";

export type TranslationSource = "tm-exact" | "tm-fuzzy" | "llm" | "manual";

/** Per-language workflow status (lives on translations, not segments). */
export type TranslationLangStatus = "translated" | "stale" | "approved";

export interface DocumentRow {
  id: string;
  path: string;
  format: DocumentFormat;
  imported_at: string;
  updated_at: string;
}

export interface SegmentRow {
  id: string;
  document_id: string;
  order_index: number;
  source_text: string;
  status: SegmentStatus;
  created_at: string;
  updated_at: string;
}

export interface TranslationRow {
  id: string;
  segment_id: string;
  lang: string;
  target_text: string;
  source: TranslationSource;
  /** Per-language status: translated | stale | approved */
  status: TranslationLangStatus;
  approved: number;
  updated_at: string;
}

export interface TranslationMemoryRow {
  id: string;
  source_text: string;
  target_text: string;
  lang: string;
  usage_count: number;
  updated_at: string;
  /** Whitespace-normalized source_text; used for indexed exact TM lookup. */
  source_norm: string;
}

export interface GlossaryRow {
  id: string;
  source_term: string;
  target_term: string;
  lang: string;
  note: string | null;
  updated_at: string;
}

export interface GlossaryUsageRow {
  glossary_id: string;
  segment_id: string;
}

const SCHEMA_SQL = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  format TEXT NOT NULL CHECK (format IN ('markdown', 'json-i18n', 'po', 'yaml', 'xliff')),
  imported_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS segments (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  order_index INTEGER NOT NULL,
  source_text TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'translated', 'stale', 'approved')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_segments_document_id ON segments(document_id);
CREATE INDEX IF NOT EXISTS idx_segments_status ON segments(status);

CREATE TABLE IF NOT EXISTS translations (
  id TEXT PRIMARY KEY,
  segment_id TEXT NOT NULL REFERENCES segments(id) ON DELETE CASCADE,
  lang TEXT NOT NULL,
  target_text TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('tm-exact', 'tm-fuzzy', 'llm', 'manual')),
  status TEXT NOT NULL DEFAULT 'translated' CHECK (status IN ('translated', 'stale', 'approved')),
  approved INTEGER NOT NULL DEFAULT 0 CHECK (approved IN (0, 1)),
  updated_at TEXT NOT NULL,
  UNIQUE (segment_id, lang)
);

CREATE INDEX IF NOT EXISTS idx_translations_lang ON translations(lang);
CREATE INDEX IF NOT EXISTS idx_translations_status ON translations(status);

CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER NOT NULL PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS translation_memory (
  id TEXT PRIMARY KEY,
  source_text TEXT NOT NULL,
  target_text TEXT NOT NULL,
  lang TEXT NOT NULL,
  usage_count INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  source_norm TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tm_lang_source_unique ON translation_memory(lang, source_text);
-- idx_tm_lang_source_norm_unique is created in ensureTmSourceNorm after source_norm exists.

CREATE TABLE IF NOT EXISTS glossary (
  id TEXT PRIMARY KEY,
  source_term TEXT NOT NULL,
  target_term TEXT NOT NULL,
  lang TEXT NOT NULL,
  note TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE (source_term, lang)
);

CREATE INDEX IF NOT EXISTS idx_glossary_lang ON glossary(lang);

CREATE TABLE IF NOT EXISTS glossary_usage (
  glossary_id TEXT NOT NULL REFERENCES glossary(id) ON DELETE CASCADE,
  segment_id TEXT NOT NULL REFERENCES segments(id) ON DELETE CASCADE,
  PRIMARY KEY (glossary_id, segment_id)
);

CREATE INDEX IF NOT EXISTS idx_glossary_usage_segment ON glossary_usage(segment_id);
`;

export function resolveDbPath(projectRoot: string): string {
  return path.join(projectRoot, DB_RELATIVE_PATH);
}

/**
 * Opens (or creates) the project SQLite database and applies the schema.
 * Creates `.tm/` when missing.
 */

export const SCHEMA_VERSION = 4;

/**
 * Ensure translation_memory.source_norm exists, is backfilled with normalizeText
 * (in JS, not SQL), and is uniquely indexed. When several rows share the same
 * (lang, source_norm), keep the newest updated_at and sum usage_count into it.
 * Leaves idx_tm_lang_source_unique in place.
 */
function ensureTmSourceNorm(db: Database.Database): void {
  const tmCols = db.prepare(`PRAGMA table_info(translation_memory)`).all() as Array<{
    name: string;
  }>;
  if (tmCols.length === 0) return;

  if (!tmCols.some((c) => c.name === "source_norm")) {
    db.exec(`ALTER TABLE translation_memory ADD COLUMN source_norm TEXT`);
  }

  const missing = db
    .prepare(
      `SELECT id, source_text FROM translation_memory WHERE source_norm IS NULL OR source_norm = ''`,
    )
    .all() as Array<{ id: string; source_text: string }>;
  const setNorm = db.prepare(`UPDATE translation_memory SET source_norm = ? WHERE id = ?`);
  for (const row of missing) {
    setNorm.run(normalizeText(row.source_text), row.id);
  }

  // Collapse duplicates that only differ by whitespace after normalizeText.
  const dupGroups = db
    .prepare(
      `SELECT lang, source_norm FROM translation_memory
       GROUP BY lang, source_norm
       HAVING COUNT(*) > 1`,
    )
    .all() as Array<{ lang: string; source_norm: string }>;
  const selectDupes = db.prepare(
    `SELECT id, usage_count, updated_at FROM translation_memory
     WHERE lang = ? AND source_norm = ?
     ORDER BY updated_at DESC, id DESC`,
  );
  const addUsage = db.prepare(
    `UPDATE translation_memory SET usage_count = ? WHERE id = ?`,
  );
  const deleteById = db.prepare(`DELETE FROM translation_memory WHERE id = ?`);

  for (const group of dupGroups) {
    const rows = selectDupes.all(group.lang, group.source_norm) as Array<{
      id: string;
      usage_count: number;
      updated_at: string;
    }>;
    if (rows.length < 2) continue;
    const keep = rows[0]!;
    let totalUsage = 0;
    for (const row of rows) totalUsage += row.usage_count;
    addUsage.run(totalUsage, keep.id);
    for (const row of rows.slice(1)) {
      deleteById.run(row.id);
    }
  }

  try {
    db.exec(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_tm_lang_source_norm_unique
       ON translation_memory(lang, source_norm)`,
    );
  } catch {
    // Should not happen after dedupe; keep open non-fatal like the raw-source index.
  }
}

function ensureSchemaUpgrades(db: Database.Database): void {
  // translations.status (per-language workflow)
  const trCols = db.prepare(`PRAGMA table_info(translations)`).all() as Array<{ name: string }>;
  if (!trCols.some((c) => c.name === "status")) {
    db.exec(`ALTER TABLE translations ADD COLUMN status TEXT NOT NULL DEFAULT 'translated'`);
    db.exec(`
      UPDATE translations
      SET status = CASE WHEN approved = 1 THEN 'approved' ELSE 'translated' END
    `);
  }

  // Unique TM index on raw source_text (ignore failure if duplicates exist).
  // Kept for compatibility; lookups use idx_tm_lang_source_norm_unique instead.
  try {
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_tm_lang_source_unique ON translation_memory(lang, source_text)`);
  } catch {
    // Duplicate TM rows may exist in older DBs; non-fatal.
  }

  ensureTmSourceNorm(db);

  db.exec(`CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL PRIMARY KEY)`);
  const row = db.prepare(`SELECT version FROM schema_version LIMIT 1`).get() as
    | { version: number }
    | undefined;
  if (!row) {
    db.prepare(`INSERT INTO schema_version (version) VALUES (?)`).run(SCHEMA_VERSION);
    return;
  }

  if (row.version < 3) {
    // Recreate documents table so format CHECK accepts po/yaml/xliff.
    db.exec(`
      CREATE TABLE IF NOT EXISTS documents_v3 (
        id TEXT PRIMARY KEY,
        path TEXT NOT NULL UNIQUE,
        format TEXT NOT NULL CHECK (format IN ('markdown', 'json-i18n', 'po', 'yaml', 'xliff')),
        imported_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT OR IGNORE INTO documents_v3 (id, path, format, imported_at, updated_at)
        SELECT id, path, format, imported_at, updated_at FROM documents;
      DROP TABLE documents;
      ALTER TABLE documents_v3 RENAME TO documents;
    `);
    db.prepare(`UPDATE schema_version SET version = ?`).run(3);
    row.version = 3;
  }

  if (row.version < SCHEMA_VERSION) {
    db.prepare(`UPDATE schema_version SET version = ?`).run(SCHEMA_VERSION);
  }
}

export function openDatabase(projectRoot: string): Database.Database {
  const dbPath = resolveDbPath(projectRoot);
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA_SQL);
  ensureSchemaUpgrades(db);
  return db;
}

/** Applies schema migrations/bootstrap to an already-open connection. */
export function migrate(db: Database.Database): void {
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA_SQL);
  ensureSchemaUpgrades(db);
}
