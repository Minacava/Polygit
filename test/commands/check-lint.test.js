import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { runCheck } from "../../dist/commands/check.js";
import { runImport } from "../../dist/commands/import.js";
import { runInit } from "../../dist/commands/init.js";
import { writeOutputDocuments } from "../../dist/core/output.js";
import {
  DEFAULT_CONFIG,
  openProjectDb,
  readConfig,
  writeConfig,
} from "../../dist/core/project.js";
import { upsertTranslation } from "../../dist/core/repository.js";

async function withProject(fn, configPatch = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "polygit-check-lint-"));
  const prev = process.cwd();
  process.chdir(root);
  try {
    await runInit();
    writeConfig(root, {
      ...DEFAULT_CONFIG,
      ...readConfig(root),
      targetLangs: ["fr"],
      ...configPatch,
    });
    await fn(root);
  } finally {
    process.chdir(prev);
  }
}

function translateAndWrite(root, lang = "fr") {
  const db = openProjectDb(root);
  try {
    const segs = db.prepare(`SELECT id, document_id FROM segments`).all();
    for (const seg of segs) {
      upsertTranslation(db, seg.id, lang, `T-${seg.id.slice(0, 6)}`, "manual", true);
    }
    const docs = db.prepare(`SELECT path FROM documents`).all().map((r) => r.path);
    writeOutputDocuments(db, root, lang, docs);
  } finally {
    db.close();
  }
}

describe("check as content lint", () => {
  it("fails on NEW files that are not imported", async () => {
    await withProject(async (root) => {
      fs.writeFileSync(path.join(root, "sources", "pricing.md"), "Price list.\n", "utf8");
      let err;
      try {
        runCheck({ lang: "fr", quiet: true });
        assert.fail("expected check to throw");
      } catch (e) {
        err = e;
      }
      assert.ok(err.checkResult);
      assert.deepEqual(err.checkResult.newFiles, ["sources/pricing.md"]);
      assert.match(err.message, /NEW \(not imported\)/);
    });
  });

  it("fails when an imported file changes after import", async () => {
    await withProject(async (root) => {
      fs.writeFileSync(path.join(root, "sources", "intro.md"), "Hello.\n", "utf8");
      runImport("sources/intro.md");
      translateAndWrite(root);

      fs.writeFileSync(path.join(root, "sources", "intro.md"), "Hello edited.\n", "utf8");
      let err;
      try {
        runCheck({ lang: "fr", quiet: true });
        assert.fail("expected check to throw");
      } catch (e) {
        err = e;
      }
      assert.deepEqual(err.checkResult.changedFiles, ["sources/intro.md"]);
      assert.match(err.message, /CHANGED since import/);
    });
  });

  it("fails when an output file is deleted", async () => {
    await withProject(async (root) => {
      fs.writeFileSync(path.join(root, "sources", "faq.md"), "FAQ body.\n", "utf8");
      runImport("sources/faq.md");
      translateAndWrite(root);

      const out = path.join(root, "outputs", "fr", "faq.md");
      assert.ok(fs.existsSync(out));
      fs.unlinkSync(out);

      let err;
      try {
        runCheck({ lang: "fr", quiet: true });
        assert.fail("expected check to throw");
      } catch (e) {
        err = e;
      }
      const docs = err.checkResult.byLang[0].documents;
      assert.ok(docs.some((d) => d.path === "sources/faq.md" && d.missingOutput));
      assert.match(err.message, /missing output file/);
    });
  });

  it("passes when sources and outputs are up to date", async () => {
    await withProject(async (root) => {
      fs.writeFileSync(path.join(root, "sources", "ok.md"), "All good.\n", "utf8");
      runImport("sources/ok.md");
      translateAndWrite(root);
      const result = runCheck({ lang: "fr", quiet: true });
      assert.equal(result.ok, true);
      assert.deepEqual(result.newFiles, []);
      assert.deepEqual(result.changedFiles, []);
    });
  });

  it("does not report sidecar outputs as NEW", async () => {
    await withProject(
      async (root) => {
        fs.mkdirSync(path.join(root, "docs"), { recursive: true });
        fs.writeFileSync(path.join(root, "docs", "intro.md"), "Hello.\n", "utf8");
        // Source whose name looks like a locale but "es" is not a target lang.
        fs.writeFileSync(path.join(root, "docs", "notes.es.md"), "Notes.\n", "utf8");
        runImport("docs/intro.md");
        runImport("docs/notes.es.md");
        translateAndWrite(root, "fr");

        const sidecar = path.join(root, "docs", "intro.fr.md");
        assert.ok(fs.existsSync(sidecar));

        const result = runCheck({ lang: "fr", quiet: true });
        assert.equal(result.ok, true);
        assert.ok(!result.newFiles.includes("docs/intro.fr.md"));
        assert.ok(!result.newFiles.includes("docs/notes.es.md"));
      },
      {
        contentRoots: ["docs"],
        outputMode: "sidecar",
        outputRoot: "outputs",
        targetLangs: ["fr"],
      },
    );
  });

  it("excludes --lang sidecar outputs even when targetLangs is empty", async () => {
    await withProject(
      async (root) => {
        fs.mkdirSync(path.join(root, "docs"), { recursive: true });
        fs.writeFileSync(path.join(root, "docs", "intro.md"), "Hello.\n", "utf8");
        runImport("docs/intro.md");
        translateAndWrite(root, "fr");
        assert.ok(fs.existsSync(path.join(root, "docs", "intro.fr.md")));

        const result = runCheck({ lang: "fr", quiet: true });
        assert.equal(result.ok, true);
        assert.ok(!result.newFiles.includes("docs/intro.fr.md"));
      },
      {
        contentRoots: ["docs"],
        outputMode: "sidecar",
        outputRoot: "outputs",
        targetLangs: [],
      },
    );
  });

  it("errors clearly when targetLangs is empty and --lang is omitted", async () => {
    await withProject(
      async () => {
        assert.throws(
          () => runCheck({ quiet: true }),
          /No languages to check|targetLangs/,
        );
      },
      { targetLangs: [] },
    );
  });

  it("emits JSON when --json is set", async () => {
    await withProject(async (root) => {
      fs.writeFileSync(path.join(root, "sources", "a.md"), "Hi.\n", "utf8");
      runImport("sources/a.md");
      translateAndWrite(root);

      const logs = [];
      const orig = console.log;
      console.log = (...args) => logs.push(args.join(" "));
      try {
        runCheck({ lang: "fr", json: true, quiet: true });
      } finally {
        console.log = orig;
      }
      assert.equal(logs.length, 1);
      const parsed = JSON.parse(logs[0]);
      assert.equal(parsed.ok, true);
      assert.deepEqual(parsed.newFiles, []);
    });
  });
});
