import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { runCheck } from "../../dist/commands/check.js";
import { runInit } from "../../dist/commands/init.js";
import { runSync } from "../../dist/commands/sync.js";
import { listContentFiles } from "../../dist/core/layout.js";
import { DEFAULT_CONFIG, writeConfig } from "../../dist/core/project.js";

describe("check/sync skip symlinks with a warning", () => {
  it("listContentFiles warns and skips symlink files", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "polygit-sym-list-"));
    fs.mkdirSync(path.join(root, "sources"), { recursive: true });
    fs.writeFileSync(path.join(root, "sources", "real.md"), "Hi.\n", "utf8");
    fs.symlinkSync(path.join(root, "sources", "real.md"), path.join(root, "sources", "link.md"));

    const warnings = [];
    const orig = console.warn;
    console.warn = (...args) => warnings.push(args.join(" "));
    try {
      const files = listContentFiles(root, ["sources"]);
      assert.deepEqual(files, ["sources/real.md"]);
      assert.ok(warnings.some((w) => /skipped symlink: sources\/link\.md/.test(w)));
    } finally {
      console.warn = orig;
    }
  });

  it("check does not fail because of a symlink under contentRoots", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "polygit-sym-check-"));
    const prev = process.cwd();
    process.chdir(root);
    const warnings = [];
    const orig = console.warn;
    console.warn = (...args) => warnings.push(args.join(" "));
    try {
      await runInit(root, {
        sourceLang: "en",
        targetLangs: "fr",
        content: "sources",
        output: "outputs",
        interactive: false,
      });
      writeConfig(root, {
        ...DEFAULT_CONFIG,
        targetLangs: ["fr"],
        contentRoots: ["sources"],
      });
      fs.writeFileSync(path.join(root, "sources", "ok.md"), "Ok.\n", "utf8");
      fs.symlinkSync(path.join(root, "sources", "ok.md"), path.join(root, "sources", "x.md"));

      // Without importing, NEW would fail on ok.md; import isn't needed for symlink test —
      // we only assert the symlink is skipped and does not crash check when alone with empty DB
      // after importing the real file.
      const { runImport } = await import("../../dist/commands/import.js");
      const { writeOutputDocuments } = await import("../../dist/core/output.js");
      const { openProjectDb } = await import("../../dist/core/project.js");
      const { upsertTranslation } = await import("../../dist/core/repository.js");

      runImport("sources/ok.md");
      const db = openProjectDb(root);
      try {
        const seg = db.prepare(`SELECT id FROM segments LIMIT 1`).get();
        upsertTranslation(db, seg.id, "fr", "Ok.", "manual", true);
        writeOutputDocuments(db, root, "fr", ["sources/ok.md"]);
      } finally {
        db.close();
      }

      const result = runCheck({ lang: "fr", quiet: true });
      assert.equal(result.ok, true);
      assert.ok(!result.newFiles.includes("sources/x.md"));
      assert.ok(warnings.some((w) => /skipped symlink: sources\/x\.md/.test(w)));
    } finally {
      console.warn = orig;
      process.chdir(prev);
    }
  });

  it("sync dry-run skips symlink sources without failing", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "polygit-sym-sync-"));
    const prev = process.cwd();
    process.chdir(root);
    const warnings = [];
    const orig = console.warn;
    console.warn = (...args) => warnings.push(args.join(" "));
    try {
      await runInit(root, {
        sourceLang: "en",
        targetLangs: "fr",
        content: "sources",
        output: "outputs",
        interactive: false,
      });
      writeConfig(root, {
        ...DEFAULT_CONFIG,
        targetLangs: ["fr"],
        contentRoots: ["sources"],
      });
      fs.symlinkSync("/tmp/somewhere.md", path.join(root, "sources", "dangling.md"));

      const result = await runSync({ lang: "fr", dryRun: true });
      assert.deepEqual(result.imported, []);
      assert.ok(warnings.some((w) => /skipped symlink: sources\/dangling\.md/.test(w)));
    } finally {
      console.warn = orig;
      process.chdir(prev);
    }
  });
});
