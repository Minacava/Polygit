import {
  CONTENT_EXTENSIONS,
  describeLayout,
  isManagedOutputPath,
  layoutFromConfig,
  listContentFiles,
} from "../core/layout.js";
import { assertLangCode } from "../core/lang.js";
import { openProjectDb, readConfig, requireProjectRoot } from "../core/project.js";
import { getStatusCounts } from "../core/repository.js";

function formatFileCount(n: number): string {
  return n === 1 ? "1 file on disk" : `${n} files on disk`;
}

export function runStatus(options: { lang?: string } = {}): void {
  if (options.lang !== undefined) assertLangCode(options.lang);
  const root = requireProjectRoot();
  const config = readConfig(root);
  const layout = layoutFromConfig(config);
  // Exclude translation outputs that live under contentRoots (sidecar / in-place).
  const outputLangs = [
    ...new Set(
      [...config.targetLangs, ...(options.lang ? [options.lang] : [])].map((l) =>
        l.trim().toLowerCase(),
      ),
    ),
  ].filter(Boolean);

  console.log(`Layout: ${describeLayout(layout)}`);
  const onDisk = listContentFiles(root, layout.contentRoots, CONTENT_EXTENSIONS).filter(
    (p) => !isManagedOutputPath(p, layout, outputLangs),
  );
  for (const contentRoot of layout.contentRoots) {
    const count = onDisk.filter(
      (p) => p === contentRoot || p.startsWith(`${contentRoot}/`),
    ).length;
    console.log(`  ${contentRoot}/ — ${formatFileCount(count)}`);
  }

  const db = openProjectDb(root);
  try {
    const rows = getStatusCounts(db, options.lang);
    console.log(`Imported documents: ${rows.length}`);
    if (rows.length === 0) {
      const hintRoot = layout.contentRoots[0] ?? "sources";
      console.log(
        `No documents imported yet. Run: polygit import ${hintRoot}/**/*.md` +
          `  or  polygit import --root=${hintRoot}`,
      );
      return;
    }
    console.log(
      options.lang
        ? `\nTranslation status (lang=${options.lang})\n`
        : "\nTranslation status (all languages)\n",
    );
    for (const row of rows) {
      console.log(row.path);
      console.log(
        `  pending=${row.pending}  translated=${row.translated}  stale=${row.stale}  approved=${row.approved}  total=${row.total}`,
      );
    }
  } finally {
    db.close();
  }
}
