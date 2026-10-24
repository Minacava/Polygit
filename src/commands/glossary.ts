import { assertLangCode } from "../core/lang.js";
import { openProjectDb, readConfig, requireProjectRoot } from "../core/project.js";
import {
  markGlossarySegmentsStale,
  rebuildGlossaryUsage,
  upsertGlossaryTerm,
} from "../core/repository.js";
import { runTranslate } from "./translate.js";

export interface GlossaryAddOptions {
  lang: string;
  note?: string;
}

export function runGlossaryAdd(
  sourceTerm: string,
  targetTerm: string,
  options: GlossaryAddOptions,
): void {
  assertLangCode(options.lang);
  const root = requireProjectRoot();
  const db = openProjectDb(root);
  try {
    const { row, changed } = upsertGlossaryTerm(
      db,
      sourceTerm,
      targetTerm,
      options.lang,
      options.note,
    );
    rebuildGlossaryUsage(db, row.id);
    console.log(
      `${changed ? "Saved" : "Unchanged"} glossary term [${options.lang}] "${row.source_term}" → "${row.target_term}"`,
    );
  } finally {
    db.close();
  }
}

export interface GlossarySyncOptions {
  lang?: string;
  autoRetranslate?: boolean;
}

export async function runGlossarySync(options: GlossarySyncOptions = {}): Promise<void> {
  if (options.lang !== undefined) assertLangCode(options.lang);
  const root = requireProjectRoot();
  const config = readConfig(root);
  const staleByLang = new Map<string, string[]>();

  const db = openProjectDb(root);
  try {
    const terms = (
      options.lang
        ? db
            .prepare(`SELECT id, lang FROM glossary WHERE lang = ?`)
            .all(options.lang)
        : db.prepare(`SELECT id, lang FROM glossary`).all()
    ) as Array<{ id: string; lang: string }>;

    rebuildGlossaryUsage(db);

    const byLang = new Map<string, string[]>();
    for (const term of terms) {
      const list = byLang.get(term.lang) ?? [];
      list.push(term.id);
      byLang.set(term.lang, list);
    }

    for (const [lang, ids] of byLang) {
      const staleIds = markGlossarySegmentsStale(db, ids, lang);
      if (staleIds.length > 0) staleByLang.set(lang, staleIds);
    }

    const total = [...staleByLang.values()].reduce((n, ids) => n + ids.length, 0);
    console.log(`Marked ${total} segment(s) as stale across ${staleByLang.size} language(s).`);
  } finally {
    db.close();
  }

  if (options.autoRetranslate && staleByLang.size > 0) {
    for (const [lang, segmentIds] of staleByLang) {
      await runTranslate(lang, {
        provider: config.defaultProvider,
        segmentIds,
        noBranch: true,
      });
    }
  }
}
