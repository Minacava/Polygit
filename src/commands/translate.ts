import cliProgress from "cli-progress";
import type { ProviderName } from "../connectors/index.js";
import {
  createProvider,
  listOllamaModels,
  redactSecrets,
  resolveModelSync,
} from "../connectors/index.js";
import { pickOllamaModelInteractively } from "./models.js";
import { assertLangCode } from "../core/lang.js";
import { mapPool, TranslationMemoryIndex } from "../core/matcher.js";
import { writeOutputDocuments } from "../core/output.js";
import { missingPlaceholders } from "../core/placeholders.js";
import {
  computeStyleHash,
  hasStyleConfig,
  loadStyleGuideText,
  openProjectDb,
  readConfig,
  requireProjectRoot,
  resolveInsideProject,
  resolveStyleForDocument,
  styleHashesMatch,
  toPosixRelative,
  writeConfig,
} from "../core/project.js";
import {
  getGlossary,
  getTmEntries,
  listSegmentsForTranslate,
  markStyleHashStaleByExpected,
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
   * Skip auto-creating/checking out `polygit/<lang>-YYYYMMDD` when on main/master.
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
  const config = readConfig(root);
  const cliStyle = {
    ...(options.style !== undefined ? { style: options.style } : {}),
    ...(options.formality !== undefined ? { formality: options.formality } : {}),
  };
  const styleGuide = loadStyleGuideText(root, config.style);
  const styleActive =
    hasStyleConfig(config.style) ||
    options.style !== undefined ||
    options.formality !== undefined;
  const expectedStyleHash = (docPath: string) =>
    computeStyleHash(
      resolveStyleForDocument(config.style, {
        documentPath: docPath,
        lang,
        ...cliStyle,
      }),
      styleGuide,
    );
  const providerName: ProviderName = options.provider ?? config.defaultProvider;
  const modelChoice = await resolveTranslateModel(providerName, config, options.model);

  let documentPath: string | undefined;
  if (options.doc) {
    documentPath = toPosixRelative(root, resolveInsideProject(root, options.doc));
  }

  const db = openProjectDb(root);
  try {
    // Style changes (config or CLI) mark mismatched translations stale before listing work.
    if (styleActive) {
      markStyleHashStaleByExpected(db, lang, expectedStyleHash);
    }

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
        approved: e.approved,
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
      const resolvedStyle = resolveStyleForDocument(config.style, {
        documentPath: segment.document_path,
        lang,
        ...cliStyle,
      });
      const styleHash = computeStyleHash(resolvedStyle, styleGuide);
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
          // Exact hits are already approved in TM; bump usage without demoting.
          upsertTranslationMemory(
            db,
            segment.source_text,
            match.entry.target_text,
            lang,
            styleHash,
            { approved: true },
          );
          tmIndex.add({
            id: match.entry.id,
            source_text: segment.source_text,
            target_text: match.entry.target_text,
            lang,
            usage_count: 1,
            style_hash: styleHash,
            approved: 1,
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

    // Create/checkout the work branch only when there is real work and not dry-run.
    if (!options.dryRun && !options.noBranch && (llmQueue.length > 0 || tmExact > 0 || tmFuzzy > 0)) {
      await ensureTranslationBranch(root, lang);
    }

    let llmDone = 0;
    const failures: Array<{ id: string; error: string }> = [];
    let consecutiveFailures = 0;
    const maxConsecutive = 3;
    let stopWorkers = false;

    try {
      await mapPool(llmQueue, concurrency, async (segment) => {
        if (stopWorkers) return;

        const resolvedStyle = resolveStyleForDocument(config.style, {
          documentPath: segment.document_path,
          lang,
          ...cliStyle,
        });
        const styleHash = computeStyleHash(resolvedStyle, styleGuide);
        const maxAttempts = Math.max(1, (options.placeholderRetries ?? 1) + 1);
        let translated = "";
        let missing: string[] = [];

        try {
          for (let attempt = 0; attempt < maxAttempts; attempt++) {
            translated = await ensureProvider().translateSegment(
              segment.source_text,
              config.sourceLang,
              lang,
              {
                glossary,
                documentPath: segment.document_path,
                ...(resolvedStyle ? { style: resolvedStyle } : {}),
                ...(styleGuide ? { styleGuide } : {}),
                ...(attempt > 0
                  ? {
                      notes:
                        `Previous translation dropped required placeholders: ${missing.join(", ")}. ` +
                        `Preserve every placeholder, HTML tag, and link/image URL exactly (link text may change).`,
                    }
                  : {}),
              },
            );
            missing = missingPlaceholders(segment.source_text, translated);
            if (missing.length === 0) break;
          }
        } catch (err) {
          const message = redactSecrets(err instanceof Error ? err.message : String(err));
          failures.push({ id: segment.id, error: message });
          consecutiveFailures += 1;
          if (consecutiveFailures >= maxConsecutive) stopWorkers = true;
          console.warn(
            `LLM failed for ${segment.document_path} (${segment.id.slice(0, 8)}…): ${message}`,
          );
          llmDone += 1;
          bar?.update(llmDone);
          return;
        }

        consecutiveFailures = 0;

        if (missing.length > 0) {
          // Persist as needs_fix; output writer keeps source text on disk.
          upsertTranslation(
            db,
            segment.id,
            lang,
            translated,
            "llm",
            false,
            styleHash,
            "needs_fix",
          );
          console.warn(
            `Placeholder check failed for ${segment.document_path} (${segment.id.slice(0, 8)}…): missing ${missing.join(", ")}. Marked needs_fix.`,
          );
        } else {
          upsertTranslation(db, segment.id, lang, translated, "llm", false, styleHash);
          // Draft TM only — exact reuse waits for review approval (PG-12).
          upsertTranslationMemory(db, segment.source_text, translated, lang, styleHash, {
            approved: false,
          });
          tmIndex.add({
            id: `runtime_${segment.id}`,
            source_text: segment.source_text,
            target_text: translated,
            lang,
            usage_count: 1,
            style_hash: styleHash,
            approved: 0,
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
      // Always write whatever succeeded so disk stays coherent after partial failure.
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
    if (failures.length > 0) {
      console.error(`${failures.length} segment(s) failed during translate.`);
      process.exitCode = 1;
    }
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

