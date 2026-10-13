import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { inferFormat, xliffParser } from "../../dist/parsers/index.js";

describe("xliff parser", () => {
  it("infers xliff from extension", () => {
    assert.equal(inferFormat("locales/app.xliff"), "xliff");
    assert.equal(inferFormat("locales/app.xlf"), "xliff");
  });

  it("extracts trans-unit sources", () => {
    const input = `<?xml version="1.0"?>
<xliff version="1.2">
  <file source-language="en" target-language="fr">
    <body>
      <trans-unit id="1">
        <source>Hello</source>
        <target></target>
      </trans-unit>
      <trans-unit id="2">
        <source>Bye</source>
      </trans-unit>
    </body>
  </file>
</xliff>
`;
    const parsed = xliffParser.parse(input);
    assert.equal(parsed.format, "xliff");
    assert.deepEqual(
      parsed.segments.map((s) => s.sourceText),
      ["Hello", "Bye"],
    );
  });

  it("writes targets on serialize", () => {
    const input = `<xliff version="1.2">
  <file>
    <body>
      <trans-unit id="u1">
        <source>Hello</source>
        <target></target>
      </trans-unit>
    </body>
  </file>
</xliff>
`;
    const parsed = xliffParser.parse(input);
    const out = xliffParser.serialize(parsed.skeleton, new Map([[0, "Hola"]]));
    assert.match(out, /<target>Hola<\/target>/);
    assert.match(out, /<source>Hello<\/source>/);
  });
});
