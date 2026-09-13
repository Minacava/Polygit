import type { ProviderName } from "../connectors/index.js";
import {
  createProvider,
  listOllamaModels,
  resolveModelSync,
} from "../connectors/index.js";
import { pickOllamaModelInteractively } from "./models.js";
import { matchTranslationMemory } from "../core/matcher.js";
import { writeOutputDocuments } from "../core/output.js";
import {
  openProjectDb,
  readConfig,
  requireProjectRoot,
  resolveInsideProject,
  toPosixRelative,
  writeConfig,
} from "../core/project.js";
import {
  getGlossary,
  getTmEntries,
  listSegmentsForTranslate,
  upsertTranslation,
  upsertTranslationMemory,
} from "../core/repository.js";

export interface TranslateOptions {
  doc?: string;
  provider?: ProviderName;
  /** One-off model override (also see `polygit models use`). */
  model?: string;
  dryRun?: boolean;
  segmentIds?: string[];
}

export async function runTranslate(lang: string, options: TranslateOptions = {}): Promise<void> {
  const root = requireProjectRoot();
  const config = readConfig(root);
  const providerName: ProviderName = options.provider ?? config.defaultProvider;
  const modelChoice = await resolveTranslateModel(providerName, config, options.model);

  let documentPath: string | undefined;
  if (options.doc) {
    documentPath = toPosixRelative(root, resolveInsideProject(root, options.doc));
  }

  const db = openProjectDb(root);
  try {
    const segments = listSegmentsForTranslate(db, {
      lang,
      ...(documentPath ? { documentPath } : {}),
      ...(options.segmentIds ? { segmentIds: options.segmentIds } : {}),
    });

    if (segments.length === 0) {
      console.log(`No segments need translation for lang=${lang}.`);
      return;
    }

    const tmEntries = getTmEntries(db, lang).map((e) => ({
      id: e.id,
      source_text: e.source_text,
      target_text: e.target_text,
      lang: e.lang,
      usage_count: e.usage_count,
    }));

    const glossary = getGlossary(db, lang).map((g) => ({
      sourceTerm: g.source_term,
      targetTerm: g.target_term,
      note: g.note,
    }));

    let provider: ReturnType<typeof createProvider> | null = null;
    const ensureProvider = () => {
      provider ??= createProvider(providerName, { model: modelChoice.model });
      return provider;
    };

    let tmExact = 0;
    let tmFuzzy = 0;
    let llm = 0;
    const touchedDocs = new Set<string>();

    for (const segment of segments) {
      touchedDocs.add(segment.document_path);
      const match = matchTranslationMemory(segment.source_text, tmEntries);

      if (match?.kind === "exact") {
        if (!options.dryRun) {
          upsertTranslation(db, segment.id, lang, match.entry.target_text, "tm-exact");
          upsertTranslationMemory(db, segment.source_text, match.entry.target_text, lang);
        }
        tmExact += 1;
        continue;
      }

      if (match?.kind === "fuzzy") {
        if (!options.dryRun) {
          upsertTranslation(db, segment.id, lang, match.entry.target_text, "tm-fuzzy");
          upsertTranslationMemory(db, segment.source_text, match.entry.target_text, lang);
        }
        tmFuzzy += 1;
        continue;
      }

      if (options.dryRun) {
        llm += 1;
        continue;
      }

      const translated = await ensureProvider().translateSegment(
        segment.source_text,
        config.sourceLang,
        lang,
        { glossary, documentPath: segment.document_path },
      );
      upsertTranslation(db, segment.id, lang, translated, "llm");
      upsertTranslationMemory(db, segment.source_text, translated, lang);
      tmEntries.push({
        id: `runtime_${tmEntries.length}`,
        source_text: segment.source_text,
        target_text: translated,
        lang,
        usage_count: 1,
      });
      llm += 1;
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

