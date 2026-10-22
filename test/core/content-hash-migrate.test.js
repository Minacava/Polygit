import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { describe, it } from "node:test";
import { DB_RELATIVE_PATH, openDatabase, SCHEMA_VERSION } from "../../dist/core/db.js";

function tempProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "polygit-hash-migrate-"));
  fs.mkdirSync(path.join(root, ".tm"), { recursive: true });
  return root;
}

/** Seed a schema-v4 DB (source_norm era) with a documents row and no content_hash. */
function seedSchemaV4(root) {
  const dbPath = path.join(root, DB_RELATIVE_PATH);
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE documents (
      id TEXT PRIMARY KEY,
      path TEXT NOT NULL UNIQUE,
      format TEXT NOT NULL CHECK (format IN ('markdown', 'json-i18n', 'po', 'yaml', 'xliff')),
      imported_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
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
    CREATE UNIQUE INDEX idx_tm_lang_source_norm_unique
      ON translation_memory(lang, source_norm);
    CREATE TABLE schema_version (version INTEGER NOT NULL PRIMARY KEY);
    INSERT INTO schema_version (version) VALUES (4);
  `);
  db.prepare(
    `INSERT INTO documents (id, path, format, imported_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run("doc-1", "sources/keep.md", "markdown", "2024-01-01T00:00:00.000Z", "2024-01-01T00:00:00.000Z");
  db.prepare(
    `INSERT INTO translation_memory
       (id, source_text, target_text, lang, usage_count, updated_at, source_norm)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run("tm-1", "Hello", "Hola", "es", 2, "2024-01-01T00:00:00.000Z", "Hello");
  db.close();
}

describe("documents.content_hash migration", () => {
  it("upgrades schema v4 to v5 without losing documents or TM rows", () => {
    const root = tempProject();
    seedSchemaV4(root);

    const db = openDatabase(root);
    const version = db.prepare(`SELECT version FROM schema_version LIMIT 1`).get();
    assert.equal(version.version, SCHEMA_VERSION);
    assert.ok(SCHEMA_VERSION >= 5);

    const cols = db
      .prepare(`PRAGMA table_info(documents)`)
      .all()
      .map((c) => c.name);
    assert.ok(cols.includes("content_hash"));

    const doc = db.prepare(`SELECT * FROM documents WHERE id = ?`).get("doc-1");
    assert.equal(doc.path, "sources/keep.md");
    assert.equal(doc.format, "markdown");
    assert.equal(doc.content_hash, null);

    const tm = db.prepare(`SELECT * FROM translation_memory WHERE id = ?`).get("tm-1");
    assert.equal(tm.target_text, "Hola");
    assert.equal(tm.source_norm, "Hello");
    assert.equal(tm.usage_count, 2);

    db.close();

    // Idempotent: opening again must not fail or wipe data.
    const db2 = openDatabase(root);
    assert.equal(
      db2.prepare(`SELECT version FROM schema_version LIMIT 1`).get().version,
      SCHEMA_VERSION,
    );
    assert.equal(
      db2.prepare(`SELECT path FROM documents WHERE id = ?`).get("doc-1").path,
      "sources/keep.md",
    );
    assert.equal(
      db2.prepare(`SELECT source_norm FROM translation_memory WHERE id = ?`).get("tm-1")
        .source_norm,
      "Hello",
    );
    db2.close();
  });

  it("fresh databases include content_hash and source_norm", () => {
    const root = tempProject();
    const db = openDatabase(root);
    const docCols = db
      .prepare(`PRAGMA table_info(documents)`)
      .all()
      .map((c) => c.name);
    const tmCols = db
      .prepare(`PRAGMA table_info(translation_memory)`)
      .all()
      .map((c) => c.name);
    assert.ok(docCols.includes("content_hash"));
    assert.ok(tmCols.includes("source_norm"));
    assert.equal(
      db.prepare(`SELECT version FROM schema_version LIMIT 1`).get().version,
      SCHEMA_VERSION,
    );
    db.close();
  });
});
