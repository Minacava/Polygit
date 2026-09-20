import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { openDatabase } from "../../dist/core/db.js";
import { writeOutputDocuments } from "../../dist/core/output.js";
import { DEFAULT_CONFIG, writeConfig } from "../../dist/core/project.js";
import {
  replaceDocumentSegments,
  upsertDocument,
  upsertTranslation,
} from "../../dist/core/repository.js";

function seedDoc(root, sourceRel, text = "Hello world.\n") {
  const abs = path.join(root, ...sourceRel.split("/"));
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text, "utf8");
  const db = openDatabase(root);
  const doc = upsertDocument(db, sourceRel, "markdown");
  replaceDocumentSegments(db, doc, [{ orderIndex: 0, sourceText: "Hello world." }]);
  const segment = db
    .prepare(`SELECT id FROM segments WHERE document_id = ?`)
    .get(doc.id);
  upsertTranslation(db, segment.id, "fr", "Bonjour le monde.", "llm", false);
  return { db, doc };
}

describe("writeOutputDocuments", () => {
  it("rewrites outputs after an approved edit (review → disk)", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "polygit-output-"));
    writeConfig(root, { ...DEFAULT_CONFIG });
    const { db } = seedDoc(root, "sources/hello.md");

    let written = writeOutputDocuments(db, root, "fr", ["sources/hello.md"]);
    assert.deepEqual(written, ["outputs/fr/hello.md"]);
    assert.match(
      fs.readFileSync(path.join(root, "outputs", "fr", "hello.md"), "utf8"),
      /Bonjour le monde/,
    );

    const segment = db.prepare(`SELECT id FROM segments LIMIT 1`).get();
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

  it("writes sidecar and in-place-locale layouts", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "polygit-output-modes-"));
    writeConfig(root, {
      ...DEFAULT_CONFIG,
      contentRoots: ["docs"],
      outputMode: "sidecar",
      outputRoot: "outputs",
    });
    let { db } = seedDoc(root, "docs/getting-started.md");
    let written = writeOutputDocuments(db, root, "fr", ["docs/getting-started.md"]);
    assert.deepEqual(written, ["docs/getting-started.fr.md"]);
    assert.ok(fs.existsSync(path.join(root, "docs", "getting-started.fr.md")));
    db.close();

    writeConfig(root, {
      ...DEFAULT_CONFIG,
      contentRoots: ["docs"],
      outputMode: "in-place-locale",
      outputRoot: "outputs",
    });
    ({ db } = seedDoc(root, "docs/guide.md", "Hello world.\n"));
    written = writeOutputDocuments(db, root, "fr", ["docs/guide.md"]);
    assert.deepEqual(written, ["docs/fr/guide.md"]);
    assert.ok(fs.existsSync(path.join(root, "docs", "fr", "guide.md")));
    db.close();
  });

  it("writes mirror with a custom outputRoot", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "polygit-output-mirror-"));
    writeConfig(root, {
      ...DEFAULT_CONFIG,
      contentRoots: ["docs"],
      outputMode: "mirror",
      outputRoot: "locales",
    });
    const { db } = seedDoc(root, "docs/intro.md");
    const written = writeOutputDocuments(db, root, "fr", ["docs/intro.md"]);
    assert.deepEqual(written, ["locales/fr/intro.md"]);
    db.close();
  });
});
