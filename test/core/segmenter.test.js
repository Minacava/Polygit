import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assignStableSegmentIds,
  createSegmentId,
  normalizeText,
  segmentProse,
} from "../../dist/core/segmenter.js";

describe("segmenter", () => {
  it("creates stable segment ids from content, not position", () => {
    const a = createSegmentId("sources/a.md", "Hello world.", 0);
    const b = createSegmentId("sources/a.md", "Hello world.", 0);
    const moved = createSegmentId("sources/a.md", "Hello world.", 0);
    const duplicate = createSegmentId("sources/a.md", "Hello world.", 1);
    assert.equal(a, b);
    assert.equal(a, moved);
    assert.notEqual(a, duplicate);
  });

  it("keeps ids when a preceding paragraph is inserted", () => {
    const before = assignStableSegmentIds("sources/a.md", [
      { orderIndex: 0, sourceText: "Hello world." },
      { orderIndex: 1, sourceText: "Welcome." },
    ]);
    const after = assignStableSegmentIds("sources/a.md", [
      { orderIndex: 0, sourceText: "New intro." },
      { orderIndex: 1, sourceText: "Hello world." },
      { orderIndex: 2, sourceText: "Welcome." },
    ]);
    assert.equal(after[1]?.id, before[0]?.id);
    assert.equal(after[2]?.id, before[1]?.id);
    assert.notEqual(after[0]?.id, before[0]?.id);
  });

  it("normalizes whitespace before hashing", () => {
    assert.equal(normalizeText("  hi \n"), "hi");
    const a = createSegmentId("sources/a.md", "Hello  world.", 0);
    const b = createSegmentId("sources/a.md", "Hello  world.  ", 0);
    assert.equal(a, b);
  });

  it("splits prose into sentence-like segments", () => {
    const segments = segmentProse("Hello world. This is next.");
    assert.ok(segments.length >= 2);
    assert.match(segments[0]?.sourceText ?? "", /Hello/);
    assert.ok((segments[0]?.gapAfter ?? "").length >= 0);
  });

  it("preserves newline gaps between sentences (NEW-01)", () => {
    const parts = segmentProse("Line one.\nLine two.");
    assert.ok(parts.length >= 2);
    assert.match(parts[0]?.gapAfter ?? "", /\n/);
  });

  it("keeps fenced code blocks atomic", () => {
    const segments = segmentProse("Intro.\n\n```js\nconst x = 1;\n```\n\nOutro.");
    assert.ok(segments.some((s) => s.sourceText.includes("```")));
  });
});
