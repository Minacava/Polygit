import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  assertInContentRoots,
  expandImportTargets,
  gitPathPrefixes,
  layoutForPreset,
  listContentFiles,
  matchContentRoot,
  toOutputPath,
} from "../../dist/core/layout.js";
import { DEFAULT_CONFIG, readConfig, writeConfig } from "../../dist/core/project.js";

describe("layout", () => {
  it("matches the longest content root", () => {
    assert.equal(matchContentRoot("docs/a.md", ["docs", "content"]), "docs");
    assert.equal(matchContentRoot("docs/api/a.md", ["docs", "docs/api"]), "docs/api");
    assert.equal(matchContentRoot("other/a.md", ["docs"]), null);
  });

  it("resolves mirror / sidecar / in-place-locale output paths", () => {
    const base = {
      contentRoots: ["docs"],
      outputMode: "mirror",
      outputRoot: "locales",
    };
    assert.equal(
      toOutputPath("docs/getting-started.md", "fr", base),
      "locales/fr/getting-started.md",
    );
    assert.equal(
      toOutputPath("docs/getting-started.md", "fr", {
        ...base,
        outputMode: "sidecar",
      }),
      "docs/getting-started.fr.md",
    );
    assert.equal(
      toOutputPath("docs/getting-started.md", "fr", {
        ...base,
        outputMode: "in-place-locale",
      }),
      "docs/fr/getting-started.md",
    );
  });

  it("defaults legacy configs to sources → outputs mirror", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "polygit-layout-legacy-"));
    fs.writeFileSync(
      path.join(root, ".tmconfig.json"),
      JSON.stringify({ sourceLang: "en", targetLangs: [], defaultProvider: "ollama" }),
      "utf8",
    );
    const config = readConfig(root);
    assert.deepEqual(config.contentRoots, ["sources"]);
    assert.equal(config.outputMode, "mirror");
    assert.equal(config.outputRoot, "outputs");
  });

  it("gitPathPrefixes includes outputRoot only for mirror", () => {
    assert.deepEqual(
      gitPathPrefixes({
        contentRoots: ["docs"],
        outputMode: "mirror",
        outputRoot: "locales",
      }),
      ["docs", "locales"],
    );
    assert.deepEqual(
      gitPathPrefixes({
        contentRoots: ["docs"],
        outputMode: "sidecar",
        outputRoot: "outputs",
      }),
      ["docs"],
    );
  });

  it("lists content files and expands globs", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "polygit-layout-glob-"));
    fs.mkdirSync(path.join(root, "docs", "guide"), { recursive: true });
    fs.writeFileSync(path.join(root, "docs", "a.md"), "# A\n", "utf8");
    fs.writeFileSync(path.join(root, "docs", "guide", "b.md"), "# B\n", "utf8");
    fs.writeFileSync(path.join(root, "docs", "skip.txt"), "x", "utf8");

    assert.deepEqual(listContentFiles(root, ["docs"]), [
      "docs/a.md",
      "docs/guide/b.md",
    ]);
    assert.deepEqual(expandImportTargets(root, "docs/**/*.md"), [
      "docs/a.md",
      "docs/guide/b.md",
    ]);
    assert.deepEqual(expandImportTargets(root, "docs/a.md"), ["docs/a.md"]);
  });

  it("assertInContentRoots throws a clear error", () => {
    assert.throws(
      () => assertInContentRoots("other/a.md", ["docs", "content"]),
      /contentRoots/,
    );
  });

  it("exposes framework presets", () => {
    assert.deepEqual(layoutForPreset("vitepress").contentRoots, ["docs"]);
    assert.equal(layoutForPreset("vitepress").outputMode, "in-place-locale");
    assert.deepEqual(layoutForPreset("json-i18n").contentRoots, ["locales"]);
  });

  it("round-trips layout fields in config", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "polygit-layout-cfg-"));
    writeConfig(root, {
      ...DEFAULT_CONFIG,
      contentRoots: ["docs", "content"],
      outputMode: "sidecar",
      outputRoot: "locales",
    });
    const config = readConfig(root);
    assert.deepEqual(config.contentRoots, ["docs", "content"]);
    assert.equal(config.outputMode, "sidecar");
    assert.equal(config.outputRoot, "locales");
  });
});
