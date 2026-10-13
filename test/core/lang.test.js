import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { assertLangCode, isValidLangCode } from "../../dist/core/lang.js";
import { toOutputPath } from "../../dist/core/layout.js";
import { runTranslate } from "../../dist/commands/translate.js";
import { runReview } from "../../dist/commands/review.js";
import { runPublish } from "../../dist/commands/publish.js";
import { runStatus } from "../../dist/commands/status.js";
import { runGlossaryAdd, runGlossarySync } from "../../dist/commands/glossary.js";
import { runInit } from "../../dist/commands/init.js";
import { runImport } from "../../dist/commands/import.js";

const BAD = ["../sources", "..", "fr/../../x", "fr\\..\\x", "/etc", "f r", "", "fr.md", "a", "fr-", "x".repeat(40)];
const GOOD = ["fr", "es", "pt-BR", "zh-Hans", "zh-Hans-CN", "es-419", "fil"];

describe("lang code validation", () => {
  it("accepts BCP 47-style tags", () => {
    for (const l of GOOD) assert.equal(isValidLangCode(l), true, l);
  });

  it("rejects path-like and malformed values", () => {
    for (const l of BAD) assert.equal(isValidLangCode(l), false, l);
    assert.throws(() => assertLangCode("../sources"), /Invalid language code/);
    assert.throws(() => assertLangCode(undefined), /Invalid language code/);
  });

  it("toOutputPath refuses a traversing lang in every output mode", () => {
    for (const outputMode of ["mirror", "sidecar", "in-place-locale"]) {
      const cfg = { contentRoots: ["sources"], outputMode, outputRoot: "outputs" };
      assert.throws(() => toOutputPath("sources/a.md", "../sources", cfg), /Invalid language/);
    }
  });
});

describe("lang validation in commands", () => {
  const cwd0 = process.cwd();
  const mk = async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "polygit-lang-"));
    process.chdir(dir);
    await runInit(dir);
    fs.writeFileSync(path.join(dir, "sources", "a.md"), "# Title\n\nHello there.\n");
    runImport("sources/a.md");
    return dir;
  };

  it("does not overwrite sources when translate gets a traversing lang", async () => {
    const dir = await mk();
    try {
      const before = fs.readFileSync(path.join(dir, "sources", "a.md"), "utf8");
      await assert.rejects(
        runTranslate("../sources", {
          providerInstance: { name: "ollama", translateSegment: async (t) => `[T]${t}` },
        }),
        /Invalid language/,
      );
      assert.equal(fs.readFileSync(path.join(dir, "sources", "a.md"), "utf8"), before);
    } finally {
      process.chdir(cwd0);
    }
  });

  it("rejects bad lang in review, publish, status and glossary", async () => {
    await mk();
    try {
      await assert.rejects(runReview({ lang: "../x" }), /Invalid language/);
      await assert.rejects(runPublish({ lang: "../x", yes: true }), /Invalid language/);
      assert.throws(() => runStatus({ lang: "../x" }), /Invalid language/);
      assert.throws(() => runGlossaryAdd("a", "b", { lang: "../x" }), /Invalid language/);
      await assert.rejects(runGlossarySync({ lang: "../x" }), /Invalid language/);
    } finally {
      process.chdir(cwd0);
    }
  });
});
