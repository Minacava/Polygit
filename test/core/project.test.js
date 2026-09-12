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
  });
});
