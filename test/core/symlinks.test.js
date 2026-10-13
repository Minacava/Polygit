import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { resolveInsideProject } from "../../dist/core/paths.js";
import { listContentFiles } from "../../dist/core/layout.js";
import { runInit } from "../../dist/commands/init.js";
import { runImport } from "../../dist/commands/import.js";
import { runTranslate } from "../../dist/commands/translate.js";
import { openProjectDb } from "../../dist/core/project.js";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "polygit-sym-"));

describe("symlink protection", () => {
  it("allows regular and not-yet-existing paths", () => {
    const root = tmp();
    fs.mkdirSync(path.join(root, "sources"));
    fs.writeFileSync(path.join(root, "sources", "a.md"), "x");
    assert.equal(resolveInsideProject(root, "sources/a.md"), path.join(root, "sources", "a.md"));
    assert.equal(
      resolveInsideProject(root, "outputs/fr/new.md"),
      path.join(root, "outputs", "fr", "new.md"),
    );
  });

  it("works when the project root itself is reached through a symlink", () => {
    const real = tmp();
    fs.mkdirSync(path.join(real, "sources"));
    fs.writeFileSync(path.join(real, "sources", "a.md"), "x");
    const link = path.join(tmp(), "linked-root");
    fs.symlinkSync(real, link);
    assert.equal(resolveInsideProject(link, "sources/a.md"), path.join(link, "sources", "a.md"));
  });

  it("refuses a symlinked file, even one pointing inside the project", () => {
    const root = tmp();
    fs.mkdirSync(path.join(root, "sources"));
    fs.writeFileSync(path.join(root, ".env"), "SECRET=1");
    fs.symlinkSync(path.join(root, ".env"), path.join(root, "sources", "leak.md"));
    assert.throws(() => resolveInsideProject(root, "sources/leak.md"), /symlink/);
  });

  it("refuses a symlinked directory component and a dangling symlink", () => {
    const root = tmp();
    const outside = tmp();
    fs.writeFileSync(path.join(outside, "x.md"), "secret");
    fs.symlinkSync(outside, path.join(root, "sources"));
    assert.throws(() => resolveInsideProject(root, "sources/x.md"), /symlink/);
    fs.symlinkSync(path.join(outside, "missing"), path.join(root, "dangling"));
    assert.throws(() => resolveInsideProject(root, "dangling/y.md"), /symlink/);
  });

  it("import does not read a symlink to a file outside the project", async () => {
    const root = tmp();
    const outside = tmp();
    const secret = path.join(outside, "secret.txt");
    fs.writeFileSync(secret, "TOPSECRET");
    const cwd0 = process.cwd();
    process.chdir(root);
    try {
      await runInit(root);
      fs.symlinkSync(secret, path.join(root, "sources", "leak.md"));
      assert.throws(() => runImport("sources/leak.md"), /symlink/);
      const db = openProjectDb(root);
      try {
        const n = db.prepare("SELECT COUNT(*) AS n FROM segments").get().n;
        assert.equal(n, 0);
      } finally {
        db.close();
      }
    } finally {
      process.chdir(cwd0);
    }
  });

  it("translate does not write through a symlinked output file", async () => {
    const root = tmp();
    const outside = tmp();
    const target = path.join(outside, "victim.md");
    fs.writeFileSync(target, "ORIGINAL");
    const cwd0 = process.cwd();
    process.chdir(root);
    try {
      await runInit(root);
      fs.writeFileSync(path.join(root, "sources", "a.md"), "# Hi\n\nText here.\n");
      runImport("sources/a.md");
      fs.mkdirSync(path.join(root, "outputs", "fr"), { recursive: true });
      fs.symlinkSync(target, path.join(root, "outputs", "fr", "a.md"));
      await assert.rejects(
        runTranslate("fr", {
          providerInstance: { name: "ollama", translateSegment: async (t) => `[T]${t}` },
        }),
        /symlink/,
      );
      assert.equal(fs.readFileSync(target, "utf8"), "ORIGINAL");
    } finally {
      process.chdir(cwd0);
    }
  });

  it("directory walks skip symlinked files", () => {
    const root = tmp();
    fs.mkdirSync(path.join(root, "sources"));
    fs.writeFileSync(path.join(root, "sources", "ok.md"), "x");
    fs.symlinkSync(path.join(root, "sources", "ok.md"), path.join(root, "sources", "link.md"));
    assert.deepEqual(listContentFiles(root, ["sources"]), ["sources/ok.md"]);
  });
});
