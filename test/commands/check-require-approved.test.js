import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { runCheck } from "../../dist/commands/check.js";
import { openDatabase } from "../../dist/core/db.js";
import { sha256Text } from "../../dist/core/hash.js";
import { DEFAULT_CONFIG, writeConfig } from "../../dist/core/project.js";
import {
  replaceDocumentSegments,
  upsertDocument,
  upsertTranslation,
} from "../../dist/core/repository.js";

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "polygit-check-req-"));
  const prev = process.cwd();
  process.chdir(root);
  writeConfig(root, {
    ...DEFAULT_CONFIG,
    targetLangs: ["fr"],
    contentRoots: ["sources"],
    outputMode: "mirror",
    outputRoot: "outputs",
  });
  fs.mkdirSync(path.join(root, "sources"), { recursive: true });
  fs.mkdirSync(path.join(root, ".tm"), { recursive: true });
  return { root, prev };
}

describe("check --require-approved and placeholders", () => {
  it("passes for approved translations without the flag, fails with --require-approved when unapproved", () => {
    const { root, prev } = setup();
    try {
      const text = "Hello {name}.\n";
      fs.writeFileSync(path.join(root, "sources", "a.md"), text, "utf8");
      const db = openDatabase(root);
      const doc = upsertDocument(db, "sources/a.md", "markdown", sha256Text(text));
      replaceDocumentSegments(db, doc, [
        { orderIndex: 0, sourceText: "Hello {name}." },
      ]);
      const seg = db.prepare(`SELECT id FROM segments`).get();
      upsertTranslation(db, seg.id, "fr", "Bonjour {name}.", "llm", false);
      db.close();
      fs.mkdirSync(path.join(root, "outputs", "fr"), { recursive: true });
      fs.writeFileSync(
        path.join(root, "outputs", "fr", "a.md"),
        "Bonjour {name}.\n",
        "utf8",
      );

      // Without --require-approved: translated (unapproved) is OK if not pending/stale.
      const ok = runCheck({ lang: "fr", quiet: true });
      assert.equal(ok.ok, true);

      assert.throws(
        () => runCheck({ lang: "fr", requireApproved: true, quiet: true }),
        /unapproved=1|check failed/i,
      );
    } finally {
      process.chdir(prev);
    }
  });

  it("fails when placeholders are missing from the translation", () => {
    const { root, prev } = setup();
    try {
      const text = "Hello {name}.\n";
      fs.writeFileSync(path.join(root, "sources", "a.md"), text, "utf8");
      const db = openDatabase(root);
      const doc = upsertDocument(db, "sources/a.md", "markdown", sha256Text(text));
      replaceDocumentSegments(db, doc, [
        { orderIndex: 0, sourceText: "Hello {name}." },
      ]);
      const seg = db.prepare(`SELECT id FROM segments`).get();
      upsertTranslation(db, seg.id, "fr", "Bonjour.", "llm", true);
      db.close();
      fs.mkdirSync(path.join(root, "outputs", "fr"), { recursive: true });
      fs.writeFileSync(path.join(root, "outputs", "fr", "a.md"), "Bonjour.\n", "utf8");

      assert.throws(
        () => runCheck({ lang: "fr", quiet: true }),
        /placeholder_failed=1|check failed/i,
      );
    } finally {
      process.chdir(prev);
    }
  });
});
