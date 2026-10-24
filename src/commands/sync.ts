import type { ProviderName } from "../connectors/index.js";
import { assertLangCode } from "../core/lang.js";
import {
  openProjectDb,
  readConfig,
  requireProjectRoot,
} from "../core/project.js";
import { scanContentDrift } from "./check.js";
import { runImport } from "./import.js";
import { runTranslate } from "./translate.js";

export interface SyncOptions {
  /** Limit translation to one language (default: all targetLangs). */
  lang?: string;
  provider?: ProviderName;
  model?: string;
  dryRun?: boolean;
  /** CLI style preset override (passed to translate). */
  style?: string;
  /** CLI formality override (passed to translate). */
  formality?: string;
  /** Test seam: inject a provider instead of creating one. */
  providerInstance?: import("../connectors/index.js").TranslationProvider;
}

function resolveSyncLangs(targetLangs: string[], langOption?: string): string[] {
  if (langOption !== undefined) {
    return [assertLangCode(langOption)];
  }
  if (targetLangs.length === 0) {
    throw new Error(
      'No languages to sync. Pass --lang=<code> or set targetLangs in .tmconfig.json.',
    );
  }
  return targetLangs.map((l) => assertLangCode(l));
}

/**
 * Import NEW/CHANGED sources then translate them.
 * Translations are always left unapproved — publish still requires review.
 */
export async function runSync(options: SyncOptions = {}): Promise<{
  imported: string[];
  langs: string[];
  dryRun: boolean;
}> {
  const root = requireProjectRoot();
  const config = readConfig(root);
  const langs = resolveSyncLangs(config.targetLangs, options.lang);

  const db = openProjectDb(root);
  let drift;
  try {
    drift = scanContentDrift(db, root, config, langs);
  } finally {
    db.close();
  }

  const toImport = [...new Set([...drift.newFiles, ...drift.changedFiles])].sort();

  if (toImport.length === 0) {
    console.log("sync: nothing to do (no NEW or CHANGED source files)");
    return { imported: [], langs, dryRun: Boolean(options.dryRun) };
  }

  if (options.dryRun) {
    console.log(
      `[dry-run] sync would import ${toImport.length} ${toImport.length === 1 ? "file" : "files"}:`,
    );
    for (const rel of toImport) {
      const kind = drift.newFiles.includes(rel) ? "NEW" : "CHANGED";
      console.log(`  ${kind}  ${rel}`);
    }
    console.log(`[dry-run] then translate to: ${langs.join(", ")}`);
    console.log("[dry-run] translations would remain unapproved (review still required)");
    return { imported: toImport, langs, dryRun: true };
  }

  console.log(
    `sync: importing ${toImport.length} ${toImport.length === 1 ? "file" : "files"}…`,
  );
  for (const rel of toImport) {
    runImport(rel);
  }

  for (const lang of langs) {
    console.log(`sync: translating → ${lang} (unapproved)…`);
    await runTranslate(lang, {
      ...(options.provider !== undefined ? { provider: options.provider } : {}),
      ...(options.model ? { model: options.model } : {}),
      ...(options.style !== undefined ? { style: options.style } : {}),
      ...(options.formality !== undefined ? { formality: options.formality } : {}),
      ...(options.providerInstance ? { providerInstance: options.providerInstance } : {}),
      // Avoid branch churn when syncing multiple languages.
      noBranch: true,
    });
  }

  console.log(
    "sync: done. Translations are unapproved — run `polygit review` before publish.",
  );
  return { imported: toImport, langs, dryRun: false };
}
