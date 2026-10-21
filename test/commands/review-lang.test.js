import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { runInit } from "../../dist/commands/init.js";
import { REVIEW_KEY_TABLE, runReview } from "../../dist/commands/review.js";
import { openDatabase } from "../../dist/core/db.js";
import {
  countApprovedTranslations,
  countUnapprovedTranslations,
  replaceDocumentSegments,
  upsertDocument,
  upsertTranslation,
} from "../../dist/core/repository.js";

describe("review command", () => {
  it("documents a/A/e/s/q keys in REVIEW_KEY_TABLE", () => {
    assert.match(REVIEW_KEY_TABLE, /\ba\b.*approve/i);
    assert.match(REVIEW_KEY_TABLE, /\bA\b.*approve-all/i);
    assert.match(REVIEW_KEY_TABLE, /\be\b.*edit/i);
    assert.match(REVIEW_KEY_TABLE, /\bs\b.*skip/i);
    assert.match(REVIEW_KEY_TABLE, /\bq\b.*quit/i);
  });

  it("requires --lang", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "polygit-review-"));
    const prev = process.cwd();
    process.chdir(root);
    try {
      await runInit();
      await assert.rejects(() => runReview({}), /Language is required/i);
    } finally {
      process.chdir(prev);
    }
  });

  it("approves all segments with TARGET via --approve-all", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "polygit-review-all-"));
    const prev = process.cwd();
    process.chdir(root);
    try {
      await runInit();
      const db = openDatabase(root);
      fs.mkdirSync(path.join(root, "sources"), { recursive: true });
      fs.writeFileSync(path.join(root, "sources", "a.md"), "Hello.\nWorld.\n", "utf8");
      const doc = upsertDocument(db, "sources/a.md", "markdown");
      replaceDocumentSegments(db, doc, [
        { orderIndex: 0, sourceText: "Hello." },
        { orderIndex: 1, sourceText: "World." },
      ]);
      const segs = db.prepare(`SELECT id FROM segments ORDER BY order_index`).all();
      upsertTranslation(db, segs[0].id, "fr", "Bonjour.", "llm", false);
      upsertTranslation(db, segs[1].id, "fr", "Monde.", "llm", false);
      assert.equal(countUnapprovedTranslations(db, "fr"), 2);
      db.close();

      await runReview({ lang: "fr", approveAll: true, noBranch: true });

      const db2 = openDatabase(root);
      assert.equal(countUnapprovedTranslations(db2, "fr"), 0);
      assert.equal(countApprovedTranslations(db2, "fr"), 2);
      db2.close();
      assert.ok(fs.existsSync(path.join(root, "outputs", "fr", "a.md")));
    } finally {
      process.chdir(prev);
    }
  });
});
