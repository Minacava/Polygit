import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { openDatabase } from "../../dist/core/db.js";
import {
  countApprovedTranslations,
  countUnapprovedTranslations,
  getStatusCounts,
  listSegmentsForTranslate,
  markGlossarySegmentsStale,
  rebuildGlossaryUsage,
  replaceDocumentSegments,
  upsertDocument,
  upsertGlossaryTerm,
  upsertTranslation,
} from "../../dist/core/repository.js";

function tempProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "polygit-repo-"));
  fs.mkdirSync(path.join(root, "sources"), { recursive: true });
  return root;
}

describe("repository", () => {
  it("imports segments and reports status counts", () => {
    const root = tempProject();
    const db = openDatabase(root);
    const doc = upsertDocument(db, "sources/hello.md", "markdown");
    const result = replaceDocumentSegments(db, doc, [
      { orderIndex: 0, sourceText: "Hello world." },
      { orderIndex: 1, sourceText: "Welcome to polygit." },
    ]);
    assert.equal(result.inserted, 2);
    assert.equal(result.unchanged, 0);

    const counts = getStatusCounts(db);
    assert.equal(counts.length, 1);
    assert.equal(counts[0]?.pending, 2);
    assert.equal(counts[0]?.total, 2);
    db.close();
  });

  it("marks glossary-linked segments stale on sync", () => {
    const root = tempProject();
    const db = openDatabase(root);
    const doc = upsertDocument(db, "sources/hello.md", "markdown");
    replaceDocumentSegments(db, doc, [
      { orderIndex: 0, sourceText: "Welcome to polygit." },
      { orderIndex: 1, sourceText: "Unrelated sentence." },
    ]);

    const { row } = upsertGlossaryTerm(db, "polygit", "polygit", "fr", "Product name");
    rebuildGlossaryUsage(db, row.id);
    const staleIds = markGlossarySegmentsStale(db, [row.id]);
    assert.equal(staleIds.length, 1);

    const counts = getStatusCounts(db);
    assert.equal(counts[0]?.stale, 1);
    assert.equal(counts[0]?.pending, 1);
    db.close();
  });

  it("stores translations and updates segment status", () => {
    const root = tempProject();
    const db = openDatabase(root);
    const doc = upsertDocument(db, "sources/hello.md", "markdown");
    const { inserted } = replaceDocumentSegments(db, doc, [
      { orderIndex: 0, sourceText: "Hello." },
    ]);
    assert.equal(inserted, 1);

    const segment = db
      .prepare(`SELECT id FROM segments WHERE document_id = ?`)
      .get(doc.id);
    upsertTranslation(db, segment.id, "fr", "Bonjour.", "llm");
    const counts = getStatusCounts(db);
    assert.equal(counts[0]?.translated, 1);
    assert.equal(counts[0]?.pending, 0);
    db.close();
  });

  it("counts approved vs unapproved translations for publish gate", () => {
    const root = tempProject();
    const db = openDatabase(root);
    const doc = upsertDocument(db, "sources/hello.md", "markdown");
    replaceDocumentSegments(db, doc, [
      { orderIndex: 0, sourceText: "Hello." },
      { orderIndex: 1, sourceText: "World." },
    ]);
    const segments = db
      .prepare(`SELECT id FROM segments WHERE document_id = ? ORDER BY order_index`)
      .all(doc.id);

    upsertTranslation(db, segments[0].id, "fr", "Bonjour.", "llm", false);
    upsertTranslation(db, segments[1].id, "fr", "Monde.", "llm", true);

    assert.equal(countUnapprovedTranslations(db, "fr"), 1);
    assert.equal(countApprovedTranslations(db, "fr"), 1);
    assert.equal(countUnapprovedTranslations(db, "es"), 0);
    assert.equal(countApprovedTranslations(db, "es"), 0);
    db.close();
  });

  it("keeps translations when a paragraph is inserted and reimported", () => {
    const root = tempProject();
    const db = openDatabase(root);
    const doc = upsertDocument(db, "sources/hello.md", "markdown");

    replaceDocumentSegments(db, doc, [
      { orderIndex: 0, sourceText: "Hello world." },
      { orderIndex: 1, sourceText: "Welcome to polygit." },
    ]);
    const before = db
      .prepare(`SELECT id, source_text FROM segments WHERE document_id = ? ORDER BY order_index`)
      .all(doc.id);
    assert.equal(before.length, 2);
    upsertTranslation(db, before[0].id, "fr", "Bonjour le monde.", "llm", true);
    upsertTranslation(db, before[1].id, "fr", "Bienvenue sur polygit.", "llm", true);

    // Insert a new paragraph at the top (shifts order_index of prior segments).
    const result = replaceDocumentSegments(db, doc, [
      { orderIndex: 0, sourceText: "Brand new intro." },
      { orderIndex: 1, sourceText: "Hello world." },
      { orderIndex: 2, sourceText: "Welcome to polygit." },
    ]);
    assert.equal(result.unchanged, 2);
    assert.equal(result.inserted, 1);
    assert.equal(result.removed, 0);

    const hello = db
      .prepare(`SELECT id FROM segments WHERE document_id = ? AND source_text = ?`)
      .get(doc.id, "Hello world.");
    const welcome = db
      .prepare(`SELECT id FROM segments WHERE document_id = ? AND source_text = ?`)
      .get(doc.id, "Welcome to polygit.");
    assert.equal(hello.id, before[0].id);
    assert.equal(welcome.id, before[1].id);

    const trHello = db
      .prepare(`SELECT target_text, status, approved FROM translations WHERE segment_id = ? AND lang = ?`)
      .get(hello.id, "fr");
    const trWelcome = db
      .prepare(`SELECT target_text, status, approved FROM translations WHERE segment_id = ? AND lang = ?`)
      .get(welcome.id, "fr");
    assert.equal(trHello.target_text, "Bonjour le monde.");
    assert.equal(trHello.status, "approved");
    assert.equal(trHello.approved, 1);
    assert.equal(trWelcome.target_text, "Bienvenue sur polygit.");
    assert.equal(trWelcome.status, "approved");
    assert.equal(countApprovedTranslations(db, "fr"), 2);
    db.close();
  });

  it("keeps translations as stale when source text is edited", () => {
    const root = tempProject();
    const db = openDatabase(root);
    const doc = upsertDocument(db, "sources/hello.md", "markdown");
    replaceDocumentSegments(db, doc, [
      { orderIndex: 0, sourceText: "Hello world." },
    ]);
    const seg = db.prepare(`SELECT id FROM segments WHERE document_id = ?`).get(doc.id);
    upsertTranslation(db, seg.id, "fr", "Bonjour le monde.", "llm", true);

    const result = replaceDocumentSegments(db, doc, [
      { orderIndex: 0, sourceText: "Hello brave world." },
    ]);
    assert.equal(result.updated, 1);
    assert.equal(result.removed, 0);
    assert.equal(result.inserted, 0);

    const row = db
      .prepare(
        `SELECT s.id, s.status AS seg_status, t.target_text, t.status AS tr_status, t.approved
         FROM segments s
         JOIN translations t ON t.segment_id = s.id AND t.lang = 'fr'
         WHERE s.document_id = ?`,
      )
      .get(doc.id);
    assert.equal(row.id, seg.id);
    assert.equal(row.target_text, "Bonjour le monde.");
    assert.equal(row.seg_status, "stale");
    assert.equal(row.tr_status, "stale");
    assert.equal(row.approved, 0);
    db.close();
  });

  it("lists segments missing a translation for the target lang (multi-lang)", () => {
    const root = tempProject();
    const db = openDatabase(root);
    const doc = upsertDocument(db, "sources/hello.md", "markdown");
    replaceDocumentSegments(db, doc, [
      { orderIndex: 0, sourceText: "Hello." },
      { orderIndex: 1, sourceText: "World." },
    ]);
    const segments = db
      .prepare(`SELECT id FROM segments WHERE document_id = ? ORDER BY order_index`)
      .all(doc.id);

    assert.equal(listSegmentsForTranslate(db, { lang: "fr" }).length, 2);
    assert.equal(listSegmentsForTranslate(db, { lang: "es" }).length, 2);

    upsertTranslation(db, segments[0].id, "fr", "Bonjour.", "llm", true);
    upsertTranslation(db, segments[1].id, "fr", "Monde.", "llm", true);

    // After FR is done, ES still needs work; FR has nothing left.
    assert.equal(listSegmentsForTranslate(db, { lang: "fr" }).length, 0);
    assert.equal(listSegmentsForTranslate(db, { lang: "es" }).length, 2);

    // Stale is per-language: FR glossary sync must not force ES retranslation.
    const { row } = upsertGlossaryTerm(db, "Hello", "Bonjour", "fr");
    rebuildGlossaryUsage(db, row.id);
    markGlossarySegmentsStale(db, [row.id], "fr");
    assert.equal(listSegmentsForTranslate(db, { lang: "fr" }).length, 1);
    assert.equal(listSegmentsForTranslate(db, { lang: "es" }).length, 2);

    // Stale FR clears approval on the affected segment → publish gate blocks
    assert.equal(countUnapprovedTranslations(db, "fr"), 1);
    assert.equal(countApprovedTranslations(db, "fr"), 1);
    db.close();
  });
});
