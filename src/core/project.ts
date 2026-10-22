import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import {
  isProviderName,
  parseProviderName,
  type ProviderName,
} from "../connectors/provider.js";
import { openDatabase } from "./db.js";
import { assertLangCode } from "./lang.js";
import {
  DEFAULT_CONTENT_ROOTS,
  DEFAULT_OUTPUT_MODE,
  DEFAULT_OUTPUT_ROOT,
  parseContentRoots,
  parseOutputMode,
  parseOutputRoot,
  type OutputMode,
} from "./layout.js";
import { parseStyleConfig, type StyleConfig } from "./style.js";

export type { ProviderName };
export type { OutputMode };
export type { StyleConfig };
export { resolveInsideProject, toPosixRelative } from "./paths.js";
export {
  STYLE_PRESETS,
  FORMALITY_VALUES,
  parseStyleConfig,
  resolveStyle,
  assertStylePreset,
  assertFormality,
  computeStyleHash,
  styleHashesMatch,
  type StylePreset,
  type Formality,
  type ResolvedStyle,
} from "./style.js";

export type ProviderModels = Partial<Record<ProviderName, string>>;

/** Cloned-repo .tmconfig.json is untrusted; keep it small and typed. */
export const MAX_TMCONFIG_BYTES = 64_000;
export const MAX_TARGET_LANGS = 64;
export const MAX_FORGE_HOSTS = 32;
export const MAX_MODEL_ID_LENGTH = 200;
export const MAX_HOSTNAME_LENGTH = 253;

export interface TmConfig {
  sourceLang: string;
  targetLangs: string[];
  /** Directories where source content lives (posix-relative). */
  contentRoots: string[];
  /** How translated files are placed relative to sources. */
  outputMode: OutputMode;
  /** Used when outputMode is mirror (e.g. outputs, locales). */
  outputRoot: string;
  /**
   * When true, signals intent to run `polygit sync` in the workflow.
   * Does not install Git hooks by itself (`polygit hooks install` is opt-in).
   */
  autoTranslate: boolean;
  defaultProvider: ProviderName;
  /** Optional per-provider model ids (e.g. Ollama tag or HF model id). */
  models: ProviderModels;
  /**
   * Extra forge API hosts allowed for `publish` (Enterprise / self-hosted).
   * github.com and gitlab.com are always trusted; other hosts also need `--forge`.
   */
  forgeHosts: string[];
  /** Optional translation style. When omitted, prompts match the previous default. */
  style?: StyleConfig;
}

export const DEFAULT_CONFIG: TmConfig = {
  sourceLang: "en",
  targetLangs: [],
  contentRoots: [...DEFAULT_CONTENT_ROOTS],
  outputMode: DEFAULT_OUTPUT_MODE,
  outputRoot: DEFAULT_OUTPUT_ROOT,
  autoTranslate: false,
  defaultProvider: "ollama",
  models: {},
  forgeHosts: [],
};

export const CONFIG_FILENAME = ".tmconfig.json";

export function findProjectRoot(startDir = process.cwd()): string | null {
  let dir = path.resolve(startDir);
  for (;;) {
    if (fs.existsSync(path.join(dir, CONFIG_FILENAME))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function requireProjectRoot(startDir = process.cwd()): string {
  const root = findProjectRoot(startDir);
  if (!root) {
    throw new Error(
      `No polygit project found. Run "polygit init" in your project directory first.`,
    );
  }
  return root;
}

export function readConfig(projectRoot: string): TmConfig {
  const file = path.join(projectRoot, CONFIG_FILENAME);
  let stat: fs.Stats;
  try {
    stat = fs.statSync(file);
  } catch {
    throw new Error(`Missing ${CONFIG_FILENAME} in ${projectRoot}`);
  }
  if (!stat.isFile()) {
    throw new Error(`${CONFIG_FILENAME} is not a regular file`);
  }
  if (stat.size > MAX_TMCONFIG_BYTES) {
    throw new Error(
      `${CONFIG_FILENAME} is too large (${stat.size} bytes; max ${MAX_TMCONFIG_BYTES}). ` +
        `Treat config from cloned repos as untrusted.`,
    );
  }

  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    throw new Error(`Invalid ${CONFIG_FILENAME}: not valid JSON`);
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`Invalid ${CONFIG_FILENAME}: expected a JSON object`);
  }

  const obj = raw as Record<string, unknown>;
  const outputMode = parseOutputMode(obj.outputMode);

  const sourceLang = parseSourceLang(obj.sourceLang);
  const targetLangs = parseTargetLangs(obj.targetLangs);
  assertSourceNotInTargets(sourceLang, targetLangs);

  const style = parseStyleConfig(obj.style);

  return {
    sourceLang,
    targetLangs,
    contentRoots: parseContentRoots(obj.contentRoots),
    outputMode,
    outputRoot: parseOutputRoot(obj.outputRoot, outputMode),
    autoTranslate: parseAutoTranslate(obj.autoTranslate),
    defaultProvider: parseProviderName(obj.defaultProvider),
    models: parseProviderModels(obj.models),
    forgeHosts: parseForgeHosts(obj.forgeHosts),
    ...(style ? { style } : {}),
  };
}

export function parseSourceLang(value: unknown): string {
  if (value === undefined || value === null || value === "") {
    return DEFAULT_CONFIG.sourceLang;
  }
  return assertLangCode(value, "sourceLang");
}

export function parseTargetLangs(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new Error("targetLangs must be an array of language codes");
  }
  if (value.length > MAX_TARGET_LANGS) {
    throw new Error(`targetLangs exceeds maximum of ${MAX_TARGET_LANGS} entries`);
  }
  return value.map((item, i) => assertLangCode(item, `targetLangs[${i}]`));
}

export function parseAutoTranslate(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === "boolean") return value;
  throw new Error(`autoTranslate must be a boolean, got ${JSON.stringify(value)}`);
}

/** Parse CLI/prompt yes/no into a boolean. */
export function parseBoolFlag(raw: string, label = "value"): boolean {
  const v = raw.trim().toLowerCase();
  if (["y", "yes", "true", "1"].includes(v)) return true;
  if (["n", "no", "false", "0", ""].includes(v)) return false;
  throw new Error(`Invalid ${label}: ${JSON.stringify(raw)}. Use y/n or true/false.`);
}

/** Split a comma-separated language list and validate each code. */
export function parseLangCsv(raw: string, label = "languages"): string[] {
  const parts = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length > MAX_TARGET_LANGS) {
    throw new Error(`${label} exceeds maximum of ${MAX_TARGET_LANGS} entries`);
  }
  return parts.map((item, i) => assertLangCode(item, `${label}[${i}]`));
}

export function assertSourceNotInTargets(sourceLang: string, targetLangs: string[]): void {
  if (targetLangs.some((l) => l.toLowerCase() === sourceLang.toLowerCase())) {
    throw new Error(
      `sourceLang (${sourceLang}) must not appear in targetLangs (${targetLangs.join(", ")})`,
    );
  }
}

/** Hostnames only (no scheme, path, or credentials). */
export function parseForgeHosts(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new Error("forgeHosts must be an array of hostnames");
  }
  if (value.length > MAX_FORGE_HOSTS) {
    throw new Error(`forgeHosts exceeds maximum of ${MAX_FORGE_HOSTS} entries`);
  }
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || !item.trim()) {
      throw new Error("forgeHosts entries must be non-empty hostnames");
    }
    if (item.length > MAX_HOSTNAME_LENGTH) {
      throw new Error(
        `forgeHosts entry exceeds ${MAX_HOSTNAME_LENGTH} characters`,
      );
    }
    const host = item.trim().toLowerCase().replace(/\.$/, "");
    if (
      host.includes("://") ||
      host.includes("/") ||
      host.includes("@") ||
      host.includes(" ") ||
      host.includes("\\") ||
      host.includes("\0")
    ) {
      throw new Error(
        `Invalid forgeHosts entry "${item}": use a hostname only (e.g. "git.example.com")`,
      );
    }
    out.push(host);
  }
  return out;
}

function parseProviderModels(value: unknown): ProviderModels {
  if (value === undefined || value === null) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("models must be an object of provider → model id strings");
  }
  const out: ProviderModels = {};
  for (const [key, model] of Object.entries(value as Record<string, unknown>)) {
    if (!isProviderName(key)) {
      throw new Error(
        `Invalid models key ${JSON.stringify(key)}. Use claude, openai, ollama, or huggingface.`,
      );
    }
    if (model === undefined || model === null || model === "") continue;
    if (typeof model !== "string") {
      throw new Error(`models.${key} must be a string`);
    }
    const trimmed = model.trim();
    if (!trimmed) continue;
    if (trimmed.length > MAX_MODEL_ID_LENGTH) {
      throw new Error(
        `models.${key} exceeds maximum length of ${MAX_MODEL_ID_LENGTH}`,
      );
    }
    if (trimmed.includes("\0")) {
      throw new Error(`models.${key} contains an invalid NUL byte`);
    }
    out[key] = trimmed;
  }
  return out;
}

export function writeConfig(projectRoot: string, config: TmConfig): void {
  const file = path.join(projectRoot, CONFIG_FILENAME);
  fs.writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

export function openProjectDb(projectRoot: string): Database.Database {
  return openDatabase(projectRoot);
}

export function nowIso(): string {
  return new Date().toISOString();
}
