import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { openDatabase } from "../../dist/core/db.js";
import { writeOutputDocuments } from "../../dist/core/output.js";
import {
  replaceDocumentSegments,
  upsertDocument,
  upsertTranslation,
} from "../../dist/core/repository.js";

describe("writeOutputDocuments", () => {
  it("rewrites outputs after an approved edit (review → disk)", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "polygit-output-"));
    fs.mkdirSync(path.join(root, "sources"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "sources", "hello.md"),
      "Hello world.\n",
      "utf8",
    );

    const db = openDatabase(root);
    const doc = upsertDocument(db, "sources/hello.md", "markdown");
    replaceDocumentSegments(db, doc, [
      { orderIndex: 0, sourceText: "Hello world." },
    ]);
    const segment = db
      .prepare(`SELECT id FROM segments WHERE document_id = ?`)
      .get(doc.id);

    upsertTranslation(db, segment.id, "fr", "Bonjour le monde.", "llm", false);
    let written = writeOutputDocuments(db, root, "fr", ["sources/hello.md"]);
    assert.deepEqual(written, ["outputs/fr/hello.md"]);
    assert.match(
      fs.readFileSync(path.join(root, "outputs", "fr", "hello.md"), "utf8"),
      /Bonjour le monde/,
    );

    // Simulate review edit + approve, then regenerate touched docs.
    upsertTranslation(db, segment.id, "fr", "Salut le monde.", "manual", true);
    written = writeOutputDocuments(db, root, "fr", ["sources/hello.md"]);
    assert.deepEqual(written, ["outputs/fr/hello.md"]);
    assert.match(
      fs.readFileSync(path.join(root, "outputs", "fr", "hello.md"), "utf8"),
      /Salut le monde/,
    );
    assert.doesNotMatch(
      fs.readFileSync(path.join(root, "outputs", "fr", "hello.md"), "utf8"),
      /Bonjour/,
    );
    db.close();
  });
});
