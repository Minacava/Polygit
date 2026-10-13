import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { inferFormat, poParser } from "../../dist/parsers/index.js";

describe("po parser", () => {
  it("infers po from extension", () => {
    assert.equal(inferFormat("locales/messages.po"), "po");
    assert.equal(inferFormat("locales/messages.pot"), "po");
  });

  it("extracts msgid units (skips header empty msgid)", () => {
    const input = [
      'msgid ""',
      'msgstr "Content-Type: text/plain; charset=UTF-8\\n"',
      "",
      "#: src/app.ts:1",
      'msgid "Hello"',
      'msgstr ""',
      "",
      'msgid "Save"',
      'msgstr "Guardar"',
      "",
    ].join("\n");
    const parsed = poParser.parse(input);
    assert.equal(parsed.format, "po");
    assert.equal(parsed.segments.length, 2);
    assert.deepEqual(
      parsed.segments.map((s) => s.sourceText),
      ["Hello", "Save"],
    );
  });

  it("round-trips translations into msgstr", () => {
    const input = ['msgid "Hello"', 'msgstr ""', "", 'msgid "Bye"', 'msgstr "Adiós"', ""].join(
      "\n",
    );
    const parsed = poParser.parse(input);
    const map = new Map([[0, "Hola"], [1, "Chao"]]);
    const out = poParser.serialize(parsed.skeleton, map);
    assert.match(out, /msgid "Hello"\nmsgstr "Hola"/);
    assert.match(out, /msgid "Bye"\nmsgstr "Chao"/);
  });
});
