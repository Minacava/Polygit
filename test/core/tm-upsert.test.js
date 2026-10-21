import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { describe, it } from "node:test";
import { DB_RELATIVE_PATH, openDatabase, SCHEMA_VERSION } from "../../dist/core/db.js";
import { upsertTranslationMemory } from "../../dist/core/repository.js";
import { normalizeText } from "../../dist/core/segmenter.js";

function tempProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "polygit-tm-upsert-"));
  fs.mkdirSync(path.join(root, ".tm"), { recursive: true });
  return root;
}

/** Build a schema-v3 SQLite file with TM rows that collide after normalizeText. */
function seedSchemaV3WithDupes(root) {
  const dbPath = path.join(root, DB_RELATIVE_PATH);
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE translation_memory (
      id TEXT PRIMARY KEY,
      source_text TEXT NOT NULL,
      target_text TEXT NOT NULL,
      lang TEXT NOT NULL,
      usage_count INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX idx_tm_lang_source_unique
      ON translation_memory(lang, source_text);
    CREATE TABLE schema_version (version INTEGER NOT NULL PRIMARY KEY);
    INSERT INTO schema_version (version) VALUES (3);
  `);
  db.prepare(
    `INSERT INTO translation_memory (id, source_text, target_text, lang, usage_count, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run("tm-old", "Hello", "Hola-old", "es", 2, "2020-01-01T00:00:00.000Z");
  db.prepare(
    `INSERT INTO translation_memory (id, source_text, target_text, lang, usage_count, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run("tm-new", " Hello ", "Hola-new", "es", 3, "2024-06-01T12:00:00.000Z");
  db.prepare(
    `INSERT INTO translation_memory (id, source_text, target_text, lang, usage_count, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run("tm-other", "Bye", "Adiós", "es", 1, "2023-01-01T00:00:00.000Z");
  db.close();
}

describe("translation memory upsert indexing", () => {
  it("uses idx_tm_lang_source_norm_unique for exact lookup", () => {
    const root = tempProject();
    const db = openDatabase(root);
    upsertTranslationMemory(db, "Hello", "Hola", "es");

    const plan = db
      .prepare(
        `EXPLAIN QUERY PLAN
         SELECT id FROM translation_memory WHERE lang = ? AND source_norm = ?`,
      )
      .all("es", normalizeText("Hello"));
    const detail = plan.map((row) => row.detail).join("\n");
    assert.match(detail, /idx_tm_lang_source_norm_unique/);

    const indexes = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'index'`)
      .all()
      .map((row) => row.name);
    assert.ok(indexes.includes("idx_tm_lang_source_unique"));
    assert.ok(indexes.includes("idx_tm_lang_source_norm_unique"));
    db.close();
  });

  it("updates the same row when sources normalize equally", () => {
    const root = tempProject();
    const db = openDatabase(root);
    upsertTranslationMemory(db, "Hello", "Hola", "es");
    upsertTranslationMemory(db, " Hello ", "Hola!", "es");

    const rows = db.prepare(`SELECT * FROM translation_memory WHERE lang = ?`).all("es");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].source_norm, "Hello");
    assert.equal(rows[0].target_text, "Hola!");
    assert.equal(rows[0].usage_count, 2);
    db.close();
  });

  it("migrates schema v3 TM duplicates to v4 without data loss", () => {
    const root = tempProject();
    seedSchemaV3WithDupes(root);

    const db = openDatabase(root);
    const version = db.prepare(`SELECT version FROM schema_version LIMIT 1`).get();
    assert.equal(version.version, SCHEMA_VERSION);

    const cols = db
      .prepare(`PRAGMA table_info(translation_memory)`)
      .all()
      .map((c) => c.name);
    assert.ok(cols.includes("source_norm"));

    const rows = db
      .prepare(`SELECT * FROM translation_memory WHERE lang = ? ORDER BY source_norm`)
      .all("es");
    assert.equal(rows.length, 2);

    const hello = rows.find((r) => r.source_norm === "Hello");
    assert.ok(hello);
    // Newest updated_at kept; usage_count summed (2 + 3).
    assert.equal(hello.id, "tm-new");
    assert.equal(hello.target_text, "Hola-new");
    assert.equal(hello.usage_count, 5);
    assert.equal(hello.source_norm, normalizeText(" Hello "));

    const bye = rows.find((r) => r.source_norm === "Bye");
    assert.ok(bye);
    assert.equal(bye.usage_count, 1);

    const indexes = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'index'`)
      .all()
      .map((row) => row.name);
    assert.ok(indexes.includes("idx_tm_lang_source_unique"));
    assert.ok(indexes.includes("idx_tm_lang_source_norm_unique"));
    db.close();
  });
});
