import { openProjectDb, requireProjectRoot } from "../core/project.js";
import { getStatusCounts } from "../core/repository.js";

export function runStatus(options: { lang?: string } = {}): void {
  const root = requireProjectRoot();
  const db = openProjectDb(root);
  try {
    const rows = getStatusCounts(db, options.lang);
    if (rows.length === 0) {
      console.log("No documents imported yet. Run: polygit import sources/<file>");
      return;
    }
    console.log(
      options.lang
        ? `Translation status (lang=${options.lang})\n`
        : "Translation status (segment rollup)\n",
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
