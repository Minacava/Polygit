import {
  CONTENT_EXTENSIONS,
  describeLayout,
  layoutFromConfig,
  listContentFiles,
} from "../core/layout.js";
import { openProjectDb, readConfig, requireProjectRoot } from "../core/project.js";
import { getStatusCounts } from "../core/repository.js";

export function runStatus(options: { lang?: string } = {}): void {
  const root = requireProjectRoot();
  const config = readConfig(root);
  const layout = layoutFromConfig(config);

  console.log(`Layout: ${describeLayout(layout)}`);
  const onDisk = listContentFiles(root, layout.contentRoots, CONTENT_EXTENSIONS);
  for (const contentRoot of layout.contentRoots) {
    const count = onDisk.filter(
      (p) => p === contentRoot || p.startsWith(`${contentRoot}/`),
    ).length;
    console.log(`  ${contentRoot}/ — ${count} file(s) on disk`);
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
        : "\nTranslation status (segment rollup)\n",
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
