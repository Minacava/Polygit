import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  TranslationMemoryIndex,
  mapPool,
  matchTranslationMemory,
  similarity,
} from "../../dist/core/matcher.js";

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

  it("returns exact matches first", () => {
    const match = matchTranslationMemory("Sign in", entries);
    assert.equal(match?.kind, "exact");
    assert.equal(match?.score, 1);
    assert.equal(match?.entry.target_text, "Se connecter");
  });

  it("returns fuzzy matches above the threshold", () => {
    const match = matchTranslationMemory("Sign inn", entries, 0.7);
    assert.equal(match?.kind, "fuzzy");
    assert.ok((match?.score ?? 0) >= 0.7);
  });

  it("returns null when nothing is close enough", () => {
    const match = matchTranslationMemory("Completely different", entries, 0.9);
    assert.equal(match, null);
  });

  it("computes similarity", () => {
    assert.equal(similarity("abc", "abc"), 1);
    assert.ok(similarity("abc", "abd") > 0.5);
    assert.equal(similarity("", "abc"), 0);
  });

  it("skips fuzzy candidates outside the length window", () => {
    const index = new TranslationMemoryIndex([
      {
        id: "short",
        source_text: "Hi",
        target_text: "Salut",
        lang: "fr",
        usage_count: 1,
      },
      {
        id: "long",
        source_text: "This is a much longer sentence for length filtering",
        target_text: "Longue",
        lang: "fr",
        usage_count: 1,
      },
    ]);
    // Needle length far from "Hi"; should not fuzzy-match the short entry at high threshold.
    const match = index.match("This is a much longer sentence for length filterin", 0.9);
    assert.equal(match?.entry.id, "long");
  });

  it("mapPool respects concurrency and preserves order", async () => {
    let live = 0;
    let peak = 0;
    const out = await mapPool([1, 2, 3, 4, 5], 2, async (n) => {
      live += 1;
      peak = Math.max(peak, live);
      await new Promise((r) => setTimeout(r, 5));
      live -= 1;
      return n * 10;
    });
    assert.deepEqual(out, [10, 20, 30, 40, 50]);
    assert.ok(peak <= 2);
  });
});

