import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import {
  isProviderName,
  parseProviderName,
  type ProviderName,
} from "../connectors/provider.js";
import { openDatabase } from "./db.js";
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
  const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<TmConfig> & {
    contentRoots?: unknown;
    outputMode?: unknown;
    outputRoot?: unknown;
  };
  const outputMode = parseOutputMode(raw.outputMode);
  return {
    sourceLang: raw.sourceLang ?? DEFAULT_CONFIG.sourceLang,
    targetLangs: Array.isArray(raw.targetLangs) ? raw.targetLangs : [],
    contentRoots: parseContentRoots(raw.contentRoots),
    outputMode,
    outputRoot: parseOutputRoot(raw.outputRoot, outputMode),
    defaultProvider: parseProviderName(raw.defaultProvider),
    models: parseProviderModels(raw.models),
    forgeHosts: parseForgeHosts(raw.forgeHosts),
  };
}

/** Hostnames only (no scheme, path, or credentials). */
export function parseForgeHosts(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new Error("forgeHosts must be an array of hostnames");
  }
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || !item.trim()) {
      throw new Error("forgeHosts entries must be non-empty hostnames");
    }
    const host = item.trim().toLowerCase().replace(/\.$/, "");
    if (
      host.includes("://") ||
      host.includes("/") ||
      host.includes("@") ||
      host.includes(" ") ||
      host.includes("\\")
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
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: ProviderModels = {};
  for (const [key, model] of Object.entries(value as Record<string, unknown>)) {
    if (!isProviderName(key)) continue;
    if (typeof model === "string" && model.trim()) out[key] = model.trim();
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
