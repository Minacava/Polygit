import fs from "node:fs";
import path from "node:path";
import { resolveInsideProject, toPosixRelative } from "./paths.js";

export type OutputMode = "mirror" | "sidecar" | "in-place-locale";

export const OUTPUT_MODES: readonly OutputMode[] = [
  "mirror",
  "sidecar",
  "in-place-locale",
] as const;

export const DEFAULT_CONTENT_ROOTS = ["sources"] as const;
export const DEFAULT_OUTPUT_MODE: OutputMode = "mirror";
export const DEFAULT_OUTPUT_ROOT = "outputs";

/** Extensions Polygit can import without an explicit --format. */
export const CONTENT_EXTENSIONS = [".md", ".markdown", ".json"] as const;

export interface LayoutFields {
  contentRoots: string[];
  outputMode: OutputMode;
  outputRoot: string;
}

export interface LayoutConfig {
  contentRoots: string[];
  outputMode: OutputMode;
  /** Present when outputMode is mirror; ignored otherwise. */
  outputRoot: string;
}

export type LayoutPresetName = "vitepress" | "docusaurus" | "json-i18n";

export const LAYOUT_PRESET_NAMES: readonly LayoutPresetName[] = [
  "vitepress",
  "docusaurus",
  "json-i18n",
] as const;

export const LAYOUT_PRESETS: Record<LayoutPresetName, LayoutConfig> = {
  vitepress: {
    contentRoots: ["docs"],
    outputMode: "in-place-locale",
    outputRoot: DEFAULT_OUTPUT_ROOT,
  },
  docusaurus: {
    contentRoots: ["docs"],
    outputMode: "in-place-locale",
    outputRoot: DEFAULT_OUTPUT_ROOT,
  },
  "json-i18n": {
    contentRoots: ["locales"],
    outputMode: "in-place-locale",
    outputRoot: DEFAULT_OUTPUT_ROOT,
  },
};

export function isOutputMode(value: unknown): value is OutputMode {
  return typeof value === "string" && (OUTPUT_MODES as readonly string[]).includes(value);
}

export function isLayoutPresetName(value: string): value is LayoutPresetName {
  return (LAYOUT_PRESET_NAMES as readonly string[]).includes(value);
}

/** Normalize posix-ish relative root segments (no leading/trailing slashes). */
export function normalizeRootPath(raw: string): string {
  const normalized = raw
    .replace(/\\/g, "/")
    .replace(/^\.\/+/, "")
    .replace(/\/+$/, "");
  if (!normalized || normalized === "." || normalized.includes("..")) {
    throw new Error(`Invalid content/output root: ${raw}`);
  }
  return normalized;
}

export function parseContentRoots(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    return [...DEFAULT_CONTENT_ROOTS];
  }
  const roots: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || !item.trim()) continue;
    roots.push(normalizeRootPath(item.trim()));
  }
  return roots.length > 0 ? roots : [...DEFAULT_CONTENT_ROOTS];
}

export function parseOutputMode(value: unknown): OutputMode {
  if (isOutputMode(value)) return value;
  return DEFAULT_OUTPUT_MODE;
}

export function parseOutputRoot(value: unknown, outputMode: OutputMode): string {
  if (typeof value === "string" && value.trim()) {
    return normalizeRootPath(value.trim());
  }
  return outputMode === "mirror" ? DEFAULT_OUTPUT_ROOT : DEFAULT_OUTPUT_ROOT;
}

export function layoutFromConfig(config: LayoutFields): LayoutConfig {
  return {
    contentRoots: config.contentRoots,
    outputMode: config.outputMode,
    outputRoot: config.outputRoot,
  };
}

export function defaultLayoutConfig(): LayoutConfig {
  return {
    contentRoots: [...DEFAULT_CONTENT_ROOTS],
    outputMode: DEFAULT_OUTPUT_MODE,
    outputRoot: DEFAULT_OUTPUT_ROOT,
  };
}

export function layoutForPreset(preset: LayoutPresetName): LayoutConfig {
  return { ...LAYOUT_PRESETS[preset], contentRoots: [...LAYOUT_PRESETS[preset].contentRoots] };
}

/**
 * Longest matching content root for a posix relative path, or null.
 */
export function matchContentRoot(relPath: string, roots: string[]): string | null {
  const posix = relPath.replace(/\\/g, "/");
  let best: string | null = null;
  for (const root of roots) {
    if (posix === root || posix.startsWith(`${root}/`)) {
      if (!best || root.length > best.length) best = root;
    }
  }
  return best;
}

export function assertInContentRoots(
  relPath: string,
  roots: string[],
  options: { allowRootHint?: boolean } = {},
): string {
  const matched = matchContentRoot(relPath, roots);
  if (matched) return matched;
  const listed = roots.map((r) => `\`${r}\``).join(", ");
  const hint = options.allowRootHint
    ? " Add it to contentRoots in .tmconfig.json or pass --root."
    : " Add it to contentRoots in .tmconfig.json or use --root.";
  throw new Error(
    `Path is not under configured contentRoots (${listed}): ${relPath}.${hint}`,
  );
}

/** Path of source relative to its matched content root. */
export function relativeToContentRoot(sourceRel: string, contentRoot: string): string {
  if (sourceRel === contentRoot) return "";
  const prefix = `${contentRoot}/`;
  if (!sourceRel.startsWith(prefix)) {
    throw new Error(`Source ${sourceRel} is not under content root ${contentRoot}`);
  }
  return sourceRel.slice(prefix.length);
}

export function toOutputPath(
  sourceRel: string,
  lang: string,
  config: LayoutFields,
): string {
  const root = matchContentRoot(sourceRel, config.contentRoots);
  if (!root) {
    throw new Error(
      `Cannot resolve output path: ${sourceRel} is not under contentRoots (${config.contentRoots.join(", ")})`,
    );
  }
  const rel = relativeToContentRoot(sourceRel, root);
  const mode = config.outputMode;

  if (mode === "mirror") {
    return path.posix.join(config.outputRoot, lang, rel);
  }
  if (mode === "sidecar") {
    const dir = path.posix.dirname(sourceRel);
    const base = path.posix.basename(sourceRel);
    const ext = path.posix.extname(base);
    const stem = ext ? base.slice(0, -ext.length) : base;
    const fileName = `${stem}.${lang}${ext}`;
    return dir === "." ? fileName : path.posix.join(dir, fileName);
  }
  // in-place-locale
  return path.posix.join(root, lang, rel);
}

export function isManagedOutputPath(
  relPath: string,
  config: LayoutFields,
): boolean {
  const posix = relPath.replace(/\\/g, "/");
  if (config.outputMode === "mirror") {
    return posix === config.outputRoot || posix.startsWith(`${config.outputRoot}/`);
  }
  // Sidecar / in-place-locale outputs live under content roots.
  return matchContentRoot(posix, config.contentRoots) !== null;
}

/** Prefixes git should stage/diff for translation artifacts. */
export function gitPathPrefixes(config: LayoutFields): string[] {
  const prefixes = [...config.contentRoots];
  if (config.outputMode === "mirror" && !prefixes.includes(config.outputRoot)) {
    prefixes.push(config.outputRoot);
  }
  return prefixes;
}

export function pathMatchesPrefixes(relPath: string, prefixes: string[]): boolean {
  const posix = relPath.replace(/\\/g, "/");
  return prefixes.some((p) => posix === p || posix.startsWith(`${p}/`));
}

function hasKnownExtension(filePath: string, exts: readonly string[]): boolean {
  const lower = filePath.toLowerCase();
  return exts.some((ext) => lower.endsWith(ext));
}

/**
 * List content files under configured roots (posix relative paths).
 */
export function listContentFiles(
  projectRoot: string,
  roots: string[],
  exts: readonly string[] = CONTENT_EXTENSIONS,
): string[] {
  const out: string[] = [];
  for (const root of roots) {
    const absRoot = resolveInsideProject(projectRoot, root);
    if (!fs.existsSync(absRoot)) continue;
    const stat = fs.statSync(absRoot);
    if (stat.isFile()) {
      if (hasKnownExtension(root, exts)) out.push(root.replace(/\\/g, "/"));
      continue;
    }
    walkDir(absRoot, projectRoot, exts, out);
  }
  out.sort();
  return out;
}

function walkDir(
  absDir: string,
  projectRoot: string,
  exts: readonly string[],
  out: string[],
): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(absDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name === ".git" || entry.name === ".tm" || entry.name === "node_modules") {
      continue;
    }
    const abs = path.join(absDir, entry.name);
    if (entry.isDirectory()) {
      walkDir(abs, projectRoot, exts, out);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!hasKnownExtension(entry.name, exts)) continue;
    out.push(toPosixRelative(projectRoot, abs));
  }
}

/**
 * Expand a user path or glob into posix-relative file paths inside the project.
 * Supports `*`, `?`, and `**` without external dependencies.
 */
export function expandImportTargets(
  projectRoot: string,
  pattern: string,
  options: { root?: string; extensions?: readonly string[] } = {},
): string[] {
  const exts = options.extensions ?? CONTENT_EXTENSIONS;

  if (options.root) {
    const rootRel = normalizeRootPath(options.root);
    const absRoot = resolveInsideProject(projectRoot, rootRel);
    if (!fs.existsSync(absRoot) || !fs.statSync(absRoot).isDirectory()) {
      throw new Error(`Import root not found or not a directory: ${rootRel}`);
    }
    return listContentFiles(projectRoot, [rootRel], exts);
  }

  const normalized = pattern.replace(/\\/g, "/").replace(/^\.\/+/, "");
  if (!hasGlobMagic(normalized)) {
    const abs = resolveInsideProject(projectRoot, normalized);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
      throw new Error(`File not found: ${pattern}`);
    }
    return [toPosixRelative(projectRoot, abs)];
  }

  const base = globSearchRoot(normalized);
  const absBase = resolveInsideProject(projectRoot, base || ".");
  if (!fs.existsSync(absBase)) {
    return [];
  }

  const candidates: string[] = [];
  if (fs.statSync(absBase).isFile()) {
    candidates.push(toPosixRelative(projectRoot, absBase));
  } else {
    walkAllFiles(absBase, projectRoot, candidates);
  }

  const matcher = compileGlob(normalized);
  return candidates.filter((p) => matcher(p)).sort();
}

function walkAllFiles(absDir: string, projectRoot: string, out: string[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(absDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name === ".git" || entry.name === ".tm" || entry.name === "node_modules") {
      continue;
    }
    const abs = path.join(absDir, entry.name);
    if (entry.isDirectory()) {
      walkAllFiles(abs, projectRoot, out);
      continue;
    }
    if (entry.isFile()) out.push(toPosixRelative(projectRoot, abs));
  }
}

function hasGlobMagic(pattern: string): boolean {
  return /[*?]/.test(pattern) || pattern.includes("**");
}

/** Directory prefix before the first glob segment. */
function globSearchRoot(pattern: string): string {
  const parts = pattern.split("/");
  const solid: string[] = [];
  for (const part of parts) {
    if (hasGlobMagic(part)) break;
    solid.push(part);
  }
  return solid.join("/");
}

function compileGlob(pattern: string): (path: string) => boolean {
  // Escape regex meta first, then expand globs via placeholders so
  // replacement text like `(?:.*/)?` is not re-processed by `*` rules.
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*\//g, "\0GS\0")
    .replace(/\*\*/g, "\0G\0")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]")
    .replace(/\0GS\0/g, "(?:.*/)?")
    .replace(/\0G\0/g, ".*");
  const re = new RegExp(`^${escaped}$`, "i");
  return (p: string) => re.test(p);
}

export function ensureLayoutDirs(projectRoot: string, layout: LayoutConfig): void {
  for (const root of layout.contentRoots) {
    fs.mkdirSync(path.join(projectRoot, root), { recursive: true });
  }
  if (layout.outputMode === "mirror") {
    fs.mkdirSync(path.join(projectRoot, layout.outputRoot), { recursive: true });
  }
}

export function describeLayout(layout: LayoutConfig): string {
  const roots = layout.contentRoots.join(", ");
  if (layout.outputMode === "mirror") {
    return `contentRoots=[${roots}] outputMode=mirror outputRoot=${layout.outputRoot}`;
  }
  return `contentRoots=[${roots}] outputMode=${layout.outputMode}`;
}
