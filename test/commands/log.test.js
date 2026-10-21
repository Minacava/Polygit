import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { runInit } from "../../dist/commands/init.js";
import { runCommit } from "../../dist/commands/commit.js";
import { runLog } from "../../dist/commands/log.js";
import { listTranslationCommits } from "../../dist/git/git.js";
import { simpleGit } from "simple-git";

describe("log", () => {
  it("lists commits that touch sources/ and outputs/", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "polygit-log-"));
    const prev = process.cwd();
    process.chdir(root);
    try {
      await runInit();
      const git = simpleGit(root);
      await git.addConfig("user.name", "Test");
      await git.addConfig("user.email", "test@example.com");

      fs.writeFileSync(path.join(root, "sources", "a.md"), "Hello.\n", "utf8");
      fs.mkdirSync(path.join(root, "outputs", "fr"), { recursive: true });
      fs.writeFileSync(path.join(root, "outputs", "fr", "a.md"), "Bonjour.\n", "utf8");
      await runCommit({ yes: true, message: "translate(fr): add greeting" });

      fs.writeFileSync(path.join(root, "secret.txt"), "nope\n", "utf8");
      await git.add("secret.txt");
      await git.commit("chore: unrelated");

      const commits = await listTranslationCommits(root, {
        limit: 10,
        includeFiles: true,
      });
      assert.equal(commits.length, 1);
      assert.match(commits[0].message, /translate\(fr\): add greeting/);
      assert.ok(commits[0].files?.some((f) => f.includes("sources/")));
      assert.ok(commits[0].files?.some((f) => f.includes("outputs/")));

      // runLog should not throw
      await runLog({ limit: 5, stat: true });
    } finally {
      process.chdir(prev);
    }
  });

  it("grep-translate includes message-matched commits", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "polygit-log-grep-"));
    const prev = process.cwd();
    process.chdir(root);
    try {
      await runInit();
      const git = simpleGit(root);
      await git.addConfig("user.name", "Test");
      await git.addConfig("user.email", "test@example.com");

      fs.writeFileSync(path.join(root, "README.md"), "# hi\n", "utf8");
      await git.add("README.md");
      await git.commit("translate: docs note outside roots");

      const commits = await listTranslationCommits(root, {
        limit: 10,
        grepTranslate: true,
      });
      assert.ok(commits.some((c) => /translate: docs note/.test(c.message)));
    } finally {
      process.chdir(prev);
    }
  });
});
