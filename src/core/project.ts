import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import {
  isProviderName,
  parseProviderName,
  type ProviderName,
} from "../connectors/provider.js";
import { openDatabase } from "./db.js";

export type { ProviderName };

export type ProviderModels = Partial<Record<ProviderName, string>>;

export interface TmConfig {
  sourceLang: string;
  targetLangs: string[];
  defaultProvider: ProviderName;
  /** Optional per-provider model ids (e.g. Ollama tag or HF model id). */
  models: ProviderModels;
}

export const DEFAULT_CONFIG: TmConfig = {
  sourceLang: "en",
  targetLangs: [],
  defaultProvider: "claude",
  models: {},
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
      `No Polygit project found. Run "polygit init" in your project directory first.`,
    );
  }
  return root;
}

export function readConfig(projectRoot: string): TmConfig {
  const file = path.join(projectRoot, CONFIG_FILENAME);
  const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<TmConfig>;
  return {
    sourceLang: raw.sourceLang ?? DEFAULT_CONFIG.sourceLang,
    targetLangs: Array.isArray(raw.targetLangs) ? raw.targetLangs : [],
    defaultProvider: parseProviderName(raw.defaultProvider),
    models: parseProviderModels(raw.models),
  };
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

/**
 * Resolve a user-supplied path and ensure it stays inside the project root.
 */
export function resolveInsideProject(projectRoot: string, inputPath: string): string {
  const root = path.resolve(projectRoot);
  const absolute = path.resolve(root, inputPath);
  const rel = path.relative(root, absolute);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`Path escapes project root: ${inputPath}`);
  }
  return absolute;
}

export function toPosixRelative(projectRoot: string, absolutePath: string): string {
  return path.relative(projectRoot, absolutePath).split(path.sep).join("/");
}

export function nowIso(): string {
  return new Date().toISOString();
}
