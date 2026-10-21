/**
 * XML 1.0 Char production (excluding the supplementary-plane range, which is
 * represented in JS as valid surrogate pairs):
 *   #x9 | #xA | #xD | [#x20-#xD7FF] | [#xE000-#xFFFD]
 *
 * Drops C0 controls other than TAB/LF/CR, U+FFFE, U+FFFF, and lone surrogates.
 */
export function stripIllegalXmlChars(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = i + 1 < text.length ? text.charCodeAt(i + 1) : 0;
      if (next >= 0xdc00 && next <= 0xdfff) {
        out += text[i]! + text[i + 1]!;
        i += 1;
      }
      continue;
    }
    if (c >= 0xdc00 && c <= 0xdfff) continue;
    if (c === 0xfffe || c === 0xffff) continue;
    if (c < 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d) continue;
    out += text[i]!;
  }
  return out;
}

/** True if `text` contains any character illegal in XML 1.0. */
export function hasIllegalXmlChars(text: string): boolean {
  return stripIllegalXmlChars(text) !== text;
}

/** Strip illegal XML 1.0 characters, then escape the five markup entities. */
export function escapeXml(text: string): string {
  return stripIllegalXmlChars(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
