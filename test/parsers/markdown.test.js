import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getParser, inferFormat, markdownParser } from "../../dist/parsers/index.js";

describe("markdown parser", () => {
  it("infers markdown format from extension", () => {
    assert.equal(inferFormat("sources/readme.md"), "markdown");
    assert.equal(inferFormat("sources/app.json"), "json-i18n");
    assert.equal(inferFormat("sources/notes.txt"), null);
  });

  it("segments headings and prose, keeps fences raw", () => {
    const input = [
      "# Title",
      "",
      "Hello world. Second sentence.",
      "",
      "```js",
      "const x = 1;",
      "```",
      "",
      "Footer text.",
      "",
    ].join("\n");

    const parsed = markdownParser.parse(input);
    assert.equal(parsed.format, "markdown");
    assert.ok(parsed.segments.length >= 3);
    assert.ok(parsed.segments.some((s) => s.sourceText.includes("# Title")));
    assert.ok(!parsed.segments.some((s) => s.sourceText.includes("const x")));
  });

  it("round-trips translations through serialize", () => {
    const input = "Hello world.\n\nGoodbye.\n";
    const parsed = markdownParser.parse(input);
    const map = new Map();
    for (const seg of parsed.segments) {
      map.set(seg.orderIndex, `[fr] ${seg.sourceText}`);
    }
    const out = markdownParser.serialize(parsed.skeleton, map);
    assert.match(out, /\[fr\] Hello/);
    assert.match(out, /\[fr\] Goodbye/);
  });

  it("returns the markdown parser from getParser", () => {
    assert.equal(getParser("markdown").format, "markdown");
  });
});
