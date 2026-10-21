import {
  createProvider,
  resolveModelSync,
  type ChatMessage,
  type ProviderName,
  type TranslationProvider,
} from "../connectors/index.js";
import { readConfig, type TmConfig } from "../core/project.js";

/** Max characters of git diff passed to the LLM for commit messages. */
export const MAX_DIFF_CHARS = 8_000;

export function defaultCommitMessage(now = new Date()): string {
  return `translate: update content (${now.toISOString().slice(0, 10)})`;
}

export function truncateDiff(diff: string, maxChars = MAX_DIFF_CHARS): string {
  if (diff.length <= maxChars) return diff;
  return `${diff.slice(0, maxChars)}\n\n…[diff truncated]`;
}

/** Normalize model output to a single-line conventional-ish commit subject. */
export function sanitizeCommitMessage(raw: string): string {
  const line =
    raw
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l.length > 0 && !l.startsWith("```")) ?? "";
  const cleaned = line
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/^(commit message|message)\s*:\s*/i, "")
    .trim();
  if (!cleaned) {
    throw new Error("LLM returned an empty commit message.");
  }
  return cleaned.slice(0, 200);
}

export function buildCommitMessageMessages(diff: string): ChatMessage[] {
  const body = truncateDiff(diff);
  return [
    {
      role: "system",
      content: [
        "You write concise git commit subjects for translation/i18n changes.",
        "Reply with ONE line only: a conventional commit subject.",
        "Prefer the form: translate(<lang>): <short summary>",
        "or: translate: <short summary> when the language is unclear.",
        "Mention languages and notable files when obvious from the diff.",
        "No quotes, no markdown fences, no body, no explanation.",
      ].join("\n"),
    },
    {
      role: "user",
      content:
        `Write a commit message for these translation-related changes:\n\n${body}`,
    },
  ];
}

export interface GenerateCommitMessageOptions {
  diff: string;
  projectRoot: string;
  /** Override config (tests). */
  config?: TmConfig;
  /** Injected provider (tests). */
  providerInstance?: TranslationProvider;
  providerName?: ProviderName;
  model?: string;
}

export async function generateCommitMessage(
  options: GenerateCommitMessageOptions,
): Promise<string> {
  const config = options.config ?? readConfig(options.projectRoot);
  const providerName = options.providerName ?? config.defaultProvider;
  const resolved = resolveModelSync(providerName, config, options.model);
  const provider =
    options.providerInstance ??
    createProvider(providerName, { model: resolved.model });

  if (typeof provider.complete !== "function") {
    throw new Error(
      `Provider "${provider.name}" cannot generate commit messages (missing complete()).`,
    );
  }

  const raw = await provider.complete(buildCommitMessageMessages(options.diff));
  return sanitizeCommitMessage(raw);
}
