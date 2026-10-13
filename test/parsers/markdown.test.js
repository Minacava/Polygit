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
    assert.ok(parsed.segments.some((s) => s.sourceText.includes("Title")));
    assert.ok(!parsed.segments.some((s) => s.sourceText.includes("const x")));
  });

  it("keeps YAML front matter raw (including slug)", () => {
    const input = ["---", "slug: my-post", "title: Hello", "---", "", "Body text.", ""].join("\n");
    const parsed = markdownParser.parse(input);
    assert.ok(!parsed.segments.some((s) => s.sourceText.includes("slug:")));
    assert.ok(parsed.segments.some((s) => s.sourceText.includes("Body text")));
  });

  it("segments list items and table cells separately", () => {
    const input = [
      "- First item",
      "- Second item",
      "",
      "| A | B |",
      "| --- | --- |",
      "| one | two |",
      "",
    ].join("\n");
    const parsed = markdownParser.parse(input);
    const texts = parsed.segments.map((s) => s.sourceText);
    assert.ok(texts.includes("First item"));
    assert.ok(texts.includes("Second item"));
    assert.ok(texts.includes("A") || texts.includes(" one") || texts.includes("one"));
    assert.ok(texts.some((t) => t.includes("one")));
    assert.ok(texts.some((t) => t.includes("two")));
  });

  it("keeps links and inline code inside segment text", () => {
    const input = "See [docs](https://example.com) and `code`.\n";
    const parsed = markdownParser.parse(input);
    assert.ok(parsed.segments.some((s) => s.sourceText.includes("[docs](https://example.com)")));
    assert.ok(parsed.segments.some((s) => s.sourceText.includes("`code`")));
  });

  it("round-trips identity without translations", () => {
    const input = [
      "---",
      "slug: keep-me",
      "---",
      "",
      "# Title",
      "",
      "Hello [link](https://ex.com) and `x`.",
      "",
      "- Item one",
      "- Item two",
      "",
      "```js",
      "const x = 1;",
      "```",
      "",
      "| H1 | H2 |",
      "| --- | --- |",
      "| c1 | c2 |",
      "",
    ].join("\n");
    const parsed = markdownParser.parse(input);
    const identity = new Map(parsed.segments.map((s) => [s.orderIndex, s.sourceText]));
    const out = markdownParser.serialize(parsed.skeleton, identity);
    assert.equal(out, input.endsWith("\n") ? input : `${input}\n`);
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
