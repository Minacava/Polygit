import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { describe, it } from "node:test";
import { DB_RELATIVE_PATH, openDatabase, SCHEMA_VERSION } from "../../dist/core/db.js";
import {
  computeStyleHash,
  resolveStyle,
  styleHashesMatch,
} from "../../dist/core/style.js";

function tempProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "polygit-style-hash-"));
  fs.mkdirSync(path.join(root, ".tm"), { recursive: true });
  return root;
}

/** Seed a schema-v5 DB with translations + TM and no style_hash columns. */
function seedSchemaV5(root) {
  const dbPath = path.join(root, DB_RELATIVE_PATH);
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE documents (
      id TEXT PRIMARY KEY,
      path TEXT NOT NULL UNIQUE,
      format TEXT NOT NULL CHECK (format IN ('markdown', 'json-i18n', 'po', 'yaml', 'xliff')),
      imported_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      content_hash TEXT
    );
    CREATE TABLE segments (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      order_index INTEGER NOT NULL,
      source_text TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE translations (
      id TEXT PRIMARY KEY,
      segment_id TEXT NOT NULL REFERENCES segments(id) ON DELETE CASCADE,
      lang TEXT NOT NULL,
      target_text TEXT NOT NULL,
      source TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'translated',
      approved INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      UNIQUE (segment_id, lang)
    );
    CREATE TABLE translation_memory (
      id TEXT PRIMARY KEY,
      source_text TEXT NOT NULL,
      target_text TEXT NOT NULL,
      lang TEXT NOT NULL,
      usage_count INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL,
      source_norm TEXT NOT NULL
    );
    CREATE TABLE schema_version (version INTEGER NOT NULL PRIMARY KEY);
    INSERT INTO schema_version (version) VALUES (5);
  `);
  db.prepare(
    `INSERT INTO documents (id, path, format, imported_at, updated_at, content_hash)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run("doc-1", "sources/a.md", "markdown", "2024-01-01T00:00:00.000Z", "2024-01-01T00:00:00.000Z", "abc");
  db.prepare(
    `INSERT INTO segments (id, document_id, order_index, source_text, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run("seg-1", "doc-1", 0, "Hello", "translated", "2024-01-01T00:00:00.000Z", "2024-01-01T00:00:00.000Z");
  db.prepare(
    `INSERT INTO translations (id, segment_id, lang, target_text, source, status, approved, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run("tr-1", "seg-1", "fr", "Bonjour", "llm", "approved", 1, "2024-01-01T00:00:00.000Z");
  db.prepare(
    `INSERT INTO translation_memory
       (id, source_text, target_text, lang, usage_count, updated_at, source_norm)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run("tm-1", "Hello", "Bonjour", "fr", 3, "2024-01-01T00:00:00.000Z", "Hello");
  db.close();
}

describe("style_hash migration and fingerprint", () => {
  it("upgrades schema v5 to v6 without losing translations or TM", () => {
    const root = tempProject();
    seedSchemaV5(root);

    const db = openDatabase(root);
    assert.equal(
      db.prepare(`SELECT version FROM schema_version LIMIT 1`).get().version,
      SCHEMA_VERSION,
    );
    assert.equal(SCHEMA_VERSION, 6);

    const trCols = db
      .prepare(`PRAGMA table_info(translations)`)
      .all()
      .map((c) => c.name);
    const tmCols = db
      .prepare(`PRAGMA table_info(translation_memory)`)
      .all()
      .map((c) => c.name);
    assert.ok(trCols.includes("style_hash"));
    assert.ok(tmCols.includes("style_hash"));

    const tr = db.prepare(`SELECT * FROM translations WHERE id = ?`).get("tr-1");
    assert.equal(tr.target_text, "Bonjour");
    assert.equal(tr.approved, 1);
    assert.equal(tr.status, "approved");
    assert.equal(tr.style_hash, null);

    const tm = db.prepare(`SELECT * FROM translation_memory WHERE id = ?`).get("tm-1");
    assert.equal(tm.target_text, "Bonjour");
    assert.equal(tm.usage_count, 3);
    assert.equal(tm.style_hash, null);

    db.close();
  });

  it("computeStyleHash is null without style and stable with style", () => {
    assert.equal(computeStyleHash(undefined), null);
    const a = computeStyleHash(resolveStyle({ preset: "startup" }));
    const b = computeStyleHash(resolveStyle({ preset: "startup", formality: "auto" }));
    const c = computeStyleHash(resolveStyle({ preset: "academic" }));
    assert.equal(typeof a, "string");
    assert.equal(a.length, 64);
    assert.equal(a, b);
    assert.notEqual(a, c);
    assert.equal(styleHashesMatch(null, null), true);
    assert.equal(styleHashesMatch(a, a), true);
    assert.equal(styleHashesMatch(a, null), false);
    assert.equal(styleHashesMatch(null, a), false);
  });
});
