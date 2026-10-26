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
    "Hello world.\n\nWelcome to polygit.\n",
    "utf8",
  );
  runImport("sources/hello.md", { format: "markdown" });
  return { root, prev };
}

async function captureLogs(action) {
  const logs = [];
  const originalLog = console.log;
  console.log = (...args) => logs.push(args.join(" "));
  try {
    await action();
  } finally {
    console.log = originalLog;
  }
  return logs.join("\n");
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

      const frLogs = await captureLogs(() =>
        runTranslate("fr", { providerInstance: mock, provider: "ollama" }),
      );
      assert.match(frLogs, /Translated 2 of 2 segment\(s\) → fr /);
      assert.equal(process.exitCode ?? 0, 0);
      const frOut = path.join(root, "outputs", "fr", "hello.md");
      assert.ok(fs.existsSync(frOut));
      assert.match(fs.readFileSync(frOut, "utf8"), /\[fr\] Hello world/);

      const db = openDatabase(root);
      assert.equal(listSegmentsForTranslate(db, { lang: "fr" }).length, 0);
      assert.equal(listSegmentsForTranslate(db, { lang: "es" }).length, 2);
      db.close();

      const esLogs = await captureLogs(() =>
        runTranslate("es", {
          providerInstance: mock,
          provider: "ollama",
          addLang: true,
        }),
      );
      assert.match(esLogs, /Translated 2 of 2 segment\(s\) → es /);
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
      upsertTranslationMemory(db, "Hello world!", "Bonjour le monde!", "fr", null, {
        approved: true,
      });
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
      upsertTranslationMemory(db, "Hello world!", "Bonjour le monde!", "fr", null, {
        approved: true,
      });
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

  it("retries then leaves unapproved when LLM drops placeholders", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "polygit-ph-"));
    const prev = process.cwd();
    const prevExitCode = process.exitCode;
    process.chdir(root);
    try {
      await runInit();
      writeConfig(root, { ...DEFAULT_CONFIG, defaultProvider: "ollama" });
      fs.writeFileSync(
        path.join(root, "sources", "hello.md"),
        "Hello {name}.\n",
        "utf8",
      );
      runImport("sources/hello.md", { format: "markdown" });

      let calls = 0;
      const mock = {
        name: "ollama",
        async translateSegment() {
          calls += 1;
          return "Bonjour ami."; // drops {name}
        },
      };

      const logs = await captureLogs(() =>
        runTranslate("fr", {
          providerInstance: mock,
          provider: "ollama",
          placeholderRetries: 1,
        }),
      );
      assert.equal(calls, 2, "should retry once after placeholder loss");
      assert.match(logs, /Translated 0 of 1 segment\(s\) → fr .*1 needs fix/);
      assert.equal(process.exitCode, 1);

      const db = openDatabase(root);
      assert.equal(countUnapprovedTranslations(db, "fr"), 1);
      const row = db
        .prepare(`SELECT status, target_text FROM translations WHERE lang = 'fr'`)
        .get();
      assert.equal(row.status, "needs_fix");
      const tm = getTmEntries(db, "fr");
      assert.equal(
        tm.some((e) => e.source_text.includes("{name}")),
        false,
        "broken translation must not enter TM",
      );
      const out = fs.readFileSync(path.join(root, "outputs", "fr", "hello.md"), "utf8");
      assert.match(out, /Hello \{name\}/);
      assert.doesNotMatch(out, /Bonjour ami/);
      db.close();
    } finally {
      process.exitCode = prevExitCode;
      process.chdir(prev);
    }
  });

  it("continues after a single LLM failure and writes partial output (PG-06)", async () => {
    const { root, prev } = await setupProject();
    try {
      let calls = 0;
      const mock = {
        name: "ollama",
        async translateSegment(text) {
          calls += 1;
          if (calls === 2) throw new Error("model overloaded sk-testkey1234567890");
          return `FR:${text}`;
        },
      };

      const logs = await captureLogs(() =>
        runTranslate("fr", {
          providerInstance: mock,
          provider: "ollama",
          concurrency: 1,
        }),
      );
      assert.match(logs, /Translated 1 of 2 segment\(s\) → fr .*1 failed/);
      assert.equal(process.exitCode, 1);
      process.exitCode = 0;

      const out = path.join(root, "outputs", "fr", "hello.md");
      assert.ok(fs.existsSync(out));
      assert.match(fs.readFileSync(out, "utf8"), /FR:Hello world/);
    } finally {
      process.chdir(prev);
    }
  });

  it("counts successes separately from failures and needs-fix segments", async () => {
    const { root, prev } = await setupProject();
    const prevExitCode = process.exitCode;
    try {
      fs.writeFileSync(
        path.join(root, "sources", "hello.md"),
        "Hello world.\n\nRun `npm test` first.\n\nThird line.\n",
        "utf8",
      );
      runImport("sources/hello.md", { format: "markdown" });

      const mock = {
        name: "ollama",
        async translateSegment(text) {
          if (text.startsWith("Third")) throw new Error("simulated failure");
          if (text.includes("`")) return "Lancez d'abord les tests.";
          return `[fr] ${text}`;
        },
      };

      const logs = await captureLogs(() =>
        runTranslate("fr", {
          providerInstance: mock,
          provider: "ollama",
          concurrency: 1,
          placeholderRetries: 0,
        }),
      );
      assert.match(logs, /Translated 1 of 3 segment\(s\) → fr .*llm=1.*1 failed, 1 needs fix/);
      assert.equal(process.exitCode, 1);
      const output = fs.readFileSync(path.join(root, "outputs", "fr", "hello.md"), "utf8");
      assert.match(output, /\[fr\] Hello world/);
      assert.match(output, /Run `npm test` first/);
      assert.match(output, /Third line/);
    } finally {
      process.exitCode = prevExitCode;
      process.chdir(prev);
    }
  });

  it("uses approved TM after review, not the raw LLM draft (PG-12)", async () => {
    const { root, prev } = await setupProject();
    try {
      const mock = {
        name: "ollama",
        async translateSegment() {
          return "MAUVAIS";
        },
      };
      await runTranslate("fr", { providerInstance: mock, provider: "ollama" });

      const db = openDatabase(root);
      const seg = db
        .prepare(
          `SELECT s.id, s.source_text FROM segments s JOIN documents d ON d.id = s.document_id
           WHERE s.source_text = 'Hello world.'`,
        )
        .get();
      const { upsertTranslation, upsertTranslationMemory } = await import(
        "../../dist/core/repository.js"
      );
      upsertTranslation(db, seg.id, "fr", "Bonjour le monde.", "manual", true);
      upsertTranslationMemory(db, seg.source_text, "Bonjour le monde.", "fr", null, {
        approved: true,
      });
      db.close();

      fs.writeFileSync(
        path.join(root, "sources", "other.md"),
        "Hello world.\n",
        "utf8",
      );
      runImport("sources/other.md", { format: "markdown" });

      let llmCalls = 0;
      const mock2 = {
        name: "ollama",
        async translateSegment(text) {
          llmCalls += 1;
          return `LLM:${text}`;
        },
      };
      await runTranslate("fr", {
        providerInstance: mock2,
        provider: "ollama",
        doc: "sources/other.md",
      });
      assert.equal(llmCalls, 0, "approved TM exact should skip LLM");
      assert.match(
        fs.readFileSync(path.join(root, "outputs", "fr", "other.md"), "utf8"),
        /Bonjour le monde/,
      );
    } finally {
      process.chdir(prev);
    }
  });
});

