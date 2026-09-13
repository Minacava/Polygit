import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { runInit } from "../../dist/commands/init.js";
import { runPublish } from "../../dist/commands/publish.js";
import { openDatabase } from "../../dist/core/db.js";
import {
  markGlossarySegmentsStale,
  rebuildGlossaryUsage,
  replaceDocumentSegments,
  upsertDocument,
  upsertGlossaryTerm,
  upsertTranslation,
} from "../../dist/core/repository.js";

async function setupProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "polygit-publish-"));
  const prev = process.cwd();
  process.chdir(root);
  await runInit();
  return { root, prev };
}

describe("publish gate", () => {
  it("requires --lang", async () => {
    const { prev } = await setupProject();
    try {
      await assert.rejects(() => runPublish({ yes: true }), /Language is required/i);
    } finally {
      process.chdir(prev);
    }
  });

  it("blocks when translations are unapproved", async () => {
    const { root, prev } = await setupProject();
    try {
      const db = openDatabase(root);
      fs.mkdirSync(path.join(root, "sources"), { recursive: true });
      fs.writeFileSync(path.join(root, "sources", "a.md"), "Hello.\n", "utf8");
      const doc = upsertDocument(db, "sources/a.md", "markdown");
      replaceDocumentSegments(db, doc, [{ orderIndex: 0, sourceText: "Hello." }]);
      const seg = db.prepare(`SELECT id FROM segments`).get();
      upsertTranslation(db, seg.id, "fr", "Bonjour.", "llm", false);
      db.close();

      await assert.rejects(
        () => runPublish({ lang: "fr", yes: true }),
        /not locally approved/i,
      );
    } finally {
      process.chdir(prev);
    }
  });

  it("blocks after glossary stale clears approval", async () => {
    const { root, prev } = await setupProject();
    try {
      const db = openDatabase(root);
      fs.mkdirSync(path.join(root, "sources"), { recursive: true });
      fs.writeFileSync(path.join(root, "sources", "a.md"), "Hello Polygit.\n", "utf8");
      const doc = upsertDocument(db, "sources/a.md", "markdown");
      replaceDocumentSegments(db, doc, [{ orderIndex: 0, sourceText: "Hello Polygit." }]);
      const seg = db.prepare(`SELECT id FROM segments`).get();
      upsertTranslation(db, seg.id, "fr", "Bonjour Polygit.", "llm", true);
      const { row } = upsertGlossaryTerm(db, "Polygit", "Polygit", "fr");
      rebuildGlossaryUsage(db, row.id);
      markGlossarySegmentsStale(db, [row.id], "fr");
      db.close();

      await assert.rejects(
        () => runPublish({ lang: "fr", yes: true }),
        /not locally approved|No locally approved/i,
      );
    } finally {
      process.chdir(prev);
    }
  });
});
