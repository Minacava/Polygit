import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { runConfigGet, runConfigSet } from "../../dist/commands/config.js";
import { runInit } from "../../dist/commands/init.js";
import { readConfig } from "../../dist/core/project.js";

async function withProject(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "polygit-config-"));
  const prev = process.cwd();
  process.chdir(root);
  try {
    await runInit(root, {
      sourceLang: "en",
      targetLangs: "fr",
      content: "sources",
      output: "outputs",
    });
    await fn(root);
  } finally {
    process.chdir(prev);
  }
}

describe("config get/set", () => {
  it("gets and sets supported keys", async () => {
    await withProject(() => {
      assert.equal(runConfigGet("sourceLang"), "en");
      assert.equal(runConfigGet("targetLangs"), "fr");
      assert.equal(runConfigGet("autoTranslate"), "false");

      runConfigSet("targetLangs", "fr,es");
      runConfigSet("contentRoots", "docs,blog");
      runConfigSet("outputMode", "sidecar");
      runConfigSet("outputRoot", "locales");
      runConfigSet("autoTranslate", "true");

      const config = readConfig(process.cwd());
      assert.deepEqual(config.targetLangs, ["fr", "es"]);
      assert.deepEqual(config.contentRoots, ["docs", "blog"]);
      assert.equal(config.outputMode, "sidecar");
      assert.equal(config.outputRoot, "locales");
      assert.equal(config.autoTranslate, true);
    });
  });

  it("rejects invalid values", async () => {
    await withProject(() => {
      assert.throws(() => runConfigSet("sourceLang", "../x"), /Invalid/);
      assert.throws(() => runConfigSet("targetLangs", "!!!"), /Invalid/);
      assert.throws(() => runConfigSet("contentRoots", "/abs"), /absolute|Invalid/);
      assert.throws(() => runConfigSet("outputMode", "nope"), /outputMode/);
      assert.throws(() => runConfigSet("autoTranslate", "maybe"), /Invalid autoTranslate/);
      assert.throws(() => runConfigSet("sourceLang", "fr"), /must not appear in targetLangs/);
    });
  });

  it("rejects unknown keys", async () => {
    await withProject(() => {
      assert.throws(() => runConfigGet("models"), /Unknown config key/);
      assert.throws(() => runConfigSet("defaultProvider", "ollama"), /Unknown config key/);
    });
  });
});
