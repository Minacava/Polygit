import { sha256Text } from "./hash.js";

/** Translation style presets and formality. Preset text is fixed in code, never loaded from disk. */

export const STYLE_PRESETS = [
  "academic",
  "startup",
  "technical",
  "marketing",
  "legal",
] as const;

export type StylePreset = (typeof STYLE_PRESETS)[number];

export const FORMALITY_VALUES = ["formal", "informal", "auto"] as const;

export type Formality = (typeof FORMALITY_VALUES)[number];

/** Default when a style is active but formality is omitted. */
export const DEFAULT_FORMALITY: Formality = "auto";

/** Fixed system-prompt fragments for each preset. */
export const PRESET_INSTRUCTIONS: Readonly<Record<StylePreset, string>> = {
  academic:
    "Style preset: academic. Use a formal register and precise terminology. " +
    "Prefer an impersonal voice. Do not simplify concepts. " +
    "Respect citations, quotations, and formulas as written.",
  startup:
    "Style preset: startup. Sound approachable and direct. Prefer short sentences. " +
    "Orient phrasing toward benefits and clarity for product readers.",
  technical:
    "Style preset: technical. Be clear and literal. " +
    "Preserve API names, commands, identifiers, and code-like tokens. " +
    "Avoid decorative or marketing language.",
  marketing:
    "Style preset: marketing. Be persuasive and culturally adapted. " +
    "You may rephrase for natural sound in the target language while keeping the meaning.",
  legal:
    "Style preset: legal. Stay literal and faithful to the source. " +
    "Do not paraphrase. Preserve structure, numbering, and clause boundaries.",
};

export const FORMALITY_INSTRUCTIONS: Readonly<Record<Formality, string>> = {
  formal:
    "Formality: formal. Where the target language distinguishes address " +
    "(e.g. tú/usted, tu/vous, du/Sie), use the formal forms (usted / vous / Sie).",
  informal:
    "Formality: informal. Where the target language distinguishes address " +
    "(e.g. tú/usted, tu/vous, du/Sie), use the informal forms (tú / tu / du).",
  auto:
    "Formality: auto. Match the source text's level of formality " +
    "(tú/usted, tu/vous, du/Sie, and similar). When unclear, use natural defaults for the target language.",
};

export interface StyleConfig {
  preset?: StylePreset;
  formality?: Formality;
}

/** Style after merging config with optional CLI overrides. */
export interface ResolvedStyle {
  preset?: StylePreset;
  formality?: Formality;
}

export function isStylePreset(value: string): value is StylePreset {
  return (STYLE_PRESETS as readonly string[]).includes(value);
}

export function isFormality(value: string): value is Formality {
  return (FORMALITY_VALUES as readonly string[]).includes(value);
}

export function assertStylePreset(value: unknown, label = "style.preset"): StylePreset {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(
      `Invalid ${label}: ${JSON.stringify(value)}. Use one of: ${STYLE_PRESETS.join(", ")}.`,
    );
  }
  const trimmed = value.trim().toLowerCase();
  if (!isStylePreset(trimmed)) {
    throw new Error(
      `Unknown ${label} "${value}". Use one of: ${STYLE_PRESETS.join(", ")}.`,
    );
  }
  return trimmed;
}

export function assertFormality(value: unknown, label = "style.formality"): Formality {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(
      `Invalid ${label}: ${JSON.stringify(value)}. Use one of: ${FORMALITY_VALUES.join(", ")}.`,
    );
  }
  const trimmed = value.trim().toLowerCase();
  if (!isFormality(trimmed)) {
    throw new Error(
      `Unknown ${label} "${value}". Use one of: ${FORMALITY_VALUES.join(", ")}.`,
    );
  }
  return trimmed;
}

/** Parse optional `style` from `.tmconfig.json`. Missing → undefined. */
export function parseStyleConfig(value: unknown): StyleConfig | undefined {
  if (value === undefined || value === null) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error('style must be an object (e.g. { "preset": "startup", "formality": "formal" })');
  }
  const obj = value as Record<string, unknown>;
  const allowed = new Set(["preset", "formality"]);
  for (const key of Object.keys(obj)) {
    if (!allowed.has(key)) {
      throw new Error(
        `Unknown style key "${key}". Allowed: preset, formality.`,
      );
    }
  }

  const out: StyleConfig = {};
  if (obj.preset !== undefined && obj.preset !== null && obj.preset !== "") {
    out.preset = assertStylePreset(obj.preset);
  }
  if (obj.formality !== undefined && obj.formality !== null && obj.formality !== "") {
    out.formality = assertFormality(obj.formality);
  }

  if (out.preset === undefined && out.formality === undefined) {
    return undefined;
  }
  return out;
}

/** Merge project style with CLI flags (CLI wins). Undefined when unset. */
export function resolveStyle(
  configStyle: StyleConfig | undefined,
  overrides?: { style?: string; formality?: string },
): ResolvedStyle | undefined {
  let preset: StylePreset | undefined = configStyle?.preset;
  let formality: Formality | undefined = configStyle?.formality;

  if (overrides?.style !== undefined) {
    preset = assertStylePreset(overrides.style, "--style");
  }
  if (overrides?.formality !== undefined) {
    formality = assertFormality(overrides.formality, "--formality");
  }

  if (preset === undefined && formality === undefined) {
    return undefined;
  }

  // Active style without an explicit formality → auto.
  if (formality === undefined) {
    formality = DEFAULT_FORMALITY;
  }

  const resolved: ResolvedStyle = { formality };
  if (preset !== undefined) resolved.preset = preset;
  return resolved;
}

/** Build the system-prompt style block, or "" when there is no resolved style. */
export function buildStylePromptBlock(style: ResolvedStyle | undefined): string {
  if (!style) return "";
  const lines: string[] = [];
  if (style.preset) {
    lines.push(PRESET_INSTRUCTIONS[style.preset]);
  }
  if (style.formality) {
    lines.push(FORMALITY_INSTRUCTIONS[style.formality]);
  }
  return lines.join("\n");
}

/**
 * Fingerprint of the effective style for TM reuse and stale detection.
 * Returns null when there is no style (legacy / unset) — NULL in the DB.
 * `guideText` is reserved for a project style guide (piece 3); omit when unused.
 */
export function computeStyleHash(
  style: ResolvedStyle | undefined,
  guideText?: string | null,
): string | null {
  if (!style) return null;
  const preset = style.preset ?? "";
  const formality = style.formality ?? "";
  const guide = guideText ?? "";
  return sha256Text(`preset:${preset}\nformality:${formality}\nguide:${guide}`);
}

/** Exact TM reuse only when both hashes match (including both unset). */
export function styleHashesMatch(
  stored: string | null | undefined,
  current: string | null | undefined,
): boolean {
  const a = stored ?? null;
  const b = current ?? null;
  return a === b;
}
