import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { runImport } from "../../dist/commands/import.js";
import { runInit } from "../../dist/commands/init.js";
import { readConfig } from "../../dist/core/project.js";

describe("import", () => {
  it("rejects paths outside contentRoots", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "polygit-import-"));
    const prev = process.cwd();
    process.chdir(root);
    try {
      await runInit();
      fs.mkdirSync(path.join(root, "other"), { recursive: true });
      fs.writeFileSync(path.join(root, "other", "a.md"), "Hello.\n", "utf8");
      assert.throws(() => runImport("other/a.md"), /contentRoots/);
    } finally {
      process.chdir(prev);
    }
  });

  it("imports a glob under contentRoots", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "polygit-import-glob-"));
    const prev = process.cwd();
    process.chdir(root);
    try {
      await runInit();
      fs.writeFileSync(path.join(root, "sources", "a.md"), "One.\n", "utf8");
      fs.writeFileSync(path.join(root, "sources", "b.md"), "Two.\n", "utf8");
      const results = runImport("sources/**/*.md");
      assert.equal(results.length, 2);
      assert.ok(results.some((r) => r.path === "sources/a.md"));
      assert.ok(results.some((r) => r.path === "sources/b.md"));
    } finally {
      process.chdir(prev);
    }
  });

  it("imports --root and persists it into contentRoots", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "polygit-import-root-"));
    const prev = process.cwd();
    process.chdir(root);
    try {
      await runInit();
      fs.mkdirSync(path.join(root, "docs"), { recursive: true });
      fs.writeFileSync(path.join(root, "docs", "intro.md"), "Hello docs.\n", "utf8");
      const results = runImport(undefined, { root: "docs" });
      assert.equal(results.length, 1);
      assert.equal(results[0].path, "docs/intro.md");
      const config = readConfig(root);
      assert.ok(config.contentRoots.includes("docs"));
    } finally {
      process.chdir(prev);
    }
  });
});
