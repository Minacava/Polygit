/**
 * Detect translation placeholders that must survive LLM output.
 *
 * Markdown link/image *text* (and image alt) may be translated; only the
 * destination URL/path inside `(...)` must be preserved.
 */

const INLINE_CODE = /`[^`\n]+`/g;
const MUSTACHE = /\{\{[^{}]+\}\}/g;
const SINGLE_BRACE = /\{[a-zA-Z_][a-zA-Z0-9_]*\}/g;
const PRINTF = /%(?:\d+\$)?[sdifFc]/g;
const HTML_TAG = /<\/?[a-zA-Z][^>]*>/g;

/**
 * Capture group 1 = destination that must appear in the translation.
 * Allows one level of nested parentheses (e.g. Wikipedia _(bar)_) and optional titles.
 */
const MARKDOWN_LINK_DEST =
  /!?\[([^\]]*)]\(\s*<?((?:[^()\s]|\([^()\s]*\))+)>?(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/g;

function countBy(tokens: string[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const t of tokens) {
    map.set(t, (map.get(t) ?? 0) + 1);
  }
  return map;
}

function pushAll(re: RegExp, text: string, out: string[]): void {
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push(m[0]);
  }
}

/**
 * Extract placeholder tokens with multiplicity.
 * Inline code is taken as a whole token; braces inside code are not also extracted.
 */
export function extractPlaceholders(text: string): string[] {
  const found: string[] = [];
  const codeSpans: string[] = [];
  pushAll(INLINE_CODE, text, codeSpans);
  found.push(...codeSpans);

  // Mask inline code so `{x}` inside backticks is not double-counted.
  let masked = text.replace(INLINE_CODE, (m) => " ".repeat(m.length));

  const mustaches: string[] = [];
  pushAll(MUSTACHE, masked, mustaches);
  found.push(...mustaches);
  masked = masked.replace(MUSTACHE, (m) => " ".repeat(m.length));

  pushAll(SINGLE_BRACE, masked, found);
  pushAll(PRINTF, masked, found);
  pushAll(HTML_TAG, masked, found);

  MARKDOWN_LINK_DEST.lastIndex = 0;
  let link: RegExpExecArray | null;
  while ((link = MARKDOWN_LINK_DEST.exec(text)) !== null) {
    const dest = link[2]?.trim();
    if (dest) found.push(dest);
  }
  return found;
}

/**
 * Count occurrences of `token` that are not a prefix of a longer brace token
 * (so `{name}` does not match inside `{name}x`).
 */
function countExactToken(text: string, token: string): number {
  let n = 0;
  let from = 0;
  while (from <= text.length) {
    const i = text.indexOf(token, from);
    if (i < 0) break;
    const after = text[i + token.length];
    if (
      token.startsWith("{") &&
      !token.startsWith("{{") &&
      after &&
      /[a-zA-Z0-9_]/.test(after)
    ) {
      from = i + 1;
      continue;
    }
    n += 1;
    from = i + token.length;
  }
  return n;
}

/**
 * Tokens required by `source` that are missing (or under-counted) in `translation`.
 */
export function missingPlaceholders(source: string, translation: string): string[] {
  const need = countBy(extractPlaceholders(source));
  const missing: string[] = [];
  for (const [tok, n] of need) {
    const got =
      tok.startsWith("`") || tok.startsWith("http") || tok.startsWith("/") || tok.startsWith("#")
        ? (countBy(extractPlaceholders(translation)).get(tok) ?? 0)
        : countExactToken(translation, tok);
    for (let i = got; i < n; i++) missing.push(tok);
  }
  return missing;
}

/** Extra placeholders present in translation but not source (e.g. injected links). */
export function extraPlaceholders(source: string, translation: string): string[] {
  const need = countBy(extractPlaceholders(source));
  const have = countBy(extractPlaceholders(translation));
  const extra: string[] = [];
  for (const [tok, n] of have) {
    const expected = need.get(tok) ?? 0;
    for (let i = expected; i < n; i++) extra.push(tok);
  }
  return extra;
}

export function placeholdersPreserved(source: string, translation: string): boolean {
  return missingPlaceholders(source, translation).length === 0;
}
