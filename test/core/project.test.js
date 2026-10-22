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
    assert.equal(config.autoTranslate, false);
    assert.equal(config.style, undefined);
  });

  it("round-trips optional style and rejects unknown presets", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "polygit-project-style-"));
    writeConfig(root, {
      ...DEFAULT_CONFIG,
      targetLangs: ["fr"],
      style: { preset: "startup", formality: "formal" },
    });
    assert.deepEqual(readConfig(root).style, { preset: "startup", formality: "formal" });

    fs.writeFileSync(
      path.join(root, ".tmconfig.json"),
      JSON.stringify({ style: { preset: "casual" } }),
      "utf8",
    );
    assert.throws(() => readConfig(root), /Unknown style\.preset/);
  });

  it("parses autoTranslate and rejects sourceLang in targetLangs", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "polygit-project-"));
    writeConfig(root, { ...DEFAULT_CONFIG, autoTranslate: true, targetLangs: ["fr"] });
    assert.equal(readConfig(root).autoTranslate, true);

    fs.writeFileSync(
      path.join(root, ".tmconfig.json"),
      JSON.stringify({ autoTranslate: "yes" }),
      "utf8",
    );
    assert.throws(() => readConfig(root), /autoTranslate must be a boolean/);

    fs.writeFileSync(
      path.join(root, ".tmconfig.json"),
      JSON.stringify({ sourceLang: "en", targetLangs: ["en", "fr"] }),
      "utf8",
    );
    assert.throws(() => readConfig(root), /must not appear in targetLangs/);
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

  it("rejects unknown models keys when reading config", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "polygit-project-"));
    fs.writeFileSync(
      path.join(root, ".tmconfig.json"),
      JSON.stringify({
        defaultProvider: "ollama",
        models: { ollama: "mistral", nope: "x" },
      }),
      "utf8",
    );
    assert.throws(() => readConfig(root), /Invalid models key/i);
  });

  it("round-trips forgeHosts and rejects unsafe entries", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "polygit-project-"));
    writeConfig(root, {
      ...DEFAULT_CONFIG,
      forgeHosts: ["git.example.com", "github.mycompany.com"],
    });
    assert.deepEqual(readConfig(root).forgeHosts, [
      "git.example.com",
      "github.mycompany.com",
    ]);

    fs.writeFileSync(
      path.join(root, ".tmconfig.json"),
      JSON.stringify({ forgeHosts: ["https://evil.example/path"] }),
      "utf8",
    );
    assert.throws(() => readConfig(root), /hostname only/i);
  });

  it("rejects malformed or unsafe .tmconfig.json from untrusted repos", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "polygit-project-bad-"));

    fs.writeFileSync(path.join(root, ".tmconfig.json"), "[1,2,3]", "utf8");
    assert.throws(() => readConfig(root), /expected a JSON object/i);

    fs.writeFileSync(path.join(root, ".tmconfig.json"), "{not json", "utf8");
    assert.throws(() => readConfig(root), /not valid JSON/i);

    fs.writeFileSync(
      path.join(root, ".tmconfig.json"),
      JSON.stringify({
        sourceLang: "en",
        contentRoots: ["../outside"],
      }),
      "utf8",
    );
    assert.throws(() => readConfig(root), /Invalid content\/output root/i);

    fs.writeFileSync(
      path.join(root, ".tmconfig.json"),
      JSON.stringify({
        sourceLang: "en/../../etc",
        targetLangs: ["fr"],
      }),
      "utf8",
    );
    assert.throws(() => readConfig(root), /Invalid sourceLang/i);

    fs.writeFileSync(
      path.join(root, ".tmconfig.json"),
      JSON.stringify({
        contentRoots: ["/etc/passwd"],
      }),
      "utf8",
    );
    assert.throws(() => readConfig(root), /absolute path/i);

    fs.writeFileSync(
      path.join(root, ".tmconfig.json"),
      JSON.stringify({
        outputMode: "not-a-mode",
      }),
      "utf8",
    );
    assert.throws(() => readConfig(root), /Invalid outputMode/i);

    fs.writeFileSync(
      path.join(root, ".tmconfig.json"),
      JSON.stringify({
        models: { ollama: "x".repeat(500) },
      }),
      "utf8",
    );
    assert.throws(() => readConfig(root), /maximum length/i);
  });

});
