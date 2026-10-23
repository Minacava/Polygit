import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  extractPlaceholders,
  missingPlaceholders,
  placeholdersPreserved,
} from "../../dist/core/placeholders.js";

describe("placeholders", () => {
  it("extracts common placeholder forms", () => {
    const text = "Hi {name}, {{count}} files, %s and <b>bold</b> [x](http://y)";
    const found = extractPlaceholders(text);
    assert.ok(found.includes("{name}"));
    assert.ok(found.includes("{{count}}"));
    assert.ok(found.includes("%s"));
    assert.ok(found.includes("<b>"));
    assert.ok(found.includes("</b>"));
    // Link text may change; only the destination is required.
    assert.ok(found.includes("http://y"));
    assert.ok(!found.includes("[x](http://y)"));
  });

  it("detects missing placeholders in a bad translation", () => {
    const source = "Hello {name}, see [docs](https://ex.com) and <br/>";
    const bad = "Bonjour ami, voir le site";
    assert.equal(placeholdersPreserved(source, bad), false);
    const missing = missingPlaceholders(source, bad);
    assert.ok(missing.includes("{name}"));
    assert.ok(missing.includes("https://ex.com"));
    assert.ok(missing.includes("<br/>"));
  });

  it("accepts translated link text when the URL is preserved", () => {
    const source = "See [docs](https://ex.com/guide) for details.";
    const good = "Voir [la documentation](https://ex.com/guide) pour plus de détails.";
    assert.equal(placeholdersPreserved(source, good), true);
    assert.deepEqual(missingPlaceholders(source, good), []);
  });

  it("accepts translations that keep every token", () => {
    const source = "Hello {name} — %s — {{x}} — <em>y</em>";
    const good = "Bonjour {name} — %s — {{x}} — <em>y</em>";
    assert.equal(placeholdersPreserved(source, good), true);
    assert.deepEqual(missingPlaceholders(source, good), []);
  });
});
