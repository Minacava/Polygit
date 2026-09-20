import path from "node:path";

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
