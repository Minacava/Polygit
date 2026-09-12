import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { matchTranslationMemory, similarity } from "../dist/core/matcher.js";
import { createSegmentId, normalizeText, segmentProse } from "../dist/core/segmenter.js";

describe("segmenter", () => {
  it("creates stable segment ids", () => {
    const a = createSegmentId("sources/a.md", 0, "Hello world.");
    const b = createSegmentId("sources/a.md", 0, "Hello world.");
    const c = createSegmentId("sources/a.md", 1, "Hello world.");
    assert.equal(a, b);
    assert.notEqual(a, c);
  });

  it("normalizes whitespace", () => {
    assert.equal(normalizeText("  hi \n"), "hi");
  });

  it("splits prose into sentence-like segments", () => {
    const segments = segmentProse("Hello world. This is next.");
    assert.ok(segments.length >= 2);
    assert.equal(segments[0]?.orderIndex, 0);
  });
});

describe("matcher", () => {
  const entries = [
    {
      id: "1",
      source_text: "Sign in",
      target_text: "Se connecter",
      lang: "fr",
      usage_count: 1,
    },
    {
      id: "2",
      source_text: "Create account",
      target_text: "Créer un compte",
      lang: "fr",
      usage_count: 1,
    },
  ];

  it("returns exact matches", () => {
    const match = matchTranslationMemory("Sign in", entries);
    assert.equal(match?.kind, "exact");
    assert.equal(match?.entry.target_text, "Se connecter");
  });

  it("returns fuzzy matches above threshold", () => {
    const match = matchTranslationMemory("Sign inn", entries, 0.7);
    assert.equal(match?.kind, "fuzzy");
  });

  it("computes similarity", () => {
    assert.equal(similarity("abc", "abc"), 1);
    assert.ok(similarity("abc", "abd") > 0.5);
  });
});
