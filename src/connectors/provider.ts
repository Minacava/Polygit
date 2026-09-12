export interface TranslateContext {
  glossary?: Array<{ sourceTerm: string; targetTerm: string; note?: string | null }>;
  documentPath?: string;
  /** Extra free-form instructions (never log secrets here). */
  notes?: string;
}

export interface TranslationProvider {
  readonly name: "claude" | "openai";
  translateSegment(
    text: string,
    sourceLang: string,
    targetLang: string,
    context?: TranslateContext,
  ): Promise<string>;
}

export type ProviderName = TranslationProvider["name"];

export function buildTranslationMessages(
  text: string,
  sourceLang: string,
  targetLang: string,
  context?: TranslateContext,
): Array<{ role: "system" | "user"; content: string }> {
  const glossaryLines =
    context?.glossary
      ?.map((g) => {
        const note = g.note ? ` (${g.note})` : "";
        return `- "${g.sourceTerm}" → "${g.targetTerm}"${note}`;
      })
      .join("\n") ?? "";

  const system = [
    "You are a professional translator.",
    `Translate from ${sourceLang} to ${targetLang}.`,
    "Return only the translated text, with no quotes or commentary.",
    "Preserve Markdown syntax, placeholders, HTML tags, and ICU/message format tokens.",
    glossaryLines
      ? `Use these glossary terms consistently:\n${glossaryLines}`
      : "Respect established product terminology when obvious from context.",
    context?.notes ? `Additional notes: ${context.notes}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const user = context?.documentPath
    ? `Document: ${context.documentPath}\n\n${text}`
    : text;

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

/** Redact likely API keys from error strings before printing. */
export function redactSecrets(message: string): string {
  return message
    .replace(/sk-[a-zA-Z0-9_-]{10,}/g, "sk-***")
    .replace(/sk-ant-[a-zA-Z0-9_-]{10,}/g, "sk-ant-***")
    .replace(/Bearer\s+[a-zA-Z0-9._-]+/gi, "Bearer ***");
}
