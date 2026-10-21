import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  escapeXml,
  hasIllegalXmlChars,
  stripIllegalXmlChars,
} from "../../dist/core/xml.js";

describe("xml", () => {
  it("strips XML 1.0 illegal controls, FFFE/FFFF, and lone surrogates", () => {
    const input =
      "a\u0000b\u0008c\u000bd\u000ce\u000ef\u001fg\ufffeh\uffffi\ud800j\udc00k";
    const cleaned = stripIllegalXmlChars(input);
    assert.equal(cleaned, "abcdefghijk");
    assert.equal(hasIllegalXmlChars(input), true);
    assert.equal(hasIllegalXmlChars(cleaned), false);
  });

  it("keeps TAB, LF, CR, and valid surrogate pairs", () => {
    const input = "a\tb\nc\rd\u{1F600}e";
    assert.equal(stripIllegalXmlChars(input), input);
    assert.equal(hasIllegalXmlChars(input), false);
  });

  it("escapeXml strips illegals then escapes markup", () => {
    assert.equal(escapeXml('a\u0000&<"b'), "a&amp;&lt;&quot;b");
  });
});
