import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(repoRoot, "dist", "cli.js");

function run(cwd, args) {
  return execFileSync(process.execPath, [cli, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
  });
}

describe("cli smoke", () => {
  it("init → import → status → glossary sync without LLM", () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "polygit-smoke-"));
    const initOut = run(cwd, ["init"]);
    assert.match(initOut, /Initialized Polygit project/i);

    assert.ok(fs.existsSync(path.join(cwd, ".gitignore")));
    assert.ok(fs.existsSync(path.join(cwd, ".env.example")));
    const gitignore = fs.readFileSync(path.join(cwd, ".gitignore"), "utf8");
    assert.match(gitignore, /\.tm\//);
    assert.match(gitignore, /\.env/);
    const envExample = fs.readFileSync(path.join(cwd, ".env.example"), "utf8");
    assert.match(envExample, /ANTHROPIC_API_KEY/);
    assert.match(envExample, /GITHUB_TOKEN/);

    fs.writeFileSync(
      path.join(cwd, "sources", "readme.md"),
      "# Hello\n\nWelcome to Polygit.\n\nAnother line here.\n",
      "utf8",
    );

    const importOut = run(cwd, ["import", "sources/readme.md", "--format=markdown"]);
    assert.match(importOut, /Imported sources\/readme\.md/i);

    const statusOut = run(cwd, ["status"]);
    assert.match(statusOut, /pending=/);

    const dryOut = run(cwd, ["translate", "fr", "--dry-run", "--provider=claude"]);
    assert.match(dryOut, /\[dry-run\]/i);

    run(cwd, ["glossary", "add", "Polygit", "Polygit", "--lang=fr"]);
    const syncOut = run(cwd, ["glossary", "sync", "--lang=fr"]);
    assert.match(syncOut, /stale/i);

    assert.ok(fs.existsSync(path.join(cwd, ".tm", "db.sqlite")));
    assert.ok(fs.existsSync(path.join(cwd, ".tmconfig.json")));
  });

  it("models use saves model and defaultProvider", () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "polygit-models-"));
    run(cwd, ["init"]);
    const out = run(cwd, ["models", "use", "ollama", "llama3.2"]);
    assert.match(out, /Default provider set to ollama/i);

    const config = JSON.parse(
      fs.readFileSync(path.join(cwd, ".tmconfig.json"), "utf8"),
    );
    assert.equal(config.defaultProvider, "ollama");
    assert.equal(config.models.ollama, "llama3.2");
  });

  it("exposes clone, publish, and models in --help", () => {
    const help = run(process.cwd(), ["--help"]);
    assert.match(help, /\bclone\b/);
    assert.match(help, /\bpublish\b/);
    assert.match(help, /\bmodels\b/);
  });
});
