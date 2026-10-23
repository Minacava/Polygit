/**
 * Detect translation placeholders that must survive LLM output.
 *
 * Markdown link/image *text* (and image alt) may be translated; only the
 * destination URL/path inside `(...)` must be preserved.
 */

const EXACT_PATTERNS: RegExp[] = [
  /\{\{[^{}]+\}\}/g, // {{name}}
  /\{[a-zA-Z_][a-zA-Z0-9_]*\}/g, // {name}
  /%(?:\d+\$)?[sdifFc]/g, // %s, %d, %1$s
  /<\/?[a-zA-Z][^>]*>/g, // HTML tags
];

/** Capture group 1 = destination that must appear in the translation. */
const MARKDOWN_LINK_DEST = /!?\[([^\]]*)]\(([^)]+)\)/g;

export function extractPlaceholders(text: string): string[] {
  const found = new Set<string>();
  for (const re of EXACT_PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      found.add(m[0]);
    }
  }
  MARKDOWN_LINK_DEST.lastIndex = 0;
  let link: RegExpExecArray | null;
  while ((link = MARKDOWN_LINK_DEST.exec(text)) !== null) {
    const dest = link[2]?.trim();
    if (dest) found.add(dest);
  }
  return [...found].sort();
}

export function missingPlaceholders(source: string, translation: string): string[] {
  const required = extractPlaceholders(source);
  return required.filter((token) => !translation.includes(token));
}

export function placeholdersPreserved(source: string, translation: string): boolean {
  return missingPlaceholders(source, translation).length === 0;
}
