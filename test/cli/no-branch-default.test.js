import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { simpleGit } from "simple-git";
import { runInit } from "../../dist/commands/init.js";
import { runImport } from "../../dist/commands/import.js";
import { runTranslate } from "../../dist/commands/translate.js";
import { getCurrentBranch } from "../../dist/git/git.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DIST_CLI = path.join(ROOT, "dist", "cli.js");

describe("cli --no-branch default", () => {
  it("translate --dry-run does not create a polygit branch (PG-07)", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "polygit-nobranch-"));
    const prev = process.cwd();
    process.chdir(tmp);
    try {
      await runInit();
      const git = simpleGit(tmp);
      await git.addConfig("user.name", "Test");
      await git.addConfig("user.email", "test@example.com");
      fs.mkdirSync(path.join(tmp, "sources"), { recursive: true });
      fs.writeFileSync(path.join(tmp, "sources", "a.md"), "Hello.\n", "utf8");
      await git.add([".", ".gitignore", ".tmconfig.json"]);
      await git.commit("init");
      const head = await getCurrentBranch(tmp);
      if (head !== "main") {
        await git.branch(["-M", "main"]);
      }

      runImport("sources/a.md", { format: "markdown" });
      assert.equal(await getCurrentBranch(tmp), "main");

      const dryRun = spawnSync(
        process.execPath,
        [DIST_CLI, "translate", "fr", "--dry-run"],
        {
          cwd: tmp,
          encoding: "utf8",
          env: { ...process.env, NO_COLOR: "1" },
        },
      );
      assert.equal(dryRun.status, 0, dryRun.stderr || dryRun.stdout);
      assert.equal(await getCurrentBranch(tmp), "main");
    } finally {
      process.chdir(prev);
    }
  });

  it("translate without --no-branch creates a polygit/<lang>-* branch on main", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "polygit-branch-"));
    const prev = process.cwd();
    process.chdir(tmp);
    try {
      await runInit();
      const git = simpleGit(tmp);
      await git.addConfig("user.name", "Test");
      await git.addConfig("user.email", "test@example.com");
      fs.mkdirSync(path.join(tmp, "sources"), { recursive: true });
      fs.writeFileSync(path.join(tmp, "sources", "a.md"), "Hello.\n", "utf8");
      await git.add([".", ".gitignore", ".tmconfig.json"]);
      await git.commit("init");
      const head = await getCurrentBranch(tmp);
      if (head !== "main") {
        await git.branch(["-M", "main"]);
      }

      runImport("sources/a.md", { format: "markdown" });

      const mock = {
        name: "ollama",
        async translateSegment(text) {
          return `FR:${text}`;
        },
      };
      await runTranslate("fr", { providerInstance: mock, provider: "ollama" });
      assert.match(await getCurrentBranch(tmp), /^polygit\/fr-\d{8}$/);
    } finally {
      process.chdir(prev);
    }
  });
});
