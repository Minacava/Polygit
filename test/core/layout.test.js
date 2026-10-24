import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  assertInContentRoots,
  expandImportTargets,
  gitPathPrefixes,
  isManagedOutputPath,
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

  it("isManagedOutputPath detects outputs without flagging sources", () => {
    const mirror = {
      contentRoots: ["docs"],
      outputMode: "mirror",
      outputRoot: "locales",
    };
    assert.equal(isManagedOutputPath("locales/fr/a.md", mirror, ["fr"]), true);
    assert.equal(isManagedOutputPath("docs/a.md", mirror, ["fr"]), false);

    const sidecar = { ...mirror, outputMode: "sidecar" };
    assert.equal(isManagedOutputPath("docs/a.fr.md", sidecar, ["fr"]), true);
    assert.equal(isManagedOutputPath("docs/a.md", sidecar, ["fr"]), false);
    assert.equal(isManagedOutputPath("docs/a.es.md", sidecar, ["fr"]), false);

    const inplace = { ...mirror, outputMode: "in-place-locale" };
    assert.equal(isManagedOutputPath("docs/fr/a.md", inplace, ["fr"]), true);
    assert.equal(isManagedOutputPath("docs/a.md", inplace, ["fr"]), false);
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

  it("excludes managed outputs from import globs and --root (PG-01)", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "polygit-layout-out-"));
    fs.mkdirSync(path.join(root, "docs", "fr", "guide"), { recursive: true });
    fs.writeFileSync(path.join(root, "docs", "index.md"), "# En\n", "utf8");
    fs.writeFileSync(path.join(root, "docs", "fr", "index.md"), "# Fr\n", "utf8");
    fs.writeFileSync(
      path.join(root, "docs", "fr", "guide", "install.md"),
      "# Install\n",
      "utf8",
    );
    fs.writeFileSync(path.join(root, "docs", "intro.fr.md"), "# Side\n", "utf8");

    const inplace = {
      contentRoots: ["docs"],
      outputMode: "in-place-locale",
      outputRoot: "outputs",
    };
    assert.deepEqual(
      expandImportTargets(root, "docs/**/*.md", {
        layout: inplace,
        targetLangs: ["fr"],
      }),
      ["docs/index.md", "docs/intro.fr.md"],
    );
    assert.deepEqual(
      expandImportTargets(root, ".", {
        root: "docs",
        layout: inplace,
        targetLangs: ["fr"],
      }),
      ["docs/index.md", "docs/intro.fr.md"],
    );
    assert.throws(
      () =>
        expandImportTargets(root, "docs/fr/index.md", {
          layout: inplace,
          targetLangs: ["fr"],
        }),
      /polygit output/i,
    );

    const sidecar = { ...inplace, outputMode: "sidecar" };
    assert.deepEqual(
      expandImportTargets(root, "docs/**/*.md", {
        layout: sidecar,
        targetLangs: ["fr"],
      }),
      ["docs/fr/guide/install.md", "docs/fr/index.md", "docs/index.md"],
    );

    fs.mkdirSync(path.join(root, "outputs", "fr"), { recursive: true });
    fs.writeFileSync(path.join(root, "outputs", "fr", "index.md"), "# M\n", "utf8");
    const mirror = { ...inplace, outputMode: "mirror", outputRoot: "outputs" };
    assert.deepEqual(
      expandImportTargets(root, "outputs/**/*.md", {
        layout: mirror,
        targetLangs: ["fr"],
      }),
      [],
    );
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
