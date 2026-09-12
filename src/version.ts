import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);

/** Package version from package.json (published layout: dist/ next to package.json). */
export function getPackageVersion(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const pkgPath = path.join(here, "..", "package.json");
  const pkg = require(pkgPath) as { version?: string };
  return pkg.version ?? "0.0.0";
}
