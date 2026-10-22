import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import type { SegmentStatus } from "../core/db.js";
import { assertLangCode } from "../core/lang.js";
import { writeOutputDocuments } from "../core/output.js";
import {
  computeStyleHash,
  openProjectDb,
  readConfig,
  requireProjectRoot,
  resolveStyle,
} from "../core/project.js";
import {
  countUnapprovedTranslations,
  listReviewSegments,
  upsertTranslation,
} from "../core/repository.js";
import { ensureTranslationBranch } from "../git/translation-branch.js";

/** Shown once at the start of an interactive review session. */
export const REVIEW_KEY_TABLE = [
  "Key  Action       Meaning",
  "───  ───────────  ──────────────────────────────────────────",
  " a   approve      Keep the current TARGET and mark approved",
  " A   approve-all  Approve this and all remaining with a TARGET",
  " e   edit         Type a new TARGET, then save + approve",
  " s   skip         Leave this segment unchanged (Enter = skip)",
  " q   quit         Stop the review session",
].join("\n");

export interface ReviewOptions {
  lang?: string;
  status?: SegmentStatus;
  /** Skip auto branch for translation work (see translate --no-branch). */
  noBranch?: boolean;
  /** Approve every listed segment that already has a TARGET (no TTY). */
  approveAll?: boolean;
}

function tryApproveSegment(
  db: ReturnType<typeof openProjectDb>,
  segmentId: string,
  lang: string,
  targetText: string | null | undefined,
  touchedDocs: Set<string>,
  documentPath: string,
  styleHash: string | null = null,
): boolean {
  if (!targetText) return false;
  upsertTranslation(db, segmentId, lang, targetText, "manual", true, styleHash);
  touchedDocs.add(documentPath);
  return true;
}

export async function runReview(options: ReviewOptions = {}): Promise<void> {
  if (!options.lang) {
    throw new Error(
      `Language is required. Pass --lang=<code> (e.g. polygit review --lang=fr).`,
    );
  }
  assertLangCode(options.lang);
  const root = requireProjectRoot();
  if (!options.noBranch) {
    await ensureTranslationBranch(root, options.lang);
  }
  const db = openProjectDb(root);
  const touchedDocs = new Set<string>();
  const lang = options.lang;
  const styleHash = computeStyleHash(resolveStyle(readConfig(root).style));

  try {
    const rows = listReviewSegments(db, {
      ...(options.lang ? { lang: options.lang } : {}),
      ...(options.status ? { status: options.status } : {}),
    });

    if (rows.length === 0) {
      console.log("No segments to review.");
      return;
    }

    if (options.approveAll) {
      let approved = 0;
      let skipped = 0;
      for (const row of rows) {
        if (
          tryApproveSegment(
            db,
            row.id,
            lang,
            row.target_text,
            touchedDocs,
            row.document_path,
            styleHash,
          )
        ) {
          approved += 1;
        } else {
          skipped += 1;
        }
      }
      console.log(
        `Approved ${approved} segment(s)` +
          (skipped > 0 ? ` (skipped ${skipped} without TARGET)` : "") +
          ".",
      );
    } else {
      if (!process.stdin.isTTY) {
        throw new Error(
          "Interactive review requires a TTY. Use --approve-all to approve without a prompt.",
        );
      }

      const rl = readline.createInterface({ input, output });
      try {
        console.log(`Reviewing ${rows.length} segment(s).\n`);
        console.log(REVIEW_KEY_TABLE);
        console.log("");

        for (let i = 0; i < rows.length; i++) {
          const row = rows[i]!;
          console.log(`── ${row.document_path}  (${row.status})`);
          console.log(`SOURCE: ${row.source_text}`);
          console.log(`TARGET: ${row.target_text ?? "(none)"}`);

          // Keep case: `A` = approve-all; `a` = approve one.
          const raw = (await rl.question("Action [a/A/e/s/q] > ")).trim();
          const answer = raw.toLowerCase();

          if (answer === "q") break;
          if (answer === "s" || answer === "") continue;

          if (raw === "A" || answer === "aa" || answer === "all") {
            let bulk = 0;
            let skipped = 0;
            for (let j = i; j < rows.length; j++) {
              const next = rows[j]!;
              if (
                tryApproveSegment(
                  db,
                  next.id,
                  lang,
                  next.target_text,
                  touchedDocs,
                  next.document_path,
                  styleHash,
                )
              ) {
                bulk += 1;
              } else {
                skipped += 1;
              }
            }
            console.log(
              `Approved ${bulk} remaining segment(s)` +
                (skipped > 0 ? ` (skipped ${skipped} without TARGET)` : "") +
                ".\n",
            );
            break;
          }

          if (answer === "a") {
            if (
              !tryApproveSegment(
                db,
                row.id,
                lang,
                row.target_text,
                touchedDocs,
                row.document_path,
                styleHash,
              )
            ) {
              console.log("No translation to approve.");
              continue;
            }
            console.log("Approved.\n");
            continue;
          }

          if (answer === "e") {
            const edited = await rl.question("New translation > ");
            if (!edited.trim()) {
              console.log("Empty edit ignored.\n");
              continue;
            }
            upsertTranslation(db, row.id, lang, edited.trim(), "manual", true, styleHash);
            touchedDocs.add(row.document_path);
            console.log("Saved and approved.\n");
          }
        }
      } finally {
        rl.close();
      }
    }

    if (touchedDocs.size > 0) {
      const written = writeOutputDocuments(db, root, lang, [...touchedDocs]);
      console.log(`Updated outputs: ${written.join(", ")}`);
    }

    if (countUnapprovedTranslations(db, lang) === 0) {
      console.log(
        `\nAll ${lang} translations are approved. Open a PR to main with:\n` +
          `  polygit publish --lang=${lang} --yes\n`,
      );
    }
  } finally {
    db.close();
  }
}
