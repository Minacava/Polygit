import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, it } from "node:test";
import { simpleGit } from "simple-git";
import { runHooksInstall } from "../../dist/commands/hooks.js";
import { runInit } from "../../dist/commands/init.js";
import { DEFAULT_CONFIG, writeConfig } from "../../dist/core/project.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DIST_CLI = path.join(REPO_ROOT, "dist", "cli.js");

/**
 * PATH that includes node/git but not a global polygit and not this project's
 * node_modules/.bin (the hook must use ./node_modules/.bin/polygit via cwd).
 */
function pathWithoutPolygit() {
  const nodeDir = path.dirname(process.execPath);
  const parts = [
    nodeDir,
    "/exec-daemon",
    "/usr/bin",
    "/bin",
    "/usr/local/bin",
  ];
  return [...new Set(parts)].join(path.delimiter);
}

function installLocalPolygitBin(projectRoot) {
  const binDir = path.join(projectRoot, "node_modules", ".bin");
  fs.mkdirSync(binDir, { recursive: true });
  const binPath = path.join(binDir, "polygit");
  fs.writeFileSync(
    binPath,
    `#!/usr/bin/env node\nimport ${JSON.stringify(pathToFileURL(DIST_CLI).href)};\n`,
    "utf8",
  );
  fs.chmodSync(binPath, 0o755);
  return binPath;
}

async function setupHookProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "polygit-hook-pc-"));
  const prev = process.cwd();
  process.chdir(root);
  await runInit(root, {
    sourceLang: "en",
    targetLangs: "fr",
    content: "sources",
    output: "outputs",
    interactive: false,
  });
  writeConfig(root, {
    ...DEFAULT_CONFIG,
    sourceLang: "en",
    targetLangs: ["fr"],
    contentRoots: ["sources"],
    outputMode: "mirror",
    outputRoot: "outputs",
  });
  await simpleGit(root).init();
  // Identity for commits in the temp repo.
  await simpleGit(root).addConfig("user.email", "test@example.com");
  await simpleGit(root).addConfig("user.name", "Test");
  installLocalPolygitBin(root);
  runHooksInstall();
  return { root, prev };
}

describe("pre-commit hook resolves local polygit", () => {
  it("allows commit when check passes using only node_modules/.bin", async () => {
    const { root, prev } = await setupHookProject();
    try {
      fs.writeFileSync(path.join(root, "README.md"), "# ok\n", "utf8");
      const git = simpleGit(root);
      await git.add("README.md");
      const result = spawnSync("git", ["commit", "-m", "ok"], {
        cwd: root,
        env: { ...process.env, PATH: pathWithoutPolygit() },
        encoding: "utf8",
      });
      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.doesNotMatch(result.stderr || "", /not found/i);
    } finally {
      process.chdir(prev);
    }
  });

  it("blocks commit when check fails on missing outputs (hook softens NEW/CHANGED)", async () => {
    const { root, prev } = await setupHookProject();
    try {
      // Imported but never translated → missing output / pending fails even under --hook.
      const { runImport } = await import("../../dist/commands/import.js");
      const { writeConfig, readConfig } = await import("../../dist/core/project.js");
      writeConfig(root, { ...readConfig(root), targetLangs: ["fr"] });
      fs.writeFileSync(path.join(root, "sources", "new.md"), "Hello.\n", "utf8");
      runImport("sources/new.md");
      const git = simpleGit(root);
      await git.add(["sources/new.md"]);
      const result = spawnSync("git", ["commit", "-m", "should fail"], {
        cwd: root,
        env: { ...process.env, PATH: pathWithoutPolygit() },
        encoding: "utf8",
      });
      assert.notEqual(result.status, 0);
      const out = `${result.stdout}\n${result.stderr}`;
      assert.match(out, /missing output|check failed|pending=/i);
      assert.doesNotMatch(out, /polygit: not found/i);
    } finally {
      process.chdir(prev);
    }
  });

  it("prints a clear message when polygit cannot be found", async () => {
    const { root, prev } = await setupHookProject();
    try {
      fs.rmSync(path.join(root, "node_modules"), { recursive: true, force: true });
      const hookPath = path.join(root, ".git", "hooks", "pre-commit");
      const result = spawnSync("sh", [hookPath], {
        cwd: root,
        env: { ...process.env, PATH: pathWithoutPolygit() },
        encoding: "utf8",
      });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /polygit was not found/i);
      assert.match(result.stderr, /npm install polygit/i);
      assert.doesNotMatch(result.stderr, /polygit: not found/);
    } finally {
      process.chdir(prev);
    }
  });
});

describe("hooks install exit code", () => {
  it("exits non-zero via CLI when refusing to overwrite", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "polygit-hook-exit-"));
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
      await simpleGit(root).init();
      runHooksInstall();
      const cli = spawnSync(process.execPath, [DIST_CLI, "hooks", "install"], {
        cwd: root,
        encoding: "utf8",
      });
      assert.notEqual(cli.status, 0);
      assert.match(cli.stderr, /Refusing to overwrite|already exists/);
    } finally {
      process.chdir(prev);
    }
  });
});
