import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { runInit } from "../../dist/commands/init.js";
import { runImport } from "../../dist/commands/import.js";
import { runTranslate } from "../../dist/commands/translate.js";
import { openDatabase } from "../../dist/core/db.js";
import {
  countUnapprovedTranslations,
  getTmEntries,
  listSegmentsForTranslate,
  upsertTranslationMemory,
} from "../../dist/core/repository.js";
import { DEFAULT_CONFIG, writeConfig } from "../../dist/core/project.js";

async function setupProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "polygit-translate-"));
  const prev = process.cwd();
  process.chdir(root);
  await runInit();
  writeConfig(root, { ...DEFAULT_CONFIG, defaultProvider: "ollama" });
  fs.writeFileSync(
    path.join(root, "sources", "hello.md"),
    "Hello world.\n\nWelcome to Polygit.\n",
    "utf8",
  );
  runImport("sources/hello.md", { format: "markdown" });
  return { root, prev };
}

describe("translate pipeline", () => {
  it("translates with a mock provider and writes outputs for fr then es", async () => {
    const { root, prev } = await setupProject();
    try {
      const mock = {
        name: "ollama",
        async translateSegment(text, _src, lang) {
          return `[${lang}] ${text}`;
        },
      };

      await runTranslate("fr", { providerInstance: mock, provider: "ollama" });
      const frOut = path.join(root, "outputs", "fr", "hello.md");
      assert.ok(fs.existsSync(frOut));
      assert.match(fs.readFileSync(frOut, "utf8"), /\[fr\] Hello world/);

      const db = openDatabase(root);
      assert.equal(listSegmentsForTranslate(db, { lang: "fr" }).length, 0);
      assert.equal(listSegmentsForTranslate(db, { lang: "es" }).length, 2);
      db.close();

      await runTranslate("es", { providerInstance: mock, provider: "ollama" });
      const esOut = path.join(root, "outputs", "es", "hello.md");
      assert.ok(fs.existsSync(esOut));
      assert.match(fs.readFileSync(esOut, "utf8"), /\[es\] Hello world/);
    } finally {
      process.chdir(prev);
    }
  });

  it("does not auto-apply fuzzy TM or write it as exact memory", async () => {
    const { root, prev } = await setupProject();
    try {
      const db = openDatabase(root);
      upsertTranslationMemory(db, "Hello world!", "Bonjour le monde!", "fr");
      db.close();

      let llmCalls = 0;
      const mock = {
        name: "ollama",
        async translateSegment(text) {
          llmCalls += 1;
          return `LLM:${text}`;
        },
      };

      await runTranslate("fr", { providerInstance: mock, provider: "ollama" });
      assert.ok(llmCalls >= 1, "fuzzy hits should fall through to LLM by default");

      const db2 = openDatabase(root);
      const tm = getTmEntries(db2, "fr");
      const poisoned = tm.find(
        (e) => e.source_text === "Hello world." && e.target_text === "Bonjour le monde!",
      );
      assert.equal(poisoned, undefined);
      db2.close();
    } finally {
      process.chdir(prev);
    }
  });

  it("accept-fuzzy writes unapproved draft without TM upsert", async () => {
    const { root, prev } = await setupProject();
    try {
      const db = openDatabase(root);
      upsertTranslationMemory(db, "Hello world!", "Bonjour le monde!", "fr");
      db.close();

      const mock = {
        name: "ollama",
        async translateSegment() {
          return "should-not-matter";
        },
      };

      await runTranslate("fr", {
        providerInstance: mock,
        provider: "ollama",
        acceptFuzzy: true,
      });

      const db2 = openDatabase(root);
      assert.ok(countUnapprovedTranslations(db2, "fr") >= 1);
      const tm = getTmEntries(db2, "fr");
      assert.equal(
        tm.some((e) => e.source_text === "Hello world." && e.target_text === "Bonjour le monde!"),
        false,
      );
      db2.close();
    } finally {
      process.chdir(prev);
    }
  });
});
