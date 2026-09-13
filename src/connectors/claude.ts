import {
  buildTranslationMessages,
  redactSecrets,
  type TranslateContext,
  type TranslationProvider,
} from "./provider.js";
import { DEFAULT_MODELS } from "./resolve-model.js";

interface ClaudeResponse {
  content?: Array<{ type: string; text?: string }>;
  error?: { message?: string };
}

export interface ClaudeProviderOptions {
  apiKey?: string;
  model?: string;
}

export function createClaudeProvider(
  options: ClaudeProviderOptions = {},
): TranslationProvider {
  const apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("Missing ANTHROPIC_API_KEY. Set it in your environment or .env file.");
  }

  const key = apiKey;
  const model =
    options.model?.trim() ||
    process.env.POLYGIT_CLAUDE_MODEL?.trim() ||
    DEFAULT_MODELS.claude;

  return {
    name: "claude",

    async translateSegment(
      text: string,
      sourceLang: string,
      targetLang: string,
      context?: TranslateContext,
    ): Promise<string> {
      const messages = buildTranslationMessages(text, sourceLang, targetLang, context);
      const system = messages.find((m) => m.role === "system")?.content ?? "";
      const user = messages.find((m) => m.role === "user")?.content ?? text;

      let response: Response;
      try {
        response = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": key,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model,
            max_tokens: 2048,
            system,
            messages: [{ role: "user", content: user }],
          }),
          signal: AbortSignal.timeout(60_000),
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`Claude request failed: ${redactSecrets(msg)}`);
      }

      const body = (await response.json()) as ClaudeResponse;
      if (!response.ok) {
        const detail = body.error?.message ?? response.statusText;
        throw new Error(`Claude API error (${response.status}): ${redactSecrets(detail)}`);
      }

      const textOut = body.content?.find((c) => c.type === "text")?.text?.trim();
      if (!textOut) {
        throw new Error("Claude returned an empty translation.");
      }
      return textOut;
    },
  };
}
