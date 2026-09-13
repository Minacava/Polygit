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
      const gi = fs.readFileSync(path.join(root, ".gitignore"), "utf8");
      assert.match(gi, /\.tm\//);
      assert.match(gi, /\.env/);
    } finally {
      process.chdir(prev);
    }
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
