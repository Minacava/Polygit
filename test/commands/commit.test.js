import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { runInit } from "../../dist/commands/init.js";
import { runCommit } from "../../dist/commands/commit.js";
import { simpleGit } from "simple-git";

describe("commit", () => {
  it("commits sources/ and outputs/ with --yes", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "polygit-commit-"));
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

      await runCommit({ yes: true, message: "test: translate fr" });

      const log = await git.log({ maxCount: 1 });
      assert.match(log.latest.message, /test: translate fr/);
      const show = await git.show(["--name-only", "--pretty=format:", "HEAD"]);
      assert.match(show, /sources\/a\.md/);
      assert.match(show, /outputs\/fr\/a\.md/);
    } finally {
      process.chdir(prev);
    }
  });
});
