import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import {
  DEFAULT_MODELS,
  envModelKey,
  formatOllamaModelSize,
  getOllamaHost,
  HUGGINGFACE_CURATED_MODELS,
  isProviderName,
  listOllamaModels,
  PROVIDER_NAMES,
  resolveModel,
  resolveModelSync,
  type ProviderName,
} from "../connectors/index.js";
import {
  readConfig,
  requireProjectRoot,
  writeConfig,
  type TmConfig,
} from "../core/project.js";

export interface ModelsListOptions {
  provider?: ProviderName;
}

export async function runModelsList(options: ModelsListOptions = {}): Promise<void> {
  const root = requireProjectRoot();
  const config = readConfig(root);
  const providers: ProviderName[] = options.provider
    ? [options.provider]
    : [...PROVIDER_NAMES];

  if (!options.provider) {
    console.log("Configured providers and effective models:\n");
    console.log(
      `${pad("Provider", 14)}${pad("Model", 42)}${pad("Source", 10)}Notes`,
    );
    console.log("-".repeat(90));
    for (const name of providers) {
      const resolved = await resolveModel(name, config, { allowOllamaAuto: true });
      const notes =
        name === config.defaultProvider ? "default provider" : "";
      console.log(
        `${pad(name, 14)}${pad(resolved.model, 42)}${pad(resolved.source, 10)}${notes}`,
      );
    }
    console.log("");
  }

  for (const name of providers) {
    if (name === "ollama") {
      await printOllamaDetails(config);
    } else if (name === "huggingface") {
      printHuggingFaceDetails(config);
    } else if (options.provider) {
      printCloudDetails(name, config);
    }
  }

  console.log(
    "Tip: save a default with `polygit models use <provider> <model>`, or pass `--model` to translate.",
  );
}

async function printOllamaDetails(config: TmConfig): Promise<void> {
  const host = getOllamaHost();
  const effective = await resolveModel("ollama", config, { allowOllamaAuto: true });
  console.log(`Ollama (${host})`);
  console.log(`  Effective model: ${effective.model}  [${effective.source}]`);
  try {
    const installed = await listOllamaModels(host);
    if (installed.length === 0) {
      console.log("  No local models found. Pull one with `ollama pull llama3.2`.\n");
      return;
    }
    console.log("  Installed models:");
    for (const m of installed) {
      const mark = m.name === effective.model ? "*" : " ";
      const size = formatOllamaModelSize(m.size);
      const params = m.parameterSize ? ` ${m.parameterSize}` : "";
      const meta = [size, params.trim()].filter(Boolean).join(" · ");
      console.log(`  ${mark} ${m.name}${meta ? `  (${meta})` : ""}`);
    }
    console.log("  (* = effective model)\n");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`  ${msg}\n`);
  }
}

function printHuggingFaceDetails(config: TmConfig): void {
  const effective = resolveModelSync("huggingface", config);
  console.log("Hugging Face (Inference Providers)");
  console.log(`  Effective model: ${effective.model}  [${effective.source}]`);
  console.log("  Suggested instruct models:");
  for (const id of HUGGINGFACE_CURATED_MODELS) {
    const mark = id === effective.model ? "*" : " ";
    console.log(`  ${mark} ${id}`);
  }
  console.log("  (* = effective model)\n");
}

function printCloudDetails(provider: ProviderName, config: TmConfig): void {
  const effective = resolveModelSync(provider, config);
  console.log(`${provider}`);
  console.log(`  Effective model: ${effective.model}  [${effective.source}]`);
  console.log(
    `  Override with models use, --model, or ${envModelKey(provider)}=…\n`,
  );
}

export async function runModelsUse(providerRaw: string, model: string): Promise<void> {
  if (!isProviderName(providerRaw)) {
    throw new Error(
      `Unsupported provider: ${providerRaw}. Use ${PROVIDER_NAMES.join(", ")}.`,
    );
  }
  const provider = providerRaw;
  const modelId = model.trim();
  if (!modelId) {
    throw new Error("Model id must not be empty.");
  }

  const root = requireProjectRoot();
  const config = readConfig(root);

  if (provider === "ollama") {
    try {
      const installed = await listOllamaModels();
      const names = new Set(installed.map((m) => m.name));
      if (installed.length > 0 && !names.has(modelId)) {
        console.warn(
          `Warning: "${modelId}" is not in the local Ollama list. Pull it with:\n  ollama pull ${modelId}`,
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`Warning: could not verify Ollama models (${msg.split("\n")[0]})`);
    }
  }

  writeConfig(root, {
    ...config,
    defaultProvider: provider,
    models: {
      ...config.models,
      [provider]: modelId,
    },
  });

  console.log(`Saved ${provider} model → ${modelId} (.tmconfig.json)`);
  console.log(`Default provider set to ${provider}.`);
  console.log(`  polygit translate <lang>`);
}

/**
 * Interactive picker when several Ollama models are installed and none is configured.
 */
export async function pickOllamaModelInteractively(
  modelNames: string[],
): Promise<string> {
  if (!process.stdin.isTTY) {
    throw new Error(
      `Multiple Ollama models installed (${modelNames.join(", ")}). ` +
        `Pass --model=<name> or run \`polygit models use ollama <name>\`.`,
    );
  }

  console.log("Multiple Ollama models found. Choose one:\n");
  modelNames.forEach((name, i) => {
    console.log(`  ${i + 1}) ${name}`);
  });
  console.log("");

  const rl = readline.createInterface({ input, output });
  try {
    for (;;) {
      const answer = (await rl.question(`Select 1-${modelNames.length} > `)).trim();
      const index = Number.parseInt(answer, 10);
      if (Number.isInteger(index) && index >= 1 && index <= modelNames.length) {
        return modelNames[index - 1]!;
      }
      console.log("Invalid selection.");
    }
  } finally {
    rl.close();
  }
}

function pad(value: string, width: number): string {
  if (value.length >= width) return `${value} `;
  return value + " ".repeat(width - value.length);
}
