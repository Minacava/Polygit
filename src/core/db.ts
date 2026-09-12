import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

/** Relative path of the on-disk SQLite file inside a Polygit project. */
export const DB_RELATIVE_PATH = path.join(".tm", "db.sqlite");

export type DocumentFormat = "markdown" | "json-i18n";

export type SegmentStatus = "pending" | "translated" | "stale" | "approved";

export type TranslationSource = "tm-exact" | "tm-fuzzy" | "llm" | "manual";

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
  format TEXT NOT NULL CHECK (format IN ('markdown', 'json-i18n')),
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
  approved INTEGER NOT NULL DEFAULT 0 CHECK (approved IN (0, 1)),
  updated_at TEXT NOT NULL,
  UNIQUE (segment_id, lang)
);

CREATE INDEX IF NOT EXISTS idx_translations_lang ON translations(lang);

CREATE TABLE IF NOT EXISTS translation_memory (
  id TEXT PRIMARY KEY,
  source_text TEXT NOT NULL,
  target_text TEXT NOT NULL,
  lang TEXT NOT NULL,
  usage_count INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tm_lang_source ON translation_memory(lang, source_text);

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
export function openDatabase(projectRoot: string): Database.Database {
  const dbPath = resolveDbPath(projectRoot);
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA_SQL);
  return db;
}

/** Applies schema migrations/bootstrap to an already-open connection. */
export function migrate(db: Database.Database): void {
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA_SQL);
}
