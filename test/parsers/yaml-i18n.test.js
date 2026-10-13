import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { inferFormat, yamlI18nParser } from "../../dist/parsers/index.js";

describe("yaml-i18n parser", () => {
  it("infers yaml from extension", () => {
    assert.equal(inferFormat("locales/en.yml"), "yaml");
    assert.equal(inferFormat("locales/en.yaml"), "yaml");
  });

  it("extracts leaf key: value strings", () => {
    const input = ["app:", "  title: Welcome", "  save: Save", "  nested:", "    bye: Goodbye", ""].join(
      "\n",
    );
    const parsed = yamlI18nParser.parse(input);
    assert.equal(parsed.format, "yaml");
    assert.deepEqual(
      parsed.segments.map((s) => s.sourceText),
      ["Welcome", "Save", "Goodbye"],
    );
  });

  it("round-trips translations preserving indent", () => {
    const input = "title: Hello\n";
    const parsed = yamlI18nParser.parse(input);
    const out = yamlI18nParser.serialize(parsed.skeleton, new Map([[0, "Hola"]]));
    assert.equal(out, "title: Hola\n");
  });
});
