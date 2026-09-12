import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { matchTranslationMemory, similarity } from "../../dist/core/matcher.js";

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
});
