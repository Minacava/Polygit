import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createSegmentId, normalizeText, segmentProse } from "../../dist/core/segmenter.js";

describe("segmenter", () => {
  it("creates stable segment ids for the same inputs", () => {
    const a = createSegmentId("sources/a.md", 0, "Hello world.");
    const b = createSegmentId("sources/a.md", 0, "Hello world.");
    const c = createSegmentId("sources/a.md", 1, "Hello world.");
    assert.equal(a, b);
    assert.notEqual(a, c);
  });

  it("normalizes whitespace before hashing", () => {
    assert.equal(normalizeText("  hi \n"), "hi");
    const a = createSegmentId("sources/a.md", 0, "Hello  world.");
    const b = createSegmentId("sources/a.md", 0, "Hello  world.  ");
    assert.equal(a, b);
  });

  it("splits prose into sentence-like segments", () => {
    const segments = segmentProse("Hello world. This is next.");
    assert.ok(segments.length >= 2);
    assert.equal(segments[0]?.orderIndex, 0);
    assert.match(segments[0]?.sourceText ?? "", /Hello/);
  });

  it("keeps fenced code blocks atomic", () => {
    const segments = segmentProse("Intro.\n\n```js\nconst x = 1;\n```\n\nOutro.");
    assert.ok(segments.some((s) => s.sourceText.includes("```")));
  });
});
