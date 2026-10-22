import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { runInit } from "../../dist/commands/init.js";
import { readConfig } from "../../dist/core/project.js";

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "polygit-init-guided-"));
}

function queuePrompt(answers) {
  const remaining = [...answers];
  return async (question) => {
    if (remaining.length === 0) {
      throw new Error(`Unexpected prompt: ${question}`);
    }
    return remaining.shift();
  };
}

describe("init guided configuration", () => {
  it("writes config from all flags without prompting", async () => {
    const root = tempRoot();
    const prev = process.cwd();
    process.chdir(root);
    try {
      await runInit(root, {
        sourceLang: "en",
        targetLangs: "fr,es",
        content: "docs",
        output: "locales",
      });
      const config = readConfig(root);
      assert.equal(config.sourceLang, "en");
      assert.deepEqual(config.targetLangs, ["fr", "es"]);
      assert.deepEqual(config.contentRoots, ["docs"]);
      assert.equal(config.outputRoot, "locales");
      assert.equal(config.autoTranslate, false);
      assert.ok(fs.existsSync(path.join(root, "docs")));
    } finally {
      process.chdir(prev);
    }
  });

  it("asks only for missing flags via prompt", async () => {
    const root = tempRoot();
    const prev = process.cwd();
    process.chdir(root);
    try {
      await runInit(root, {
        sourceLang: "en",
        content: "sources",
        output: "outputs",
        prompt: queuePrompt(["fr,de", "y", ""]),
      });
      const config = readConfig(root);
      assert.deepEqual(config.targetLangs, ["fr", "de"]);
      assert.equal(config.autoTranslate, true);
      assert.equal(config.style, undefined);
    } finally {
      process.chdir(prev);
    }
  });

  it("re-asks after an invalid answer", async () => {
    const root = tempRoot();
    const prev = process.cwd();
    process.chdir(root);
    try {
      await runInit(root, {
        prompt: queuePrompt([
          "en",
          "not a lang!!!",
          "fr",
          "",
          "",
          "n",
          "",
        ]),
      });
      const config = readConfig(root);
      assert.equal(config.sourceLang, "en");
      assert.deepEqual(config.targetLangs, ["fr"]);
      assert.deepEqual(config.contentRoots, ["sources"]);
      assert.equal(config.outputRoot, "outputs");
      assert.equal(config.autoTranslate, false);
      assert.equal(config.style, undefined);
    } finally {
      process.chdir(prev);
    }
  });

  it("rejects source language in targetLangs", async () => {
    const root = tempRoot();
    await assert.rejects(
      () =>
        runInit(root, {
          sourceLang: "en",
          targetLangs: "en,fr",
          content: "sources",
          output: "outputs",
        }),
      /must not appear in targetLangs/,
    );
  });

  it("uses defaults without TTY and does not require prompts", async () => {
    const root = tempRoot();
    const prev = process.cwd();
    process.chdir(root);
    const warnings = [];
    const orig = console.warn;
    console.warn = (...args) => warnings.push(args.join(" "));
    try {
      await runInit(root, { interactive: false });
      const config = readConfig(root);
      assert.equal(config.sourceLang, "en");
      assert.deepEqual(config.targetLangs, []);
      assert.deepEqual(config.contentRoots, ["sources"]);
      assert.equal(config.outputRoot, "outputs");
      assert.equal(config.autoTranslate, false);
      assert.ok(warnings.some((w) => /Non-interactive shell/.test(w)));
    } finally {
      console.warn = orig;
      process.chdir(prev);
    }
  });

  it("does not overwrite an existing .tmconfig.json", async () => {
    const root = tempRoot();
    const prev = process.cwd();
    process.chdir(root);
    try {
      await runInit(root, {
        sourceLang: "en",
        targetLangs: "fr",
        content: "sources",
        output: "outputs",
      });
      fs.writeFileSync(
        path.join(root, ".tmconfig.json"),
        JSON.stringify({ sourceLang: "ca", targetLangs: ["eu"] }, null, 2),
        "utf8",
      );
      await runInit(root, {
        sourceLang: "en",
        targetLangs: "fr",
        content: "sources",
        output: "outputs",
      });
      const raw = JSON.parse(fs.readFileSync(path.join(root, ".tmconfig.json"), "utf8"));
      assert.equal(raw.sourceLang, "ca");
      assert.deepEqual(raw.targetLangs, ["eu"]);
    } finally {
      process.chdir(prev);
    }
  });

  it("lets explicit flags override preset layout roots", async () => {
    const root = tempRoot();
    const prev = process.cwd();
    process.chdir(root);
    try {
      await runInit(root, {
        preset: "vitepress",
        sourceLang: "en",
        targetLangs: "fr",
        content: "content",
        output: "out",
      });
      const config = readConfig(root);
      assert.deepEqual(config.contentRoots, ["content"]);
      assert.equal(config.outputRoot, "out");
      assert.equal(config.outputMode, "in-place-locale");
    } finally {
      process.chdir(prev);
    }
  });
});
