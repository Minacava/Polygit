import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { runCheck } from "../../dist/commands/check.js";
import { runConfigSet } from "../../dist/commands/config.js";
import { runImport } from "../../dist/commands/import.js";
import { runInit } from "../../dist/commands/init.js";
import { runTranslate } from "../../dist/commands/translate.js";
import { openDatabase } from "../../dist/core/db.js";
import {
  computeStyleHash,
  DEFAULT_CONFIG,
  readConfig,
  resolveStyle,
  writeConfig,
} from "../../dist/core/project.js";
import {
  getTmEntries,
  listSegmentsForTranslate,
  markStyleHashStale,
  upsertTranslation,
  upsertTranslationMemory,
} from "../../dist/core/repository.js";

async function withProject(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "polygit-style-stale-"));
  const prev = process.cwd();
  process.chdir(root);
  try {
    await runInit(root, {
      sourceLang: "en",
      targetLangs: "fr",
      content: "sources",
      output: "outputs",
    });
    fs.writeFileSync(path.join(root, "sources", "hello.md"), "Hello world.\n", "utf8");
    runImport("sources/hello.md", { format: "markdown" });
    await fn(root);
  } finally {
    process.chdir(prev);
  }
}

describe("style hash stale and TM gating", () => {
  it("changing preset marks translations stale; retranslate leaves them unapproved", async () => {
    await withProject(async (root) => {
      const startupHash = computeStyleHash(resolveStyle({ preset: "startup" }));
      writeConfig(root, {
        ...readConfig(root),
        style: { preset: "startup", formality: "auto" },
      });

      const mock = {
        name: "ollama",
        async translateSegment(text) {
          return `FR:${text}`;
        },
      };
      await runTranslate("fr", {
        providerInstance: mock,
        provider: "ollama",
        noBranch: true,
      });

      let db = openDatabase(root);
      let tr = db
        .prepare(`SELECT status, approved, style_hash FROM translations WHERE lang = ?`)
        .get("fr");
      assert.equal(tr.status, "translated");
      assert.equal(tr.approved, 0);
      assert.equal(tr.style_hash, startupHash);
      // Approve in place to verify approved text survives until retranslate.
      db.prepare(`UPDATE translations SET status = 'approved', approved = 1`).run();
      const approvedText = db
        .prepare(`SELECT target_text FROM translations WHERE lang = ?`)
        .get("fr").target_text;
      db.close();

      runConfigSet("style.preset", "academic");

      db = openDatabase(root);
      tr = db
        .prepare(`SELECT status, approved, target_text, style_hash FROM translations WHERE lang = ?`)
        .get("fr");
      assert.equal(tr.status, "stale");
      assert.equal(tr.approved, 0);
      assert.equal(tr.target_text, approvedText);
      assert.equal(listSegmentsForTranslate(db, { lang: "fr" }).length, 1);
      db.close();

      assert.throws(() => runCheck({ lang: "fr" }), /style changed/);

      let llmCalls = 0;
      const mock2 = {
        name: "ollama",
        async translateSegment(text) {
          llmCalls += 1;
          return `ACADEMIC:${text}`;
        },
      };
      await runTranslate("fr", {
        providerInstance: mock2,
        provider: "ollama",
        noBranch: true,
      });
      assert.equal(llmCalls, 1);

      db = openDatabase(root);
      tr = db
        .prepare(`SELECT status, approved, target_text, style_hash FROM translations WHERE lang = ?`)
        .get("fr");
      assert.equal(tr.status, "translated");
      assert.equal(tr.approved, 0);
      assert.match(tr.target_text, /^ACADEMIC:/);
      assert.equal(
        tr.style_hash,
        computeStyleHash(resolveStyle({ preset: "academic", formality: "auto" })),
      );
      db.close();
    });
  });

  it("exact TM with a different style_hash is not reused", async () => {
    await withProject(async (root) => {
      const oldHash = computeStyleHash(resolveStyle({ preset: "startup" }));
      const newHash = computeStyleHash(resolveStyle({ preset: "academic" }));
      writeConfig(root, {
        ...readConfig(root),
        style: { preset: "academic", formality: "auto" },
      });

      const db = openDatabase(root);
      upsertTranslationMemory(db, "Hello world.", "VIEJO estilo", "fr", oldHash);
      db.close();

      let llmCalls = 0;
      const mock = {
        name: "ollama",
        async translateSegment(text) {
          llmCalls += 1;
          return `NEW:${text}`;
        },
      };
      await runTranslate("fr", {
        providerInstance: mock,
        provider: "ollama",
        noBranch: true,
      });
      assert.equal(llmCalls, 1);

      const db2 = openDatabase(root);
      const tr = db2
        .prepare(`SELECT target_text, style_hash FROM translations WHERE lang = ?`)
        .get("fr");
      assert.match(tr.target_text, /^NEW:/);
      assert.equal(tr.style_hash, newHash);
      const tm = getTmEntries(db2, "fr");
      assert.ok(tm.some((e) => e.style_hash === newHash));
      db2.close();
    });
  });

  it("without style configured, nothing is marked stale", async () => {
    await withProject(async (root) => {
      writeConfig(root, { ...DEFAULT_CONFIG, targetLangs: ["fr"] });
      assert.equal(readConfig(root).style, undefined);

      const db = openDatabase(root);
      const segs = listSegmentsForTranslate(db, { lang: "fr" });
      assert.ok(segs.length >= 1);
      upsertTranslation(db, segs[0].id, "fr", "Bonjour.", "llm", true, null);
      // Even if a hash existed historically, no current style → do not mark stale.
      const marked = markStyleHashStale(db, null, "fr");
      assert.deepEqual(marked, []);
      const tr = db
        .prepare(`SELECT status, approved FROM translations WHERE lang = ?`)
        .get("fr");
      assert.equal(tr.status, "approved");
      assert.equal(tr.approved, 1);
      db.close();
    });
  });
});
