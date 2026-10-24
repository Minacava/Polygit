import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { simpleGit } from "simple-git";
import { runInit } from "../../dist/commands/init.js";
import {
  ensureTranslationBranch,
  isProtectedBranch,
  isTranslationBranchForLang,
  resolvePublishSourceBranch,
  translationBranchName,
} from "../../dist/git/translation-branch.js";
import { getCurrentBranch } from "../../dist/git/git.js";

describe("translation-branch", () => {
  it("names and detects polygit translation branches", () => {
    const name = translationBranchName("fr", new Date("2026-10-21T12:00:00Z"));
    assert.equal(name, "polygit/fr-20261021");
    assert.equal(isTranslationBranchForLang(name, "fr"), true);
    assert.equal(isTranslationBranchForLang(name, "es"), false);
    // Legacy names still count as translation branches for that lang.
    assert.equal(isTranslationBranchForLang("polygit/translate-fr-20261021", "fr"), true);
    assert.equal(isTranslationBranchForLang("polygit/translate-fr", "fr"), true);
    assert.equal(isProtectedBranch("main"), true);
    assert.equal(isProtectedBranch("feature/x"), false);
  });

  it("resolvePublishSourceBranch prefers current polygit branch", () => {
    assert.equal(
      resolvePublishSourceBranch("fr", "polygit/fr-20261021"),
      "polygit/fr-20261021",
    );
    assert.equal(
      resolvePublishSourceBranch("fr", "polygit/translate-fr-20261021"),
      "polygit/translate-fr-20261021",
    );
    assert.equal(
      resolvePublishSourceBranch("fr", "main", "custom/branch"),
      "custom/branch",
    );
    assert.match(
      resolvePublishSourceBranch("fr", "main"),
      /^polygit\/fr-\d{8}$/,
    );
  });

  it("ensureTranslationBranch creates a branch from main", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "polygit-tbranch-"));
    const prev = process.cwd();
    process.chdir(root);
    try {
      await runInit();
      const git = simpleGit(root);
      await git.addConfig("user.name", "Test");
      await git.addConfig("user.email", "test@example.com");
      fs.writeFileSync(path.join(root, "README.md"), "# t\n", "utf8");
      await git.add("README.md");
      await git.commit("init");
      // Normalize default branch name for the test.
      const head = await getCurrentBranch(root);
      if (head !== "main") {
        await git.branch(["-M", "main"]);
      }

      const result = await ensureTranslationBranch(root, "fr");
      assert.equal(result.switched, true);
      assert.match(result.branch, /^polygit\/fr-\d{8}$/);
      assert.equal(await getCurrentBranch(root), result.branch);

      const again = await ensureTranslationBranch(root, "fr");
      assert.equal(again.switched, false);
      assert.equal(again.branch, result.branch);
    } finally {
      process.chdir(prev);
    }
  });
});
