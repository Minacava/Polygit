import { openProjectDb, requireProjectRoot } from "../core/project.js";
import { getStatusCounts } from "../core/repository.js";

export function runStatus(): void {
  const root = requireProjectRoot();
  const db = openProjectDb(root);
  try {
    const rows = getStatusCounts(db);
    if (rows.length === 0) {
      console.log("No documents imported yet. Run: polygit import sources/<file>");
      return;
    }
    console.log("Translation status\n");
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
