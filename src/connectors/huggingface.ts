import { createChatCompletionsProvider } from "./chat-completions.js";
import type { TranslationProvider } from "./provider.js";
import { DEFAULT_MODELS } from "./resolve-model.js";

export interface HuggingFaceProviderOptions {
  token?: string;
  model?: string;
}

/**
 * Hugging Face Inference Providers (OpenAI-compatible router).
 * @see https://huggingface.co/docs/inference-providers/guides/open-ai-compatible-api
 */
export function createHuggingFaceProvider(
  options: HuggingFaceProviderOptions = {},
): TranslationProvider {
  const token =
    options.token ?? process.env.HF_TOKEN ?? process.env.HUGGINGFACE_TOKEN;
  const model =
    options.model?.trim() ||
    process.env.POLYGIT_HF_MODEL?.trim() ||
    DEFAULT_MODELS.huggingface;

  return createChatCompletionsProvider({
    name: "huggingface",
    endpoint: "https://router.huggingface.co/v1/chat/completions",
    model,
    ...(token ? { apiKey: token } : {}),
    label: "Hugging Face",
    missingKeyMessage:
      "Missing HF_TOKEN (or HUGGINGFACE_TOKEN). Set it in your environment or .env file.",
    temperature: 0.2,
  });
}
