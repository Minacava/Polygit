import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import type { SegmentStatus } from "../core/db.js";
import { writeOutputDocuments } from "../core/output.js";
import { openProjectDb, requireProjectRoot } from "../core/project.js";
import { listReviewSegments, upsertTranslation } from "../core/repository.js";

export interface ReviewOptions {
  lang?: string;
  status?: SegmentStatus;
}

export async function runReview(options: ReviewOptions = {}): Promise<void> {
  const root = requireProjectRoot();
  const db = openProjectDb(root);
  const rl = readline.createInterface({ input, output });
  const touchedDocs = new Set<string>();

  try {
    const rows = listReviewSegments(db, {
      ...(options.lang ? { lang: options.lang } : {}),
      ...(options.status ? { status: options.status } : {}),
    });

    if (rows.length === 0) {
      console.log("No segments to review.");
      return;
    }

    if (!process.stdin.isTTY) {
      throw new Error("Interactive review requires a TTY.");
    }

    console.log(
      `Reviewing ${rows.length} segment(s). Commands: a=approve, e=edit, s=skip, q=quit\n`,
    );

    for (const row of rows) {
      console.log(`── ${row.document_path}  (${row.status})`);
      console.log(`SOURCE: ${row.source_text}`);
      console.log(`TARGET: ${row.target_text ?? "(none)"}`);

      const answer = (await rl.question("[a/e/s/q] > ")).trim().toLowerCase();
      if (answer === "q") break;
      if (answer === "s" || answer === "") continue;

      if (!options.lang) {
        console.log("Pass --lang=<code> to approve or edit translations.");
        continue;
      }

      if (answer === "a") {
        if (!row.target_text) {
          console.log("No translation to approve.");
          continue;
        }
        upsertTranslation(db, row.id, options.lang, row.target_text, "manual", true);
        touchedDocs.add(row.document_path);
        console.log("Approved.\n");
        continue;
      }

      if (answer === "e") {
        const edited = await rl.question("New translation > ");
        if (!edited.trim()) {
          console.log("Empty edit ignored.\n");
          continue;
        }
        upsertTranslation(db, row.id, options.lang, edited.trim(), "manual", true);
        touchedDocs.add(row.document_path);
        console.log("Saved and approved.\n");
      }
    }

    if (options.lang && touchedDocs.size > 0) {
      const written = writeOutputDocuments(db, root, options.lang, [...touchedDocs]);
      console.log(`Updated outputs: ${written.join(", ")}`);
    }
  } finally {
    rl.close();
    db.close();
  }
}
