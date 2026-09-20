import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { runInit } from "../../dist/commands/init.js";

describe("init seeding", () => {
  it("creates .gitignore and .env.example", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "polygit-init-"));
    const prev = process.cwd();
    process.chdir(root);
    try {
      await runInit();
      assert.ok(fs.existsSync(path.join(root, ".gitignore")));
      assert.ok(fs.existsSync(path.join(root, ".env.example")));
      assert.ok(fs.existsSync(path.join(root, "sources")));
      assert.ok(fs.existsSync(path.join(root, "outputs")));
      const gi = fs.readFileSync(path.join(root, ".gitignore"), "utf8");
      assert.match(gi, /\.tm\//);
      assert.match(gi, /\.env/);
      const config = JSON.parse(
        fs.readFileSync(path.join(root, ".tmconfig.json"), "utf8"),
      );
      assert.deepEqual(config.contentRoots, ["sources"]);
      assert.equal(config.outputMode, "mirror");
      assert.equal(config.outputRoot, "outputs");
    } finally {
      process.chdir(prev);
    }
  });

  it("applies vitepress / docusaurus / json-i18n presets", async () => {
    for (const [preset, expectedRoot, mode] of [
      ["vitepress", "docs", "in-place-locale"],
      ["docusaurus", "docs", "in-place-locale"],
      ["json-i18n", "locales", "in-place-locale"],
    ]) {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), `polygit-init-${preset}-`));
      const prev = process.cwd();
      process.chdir(root);
      try {
        await runInit(root, { preset });
        assert.ok(fs.existsSync(path.join(root, expectedRoot)));
        assert.equal(fs.existsSync(path.join(root, "outputs")), false);
        const config = JSON.parse(
          fs.readFileSync(path.join(root, ".tmconfig.json"), "utf8"),
        );
        assert.deepEqual(config.contentRoots, [expectedRoot]);
        assert.equal(config.outputMode, mode);
      } finally {
        process.chdir(prev);
      }
    }
  });

  it("rejects unknown presets", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "polygit-init-bad-"));
    await assert.rejects(() => runInit(root, { preset: "nope" }), /Unknown preset/);
  });

  it("merges Polygit rules into an existing .gitignore", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "polygit-init-gi-"));
    const prev = process.cwd();
    process.chdir(root);
    try {
      fs.writeFileSync(path.join(root, ".gitignore"), "node_modules/\n", "utf8");
      await runInit();
      const gi = fs.readFileSync(path.join(root, ".gitignore"), "utf8");
      assert.match(gi, /node_modules\//);
      assert.match(gi, /\.tm\//);
      assert.match(gi, /\.env/);
    } finally {
      process.chdir(prev);
    }
  });
});
