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
  const root = requireProjectRoot();
  const config = readConfig(root);
  const db = openProjectDb(root);
  let staleIds: string[] = [];

  try {
    const terms = (
      options.lang
        ? db.prepare(`SELECT id FROM glossary WHERE lang = ?`).all(options.lang)
        : db.prepare(`SELECT id FROM glossary`).all()
    ) as Array<{ id: string }>;

    rebuildGlossaryUsage(db);
    staleIds = markGlossarySegmentsStale(
      db,
      terms.map((t) => t.id),
    );
    console.log(`Marked ${staleIds.length} segment(s) as stale.`);
  } finally {
    db.close();
  }

  if (options.autoRetranslate && staleIds.length > 0) {
    const lang = options.lang ?? config.targetLangs[0];
    if (!lang) {
      throw new Error("No target language available. Pass --lang=<code>.");
    }
    await runTranslate(lang, {
      provider: config.defaultProvider,
      segmentIds: staleIds,
    });
  }
}
