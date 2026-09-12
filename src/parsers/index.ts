import type { DocumentFormat } from "../core/db.js";
import { jsonI18nParser } from "./json-i18n.js";
import { markdownParser } from "./markdown.js";
import type { Parser } from "./types.js";

const parsers: Record<DocumentFormat, Parser> = {
  markdown: markdownParser,
  "json-i18n": jsonI18nParser,
};

export function getParser(format: DocumentFormat): Parser {
  return parsers[format];
}

export function inferFormat(filePath: string): DocumentFormat | null {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) return "markdown";
  if (lower.endsWith(".json")) return "json-i18n";
  return null;
}

export type { ParsedDocument, Parser } from "./types.js";
export { markdownParser } from "./markdown.js";
export { jsonI18nParser } from "./json-i18n.js";
