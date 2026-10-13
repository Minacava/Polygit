import type { DocumentFormat } from "../core/db.js";
import { jsonI18nParser } from "./json-i18n.js";
import { markdownParser } from "./markdown.js";
import { poParser } from "./po.js";
import { xliffParser } from "./xliff.js";
import { yamlI18nParser } from "./yaml-i18n.js";
import type { Parser } from "./types.js";

const parsers: Record<DocumentFormat, Parser> = {
  markdown: markdownParser,
  "json-i18n": jsonI18nParser,
  po: poParser,
  yaml: yamlI18nParser,
  xliff: xliffParser,
};

export function getParser(format: DocumentFormat): Parser {
  return parsers[format];
}

export function inferFormat(filePath: string): DocumentFormat | null {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) return "markdown";
  if (lower.endsWith(".json")) return "json-i18n";
  if (lower.endsWith(".po") || lower.endsWith(".pot")) return "po";
  if (lower.endsWith(".yaml") || lower.endsWith(".yml")) return "yaml";
  if (lower.endsWith(".xliff") || lower.endsWith(".xlf")) return "xliff";
  return null;
}

export const DOCUMENT_FORMATS: readonly DocumentFormat[] = [
  "markdown",
  "json-i18n",
  "po",
  "yaml",
  "xliff",
] as const;

export function isDocumentFormat(value: string): value is DocumentFormat {
  return (DOCUMENT_FORMATS as readonly string[]).includes(value);
}

export type { ParsedDocument, Parser } from "./types.js";
export { markdownParser } from "./markdown.js";
export { jsonI18nParser } from "./json-i18n.js";
export { poParser } from "./po.js";
export { yamlI18nParser } from "./yaml-i18n.js";
export { xliffParser } from "./xliff.js";
