import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { runInit } from "../../dist/commands/init.js";
import { DEFAULT_CONFIG, writeConfig } from "../../dist/core/project.js";

const DIST_CLI = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../dist/cli.js",
);

describe("check CLI output", () => {
  it("prints the failure summary only once (no duplicated Error: prefix)", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "polygit-check-out-"));
    const prev = process.cwd();
    process.chdir(root);
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
        outputMode: "mirror",
        outputRoot: "outputs",
      });
      fs.writeFileSync(path.join(root, "sources", "x.md"), "Hello.\n", "utf8");

      const result = spawnSync(process.execPath, [DIST_CLI, "check", "--lang=fr"], {
        cwd: root,
        encoding: "utf8",
      });
      assert.notEqual(result.status, 0);
      const stderr = result.stderr || "";
      assert.match(stderr, /check failed/);
      assert.match(stderr, /NEW \(not imported\)/);
      // Must not print the summary twice via "Error: check failed…".
      assert.equal((stderr.match(/check failed/g) || []).length, 1);
      assert.doesNotMatch(stderr, /^Error: check failed/m);
    } finally {
      process.chdir(prev);
    }
  });
});
