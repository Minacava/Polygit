import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { simpleGit } from "simple-git";
import { runHooksInstall } from "../../dist/commands/hooks.js";
import { runInit } from "../../dist/commands/init.js";
import { runPublish } from "../../dist/commands/publish.js";
import { runSync } from "../../dist/commands/sync.js";
import {
  countUnapprovedTranslations,
  listSegmentsForTranslate,
} from "../../dist/core/repository.js";
import {
  DEFAULT_CONFIG,
  openProjectDb,
  writeConfig,
} from "../../dist/core/project.js";

async function withProject(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "polygit-sync-"));
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
      ...JSON.parse(fs.readFileSync(path.join(root, ".tmconfig.json"), "utf8")),
      targetLangs: ["fr"],
      defaultProvider: "ollama",
    });
    await fn(root);
  } finally {
    process.chdir(prev);
  }
}

const mockProvider = {
  name: "ollama",
  async translateSegment(text, _src, lang) {
    return `[${lang}] ${text}`;
  },
};

describe("sync", () => {
  it("imports a NEW file, translates it unapproved, and publish blocks", async () => {
    await withProject(async (root) => {
      fs.writeFileSync(path.join(root, "sources", "pricing.md"), "Price list.\n", "utf8");

      const result = await runSync({
        lang: "fr",
        provider: "ollama",
        providerInstance: mockProvider,
      });
      assert.deepEqual(result.imported, ["sources/pricing.md"]);
      assert.equal(result.dryRun, false);

      const out = path.join(root, "outputs", "fr", "pricing.md");
      assert.ok(fs.existsSync(out));
      assert.match(fs.readFileSync(out, "utf8"), /\[fr\] Price list/);

      const db = openProjectDb(root);
      try {
        assert.equal(countUnapprovedTranslations(db, "fr") > 0, true);
        assert.equal(listSegmentsForTranslate(db, { lang: "fr" }).length, 0);
      } finally {
        db.close();
      }

      await assert.rejects(
        () => runPublish({ lang: "fr", yes: true }),
        /not locally approved/i,
      );
    });
  });

  it("dry-run does not import or translate", async () => {
    await withProject(async (root) => {
      fs.writeFileSync(path.join(root, "sources", "new.md"), "New doc.\n", "utf8");
      const result = await runSync({
        lang: "fr",
        dryRun: true,
        providerInstance: mockProvider,
      });
      assert.deepEqual(result.imported, ["sources/new.md"]);
      assert.equal(result.dryRun, true);

      const db = openProjectDb(root);
      try {
        const docs = db.prepare(`SELECT path FROM documents`).all();
        assert.equal(docs.length, 0);
      } finally {
        db.close();
      }
      assert.equal(fs.existsSync(path.join(root, "outputs", "fr", "new.md")), false);
    });
  });
});

describe("hooks install", () => {
  it("writes an executable pre-commit that only runs check", async () => {
    await withProject(async (root) => {
      await simpleGit(root).init();
      const { path: hookPath } = runHooksInstall();
      assert.ok(fs.existsSync(hookPath));
      const mode = fs.statSync(hookPath).mode & 0o777;
      assert.equal(mode, 0o755);
      const body = fs.readFileSync(hookPath, "utf8");
      assert.match(body, /polygit check/);
      assert.doesNotMatch(body, /\bsync\b/);
    });
  });

  it("refuses to overwrite an existing pre-commit hook", async () => {
    await withProject(async (root) => {
      await simpleGit(root).init();
      runHooksInstall();
      assert.throws(() => runHooksInstall(), /already exists|Refusing to overwrite/);
    });
  });
});
