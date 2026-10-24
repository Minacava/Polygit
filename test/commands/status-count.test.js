import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { runInit } from "../../dist/commands/init.js";
import { runImport } from "../../dist/commands/import.js";
import { runStatus } from "../../dist/commands/status.js";
import { writeConfig, readConfig, DEFAULT_CONFIG } from "../../dist/core/project.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DIST_CLI = path.join(ROOT, "dist", "cli.js");

describe("status file count", () => {
  it("uses singular/plural and ignores managed sidecar outputs under contentRoots", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "polygit-status-count-"));
    const prev = process.cwd();
    process.chdir(tmp);
    const logs = [];
    const originalLog = console.log;
    console.log = (...args) => {
      logs.push(args.map(String).join(" "));
    };
    try {
      await runInit();
      writeConfig(tmp, {
        ...DEFAULT_CONFIG,
        ...readConfig(tmp),
        contentRoots: ["docs"],
        outputMode: "sidecar",
        targetLangs: ["fr"],
      });
      fs.mkdirSync(path.join(tmp, "docs"), { recursive: true });
      fs.writeFileSync(path.join(tmp, "docs", "a.md"), "Hello.\n", "utf8");
      fs.writeFileSync(path.join(tmp, "docs", "a.fr.md"), "Bonjour.\n", "utf8");
      runImport("docs/a.md", { format: "markdown" });

      logs.length = 0;
      runStatus({ lang: "fr" });
      const joined = logs.join("\n");
      assert.match(joined, /docs\/ — 1 file on disk/);
      assert.doesNotMatch(joined, /file\(s\)/);
      assert.doesNotMatch(joined, /2 files on disk/);
    } finally {
      console.log = originalLog;
      process.chdir(prev);
    }
  });

  it("CLI status prints plural files without (s)", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "polygit-status-cli-"));
    const init = spawnSync(process.execPath, [DIST_CLI, "init"], {
      cwd: tmp,
      encoding: "utf8",
      env: { ...process.env, NO_COLOR: "1" },
    });
    assert.equal(init.status, 0, init.stderr || init.stdout);
    fs.mkdirSync(path.join(tmp, "sources"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "sources", "a.md"), "A\n", "utf8");
    fs.writeFileSync(path.join(tmp, "sources", "b.md"), "B\n", "utf8");
    const status = spawnSync(process.execPath, [DIST_CLI, "status"], {
      cwd: tmp,
      encoding: "utf8",
      env: { ...process.env, NO_COLOR: "1" },
    });
    assert.equal(status.status, 0, status.stderr || status.stdout);
    assert.match(status.stdout, /sources\/ — 2 files on disk/);
    assert.doesNotMatch(status.stdout, /file\(s\)/);
  });
});
