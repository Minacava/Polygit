import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { runConfigGet, runConfigSet } from "../../dist/commands/config.js";
import { runInit } from "../../dist/commands/init.js";
import { runImport } from "../../dist/commands/import.js";
import { runTranslate } from "../../dist/commands/translate.js";
import { readConfig, writeConfig, DEFAULT_CONFIG } from "../../dist/core/project.js";
import { PRESET_INSTRUCTIONS } from "../../dist/core/style.js";

async function withProject(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "polygit-style-cli-"));
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

describe("style via config and CLI", () => {
  it("config get/set style.preset and style.formality", async () => {
    await withProject(() => {
      assert.equal(runConfigGet("style.preset"), "");
      assert.equal(runConfigGet("style.formality"), "");

      runConfigSet("style.preset", "startup");
      runConfigSet("style.formality", "formal");

      assert.equal(runConfigGet("style.preset"), "startup");
      assert.equal(runConfigGet("style.formality"), "formal");
      const config = readConfig(process.cwd());
      assert.deepEqual(config.style, { preset: "startup", formality: "formal" });
    });
  });

  it("rejects invalid style values on config set", async () => {
    await withProject(() => {
      assert.throws(() => runConfigSet("style.preset", "casual"), /Unknown style\.preset/);
      assert.throws(() => runConfigSet("style.formality", "polite"), /Unknown style\.formality/);
    });
  });

  it("readConfig rejects invalid style in .tmconfig.json", async () => {
    await withProject((root) => {
      fs.writeFileSync(
        path.join(root, ".tmconfig.json"),
        JSON.stringify({
          ...DEFAULT_CONFIG,
          targetLangs: ["fr"],
          style: { preset: "nope" },
        }),
        "utf8",
      );
      assert.throws(() => readConfig(root), /Unknown style\.preset/);
    });
  });

  it("init --style and --formality write style into config", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "polygit-style-init-"));
    const prev = process.cwd();
    process.chdir(root);
    try {
      await runInit(root, {
        sourceLang: "en",
        targetLangs: "de",
        content: "sources",
        output: "outputs",
        style: "technical",
        formality: "formal",
      });
      const config = readConfig(root);
      assert.deepEqual(config.style, { preset: "technical", formality: "formal" });
    } finally {
      process.chdir(prev);
    }
  });

  it("init prompt Enter keeps style unset; answering a preset stores it", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "polygit-style-prompt-"));
    const prev = process.cwd();
    process.chdir(root);
    try {
      await runInit(root, {
        sourceLang: "en",
        content: "sources",
        output: "outputs",
        prompt: async (q) => {
          if (/Target languages/.test(q)) return "fr";
          if (/automatically/.test(q)) return "n";
          if (/Translation style preset/.test(q)) return "";
          throw new Error(`Unexpected prompt: ${q}`);
        },
      });
      assert.equal(readConfig(root).style, undefined);

      const root2 = fs.mkdtempSync(path.join(os.tmpdir(), "polygit-style-prompt2-"));
      process.chdir(root2);
      await runInit(root2, {
        sourceLang: "en",
        content: "sources",
        output: "outputs",
        prompt: async (q) => {
          if (/Target languages/.test(q)) return "es";
          if (/automatically/.test(q)) return "n";
          if (/Translation style preset/.test(q)) return "marketing";
          throw new Error(`Unexpected prompt: ${q}`);
        },
      });
      assert.deepEqual(readConfig(root2).style, { preset: "marketing" });
    } finally {
      process.chdir(prev);
    }
  });

  it("--style on translate overrides config style in the LLM context", async () => {
    await withProject(async (root) => {
      writeConfig(root, {
        ...readConfig(root),
        style: { preset: "startup", formality: "informal" },
      });
      fs.writeFileSync(path.join(root, "sources", "a.md"), "Hello.\n", "utf8");
      runImport("sources/a.md", { format: "markdown" });

      let seenStyle;
      const mock = {
        name: "ollama",
        async translateSegment(_text, _src, _lang, context) {
          seenStyle = context?.style;
          return "Hola.";
        },
      };

      await runTranslate("fr", {
        providerInstance: mock,
        provider: "ollama",
        style: "academic",
        formality: "formal",
        noBranch: true,
      });

      assert.deepEqual(seenStyle, { preset: "academic", formality: "formal" });
      assert.notEqual(seenStyle.preset, "startup");
      assert.match(PRESET_INSTRUCTIONS.academic, /academic/);
    });
  });
});
