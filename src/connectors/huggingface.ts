import { createChatCompletionsProvider } from "./chat-completions.js";
import type { TranslationProvider } from "./provider.js";

/**
 * Hugging Face Inference Providers (OpenAI-compatible router).
 * @see https://huggingface.co/docs/inference-providers/guides/open-ai-compatible-api
 */
export function createHuggingFaceProvider(
  token = process.env.HF_TOKEN ?? process.env.HUGGINGFACE_TOKEN,
): TranslationProvider {
  return createChatCompletionsProvider({
    name: "huggingface",
    endpoint: "https://router.huggingface.co/v1/chat/completions",
    model:
      process.env.POLYGIT_HF_MODEL ?? "meta-llama/Meta-Llama-3-8B-Instruct",
    ...(token ? { apiKey: token } : {}),
    label: "Hugging Face",
    missingKeyMessage:
      "Missing HF_TOKEN (or HUGGINGFACE_TOKEN). Set it in your environment or .env file.",
    temperature: 0.2,
  });
}
