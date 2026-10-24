import { fetchJson, HttpJsonError } from "../http/fetch-json.js";
import {
  buildTranslationMessages,
  redactSecrets,
  sanitizeLlmTranslation,
  type ChatMessage,
  type TranslateContext,
  type TranslationProvider,
} from "./provider.js";
import { DEFAULT_MODELS } from "./resolve-model.js";

interface ClaudeResponse {
  content?: Array<{ type: string; text?: string }>;
  stop_reason?: string | null;
  error?: { message?: string };
}

export interface ClaudeProviderOptions {
  apiKey?: string;
  model?: string;
  fetchImpl?: typeof fetch;
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

  async function complete(messages: ChatMessage[]): Promise<string> {
    const system = messages.find((m) => m.role === "system")?.content ?? "";
    const userParts = messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content }));
    const user =
      userParts.length > 0
        ? userParts
        : [{ role: "user" as const, content: messages.map((m) => m.content).join("\n") }];

    let result;
    try {
      result = await fetchJson<ClaudeResponse>("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model,
          max_tokens: Math.min(8192, Math.max(1024, Math.ceil(
            messages.reduce((n, m) => n + m.content.length, 0) * 1.5,
          ))),
          system,
          messages: user,
        }),
        ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
      });
    } catch (err) {
      if (err instanceof HttpJsonError) {
        throw new Error(`Claude API error (${err.status}): ${redactSecrets(err.message)}`);
      }
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Claude request failed: ${redactSecrets(msg)}`);
    }

    if (!result.ok) {
      const detail = result.data.error?.message ?? `HTTP ${result.status}`;
      throw new Error(`Claude API error (${result.status}): ${redactSecrets(detail)}`);
    }

    if (result.data.stop_reason === "max_tokens") {
      throw new Error("Claude output truncated (max_tokens); segment too long.");
    }

    const textOut = result.data.content?.find((c) => c.type === "text")?.text?.trim();
    if (!textOut) {
      throw new Error("Claude returned an empty response.");
    }
    return textOut;
  }

  return {
    name: "claude",

    async translateSegment(
      text: string,
      sourceLang: string,
      targetLang: string,
      context?: TranslateContext,
    ): Promise<string> {
      const raw = await complete(
        buildTranslationMessages(text, sourceLang, targetLang, context),
      );
      return sanitizeLlmTranslation(raw, text);
    },

    complete,
  };
}
