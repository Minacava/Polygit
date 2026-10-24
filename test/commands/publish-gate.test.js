import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { simpleGit } from "simple-git";
import { runInit } from "../../dist/commands/init.js";
import { runPublish } from "../../dist/commands/publish.js";
import { openDatabase } from "../../dist/core/db.js";
import {
  DEFAULT_CONFIG,
  writeConfig,
} from "../../dist/core/project.js";
import {
  markGlossarySegmentsStale,
  rebuildGlossaryUsage,
  replaceDocumentSegments,
  upsertDocument,
  upsertGlossaryTerm,
  upsertTranslation,
} from "../../dist/core/repository.js";

async function setupProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "polygit-publish-"));
  const prev = process.cwd();
  process.chdir(root);
  await runInit();
  return { root, prev };
}

async function seedApprovedTranslation(root) {
  const db = openDatabase(root);
  fs.mkdirSync(path.join(root, "sources"), { recursive: true });
  fs.writeFileSync(path.join(root, "sources", "a.md"), "Hello.\n", "utf8");
  const doc = upsertDocument(db, "sources/a.md", "markdown");
  replaceDocumentSegments(db, doc, [{ orderIndex: 0, sourceText: "Hello." }]);
  const seg = db.prepare(`SELECT id FROM segments`).get();
  upsertTranslation(db, seg.id, "fr", "Bonjour.", "llm", true);
  db.close();
  fs.mkdirSync(path.join(root, "outputs", "fr"), { recursive: true });
  fs.writeFileSync(path.join(root, "outputs", "fr", "a.md"), "Bonjour.\n", "utf8");
}

describe("publish gate", () => {
  it("requires --lang", async () => {
    const { prev } = await setupProject();
    try {
      await assert.rejects(() => runPublish({ yes: true }), /Language is required/i);
    } finally {
      process.chdir(prev);
    }
  });

  it("rejects unsafe --branch before contacting remotes", async () => {
    const { root, prev } = await setupProject();
    try {
      await seedApprovedTranslation(root);
      await assert.rejects(
        () => runPublish({ lang: "fr", yes: true, branch: "--upload-pack=evil" }),
        /Invalid branch/i,
      );
      await assert.rejects(
        () => runPublish({ lang: "fr", yes: true, branch: "-u" }),
        /Invalid branch/i,
      );
    } finally {
      process.chdir(prev);
    }
  });

  it("blocks when translations are unapproved", async () => {
    const { root, prev } = await setupProject();
    try {
      const db = openDatabase(root);
      fs.mkdirSync(path.join(root, "sources"), { recursive: true });
      fs.writeFileSync(path.join(root, "sources", "a.md"), "Hello.\n", "utf8");
      const doc = upsertDocument(db, "sources/a.md", "markdown");
      replaceDocumentSegments(db, doc, [{ orderIndex: 0, sourceText: "Hello." }]);
      const seg = db.prepare(`SELECT id FROM segments`).get();
      upsertTranslation(db, seg.id, "fr", "Bonjour.", "llm", false);
      db.close();

      await assert.rejects(
        () => runPublish({ lang: "fr", yes: true }),
        /not locally approved/i,
      );
    } finally {
      process.chdir(prev);
    }
  });

  it("blocks after glossary stale clears approval", async () => {
    const { root, prev } = await setupProject();
    try {
      const db = openDatabase(root);
      fs.mkdirSync(path.join(root, "sources"), { recursive: true });
      fs.writeFileSync(path.join(root, "sources", "a.md"), "Hello polygit.\n", "utf8");
      const doc = upsertDocument(db, "sources/a.md", "markdown");
      replaceDocumentSegments(db, doc, [{ orderIndex: 0, sourceText: "Hello polygit." }]);
      const seg = db.prepare(`SELECT id FROM segments`).get();
      upsertTranslation(db, seg.id, "fr", "Bonjour polygit.", "llm", true);
      const { row } = upsertGlossaryTerm(db, "polygit", "polygit", "fr");
      rebuildGlossaryUsage(db, row.id);
      markGlossarySegmentsStale(db, [row.id], "fr");
      db.close();

      await assert.rejects(
        () => runPublish({ lang: "fr", yes: true }),
        /not locally approved|No locally approved/i,
      );
    } finally {
      process.chdir(prev);
    }
  });

  it("refuses github.attacker.com without --forge / confirmation", async () => {
    const { root, prev } = await setupProject();
    const prevToken = process.env.GITHUB_TOKEN;
    process.env.GITHUB_TOKEN = "should-not-be-sent";
    try {
      await seedApprovedTranslation(root);
      await simpleGit(root).addRemote(
        "origin",
        "https://github.attacker.com/acme/docs.git",
      );

      await assert.rejects(
        () => runPublish({ lang: "fr", yes: true }),
        /untrusted|Cannot detect forge|github\.com and gitlab\.com/i,
      );
    } finally {
      if (prevToken === undefined) delete process.env.GITHUB_TOKEN;
      else process.env.GITHUB_TOKEN = prevToken;
      process.chdir(prev);
    }
  });

  it("refuses gitlab.evil.io even with --forge when unconfirmed", async () => {
    const { root, prev } = await setupProject();
    const prevToken = process.env.GITLAB_TOKEN;
    process.env.GITLAB_TOKEN = "should-not-be-sent";
    try {
      await seedApprovedTranslation(root);
      await simpleGit(root).addRemote(
        "origin",
        "https://gitlab.evil.io/team/app.git",
      );

      await assert.rejects(
        () => runPublish({ lang: "fr", yes: true, forge: "gitlab" }),
        /untrusted host|confirm-forge-host|forgeHosts/i,
      );
    } finally {
      if (prevToken === undefined) delete process.env.GITLAB_TOKEN;
      else process.env.GITLAB_TOKEN = prevToken;
      process.chdir(prev);
    }
  });

  it("allows Enterprise host when listed in POLYGIT_FORGE_HOSTS with --forge", async () => {
    const { root, prev } = await setupProject();
    const prevToken = process.env.GITHUB_TOKEN;
    const prevHosts = process.env.POLYGIT_FORGE_HOSTS;
    process.env.GITHUB_TOKEN = "test-token-not-for-network";
    process.env.POLYGIT_FORGE_HOSTS = "github.mycompany.com";
    try {
      const git = simpleGit(root);
      await git.addConfig("user.email", "test@example.com");
      await git.addConfig("user.name", "Test");
      fs.writeFileSync(path.join(root, "README.md"), "# test\n", "utf8");
      await git.add("README.md");
      await git.commit("init");

      await seedApprovedTranslation(root);
      await git.addRemote("origin", "https://github.mycompany.com/acme/docs.git");
      const baseBranch = (await git.revparse(["--abbrev-ref", "HEAD"])).trim();

      // Host is confirmed via POLYGIT_FORGE_HOSTS; publish proceeds past forge
      // resolution and fails later on push (no real remote) — not on trust checks.
      await assert.rejects(
        () =>
          runPublish({
            lang: "fr",
            yes: true,
            forge: "github",
            branch: "polygit/test-forge-host",
          }),
        /Push failed|write access/i,
      );

      // Branch must be restored after failure.
      const branch = (await git.revparse(["--abbrev-ref", "HEAD"])).trim();
      assert.equal(branch, baseBranch);
    } finally {
      if (prevToken === undefined) delete process.env.GITHUB_TOKEN;
      else process.env.GITHUB_TOKEN = prevToken;
      if (prevHosts === undefined) delete process.env.POLYGIT_FORGE_HOSTS;
      else process.env.POLYGIT_FORGE_HOSTS = prevHosts;
      process.chdir(prev);
    }
  });

  it("rejects publish when on-disk output does not match approved text", async () => {
    const { root, prev } = await setupProject();
    try {
      await seedApprovedTranslation(root);
      fs.writeFileSync(
        path.join(root, "outputs", "fr", "a.md"),
        "TAMPERED\n",
        "utf8",
      );
      await assert.rejects(
        () => runPublish({ lang: "fr", yes: true }),
        /does not match approved|Output file/i,
      );
    } finally {
      process.chdir(prev);
    }
  });
});

