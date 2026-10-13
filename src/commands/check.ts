import { assertLangCode } from "../core/lang.js";
import { openProjectDb, requireProjectRoot } from "../core/project.js";
import { getStatusCounts } from "../core/repository.js";

export interface CheckOptions {
  lang: string;
  /** When true, only report; caller sets exit code. Default behavior prints and throws. */
  quiet?: boolean;
}

export interface CheckResult {
  lang: string;
  pending: number;
  stale: number;
  ok: boolean;
  documents: Array<{ path: string; pending: number; stale: number }>;
}

/**
 * CI-friendly gate: exit non-zero when any segment is still pending or stale for a language.
 */
export function runCheck(options: CheckOptions): CheckResult {
  assertLangCode(options.lang);
  const root = requireProjectRoot();
  const db = openProjectDb(root);
  try {
    const rows = getStatusCounts(db, options.lang);
    const documents = rows
      .filter((r) => r.pending > 0 || r.stale > 0)
      .map((r) => ({ path: r.path, pending: r.pending, stale: r.stale }));
    const pending = rows.reduce((n, r) => n + r.pending, 0);
    const stale = rows.reduce((n, r) => n + r.stale, 0);
    const ok = pending === 0 && stale === 0;
    const result: CheckResult = { lang: options.lang, pending, stale, ok, documents };

    if (!options.quiet) {
      if (ok) {
        console.log(`check ok: lang=${options.lang} (no pending or stale segments)`);
      } else {
        console.error(
          `check failed: lang=${options.lang} pending=${pending} stale=${stale}`,
        );
        for (const doc of documents) {
          console.error(`  ${doc.path}: pending=${doc.pending} stale=${doc.stale}`);
        }
      }
    }

    if (!ok) {
      const err = new Error(
        `Translation check failed for ${options.lang}: ${pending} pending, ${stale} stale`,
      );
      (err as Error & { checkResult?: CheckResult }).checkResult = result;
      throw err;
    }

    return result;
  } finally {
    db.close();
  }
}
