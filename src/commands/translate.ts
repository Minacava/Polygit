import cliProgress from "cli-progress";
import type { ProviderName } from "../connectors/index.js";
import {
  createProvider,
  listOllamaModels,
  resolveModelSync,
} from "../connectors/index.js";
import { pickOllamaModelInteractively } from "./models.js";
import { assertLangCode } from "../core/lang.js";
import { mapPool, TranslationMemoryIndex } from "../core/matcher.js";
import { writeOutputDocuments } from "../core/output.js";
import { missingPlaceholders } from "../core/placeholders.js";
import {
  computeStyleHash,
  openProjectDb,
  readConfig,
  requireProjectRoot,
  resolveInsideProject,
  resolveStyle,
  styleHashesMatch,
  toPosixRelative,
  writeConfig,
} from "../core/project.js";
import {
  getGlossary,
  getTmEntries,
  listSegmentsForTranslate,
  markStyleHashStale,
  upsertTranslation,
  upsertTranslationMemory,
} from "../core/repository.js";
import { ensureTranslationBranch } from "../git/translation-branch.js";

/** Default parallel LLM calls during translate. */
export const DEFAULT_TRANSLATE_CONCURRENCY = 3;

export interface TranslateOptions {
  doc?: string;
  provider?: ProviderName;
  /** One-off model override (also see `polygit models use`). */
  model?: string;
  dryRun?: boolean;
  segmentIds?: string[];
  /** Apply fuzzy TM hits as draft translations (still unapproved). Default: skip to LLM. */
  acceptFuzzy?: boolean;
  /** Max concurrent LLM segment translations (default 3). */
  concurrency?: number;
  /** Test seam: inject a provider instead of creating one. */
  providerInstance?: import("../connectors/index.js").TranslationProvider;
  /** Max LLM retries when placeholders are dropped (default 1 retry). */
  placeholderRetries?: number;
  /**
   * Skip auto-creating/checking out `polygit/translate-<lang>-…` when on main/master.
   */
  noBranch?: boolean;
  /** CLI style preset override (wins over config). */
  style?: string;
  /** CLI formality override (wins over config). */
  formality?: string;
}

export async function runTranslate(lang: string, options: TranslateOptions = {}): Promise<void> {
  assertLangCode(lang);
  const root = requireProjectRoot();
  if (!options.noBranch) {
    await ensureTranslationBranch(root, lang);
  }
  const config = readConfig(root);
  const resolvedStyle = resolveStyle(config.style, {
    ...(options.style !== undefined ? { style: options.style } : {}),
    ...(options.formality !== undefined ? { formality: options.formality } : {}),
  });
  const styleHash = computeStyleHash(resolvedStyle);
  const providerName: ProviderName = options.provider ?? config.defaultProvider;
  const modelChoice = await resolveTranslateModel(providerName, config, options.model);

  let documentPath: string | undefined;
  if (options.doc) {
    documentPath = toPosixRelative(root, resolveInsideProject(root, options.doc));
  }

  const db = openProjectDb(root);
  try {
    // Style changes (config or CLI) mark mismatched translations stale before listing work.
    markStyleHashStale(db, styleHash, lang);

    const segments = listSegmentsForTranslate(db, {
      lang,
      ...(documentPath ? { documentPath } : {}),
      ...(options.segmentIds ? { segmentIds: options.segmentIds } : {}),
    });

    if (segments.length === 0) {
      console.log(`No segments need translation for lang=${lang}.`);
      return;
    }

    const tmIndex = new TranslationMemoryIndex(
      getTmEntries(db, lang).map((e) => ({
        id: e.id,
        source_text: e.source_text,
        target_text: e.target_text,
        lang: e.lang,
        usage_count: e.usage_count,
        style_hash: e.style_hash,
      })),
    );

    const glossary = getGlossary(db, lang).map((g) => ({
      sourceTerm: g.source_term,
      targetTerm: g.target_term,
      note: g.note,
    }));

    let provider: ReturnType<typeof createProvider> | null = null;
    const ensureProvider = () => {
      if (options.providerInstance) return options.providerInstance;
      provider ??= createProvider(providerName, { model: modelChoice.model });
      return provider;
    };

    let tmExact = 0;
    let tmFuzzy = 0;
    let llm = 0;
    const touchedDocs = new Set<string>();
    const llmQueue: typeof segments = [];

    for (const segment of segments) {
      touchedDocs.add(segment.document_path);
      const match = tmIndex.match(segment.source_text);

      if (match?.kind === "exact" && styleHashesMatch(match.entry.style_hash, styleHash)) {
        if (!options.dryRun) {
          upsertTranslation(
            db,
            segment.id,
            lang,
            match.entry.target_text,
            "tm-exact",
            false,
            styleHash,
          );
          upsertTranslationMemory(
            db,
            segment.source_text,
            match.entry.target_text,
            lang,
            styleHash,
          );
          tmIndex.add({
            id: match.entry.id,
            source_text: segment.source_text,
            target_text: match.entry.target_text,
            lang,
            usage_count: 1,
            style_hash: styleHash,
          });
        }
        tmExact += 1;
        continue;
      }

      if (match?.kind === "fuzzy") {
        if (options.acceptFuzzy) {
          if (!options.dryRun) {
            upsertTranslation(
              db,
              segment.id,
              lang,
              match.entry.target_text,
              "tm-fuzzy",
              false,
              styleHash,
            );
          }
          tmFuzzy += 1;
          continue;
        }
      }

      if (options.dryRun) {
        llm += 1;
        continue;
      }

      llmQueue.push(segment);
    }

    const concurrency = options.concurrency ?? DEFAULT_TRANSLATE_CONCURRENCY;
    const showProgress =
      llmQueue.length > 0 && !options.dryRun && Boolean(process.stdout.isTTY);
    if (llmQueue.length > 0) {
      console.log(
        `Translating → ${lang}: tm-exact=${tmExact}, tm-fuzzy=${tmFuzzy}, llm=${llmQueue.length} pending…`,
      );
    }

    let bar: cliProgress.SingleBar | null = null;
    if (showProgress) {
      bar = new cliProgress.SingleBar(
        {
          format: "LLM [{bar}] {percentage}% | {value}/{total} segments",
          clearOnComplete: true,
          hideCursor: true,
        },
        cliProgress.Presets.shades_classic,
      );
      bar.start(llmQueue.length, 0);
    }

    let llmDone = 0;
    try {
      await mapPool(llmQueue, concurrency, async (segment) => {
        const maxAttempts = Math.max(1, (options.placeholderRetries ?? 1) + 1);
        let translated = "";
        let missing: string[] = [];
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          translated = await ensureProvider().translateSegment(
            segment.source_text,
            config.sourceLang,
            lang,
            {
              glossary,
              documentPath: segment.document_path,
              ...(resolvedStyle ? { style: resolvedStyle } : {}),
              ...(attempt > 0
                ? {
                    notes:
                      `Previous translation dropped required placeholders: ${missing.join(", ")}. ` +
                      `Preserve every placeholder, HTML tag, and link exactly.`,
                  }
                : {}),
            },
          );
          missing = missingPlaceholders(segment.source_text, translated);
          if (missing.length === 0) break;
        }

        if (missing.length > 0) {
          // Keep draft for review; do not write broken text into TM as exact memory.
          upsertTranslation(db, segment.id, lang, translated, "llm", false, styleHash);
          console.warn(
            `Placeholder check failed for ${segment.document_path} (${segment.id.slice(0, 8)}…): missing ${missing.join(", ")}. Left unapproved for review.`,
          );
        } else {
          upsertTranslation(db, segment.id, lang, translated, "llm", false, styleHash);
          upsertTranslationMemory(db, segment.source_text, translated, lang, styleHash);
          tmIndex.add({
            id: `runtime_${segment.id}`,
            source_text: segment.source_text,
            target_text: translated,
            lang,
            usage_count: 1,
            style_hash: styleHash,
          });
        }
        llm += 1;
        llmDone += 1;
        bar?.update(llmDone);
      });
    } finally {
      bar?.stop();
    }

    let written: string[] = [];
    if (!options.dryRun) {
      written = writeOutputDocuments(db, root, lang, [...touchedDocs]);
      if (!config.targetLangs.includes(lang)) {
        writeConfig(root, {
          ...config,
          targetLangs: [...config.targetLangs, lang],
        });
      }
    }

    const prefix = options.dryRun ? "[dry-run] " : "";
    console.log(
      `${prefix}Translated ${segments.length} segment(s) → ${lang} (tm-exact=${tmExact}, tm-fuzzy=${tmFuzzy}, llm=${llm}, provider=${providerName}, model=${modelChoice.model})`,
    );
    if (written.length) console.log(`  wrote: ${written.join(", ")}`);
  } finally {
    db.close();
  }
}

async function resolveTranslateModel(
  providerName: ProviderName,
  config: ReturnType<typeof readConfig>,
  cliModel?: string,
): Promise<{ model: string; source: string }> {
  const sync = resolveModelSync(providerName, config, cliModel);
  if (sync.source !== "default") {
    return sync;
  }
  if (providerName !== "ollama") {
    return sync;
  }

  try {
    const installed = await listOllamaModels();
    if (installed.length === 1 && installed[0]) {
      return { model: installed[0].name, source: "auto" };
    }
    if (installed.length > 1) {
      const picked = await pickOllamaModelInteractively(installed.map((m) => m.name));
      return { model: picked, source: "cli" };
    }
  } catch {
    // Ollama unreachable — keep hardcoded default.
  }

  return sync;
}

