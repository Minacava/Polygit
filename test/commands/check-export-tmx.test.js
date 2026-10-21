import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { runCheck } from "../../dist/commands/check.js";
import { runExportTmx } from "../../dist/commands/export-tmx.js";
import { runImport } from "../../dist/commands/import.js";
import { runInit } from "../../dist/commands/init.js";
import { writeOutputDocuments } from "../../dist/core/output.js";
import { openProjectDb } from "../../dist/core/project.js";
import { upsertTranslation, upsertTranslationMemory } from "../../dist/core/repository.js";
import { hasIllegalXmlChars } from "../../dist/core/xml.js";

describe("check and export-tmx", () => {
  it("check fails while pending, passes after translation", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "polygit-check-"));
    const prev = process.cwd();
    process.chdir(root);
    try {
      await runInit();
      fs.writeFileSync(path.join(root, "sources", "a.md"), "Hello world.\n", "utf8");
      runImport("sources/a.md");
      assert.throws(() => runCheck({ lang: "fr", quiet: true }), /pending/);

      const db = openProjectDb(root);
      try {
        const seg = db.prepare(`SELECT id FROM segments LIMIT 1`).get();
        upsertTranslation(db, seg.id, "fr", "Bonjour le monde.", "manual", true);
        writeOutputDocuments(db, root, "fr", ["sources/a.md"]);
      } finally {
        db.close();
      }

      const ok = runCheck({ lang: "fr", quiet: true });
      assert.equal(ok.ok, true);
      assert.equal(ok.pending, 0);
      assert.equal(ok.stale, 0);
    } finally {
      process.chdir(prev);
    }
  });

  it("export-tmx writes TMX with source/target pairs", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "polygit-tmx-"));
    const prev = process.cwd();
    process.chdir(root);
    try {
      await runInit();
      const db = openProjectDb(root);
      try {
        upsertTranslationMemory(db, "Hello", "Hola", "es");
        upsertTranslationMemory(db, "Bye", "Adiós", "es");
      } finally {
        db.close();
      }

      const { outPath, units } = runExportTmx({ lang: "es", out: "out/tm-es.tmx" });
      assert.equal(units, 2);
      const xml = fs.readFileSync(outPath, "utf8");
      assert.match(xml, /<tmx version="1\.4">/);
      assert.match(xml, /\bo-tmf="polygit"/);
      assert.match(xml, /xml:lang="en"><seg>Hello<\/seg>/);
      assert.match(xml, /xml:lang="es"><seg>Hola<\/seg>/);
      assert.match(xml, /<seg>Adiós<\/seg>/);
    } finally {
      process.chdir(prev);
    }
  });

  it("export-tmx strips illegal XML 1.0 characters from segments", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "polygit-tmx-ctrl-"));
    const prev = process.cwd();
    process.chdir(root);
    try {
      await runInit();
      const db = openProjectDb(root);
      try {
        upsertTranslationMemory(db, "Hello\u0000world", "Hola\u0001mundo", "es");
      } finally {
        db.close();
      }

      const { outPath } = runExportTmx({ lang: "es", out: "out/tm-es.tmx" });
      const xml = fs.readFileSync(outPath, "utf8");
      assert.equal(hasIllegalXmlChars(xml), false);
      assert.equal(xml.includes("\u0000"), false);
      assert.equal(xml.includes("\u0001"), false);
      assert.match(xml, /<seg>Helloworld<\/seg>/);
      assert.match(xml, /<seg>Holamundo<\/seg>/);
    } finally {
      process.chdir(prev);
    }
  });

  it("imports po/yaml/xliff files by extension", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "polygit-formats-"));
    const prev = process.cwd();
    process.chdir(root);
    try {
      await runInit();
      fs.writeFileSync(
        path.join(root, "sources", "messages.po"),
        ['msgid "Hello"', 'msgstr ""', ""].join("\n"),
        "utf8",
      );
      fs.writeFileSync(path.join(root, "sources", "en.yml"), "title: Welcome\n", "utf8");
      fs.writeFileSync(
        path.join(root, "sources", "app.xlf"),
        `<xliff version="1.2"><file><body>
          <trans-unit id="1"><source>Save</source></trans-unit>
        </body></file></xliff>\n`,
        "utf8",
      );

      const po = runImport("sources/messages.po");
      const yaml = runImport("sources/en.yml");
      const xliff = runImport("sources/app.xlf");
      assert.equal(po[0].format, "po");
      assert.equal(yaml[0].format, "yaml");
      assert.equal(xliff[0].format, "xliff");
      assert.equal(po[0].segments, 1);
      assert.equal(yaml[0].segments, 1);
      assert.equal(xliff[0].segments, 1);
    } finally {
      process.chdir(prev);
    }
  });
});
