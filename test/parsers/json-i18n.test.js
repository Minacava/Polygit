import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { jsonI18nParser } from "../../dist/parsers/index.js";

describe("json-i18n parser", () => {
  it("extracts string leaves as segments", () => {
    const input = JSON.stringify(
      {
        app: {
          title: "Welcome",
          buttons: ["Save", "Cancel"],
        },
      },
      null,
      2,
    );
    const parsed = jsonI18nParser.parse(input);
    assert.equal(parsed.format, "json-i18n");
    assert.equal(parsed.segments.length, 3);
    assert.deepEqual(
      parsed.segments.map((s) => s.sourceText).sort(),
      ["Cancel", "Save", "Welcome"],
    );
  });

  it("preserves structure when serializing translations", () => {
    const input = JSON.stringify({ greeting: "Hello", nested: { bye: "Goodbye" } }, null, 2);
    const parsed = jsonI18nParser.parse(input);
    const map = new Map(parsed.segments.map((s) => [s.orderIndex, `FR:${s.sourceText}`]));
    const out = JSON.parse(jsonI18nParser.serialize(parsed.skeleton, map));
    assert.equal(out.greeting, "FR:Hello");
    assert.equal(out.nested.bye, "FR:Goodbye");
  });

  it("rejects invalid JSON", () => {
    assert.throws(() => jsonI18nParser.parse("{not-json"), /Invalid JSON/i);
  });
});
