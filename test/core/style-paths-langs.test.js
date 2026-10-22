import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computeStyleHash,
  matchStylePathOverride,
  parseStyleConfig,
  resolveStyleForDocument,
} from "../../dist/core/style.js";

describe("style paths and langs resolution", () => {
  it("resolves with CLI > longest path > langs > global", () => {
    const style = parseStyleConfig({
      preset: "startup",
      formality: "informal",
      paths: {
        docs: { preset: "technical" },
        "docs/papers": { preset: "academic" },
      },
      langs: {
        de: { formality: "formal" },
      },
    });

    assert.deepEqual(
      resolveStyleForDocument(style, { documentPath: "sources/a.md", lang: "fr" }),
      { preset: "startup", formality: "informal" },
    );
    assert.deepEqual(
      resolveStyleForDocument(style, { documentPath: "docs/intro.md", lang: "fr" }),
      { preset: "technical", formality: "informal" },
    );
    assert.deepEqual(
      resolveStyleForDocument(style, {
        documentPath: "docs/papers/thesis.md",
        lang: "fr",
      }),
      { preset: "academic", formality: "informal" },
    );
    assert.deepEqual(
      resolveStyleForDocument(style, { documentPath: "sources/a.md", lang: "de" }),
      { preset: "startup", formality: "formal" },
    );
    // Path wins over lang for fields it sets; lang formality remains if path omits it.
    assert.deepEqual(
      resolveStyleForDocument(style, {
        documentPath: "docs/papers/thesis.md",
        lang: "de",
      }),
      { preset: "academic", formality: "formal" },
    );
    assert.deepEqual(
      resolveStyleForDocument(style, {
        documentPath: "docs/papers/thesis.md",
        lang: "de",
        style: "marketing",
        formality: "auto",
      }),
      { preset: "marketing", formality: "auto" },
    );
  });

  it("longest path prefix wins", () => {
    const paths = {
      docs: { preset: "technical" },
      "docs/papers": { preset: "academic" },
      "docs/papers/old": { preset: "legal" },
    };
    assert.equal(matchStylePathOverride(paths, "docs/a.md")?.preset, "technical");
    assert.equal(matchStylePathOverride(paths, "docs/papers/x.md")?.preset, "academic");
    assert.equal(matchStylePathOverride(paths, "docs/papers/old/x.md")?.preset, "legal");
    assert.equal(matchStylePathOverride(paths, "blog/a.md"), undefined);
  });

  it("rejects invalid path and lang keys", () => {
    assert.throws(
      () => parseStyleConfig({ paths: { "../x": { preset: "academic" } } }),
      /Invalid style\.paths key/,
    );
    assert.throws(
      () => parseStyleConfig({ paths: { "/abs": { preset: "academic" } } }),
      /Invalid style\.paths key/,
    );
    assert.throws(
      () => parseStyleConfig({ langs: { "!!!": { formality: "formal" } } }),
      /Invalid style\.langs key/,
    );
    assert.throws(
      () =>
        parseStyleConfig({
          paths: Object.fromEntries(
            Array.from({ length: 65 }, (_, i) => [`p${i}`, { preset: "startup" }]),
          ),
        }),
      /exceeds maximum/,
    );
  });

  it("produces different hashes per resolved folder style", () => {
    const style = parseStyleConfig({
      preset: "startup",
      paths: { "docs/papers": { preset: "academic" } },
    });
    const globalH = computeStyleHash(
      resolveStyleForDocument(style, { documentPath: "sources/a.md", lang: "fr" }),
    );
    const papersH = computeStyleHash(
      resolveStyleForDocument(style, {
        documentPath: "docs/papers/a.md",
        lang: "fr",
      }),
    );
    assert.notEqual(globalH, papersH);
  });
});
