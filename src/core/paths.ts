import fs from "node:fs";
import path from "node:path";

/**
 * Resolve a user-supplied path and ensure it stays inside the project root.
 *
 * Any existing component below the project root that is a symlink is refused:
 * a cloned repository could otherwise point `sources/x.md` at a file outside
 * (or a secret inside) the project and have it imported, sent to an LLM, or
 * overwritten. Components that do not exist yet (new output files) are fine.
 */
export function resolveInsideProject(projectRoot: string, inputPath: string): string {
  const root = path.resolve(projectRoot);
  const absolute = path.resolve(root, inputPath);
  const rel = path.relative(root, absolute);
  if (rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
    throw new Error(`Path escapes project root: ${inputPath}`);
  }
  assertNoSymlinks(root, rel, inputPath);
  return absolute;
}

function assertNoSymlinks(root: string, rel: string, inputPath: string): void {
  if (!rel) return;
  let current = root;
  for (const part of rel.split(path.sep)) {
    current = path.join(current, part);
    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(current);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
      throw err;
    }
    if (stat.isSymbolicLink()) {
      throw new Error(
        `Refusing to follow symlink: ${toPosixRelative(root, current)} (from ${inputPath}). ` +
          `polygit does not read or write through symbolic links.`,
      );
    }
  }
}

export function toPosixRelative(projectRoot: string, absolutePath: string): string {
  return path.relative(projectRoot, absolutePath).split(path.sep).join("/");
}
