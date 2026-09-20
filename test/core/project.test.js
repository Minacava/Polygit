import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  DEFAULT_CONFIG,
  readConfig,
  resolveInsideProject,
  toPosixRelative,
  writeConfig,
} from "../../dist/core/project.js";

describe("project", () => {
  it("rejects paths that escape the project root", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "polygit-project-"));
    assert.throws(() => resolveInsideProject(root, "../outside.txt"), /escapes project root/i);
    assert.throws(() => resolveInsideProject(root, "/etc/passwd"), /escapes project root/i);
  });

  it("resolves paths inside the project", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "polygit-project-"));
    const abs = resolveInsideProject(root, "sources/a.md");
    assert.equal(toPosixRelative(root, abs), "sources/a.md");
  });

  it("round-trips config", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "polygit-project-"));
    writeConfig(root, {
      ...DEFAULT_CONFIG,
      sourceLang: "en",
      targetLangs: ["fr"],
      defaultProvider: "openai",
    });
    const config = readConfig(root);
    assert.equal(config.sourceLang, "en");
    assert.deepEqual(config.targetLangs, ["fr"]);
    assert.equal(config.defaultProvider, "openai");
    assert.deepEqual(config.contentRoots, ["sources"]);
    assert.equal(config.outputMode, "mirror");
    assert.equal(config.outputRoot, "outputs");
  });

  it("reads ollama and huggingface defaultProvider values", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "polygit-project-"));
    writeConfig(root, { ...DEFAULT_CONFIG, defaultProvider: "ollama" });
    assert.equal(readConfig(root).defaultProvider, "ollama");

    writeConfig(root, { ...DEFAULT_CONFIG, defaultProvider: "huggingface" });
    assert.equal(readConfig(root).defaultProvider, "huggingface");

    fs.writeFileSync(
      path.join(root, ".tmconfig.json"),
      JSON.stringify({ defaultProvider: "not-a-provider" }),
      "utf8",
    );
    assert.equal(readConfig(root).defaultProvider, "ollama");
  });

  it("round-trips the models map", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "polygit-project-"));
    writeConfig(root, {
      ...DEFAULT_CONFIG,
      defaultProvider: "ollama",
      models: { ollama: "qwen2.5:7b", huggingface: "org/model" },
    });
    const config = readConfig(root);
    assert.equal(config.models.ollama, "qwen2.5:7b");
    assert.equal(config.models.huggingface, "org/model");
    assert.equal(config.models.claude, undefined);
  });

  it("ignores invalid models keys when reading config", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "polygit-project-"));
    fs.writeFileSync(
      path.join(root, ".tmconfig.json"),
      JSON.stringify({
        defaultProvider: "ollama",
        models: { ollama: "mistral", nope: "x", openai: "  " },
      }),
      "utf8",
    );
    const config = readConfig(root);
    assert.equal(config.models.ollama, "mistral");
    assert.equal(config.models.openai, undefined);
    assert.equal("nope" in config.models, false);
  });

});
