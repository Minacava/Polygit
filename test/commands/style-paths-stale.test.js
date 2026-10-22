import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { runCheck } from "../../dist/commands/check.js";
import { runImport } from "../../dist/commands/import.js";
import { runInit } from "../../dist/commands/init.js";
import { runTranslate } from "../../dist/commands/translate.js";
import { openDatabase } from "../../dist/core/db.js";
import {
  computeStyleHash,
  readConfig,
  resolveStyleForDocument,
  writeConfig,
} from "../../dist/core/project.js";

async function withProject(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "polygit-style-paths-"));
  const prev = process.cwd();
  process.chdir(root);
  try {
    await runInit(root, {
      sourceLang: "en",
      targetLangs: "fr",
      content: "sources,docs",
      output: "outputs",
    });
    fs.mkdirSync(path.join(root, "docs", "papers"), { recursive: true });
    fs.writeFileSync(path.join(root, "sources", "app.md"), "Hello product.\n", "utf8");
    fs.writeFileSync(path.join(root, "docs", "papers", "note.md"), "Hello paper.\n", "utf8");
    runImport("sources/app.md", { format: "markdown" });
    runImport("docs/papers/note.md", { format: "markdown" });
    await fn(root);
  } finally {
    process.chdir(prev);
  }
}

describe("style paths stale only for affected docs", () => {
  it("marks only path-affected translations stale when folder style differs", async () => {
    await withProject(async (root) => {
      writeConfig(root, {
        ...readConfig(root),
        style: {
          preset: "startup",
          paths: { "docs/papers": { preset: "academic" } },
        },
      });

      const seen = [];
      const mock = {
        name: "ollama",
        async translateSegment(text, _s, _l, ctx) {
          seen.push({ text, style: ctx?.style?.preset, path: ctx?.documentPath });
          return `T:${text}`;
        },
      };
      await runTranslate("fr", {
        providerInstance: mock,
        provider: "ollama",
        noBranch: true,
      });

      assert.ok(seen.some((s) => s.path === "sources/app.md" && s.style === "startup"));
      assert.ok(seen.some((s) => s.path === "docs/papers/note.md" && s.style === "academic"));

      const startupH = computeStyleHash(
        resolveStyleForDocument(readConfig(root).style, {
          documentPath: "sources/app.md",
          lang: "fr",
        }),
      );
      const academicH = computeStyleHash(
        resolveStyleForDocument(readConfig(root).style, {
          documentPath: "docs/papers/note.md",
          lang: "fr",
        }),
      );
      assert.notEqual(startupH, academicH);

      let db = openDatabase(root);
      const byPath = Object.fromEntries(
        db
          .prepare(
            `SELECT d.path AS path, t.style_hash AS style_hash, t.status AS status
             FROM translations t
             JOIN segments s ON s.id = t.segment_id
             JOIN documents d ON d.id = s.document_id
             WHERE t.lang = 'fr'`,
          )
          .all()
          .map((r) => [r.path, r]),
      );
      assert.equal(byPath["sources/app.md"].style_hash, startupH);
      assert.equal(byPath["docs/papers/note.md"].style_hash, academicH);
      db.close();

      // Change only the papers overlay.
      writeConfig(root, {
        ...readConfig(root),
        style: {
          preset: "startup",
          paths: { "docs/papers": { preset: "legal" } },
        },
      });

      assert.throws(() => runCheck({ lang: "fr" }), /style changed/);

      db = openDatabase(root);
      const rows = db
        .prepare(
          `SELECT d.path AS path, t.status AS status
           FROM translations t
           JOIN segments s ON s.id = t.segment_id
           JOIN documents d ON d.id = s.document_id
           WHERE t.lang = 'fr'`,
        )
        .all();
      const statusByPath = Object.fromEntries(rows.map((r) => [r.path, r.status]));
      assert.equal(statusByPath["sources/app.md"], "translated");
      assert.equal(statusByPath["docs/papers/note.md"], "stale");
      db.close();
    });
  });
});
