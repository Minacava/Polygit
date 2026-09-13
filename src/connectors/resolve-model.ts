import type { TmConfig } from "../core/project.js";
import { listOllamaModels } from "./ollama-models.js";
import type { ProviderName } from "./provider.js";

export type ModelSource = "cli" | "config" | "env" | "auto" | "default";

export interface ResolvedModel {
  model: string;
  source: ModelSource;
}

export const DEFAULT_MODELS: Record<ProviderName, string> = {
  claude: "claude-3-5-haiku-latest",
  openai: "gpt-4o-mini",
  ollama: "llama3.2",
  huggingface: "meta-llama/Meta-Llama-3-8B-Instruct",
};

const ENV_MODEL_KEYS: Record<ProviderName, string> = {
  claude: "POLYGIT_CLAUDE_MODEL",
  openai: "POLYGIT_OPENAI_MODEL",
  ollama: "POLYGIT_OLLAMA_MODEL",
  huggingface: "POLYGIT_HF_MODEL",
};

export function envModelKey(provider: ProviderName): string {
  return ENV_MODEL_KEYS[provider];
}

export function getEnvModel(provider: ProviderName): string | undefined {
  const value = process.env[ENV_MODEL_KEYS[provider]]?.trim();
  return value || undefined;
}

export interface ResolveModelOptions {
  /** CLI `--model` override. */
  cliModel?: string;
  /**
   * When true and provider is ollama with no explicit model, query `/api/tags`
   * and auto-pick if exactly one model is installed.
   */
  allowOllamaAuto?: boolean;
}

/**
 * Resolve which model id to use for a provider.
 * Priority: CLI → config.models → env → Ollama auto (optional) → hardcoded default.
 */
export async function resolveModel(
  provider: ProviderName,
  config: Pick<TmConfig, "models"> | undefined,
  options: ResolveModelOptions = {},
): Promise<ResolvedModel> {
  const cli = options.cliModel?.trim();
  if (cli) return { model: cli, source: "cli" };

  const fromConfig = config?.models?.[provider]?.trim();
  if (fromConfig) return { model: fromConfig, source: "config" };

  const fromEnv = getEnvModel(provider);
  if (fromEnv) return { model: fromEnv, source: "env" };

  if (provider === "ollama" && options.allowOllamaAuto !== false) {
    try {
      const installed = await listOllamaModels();
      if (installed.length === 1 && installed[0]) {
        return { model: installed[0].name, source: "auto" };
      }
    } catch {
      // Ollama may be down; fall through to hardcoded default.
    }
  }

  return { model: DEFAULT_MODELS[provider], source: "default" };
}

/** Sync resolution without Ollama network auto-pick (for display / non-async paths). */
export function resolveModelSync(
  provider: ProviderName,
  config: Pick<TmConfig, "models"> | undefined,
  cliModel?: string,
): ResolvedModel {
  const cli = cliModel?.trim();
  if (cli) return { model: cli, source: "cli" };

  const fromConfig = config?.models?.[provider]?.trim();
  if (fromConfig) return { model: fromConfig, source: "config" };

  const fromEnv = getEnvModel(provider);
  if (fromEnv) return { model: fromEnv, source: "env" };

  return { model: DEFAULT_MODELS[provider], source: "default" };
}

/** Curated Hugging Face instruct models suitable for translation. */
export const HUGGINGFACE_CURATED_MODELS: string[] = [
  "meta-llama/Meta-Llama-3-8B-Instruct",
  "mistralai/Mistral-7B-Instruct-v0.3",
  "HuggingFaceH4/zephyr-7b-beta",
  "Qwen/Qwen2.5-7B-Instruct",
  "google/gemma-2-9b-it",
];
