/**
 * Detect translation placeholders that must survive LLM output.
 */

const PATTERNS: RegExp[] = [
  /\{\{[^{}]+\}\}/g, // {{name}}
  /\{[a-zA-Z_][a-zA-Z0-9_]*\}/g, // {name}
  /%(?:\d+\$)?[sdifFc]/g, // %s, %d, %1$s
  /<\/?[a-zA-Z][^>]*>/g, // HTML tags
  /\[[^\]]*]\([^)]+\)/g, // markdown links
  /!\[[^\]]*]\([^)]+\)/g, // markdown images
];

export function extractPlaceholders(text: string): string[] {
  const found = new Set<string>();
  for (const re of PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      found.add(m[0]);
    }
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
