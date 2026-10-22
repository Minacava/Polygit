import {
  parseContentRoots,
  parseOutputMode,
  parseOutputRoot,
} from "../core/layout.js";
import {
  assertFormality,
  assertSourceNotInTargets,
  assertStyleGuidePath,
  assertStylePreset,
  computeStyleHash,
  loadStyleGuideText,
  openProjectDb,
  parseBoolFlag,
  parseLangCsv,
  parseSourceLang,
  readConfig,
  requireProjectRoot,
  resolveStyle,
  writeConfig,
  type Formality,
  type StyleConfig,
  type StylePreset,
  type TmConfig,
} from "../core/project.js";
import { markStyleHashStale } from "../core/repository.js";

export const CONFIG_KEYS = [
  "sourceLang",
  "targetLangs",
  "contentRoots",
  "outputRoot",
  "outputMode",
  "autoTranslate",
  "style.preset",
  "style.formality",
  "style.guide",
] as const;

export type ConfigKey = (typeof CONFIG_KEYS)[number];

function isConfigKey(value: string): value is ConfigKey {
  return (CONFIG_KEYS as readonly string[]).includes(value);
}

function formatValue(key: ConfigKey, config: TmConfig): string {
  switch (key) {
    case "style.preset":
      return config.style?.preset ?? "";
    case "style.formality":
      return config.style?.formality ?? "";
    case "style.guide":
      return config.style?.guide ?? "";
    case "sourceLang":
    case "targetLangs":
    case "contentRoots":
    case "outputRoot":
    case "outputMode":
    case "autoTranslate": {
      const value = config[key];
      if (Array.isArray(value)) return value.join(",");
      if (typeof value === "boolean") return value ? "true" : "false";
      return String(value);
    }
    default: {
      const _exhaustive: never = key;
      throw new Error(`Unsupported config key: ${String(_exhaustive)}`);
    }
  }
}

function withStyle(config: TmConfig, patch: StyleConfig): TmConfig {
  const nextStyle: StyleConfig = { ...config.style, ...patch };
  if (
    nextStyle.preset === undefined &&
    nextStyle.formality === undefined &&
    nextStyle.guide === undefined
  ) {
    const { style: _omit, ...rest } = config;
    return { ...rest };
  }
  return { ...config, style: nextStyle };
}

function applyConfigValue(config: TmConfig, key: ConfigKey, raw: string): TmConfig {
  const next: TmConfig = {
    ...config,
    contentRoots: [...config.contentRoots],
    targetLangs: [...config.targetLangs],
    ...(config.style ? { style: { ...config.style } } : {}),
  };

  switch (key) {
    case "sourceLang":
      next.sourceLang = parseSourceLang(raw.trim());
      break;
    case "targetLangs":
      next.targetLangs = parseLangCsv(raw, "targetLangs");
      break;
    case "contentRoots": {
      const parts = raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      next.contentRoots = parseContentRoots(parts);
      break;
    }
    case "outputRoot":
      next.outputRoot = parseOutputRoot(raw.trim(), next.outputMode);
      break;
    case "outputMode":
      next.outputMode = parseOutputMode(raw.trim());
      break;
    case "autoTranslate":
      next.autoTranslate = parseBoolFlag(raw, "autoTranslate");
      break;
    case "style.preset": {
      const preset: StylePreset = assertStylePreset(raw.trim(), "style.preset");
      return withStyle(next, { preset });
    }
    case "style.formality": {
      const formality: Formality = assertFormality(raw.trim(), "style.formality");
      return withStyle(next, { formality });
    }
    case "style.guide": {
      const guide = assertStyleGuidePath(raw.trim(), "style.guide");
      return withStyle(next, { guide });
    }
    default: {
      const _exhaustive: never = key;
      throw new Error(`Unsupported config key: ${String(_exhaustive)}`);
    }
  }

  assertSourceNotInTargets(next.sourceLang, next.targetLangs);
  return next;
}

export function runConfigGet(key: string): string {
  if (!isConfigKey(key)) {
    throw new Error(
      `Unknown config key "${key}". Use one of: ${CONFIG_KEYS.join(", ")}.`,
    );
  }
  const root = requireProjectRoot();
  const config = readConfig(root);
  const formatted = formatValue(key, config);
  console.log(formatted);
  return formatted;
}

export function runConfigSet(key: string, value: string): TmConfig {
  if (!isConfigKey(key)) {
    throw new Error(
      `Unknown config key "${key}". Use one of: ${CONFIG_KEYS.join(", ")}.`,
    );
  }
  const root = requireProjectRoot();
  const current = readConfig(root);
  const next = applyConfigValue(current, key, value);
  writeConfig(root, next);
  console.log(`Set ${key}=${formatValue(key, next)}`);

  if (key === "style.preset" || key === "style.formality" || key === "style.guide") {
    const guideText = loadStyleGuideText(root, next.style);
    const styleHash = computeStyleHash(resolveStyle(next.style), guideText);
    const db = openProjectDb(root);
    try {
      const staleIds = markStyleHashStale(db, styleHash);
      if (staleIds.length > 0) {
        console.log(
          `Marked ${staleIds.length} segment(s) stale (style changed). Run translate to refresh.`,
        );
      }
    } finally {
      db.close();
    }
  }

  return next;
}
