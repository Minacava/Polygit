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

export type { ProviderName };
export type { OutputMode };
export { resolveInsideProject, toPosixRelative } from "./paths.js";

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
  defaultProvider: ProviderName;
  /** Optional per-provider model ids (e.g. Ollama tag or HF model id). */
  models: ProviderModels;
  /**
   * Extra forge API hosts allowed for `publish` (Enterprise / self-hosted).
   * github.com and gitlab.com are always trusted; other hosts also need `--forge`.
   */
  forgeHosts: string[];
}

export const DEFAULT_CONFIG: TmConfig = {
  sourceLang: "en",
  targetLangs: [],
  contentRoots: [...DEFAULT_CONTENT_ROOTS],
  outputMode: DEFAULT_OUTPUT_MODE,
  outputRoot: DEFAULT_OUTPUT_ROOT,
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

  return {
    sourceLang: parseSourceLang(obj.sourceLang),
    targetLangs: parseTargetLangs(obj.targetLangs),
    contentRoots: parseContentRoots(obj.contentRoots),
    outputMode,
    outputRoot: parseOutputRoot(obj.outputRoot, outputMode),
    defaultProvider: parseProviderName(obj.defaultProvider),
    models: parseProviderModels(obj.models),
    forgeHosts: parseForgeHosts(obj.forgeHosts),
  };
}

function parseSourceLang(value: unknown): string {
  if (value === undefined || value === null || value === "") {
    return DEFAULT_CONFIG.sourceLang;
  }
  return assertLangCode(value, "sourceLang");
}

function parseTargetLangs(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new Error("targetLangs must be an array of language codes");
  }
  if (value.length > MAX_TARGET_LANGS) {
    throw new Error(`targetLangs exceeds maximum of ${MAX_TARGET_LANGS} entries`);
  }
  return value.map((item, i) => assertLangCode(item, `targetLangs[${i}]`));
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
