/**
 * Language codes end up in output file paths, so only accept BCP 47-style tags
 * (e.g. fr, pt-BR, zh-Hans-CN, es-419). This rules out path separators and "..".
 */
const LANG_CODE = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,3}$/;

export function isValidLangCode(value: unknown): value is string {
  return typeof value === "string" && LANG_CODE.test(value);
}

export function assertLangCode(value: unknown, label = "language"): string {
  if (!isValidLangCode(value)) {
    throw new Error(
      `Invalid ${label} code: ${JSON.stringify(value)}. ` +
        `Use a language tag such as "fr", "pt-BR" or "zh-Hans".`,
    );
  }
  return value;
}
